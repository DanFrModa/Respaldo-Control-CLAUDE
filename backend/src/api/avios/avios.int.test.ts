/**
 * Pruebas de integración de las rutas de Avíos (F1-E3, PIEZA B — R1): el API REST de punta
 * a punta.
 *
 * Levantan la app Fastify REAL (better-auth incluido) apuntada al Postgres efímero de
 * testcontainers y la ejercitan con `app.inject` (sin abrir puerto), reusando el seed real
 * (admin `Control.2026!`, 9 roles, FR Moda). El seed NO crea proveedores, así que cada test
 * siembra los que necesita directo con el cliente. Cubren:
 *  - deny-by-default: un usuario con rol `Basico` (sin permisos) recibe 403; sin sesión, 401;
 *  - alta con proveedores inline (N:N con precio/condiciones, R1) y su aparición en el listado;
 *  - PATCH parcial (reemplazar el set de proveedores; vaciar un opcional con null);
 *  - borrado suave (DELETE) + reactivación (PATCH `activo:true`);
 *  - filtro por `esGenerico` (R4) e `incluirInactivos`, y búsqueda por clave/descripción;
 *  - `GET /avios/{id}/proveedores` (precio por proveedor; protegido con `avios.ver`).
 *
 * NOTA (integración): este test asume que el plugin `rutasAvios` ya está registrado en
 * `app.ts` (lo cablea la integración). Mientras no lo esté, las rutas responden 404.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { construirApp } from '../../app.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrar } from '../../../prisma/seed.js';

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

/** Id del rol del seed por su nombre. */
async function idRol(nombre: string): Promise<number> {
  const rol = await cliente.rol.findUniqueOrThrow({ where: { nombre }, select: { id: true } });
  return rol.id;
}

/** Crea dos proveedores activos y devuelve sus ids (el seed no crea proveedores). */
async function sembrarProveedores(): Promise<{ a: number; b: number }> {
  const a = await cliente.proveedor.create({ data: { nombre: 'Botones SA' } });
  const b = await cliente.proveedor.create({ data: { nombre: 'Hilos del Norte' } });
  return { a: a.id, b: b.id };
}

