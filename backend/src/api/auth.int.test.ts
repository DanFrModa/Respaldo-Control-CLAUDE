/**
 * Pruebas de integración de E3: el API REST + auth de punta a punta.
 *
 * Levantan la app Fastify REAL (better-auth incluido) apuntada al Postgres
 * efímero de testcontainers, y la ejercitan con `app.inject` (sin abrir puerto):
 *  - login del admin sembrado (`Control.2026!`) → 200 + cookie de sesión;
 *  - contraseña incorrecta → 401 y `intentosFallidos`+1; al 5º → bloqueo con el
 *    mensaje exacto; el bloqueado no entra ni con la clave correcta;
 *  - ...salvo si quien falla es el ÚLTIMO administrador vivo: ahí el bloqueo se
 *    OMITE (quinta puerta del guard anti-lockout, V1-E6c);
 *  - usuario inactivo no entra;
 *  - `GET /api/sesion` con y sin sesión;
 *  - rutas de almacenes: sin sesión 401, sin permiso 403, y el CRUD completo
 *    con permiso (crear/listar/obtener/actualizar/desactivar).
 */
import { hashPassword } from 'better-auth/crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { construirApp } from '../app.js';
import { MAX_INTENTOS, MENSAJE_BLOQUEADO } from '../dominio/auth/login.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD_ADMIN = 'Control.2026!';

/** Crea un usuario con cuenta de credenciales (hash scrypt, igual que el seed). */
async function crearUsuarioConClave(
  username: string,
  password: string,
  opciones: { activo?: boolean; rol?: string } = {},
): Promise<string> {
  const usuario = await cliente.usuario.create({
    data: {
      username,
      displayUsername: username,
      nombre: username,
      email: `${username}@control.local`,
      emailVerified: true,
      activo: opciones.activo ?? true,
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
  if (opciones.rol !== undefined) {
    const rol = await cliente.rol.findUniqueOrThrow({ where: { nombre: opciones.rol } });
    await cliente.usuarioRol.create({ data: { idUsuario: usuario.id, idRol: rol.id } });
  }
  return usuario.id;
}

/** Resultado de un login: status y, si hubo éxito, las cookies a reenviar. */
interface ResultadoLogin {
  status: number;
  cookies: string[];
  cuerpo: unknown;
}

/** Inicia sesión por usuario/contraseña y captura las cookies `set-cookie`. */
async function login(username: string, password: string): Promise<ResultadoLogin> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username, password },
  });
  // El header set-cookie puede venir como string o string[]; se normaliza.
  const set = res.headers['set-cookie'];
  const cookies = set === undefined ? [] : Array.isArray(set) ? set : [set];
  return { status: res.statusCode, cookies, cuerpo: res.json<unknown>() };
}

