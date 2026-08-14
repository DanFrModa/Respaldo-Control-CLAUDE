/**
 * Pruebas de integración de las rutas de Bordados/estampados (F1-E3, R2): el API REST
 * de punta a punta, incluido el flujo de la FOTO con el motor de archivos de F0.
 *
 * Levantan una app Fastify con SOLO el plugin de bordados montado bajo `/api` (este
 * plugin aún no se registra en `app.ts`; lo cablea la integración), apuntada al Postgres
 * efímero de testcontainers, con la autenticación real (better-auth) y el seed real
 * (admin `Control.2026!`, 9 roles, FR Moda). Se ejercita con `app.inject` (sin abrir
 * puerto). Cubren:
 *  - deny-by-default: rol `Basico` (sin permisos) → 403; sin sesión → 401;
 *  - alta y su aparición en el listado (modo servidor: búsqueda + filtro por tipo);
 *  - PATCH parcial (cambiar tipo; vaciar un opcional con null) + reactivación;
 *  - borrado suave (DELETE) y filtro `incluirInactivos`;
 *  - foto: POST prepara la subida (URL PUT prefirmada, key ordenada por id), GET la
 *    URL de descarga (vacío si no hay) y DELETE la quita.
 *
 * Las URLs prefirmadas se firman LOCALMENTE (no se toca R2): se fijan credenciales R2
 * FALSAS antes de construir la app, para que `servicioArchivos()` arme el cliente sin
 * red. NO se sube nada a R2 (eso es el PUT del navegador, fuera del backend).
 */
// Credenciales R2 FALSAS, fijadas ANTES de importar el dominio (servicioArchivos lazy):
// `getSignedUrl` firma localmente, así que con esto el POST /foto arma la URL sin red.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from '../errores.js';
import { rutasBordados } from './bordados.rutas.js';
import { registrarAuth } from '../../auth/plugin.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrar } from '../../../prisma/seed.js';

/**
 * Crea un usuario con el rol `Basico` (sembrado, SIN permisos de bordados) y su cuenta
 * de credenciales (mismo hash scrypt de better-auth que el seed). Sirve para probar el
 * 403 (sesión válida pero sin el permiso) en esta app que NO monta `/api/usuarios`.
 */
async function crearUsuarioBasico(username: string, password: string): Promise<void> {
  const rol = await cliente.rol.findUniqueOrThrow({ where: { nombre: 'Basico' } });
  const usuario = await cliente.usuario.create({
    data: {
      username,
      nombre: 'Usuario Básico',
      email: `${username}@control.local`,
      emailVerified: true,
      roles: { create: { idRol: rol.id } },
    },
  });
  await cliente.cuenta.create({
    data: {
      providerId: 'credential',
      accountId: usuario.id,
      userId: usuario.id,
      password: await hashPassword(password),
    },
  });
}

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD_ADMIN = 'Control.2026!';

/** Resultado de un login: status y, si hubo éxito, las cookies a reenviar. */
interface ResultadoLogin {
  status: number;
  cookies: string[];
}

/** Inicia sesión por usuario/contraseña y captura las cookies `set-cookie`. */
async function login(username: string, password: string): Promise<ResultadoLogin> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username, password },
  });
  const set = res.headers['set-cookie'];
  const cookies = set === undefined ? [] : Array.isArray(set) ? set : [set];
  return { status: res.statusCode, cookies };
}

/** Convierte las cookies `set-cookie` en un header `cookie` para reenviar. */
function comoHeaderCookie(cookies: string[]): string {
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

/** Cookie de una sesión de admin lista para reenviar en peticiones protegidas. */
async function cookieAdmin(): Promise<string> {
  const sesion = await login('admin', PASSWORD_ADMIN);
  expect(sesion.status).toBe(200);
  return comoHeaderCookie(sesion.cookies);
}

/**
 * Construye una app Fastify mínima con auth + SOLO las rutas de bordados (el plugin no
 * se registra en `app.ts` todavía). Calca el armado de `construirApp` en lo esencial.
 */
async function construirAppBordados(): Promise<FastifyInstance> {
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasBordados, { prefix: '/api' });
  await instancia.ready();
  return instancia;
}

beforeAll(async () => {
  cliente = clientePruebas();
  app = await construirAppBordados();
});

afterAll(async () => {
  await app.close();
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrar(cliente);
});

/** Forma mínima de un bordado de la API que usan estas pruebas. */
interface BordadoApi {
  id: number;
  nombre: string;
  tipo: string;
  puntadas: number | null;
  precio: number | null;
  idArchivoFoto: string | null;
  activo: boolean;
}

