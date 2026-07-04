/**
 * Plugin de autenticación/autorización para Fastify.
 *
 * Hace tres cosas:
 *  1. Monta el handler de better-auth en `GET|POST /api/auth/*` (login, logout,
 *     sesión, etc.) convirtiendo la petición de Fastify a `Request` web y
 *     devolviendo la respuesta (incluidas las cookies `set-cookie`).
 *  2. Decora cada petición con `obtenerSesion()`: resuelve perezosamente la
 *     `SesionUsuario` de dominio (better-auth → permisos + empresa activa) y la
 *     memoiza por petición. Devuelve `null` si no hay sesión válida.
 *  3. Expone `app.conPermiso(clave)`: preHandler que exige sesión y un permiso
 *     server-side (deny-by-default, §9.2). Lo usan TODAS las rutas protegidas.
 *
 * Las rutas no implementan autorización a mano: declaran `preHandler:
 * app.conPermiso('...')` y reciben la sesión ya resuelta con `req.obtenerSesion()`.
 */
import { fromNodeHeaders } from 'better-auth/node';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';

import type { ClavePermiso } from '../contrato/index.js';
import { prisma, type PrismaClient } from '../datos/index.js';
import type { SesionUsuario } from '../comun/permisos.js';

import { auth as authSingleton, type Auth } from './config.js';
import {
  armarSesionUsuario,
  empresaSolicitada,
  HEADER_EMPRESA_ACTIVA,
  type UsuarioAutenticado,
} from './sesion.js';

/** Métodos y URL del catch-all de better-auth. */
const RUTA_AUTH = '/auth/*';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Resuelve la `SesionUsuario` de dominio de esta petición (memoizada):
     * lee la cookie de sesión, carga permisos y empresa activa. `null` si no
     * hay sesión válida o el usuario ya no puede operar.
     */
    obtenerSesion(): Promise<SesionUsuario | null>;
  }
  interface FastifyInstance {
    /** La instancia de better-auth (por si una ruta necesita su API directamente). */
    auth: Auth;
    /**
     * Guard de autorización: exige sesión y el permiso indicado (deny-by-default).
     * Sin sesión → 401; con sesión pero sin el permiso → 403. En éxito, la ruta
     * obtiene la sesión con `req.obtenerSesion()`.
     */
    conPermiso(clave: ClavePermiso): preHandlerAsyncHookHandler;
    /**
     * Guard de autorización con ALGUNO de varios permisos (deny-by-default): exige sesión y que
     * tenga AL MENOS uno de los indicados. Útil para pantallas que sirven a más de un rol/área
     * (p. ej. la lectura de productividad, visible con `indicadores.ip-productividad` O
     * `indicadores.almacen-productividad`). El servicio de dominio reaplica el permiso fino (A1).
     */
    conAlgunPermiso(...claves: ClavePermiso[]): preHandlerAsyncHookHandler;
  }
}

/**
 * Pasa una petición de Fastify al handler de better-auth y vuelca la respuesta
 * (status, headers y cuerpo) en la respuesta de Fastify. Patrón oficial de la
 * integración Fastify de better-auth.
 */
async function delegarABetterAuth(
  instancia: Auth,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const headers = fromNodeHeaders(request.headers);
  const peticion = new Request(url.toString(), {
    method: request.method,
    headers,
    // GET/HEAD no llevan cuerpo; el resto reenvía el JSON ya parseado por Fastify.
    ...(request.body === undefined || request.method === 'GET' || request.method === 'HEAD'
      ? {}
      : { body: JSON.stringify(request.body) }),
  });

  const respuesta = await instancia.handler(peticion);
  reply.status(respuesta.status);
  respuesta.headers.forEach((valor, clave) => {
    reply.header(clave, valor);
  });
  reply.send(respuesta.body === null ? null : await respuesta.text());
}

/**
 * Resuelve la sesión de dominio a partir de la cookie de la petición. Se llama
 * a lo sumo una vez por petición (el resultado se cachea en `obtenerSesion`).
 */