beforeAll(async () => {
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

describe('API de avíos (F1-E3, R1)', () => {
  describe('autorización (deny-by-default)', () => {
    it('un usuario con rol Basico (sin permisos) recibe 403', async () => {
      const cookie = await cookieAdmin();
      const creado = await app.inject({
        method: 'POST',
        url: '/api/usuarios',
        headers: { cookie },
        payload: {
          username: 'consulta',
          nombre: 'Usuario Consulta',
          password: 'Clave.1234!',
          idsRoles: [await idRol('Basico')],
        },
      });
      expect(creado.statusCode).toBe(201);

      const sesion = await login('consulta', 'Clave.1234!');
      const cookieConsulta = comoHeaderCookie(sesion.cookies);

      const lista = await app.inject({
        method: 'GET',
        url: '/api/avios',
        headers: { cookie: cookieConsulta },
      });
      expect(lista.statusCode).toBe(403);
      expect(lista.json()).toMatchObject({ codigo: 'PERMISO' });
    });

    it('sin sesión responde 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/avios' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('CRUD por HTTP', () => {
    it('crea, lista, obtiene, edita, desactiva y reactiva un avío', async () => {
      const cookie = await cookieAdmin();
      const { a, b } = await sembrarProveedores();

      // Crear (proveedores inline con precio/condiciones).
      const creado = await app.inject({
        method: 'POST',
        url: '/api/avios',
        headers: { cookie },
        payload: {
          clave: 'BTN-01',
          descripcion: 'Botón 2 cm',
          unidad: 'pza',
          presentacion: 'caja',
          favorito: true,
          cantFav: 12,
          proveedores: [{ idProveedor: a, precio: 0.5, condiciones: 'contado' }],
        },
      });
      expect(creado.statusCode).toBe(201);
      const avio = creado.json<{ id: number; proveedores: { idProveedor: number }[] }>();
      expect(avio.proveedores.map((p) => p.idProveedor)).toEqual([a]);

      // Obtener uno.
      const obtenido = await app.inject({
        method: 'GET',
        url: `/api/avios/${avio.id}`,
        headers: { cookie },
      });
      expect(obtenido.statusCode).toBe(200);
      expect(obtenido.json()).toMatchObject({ clave: 'BTN-01', favorito: true });

      // Proveedores del avío (precio por proveedor).
      const provs = await app.inject({
        method: 'GET',
        url: `/api/avios/${avio.id}/proveedores`,
        headers: { cookie },
      });
      expect(provs.statusCode).toBe(200);
      expect(provs.json<{ datos: { precio: number }[] }>().datos[0]?.precio).toBe(0.5);

      // Editar: reemplazar el set de proveedores y vaciar unidad (null).
      const editado = await app.inject({
        method: 'PATCH',
        url: `/api/avios/${avio.id}`,
        headers: { cookie },
        payload: { proveedores: [{ idProveedor: b, precio: 1 }], unidad: null },
      });
      expect(editado.statusCode).toBe(200);
      const editadoBody = editado.json<{
        unidad: string | null;
        proveedores: { idProveedor: number }[];
      }>();
      expect(editadoBody.unidad).toBeNull();
      expect(editadoBody.proveedores.map((p) => p.idProveedor)).toEqual([b]);

      // Listar: aparece (solo activos por defecto).
      const lista = await app.inject({ method: 'GET', url: '/api/avios', headers: { cookie } });
      expect(lista.statusCode).toBe(200);
      expect(lista.json<{ total: number }>().total).toBe(1);

      // Desactivar (borrado suave).
      const desactivado = await app.inject({
        method: 'DELETE',
        url: `/api/avios/${avio.id}`,
        headers: { cookie },
      });
      expect(desactivado.statusCode).toBe(200);
      expect(desactivado.json()).toMatchObject({ activo: false });

      // Ya no aparece por defecto; sí con incluirInactivos.
      const listaActivos = await app.inject({
        method: 'GET',
        url: '/api/avios',
        headers: { cookie },
      });
      expect(listaActivos.json<{ total: number }>().total).toBe(0);
      const listaTodos = await app.inject({
        method: 'GET',
        url: '/api/avios?incluirInactivos=true',
        headers: { cookie },
      });
      expect(listaTodos.json<{ total: number }>().total).toBe(1);

      // Reactivar (PATCH activo:true).
      const reactivado = await app.inject({
        method: 'PATCH',
        url: `/api/avios/${avio.id}`,
        headers: { cookie },
        payload: { activo: true },
      });
      expect(reactivado.statusCode).toBe(200);
      expect(reactivado.json()).toMatchObject({ activo: true });
    });

    it('favorito sin cantFav → 400 (regla favorito ⇒ cantFav)', async () => {
      const cookie = await cookieAdmin();
      const res = await app.inject({
        method: 'POST',
        url: '/api/avios',
        headers: { cookie },
        payload: { clave: 'FAV', descripcion: 'X', favorito: true },
      });
      expect(res.statusCode).toBe(400);
    });

    it('clave duplicada (insensible a mayúsculas) → 409', async () => {
      const cookie = await cookieAdmin();
      const primero = await app.inject({
        method: 'POST',
        url: '/api/avios',
        headers: { cookie },
        payload: { clave: 'BTN-01', descripcion: 'Botón' },
      });
      expect(primero.statusCode).toBe(201);

      const repetido = await app.inject({
        method: 'POST',
        url: '/api/avios',
        headers: { cookie },
        payload: { clave: 'btn-01', descripcion: 'Otro' },
      });
      expect(repetido.statusCode).toBe(409);
      expect(repetido.json()).toMatchObject({ codigo: 'CONFLICTO' });
    });
  });

  describe('filtros', () => {
    it('filtra por esGenerico (R4) y busca por clave/descripción', async () => {
      const cookie = await cookieAdmin();
      await app.inject({
        method: 'POST',
        url: '/api/avios',
        headers: { cookie },
        payload: { clave: 'GEN-1', descripcion: 'Genérico stock', esGenerico: true },
      });
      await app.inject({
        method: 'POST',
        url: '/api/avios',
        headers: { cookie },
        payload: { clave: 'NORM-1', descripcion: 'Normal por orden', esGenerico: false },
      });

      const genericos = await app.inject({
        method: 'GET',
        url: '/api/avios?esGenerico=true',
        headers: { cookie },
      });
      expect(genericos.json<{ total: number }>().total).toBe(1);

      const porDescripcion = await app.inject({
        method: 'GET',
        url: '/api/avios?busqueda=stock',
        headers: { cookie },
      });
      expect(porDescripcion.json<{ total: number }>().total).toBe(1);
    });
  });
});