/** Crea un bordado vía API con la cookie dada; devuelve el cuerpo parseado. */
async function crearBordadoApi(
  cookie: string,
  cuerpo: Record<string, unknown>,
): Promise<{ status: number; body: BordadoApi }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/bordados',
    headers: { cookie },
    payload: cuerpo,
  });
  return { status: res.statusCode, body: res.json<BordadoApi>() };
}

describe('API de bordados (F1-E3, R2)', () => {
  describe('autorización (deny-by-default)', () => {
    it('un usuario con rol Basico (sin permisos) recibe 403', async () => {
      await crearUsuarioBasico('consulta', 'Clave.1234!');
      const sesion = await login('consulta', 'Clave.1234!');
      expect(sesion.status).toBe(200);
      const cookie = comoHeaderCookie(sesion.cookies);

      // Tiene sesión pero NO el permiso bordados.ver → 403 (deny-by-default).
      const lectura = await app.inject({
        method: 'GET',
        url: '/api/bordados',
        headers: { cookie },
      });
      expect(lectura.statusCode).toBe(403);
      // Tampoco puede escribir (bordados.administrar).
      const escritura = await app.inject({
        method: 'POST',
        url: '/api/bordados',
        headers: { cookie },
        payload: { nombre: 'X' },
      });
      expect(escritura.statusCode).toBe(403);
    });

    it('sin sesión, todas las rutas responden 401', async () => {
      for (const url of ['/api/bordados', '/api/bordados/1', '/api/bordados/1/foto']) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode).toBe(401);
      }
    });
  });

  describe('CRUD', () => {
    it('crea un bordado estampado y aparece en el listado', async () => {
      const cookie = await cookieAdmin();
      const { status, body } = await crearBordadoApi(cookie, {
        nombre: 'Logo Estampado',
        tipo: 'ESTAMPADO',
        puntadas: 8000,
        precio: 30,
      });
      expect(status).toBe(201);
      expect(body).toMatchObject({ nombre: 'Logo Estampado', tipo: 'ESTAMPADO', puntadas: 8000 });
      expect(body.idArchivoFoto).toBeNull();

      const lista = await app.inject({
        method: 'GET',
        url: '/api/bordados?tipo=ESTAMPADO&busqueda=Logo',
        headers: { cookie },
      });
      expect(lista.statusCode).toBe(200);
      const pagina = lista.json<{ datos: { nombre: string }[]; total: number }>();
      expect(pagina.total).toBe(1);
      expect(pagina.datos[0]?.nombre).toBe('Logo Estampado');
    });

    it('PATCH parcial cambia el tipo y vacía un opcional con null', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearBordadoApi(cookie, {
        nombre: 'Bordado',
        puntadas: 1000,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/bordados/${body.id}`,
        headers: { cookie },
        payload: { tipo: 'ESTAMPADO', puntadas: null },
      });
      expect(res.statusCode).toBe(200);
      const actualizado = res.json<BordadoApi>();
      expect(actualizado.tipo).toBe('ESTAMPADO');
      expect(actualizado.puntadas).toBeNull();
    });

    it('DELETE desactiva (borrado suave) y reactiva con PATCH activo:true', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearBordadoApi(cookie, { nombre: 'Reversible' });

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/bordados/${body.id}`,
        headers: { cookie },
      });
      expect(del.statusCode).toBe(200);
      expect(del.json<BordadoApi>().activo).toBe(false);

      // Oculto por defecto; visible con incluirInactivos.
      const ocultos = await app.inject({
        method: 'GET',
        url: '/api/bordados',
        headers: { cookie },
      });
      expect(ocultos.json<{ total: number }>().total).toBe(0);
      const todos = await app.inject({
        method: 'GET',
        url: '/api/bordados?incluirInactivos=true',
        headers: { cookie },
      });
      expect(todos.json<{ total: number }>().total).toBe(1);

      const re = await app.inject({
        method: 'PATCH',
        url: `/api/bordados/${body.id}`,
        headers: { cookie },
        payload: { activo: true },
      });
      expect(re.json<BordadoApi>().activo).toBe(true);
    });

    it('rechaza nombre duplicado con 409', async () => {
      const cookie = await cookieAdmin();
      await crearBordadoApi(cookie, { nombre: 'Único' });
      const dup = await crearBordadoApi(cookie, { nombre: 'único' });
      expect(dup.status).toBe(409);
    });
  });

  describe('foto en R2 (URL prefirmada, sin tocar R2)', () => {
    it('POST prepara la subida: devuelve una URL PUT prefirmada con la key por id', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearBordadoApi(cookie, { nombre: 'Con foto' });

      const res = await app.inject({
        method: 'POST',
        url: `/api/bordados/${body.id}/foto`,
        headers: { cookie },
        payload: { nombreOriginal: 'logo.jpg', tipoMime: 'image/jpeg', tamanoBytes: 4096 },
      });
      expect(res.statusCode).toBe(201);
      const subida = res.json<{ idArchivo: string; urlSubida: string }>();
      expect(subida.idArchivo).toBeTruthy();
      // URL prefirmada real contra el endpoint R2, con la key ordenada por id.
      const url = new URL(subida.urlSubida);
      expect(url.hostname).toContain('r2.cloudflarestorage.com');
      expect(url.pathname).toContain(`bordados/${body.id}/`);
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();

      // El bordado quedó ligado a la foto.
      const obtenido = await app.inject({
        method: 'GET',
        url: `/api/bordados/${body.id}`,
        headers: { cookie },
      });
      expect(obtenido.json<BordadoApi>().idArchivoFoto).toBe(subida.idArchivo);
    });

    it('GET /foto devuelve vacío cuando no hay foto y la URL cuando sí', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearBordadoApi(cookie, { nombre: 'B' });

      const sinFoto = await app.inject({
        method: 'GET',
        url: `/api/bordados/${body.id}/foto`,
        headers: { cookie },
      });
      expect(sinFoto.statusCode).toBe(200);
      expect(sinFoto.json<{ urlDescarga: string | null }>().urlDescarga).toBeNull();

      await app.inject({
        method: 'POST',
        url: `/api/bordados/${body.id}/foto`,
        headers: { cookie },
        payload: { nombreOriginal: 'logo.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
      });
      const conFoto = await app.inject({
        method: 'GET',
        url: `/api/bordados/${body.id}/foto`,
        headers: { cookie },
      });
      expect(conFoto.json<{ urlDescarga: string | null }>().urlDescarga).toContain(
        'r2.cloudflarestorage.com',
      );
    });

    it('DELETE /foto quita la foto (idArchivoFoto vuelve a null)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearBordadoApi(cookie, { nombre: 'B' });
      await app.inject({
        method: 'POST',
        url: `/api/bordados/${body.id}/foto`,
        headers: { cookie },
        payload: { nombreOriginal: 'logo.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
      });

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/bordados/${body.id}/foto`,
        headers: { cookie },
      });
      expect(del.statusCode).toBe(204);

      const obtenido = await app.inject({
        method: 'GET',
        url: `/api/bordados/${body.id}`,
        headers: { cookie },
      });
      expect(obtenido.json<BordadoApi>().idArchivoFoto).toBeNull();
    });

    it('DELETE /foto?idArchivo= NO borra cuando la foto vigente ya es otra (409)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearBordadoApi(cookie, { nombre: 'B' });
      const primera = await app.inject({
        method: 'POST',
        url: `/api/bordados/${body.id}/foto`,
        headers: { cookie },
        payload: { nombreOriginal: 'vieja.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
      });
      const idVieja = primera.json<{ idArchivo: string }>().idArchivo;
      // Otro usuario reemplaza la foto mientras el PUT de la primera seguía fallando.
      const segunda = await app.inject({
        method: 'POST',
        url: `/api/bordados/${body.id}/foto`,
        headers: { cookie },
        payload: { nombreOriginal: 'buena.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
      });
      const idBuena = segunda.json<{ idArchivo: string }>().idArchivo;

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/bordados/${body.id}/foto?idArchivo=${idVieja}`,
        headers: { cookie },
      });
      expect(del.statusCode).toBe(409);

      const obtenido = await app.inject({
        method: 'GET',
        url: `/api/bordados/${body.id}`,
        headers: { cookie },
      });
      expect(obtenido.json<BordadoApi>().idArchivoFoto).toBe(idBuena);
    });

    it('DELETE /foto?idArchivo= borra cuando ESA es la vigente (204)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearBordadoApi(cookie, { nombre: 'B' });
      const subida = await app.inject({
        method: 'POST',
        url: `/api/bordados/${body.id}/foto`,
        headers: { cookie },
        payload: { nombreOriginal: 'logo.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
      });
      const idArchivo = subida.json<{ idArchivo: string }>().idArchivo;

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/bordados/${body.id}/foto?idArchivo=${idArchivo}`,
        headers: { cookie },
      });
      expect(del.statusCode).toBe(204);

      const obtenido = await app.inject({
        method: 'GET',
        url: `/api/bordados/${body.id}`,
        headers: { cookie },
      });
      expect(obtenido.json<BordadoApi>().idArchivoFoto).toBeNull();
    });

    it('rechaza una foto que no es imagen con 400', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearBordadoApi(cookie, { nombre: 'B' });
      const res = await app.inject({
        method: 'POST',
        url: `/api/bordados/${body.id}/foto`,
        headers: { cookie },
        payload: { nombreOriginal: 'doc.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