/** Convierte las cookies `set-cookie` en un header `cookie` para reenviar. */
function comoHeaderCookie(cookies: string[]): string {
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

beforeAll(async () => {
  // `preparar-entorno.ts` ya apuntó DATABASE_URL al contenedor, así que la app
  // con sus singletons (Prisma + better-auth) opera sobre la base de pruebas:
  // se ejercita el cableado REAL de producción. `clientePruebas` es solo para
  // sembrar/inspeccionar (misma base).
  cliente = clientePruebas();
  app = await construirApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrar(cliente);
});

describe('API de autenticación (E3)', () => {
  describe('login', () => {
    it('el admin sembrado inicia sesión y recibe cookie de sesión', async () => {
      const res = await login('admin', PASSWORD_ADMIN);
      expect(res.status).toBe(200);
      expect(res.cookies.length).toBeGreaterThan(0);
      expect(res.cookies.join(';')).toContain('session');
    });

    it('una contraseña incorrecta incrementa los intentos fallidos', async () => {
      const res = await login('admin', 'clave-mala');
      expect(res.status).toBe(401);
      const usuario = await cliente.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
      expect(usuario.intentosFallidos).toBe(1);
      expect(usuario.bloqueado).toBe(false);
    });

    it(`al ${MAX_INTENTOS}º intento fallido bloquea con el mensaje correcto`, async () => {
      // OJO: la cuenta que se bloquea NO puede ser la del admin sembrado — es el
      // ÚNICO administrador de la base recién sembrada, y desde V1-E6c el guard
      // anti-lockout se niega a bloquearlo (quinta puerta, prueba de abajo). Se
      // usa un usuario de Ventas, que no tiene ninguna clave de gobierno.
      await crearUsuarioConClave('vendedor', 'Clave.1234!', { rol: 'Ventas' });
      for (let i = 0; i < MAX_INTENTOS; i += 1) {
        await login('vendedor', 'clave-mala');
      }
      const usuario = await cliente.usuario.findUniqueOrThrow({ where: { username: 'vendedor' } });
      expect(usuario.bloqueado).toBe(true);

      // Un intento más (incluso con la clave correcta) ya da el mensaje de bloqueo.
      const res = await login('vendedor', 'Clave.1234!');
      expect(res.status).toBe(403);
      expect(res.cuerpo).toMatchObject({ message: MENSAJE_BLOQUEADO });
    });

    it(`al ÚNICO administrador, ${MAX_INTENTOS} fallos NO le bloquean la cuenta`, async () => {
      // La quinta puerta del guard anti-lockout, de punta a punta y con el
      // escenario real del arranque: el admin sembrado es el único que puede
      // administrar el sistema, así que bloquearlo lo cerraría por dentro (nadie
      // más tiene `usuarios.administrar` para desbloquearlo). Los intentos SÍ
      // suben y quedan a la vista; lo que no ocurre es el bloqueo.
      for (let i = 0; i < MAX_INTENTOS; i += 1) {
        expect((await login('admin', 'clave-mala')).status).toBe(401);
      }
      const usuario = await cliente.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
      expect(usuario.intentosFallidos).toBe(MAX_INTENTOS);
      expect(usuario.bloqueado).toBe(false);

      // Y con la contraseña buena entra: el sistema NO se cerró por dentro.
      expect((await login('admin', PASSWORD_ADMIN)).status).toBe(200);
    });

    it('con DOS administradores, al último que falla SÍ se le bloquea', async () => {
      // El guard no protege de más: en cuanto hay otro administrador vivo, el
      // bloqueo por intentos vuelve a funcionar como siempre.
      await crearUsuarioConClave('aurora', 'Clave.1234!', { rol: 'Administrador' });
      for (let i = 0; i < MAX_INTENTOS; i += 1) {
        await login('admin', 'clave-mala');
      }
      const usuario = await cliente.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
      expect(usuario.bloqueado).toBe(true);
    });

    it('un usuario bloqueado no entra ni con la contraseña correcta', async () => {
      await cliente.usuario.update({
        where: { username: 'admin' },
        data: { bloqueado: true, intentosFallidos: MAX_INTENTOS },
      });
      const res = await login('admin', PASSWORD_ADMIN);
      expect(res.status).toBe(403);
      expect(res.cuerpo).toMatchObject({ message: MENSAJE_BLOQUEADO });
    });

    it('un login exitoso reinicia los intentos fallidos', async () => {
      await login('admin', 'clave-mala');
      await login('admin', 'clave-mala');
      const res = await login('admin', PASSWORD_ADMIN);
      expect(res.status).toBe(200);
      const usuario = await cliente.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
      expect(usuario.intentosFallidos).toBe(0);
    });

    it('un usuario inactivo no inicia sesión', async () => {
      await crearUsuarioConClave('inactivo', 'Clave.1234!', { activo: false });
      const res = await login('inactivo', 'Clave.1234!');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/sesion', () => {
    it('sin sesión responde 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/sesion' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    });

    it('con sesión devuelve el usuario, su empresa y sus permisos', async () => {
      const sesion = await login('admin', PASSWORD_ADMIN);
      const res = await app.inject({
        method: 'GET',
        url: '/api/sesion',
        headers: { cookie: comoHeaderCookie(sesion.cookies) },
      });
      expect(res.statusCode).toBe(200);
      const cuerpo = res.json<{
        username: string;
        empresaActiva: { nombre: string };
        permisos: string[];
      }>();
      expect(cuerpo.username).toBe('admin');
      expect(cuerpo.empresaActiva.nombre).toBe('FR Moda');
      // El admin tiene todo el catálogo: incluye administrar almacenes.
      expect(cuerpo.permisos).toContain('almacenes.administrar');
    });

    it('un usuario bloqueado a mitad de sesión recibe 401 (no 200 con permisos vacíos)', async () => {
      const sesion = await login('admin', PASSWORD_ADMIN);
      const cookie = comoHeaderCookie(sesion.cookies);
      // La sesión funciona...
      expect(
        (await app.inject({ method: 'GET', url: '/api/sesion', headers: { cookie } })).statusCode,
      ).toBe(200);
      // ...hasta que un admin bloquea la cuenta: aunque la cookie siga viva, /sesion da 401.
      await cliente.usuario.update({ where: { username: 'admin' }, data: { bloqueado: true } });
      const res = await app.inject({ method: 'GET', url: '/api/sesion', headers: { cookie } });
      expect(res.statusCode).toBe(401);
      // Y una ruta protegida también lo expulsa (la sesión ya no se arma).
      const almacenes = await app.inject({
        method: 'GET',
        url: '/api/almacenes',
        headers: { cookie },
      });
      expect(almacenes.statusCode).toBe(401);
    });
  });

  describe('errores uniformes', () => {
    it('una ruta inexistente responde 404 con el cuerpo estándar { codigo, mensaje }', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/no-existe' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ codigo: 'NO_ENCONTRADO' });
    });
  });

  describe('rutas protegidas de almacenes', () => {
    it('sin sesión responde 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/almacenes' });
      expect(res.statusCode).toBe(401);
    });

    it('con sesión pero sin el permiso responde 403', async () => {
      // El rol "Basico" no tiene ningún permiso (ni almacenes.ver).
      await crearUsuarioConClave('basico', 'Clave.1234!', { rol: 'Basico' });
      const sesion = await login('basico', 'Clave.1234!');
      const res = await app.inject({
        method: 'GET',
        url: '/api/almacenes',
        headers: { cookie: comoHeaderCookie(sesion.cookies) },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ codigo: 'PERMISO' });
    });

    it('CRUD completo con permiso de administrador', async () => {
      const sesion = await login('admin', PASSWORD_ADMIN);
      const cookie = comoHeaderCookie(sesion.cookies);

      // Total activo ANTES de crear (robusto al seed: F3-E1 siembra almacenes PT activos).
      const listaInicial = await app.inject({
        method: 'GET',
        url: '/api/almacenes',
        headers: { cookie },
      });
      expect(listaInicial.statusCode).toBe(200);
      const totalInicial = listaInicial.json<{ total: number }>().total;

      // Crear
      const creado = await app.inject({
        method: 'POST',
        url: '/api/almacenes',
        headers: { cookie },
        payload: { nombre: 'Bodega PT', tipo: 'PT' },
      });
      expect(creado.statusCode).toBe(201);
      const almacen = creado.json<{ id: number; nombre: string; activo: boolean }>();
      expect(almacen).toMatchObject({ nombre: 'Bodega PT', activo: true });

      // Listar (lo encuentra)
      const lista = await app.inject({
        method: 'GET',
        url: '/api/almacenes?busqueda=bodega',
        headers: { cookie },
      });
      expect(lista.statusCode).toBe(200);
      expect(lista.json<{ total: number }>().total).toBe(1);

      // Obtener
      const obtenido = await app.inject({
        method: 'GET',
        url: `/api/almacenes/${String(almacen.id)}`,
        headers: { cookie },
      });
      expect(obtenido.statusCode).toBe(200);

      // Actualizar
      const actualizado = await app.inject({
        method: 'PATCH',
        url: `/api/almacenes/${String(almacen.id)}`,
        headers: { cookie },
        payload: { nombre: 'Bodega Central' },
      });
      expect(actualizado.statusCode).toBe(200);
      expect(actualizado.json<{ nombre: string }>().nombre).toBe('Bodega Central');

      // Desactivar (borrado suave)
      const desactivado = await app.inject({
        method: 'DELETE',
        url: `/api/almacenes/${String(almacen.id)}`,
        headers: { cookie },
      });
      expect(desactivado.statusCode).toBe(200);
      expect(desactivado.json<{ activo: boolean }>().activo).toBe(false);

      // Ya no aparece en el listado por defecto (solo activos): el efecto neto de crear + desactivar
      // sobre el total activo es CERO, así que vuelve a ser el total inicial (robusto al seed).
      const listaFinal = await app.inject({
        method: 'GET',
        url: '/api/almacenes',
        headers: { cookie },
      });
      const finalBody = listaFinal.json<{ total: number; datos: { id: number }[] }>();
      expect(finalBody.total).toBe(totalInicial);
      // Y el almacén que creamos+desactivamos NO está entre los activos.
      expect(finalBody.datos.some((a) => a.id === almacen.id)).toBe(false);
    });

    /**
     * 🔴 **V1-E3z (3ª vuelta) — DÓNDE VIVE LA FRASE ES PARTE DEL CONTRATO.**
     *
     * Esta prueba comprobaba sólo `codigo: 'VALIDACION'`, y por eso no notó nada cuando se descubrió
     * que **el frontend leía únicamente `mensaje`** —el genérico— y tiraba `detalles` a la basura:
     * todas las frases escritas en los esquemas (los `min`/`max`, los `refine`) viajaban por la red
     * y **no llegaban a ninguna pantalla**. El arreglo vive en `frontend/src/api/errores.ts`, pero
     * **este extremo hay que fijarlo también**: si algún día el handler dejara de poblar
     * `detalles[].mensaje`, el frontend volvería a enseñar el genérico y nadie se enteraría.
     *
     * O sea: las dos mitades del contrato quedan con prueba, cada una en su lado.
     */
    it('valida la entrada (Zod) → 400 con la frase ESPECÍFICA dentro de `detalles[].mensaje`', async () => {
      const sesion = await login('admin', PASSWORD_ADMIN);
      const res = await app.inject({
        method: 'POST',
        url: '/api/almacenes',
        headers: { cookie: comoHeaderCookie(sesion.cookies) },
        payload: { nombre: '', tipo: 'NO_EXISTE' },
      });
      expect(res.statusCode).toBe(400);
      const cuerpo = res.json<{
        codigo: string;
        mensaje: string;
        detalles?: { campo?: string; mensaje?: string }[];
      }>();
      expect(cuerpo.codigo).toBe('VALIDACION');
      // El `mensaje` de arriba es SIEMPRE el mismo genérico: no dice qué estuvo mal…
      expect(cuerpo.mensaje).toBe('Los datos enviados no son válidos.');
      // …y por eso el porqué tiene que venir en `detalles`, uno por campo, con texto no vacío.
      expect(Array.isArray(cuerpo.detalles)).toBe(true);
      expect(cuerpo.detalles?.length ?? 0).toBeGreaterThan(0);
      for (const d of cuerpo.detalles ?? []) {
        expect(typeof d.campo).toBe('string');
        expect((d.mensaje ?? '').trim().length).toBeGreaterThan(0);
      }
    });
  });
});