async function resolverSesion(
  instancia: Auth,
  prismaCliente: PrismaClient,
  request: FastifyRequest,
): Promise<SesionUsuario | null> {
  const datos = await instancia.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (datos === null) {
    return null;
  }
  // El plugin username agrega `username` al usuario; el adapter mapea `nombre`→name.
  const usuario = datos.user as { id: string; name: string; username?: string | null };
  if (usuario.username === undefined || usuario.username === null) {
    return null;
  }
  const autenticado: UsuarioAutenticado = {
    id: usuario.id,
    username: usuario.username,
    nombre: usuario.name,
  };
  const preferida = empresaSolicitada(request.headers[HEADER_EMPRESA_ACTIVA] as string | undefined);
  return armarSesionUsuario(autenticado, preferida, { cliente: prismaCliente });
}

/** Dependencias de la autenticación (inyectables en pruebas). */
export interface OpcionesAuth {
  /** Instancia de better-auth a usar (por defecto el singleton de la app). */
  auth?: Auth;
  /** Cliente Prisma para resolver permisos/empresa (por defecto el singleton). */
  prismaCliente?: PrismaClient;
}

/**
 * Registra la autenticación en la instancia RAÍZ de Fastify.
 *
 * Se aplica sobre el `app` raíz (no como plugin encapsulado) para que los
 * decoradores `obtenerSesion`/`conPermiso` se propaguen a TODOS los routers
 * hijos (un plugin encapsulado no los compartiría con sus hermanos). Monta
 * además el catch-all de better-auth en `/api/auth/*`.
 *
 * @param app      instancia raíz; el catch-all se registra con el prefijo `/api`.
 * @param opciones permite inyectar el `auth` y el cliente Prisma (pruebas).
 */
export function registrarAuth(app: FastifyInstance, opciones: OpcionesAuth = {}): void {
  const auth = opciones.auth ?? authSingleton;
  const prismaCliente = opciones.prismaCliente ?? prisma;

  app.decorate('auth', auth);

  // Cada petición resuelve su sesión a lo sumo una vez (memoización por request).
  app.decorateRequest('obtenerSesion', function (this: FastifyRequest) {
    const cache = sesionesPorPeticion.get(this);
    if (cache !== undefined) {
      return cache;
    }
    const promesa = resolverSesion(auth, prismaCliente, this);
    sesionesPorPeticion.set(this, promesa);
    return promesa;
  });

  app.decorate('conPermiso', (clave: ClavePermiso): preHandlerAsyncHookHandler => {
    return async (request, reply) => {
      const sesion = await request.obtenerSesion();
      if (sesion === null) {
        return reply
          .code(401)
          .send({ codigo: 'NO_AUTENTICADO', mensaje: 'Necesitas iniciar sesión.' });
      }
      if (!sesion.permisos.has(clave)) {
        return reply
          .code(403)
          .send({ codigo: 'PERMISO', mensaje: 'No tienes permiso para realizar esta operación.' });
      }
      return undefined;
    };
  });

  app.decorate('conAlgunPermiso', (...claves: ClavePermiso[]): preHandlerAsyncHookHandler => {
    return async (request, reply) => {
      const sesion = await request.obtenerSesion();
      if (sesion === null) {
        return reply
          .code(401)
          .send({ codigo: 'NO_AUTENTICADO', mensaje: 'Necesitas iniciar sesión.' });
      }
      if (!claves.some((clave) => sesion.permisos.has(clave))) {
        return reply
          .code(403)
          .send({ codigo: 'PERMISO', mensaje: 'No tienes permiso para realizar esta operación.' });
      }
      return undefined;
    };
  });

  // Catch-all de better-auth (login/logout/sesión). Va bajo /api para quedar en
  // /api/auth/* (el basePath por defecto de better-auth). No usa el type-provider
  // Zod: better-auth define su propio contrato.
  void app.register(
    (instancia, _opciones, done) => {
      instancia.route({
        method: ['GET', 'POST'],
        url: RUTA_AUTH,
        handler: async (request, reply) => {
          await delegarABetterAuth(auth, request, reply);
        },
      });
      done();
    },
    { prefix: '/api' },
  );
}

/**
 * Caché de la sesión por petición. Un `WeakMap` evita fugas: la entrada
 * desaparece cuando el objeto `request` se recolecta al cerrar la petición.
 */
const sesionesPorPeticion = new WeakMap<FastifyRequest, Promise<SesionUsuario | null>>();
