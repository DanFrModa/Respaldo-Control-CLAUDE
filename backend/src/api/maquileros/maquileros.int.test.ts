/**
 * Pruebas de integración de las rutas de Maquileros + TipoProceso (F1-E2, PIEZA A —
 * Maquila unificada): el API REST de punta a punta.
 *
 * Levantan la app Fastify REAL (better-auth incluido) apuntada al Postgres efímero de
 * testcontainers y la ejercitan con `app.inject` (sin abrir puerto), reusando el seed
 * real (admin `Control.2026!`, 9 roles, FR Moda + 5 tipos de proceso sembrados). Cubren:
 *  - deny-by-default: un usuario con rol `Basico` (sin permisos) recibe 403; sin sesión, 401;
 *  - alta con tipos inline (capacidades N:N) y su aparición en el listado;
 *  - PATCH parcial (cambiar el set de tipos; vaciar un opcional con null);
 *  - borrado suave (DELETE) + reactivación (PATCH `activo:true`);
 *  - filtro por `tipoProceso` e `incluirInactivos`, y búsqueda por corto/nombre;
 *  - el selector `GET /tipos-proceso` (protegido con `maquileros.ver`).
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

/** Ids de dos tipos de proceso del seed (costura, estampado), por su código. */
async function idsTiposBase(): Promise<{ costura: number; estampado: number }> {
  const costura = await cliente.tipoProceso.findUniqueOrThrow({ where: { codigo: 'costura' } });
  const estampado = await cliente.tipoProceso.findUniqueOrThrow({ where: { codigo: 'estampado' } });
  return { costura: costura.id, estampado: estampado.id };
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

describe('API de maquileros (F1-E2, maquila unificada)', () => {
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
        url: '/api/maquileros',
        headers: { cookie: cookieConsulta },
      });
      expect(lista.statusCode).toBe(403);
      expect(lista.json()).toMatchObject({ codigo: 'PERMISO' });

      const tipos = await app.inject({
        method: 'GET',
        url: '/api/tipos-proceso',
        headers: { cookie: cookieConsulta },
      });
      expect(tipos.statusCode).toBe(403);
    });

    it('sin sesión responde 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/maquileros' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('CRUD por HTTP', () => {
    it('crea, lista, obtiene, edita, desactiva y reactiva un maquilero', async () => {
      const cookie = await cookieAdmin();
      const { costura, estampado } = await idsTiposBase();

      // Crear (tipos inline).
      const creado = await app.inject({
        method: 'POST',
        url: '/api/maquileros',
        headers: { cookie },
        payload: {
          corto: 'Intersew',
          nombre: 'Intersew',
          apellidos: 'A',
          telefonos: '01718-1240-395',
          asegurado: true,
          tipos: [costura],
        },
      });
      expect(creado.statusCode).toBe(201);
      const maquilero = creado.json<{ id: number; tipos: { codigo: string }[] }>();
      expect(maquilero.tipos.map((t) => t.codigo)).toEqual(['costura']);

      // Obtener uno.
      const obtenido = await app.inject({
        method: 'GET',
        url: `/api/maquileros/${maquilero.id}`,
        headers: { cookie },
      });
      expect(obtenido.statusCode).toBe(200);
      expect(obtenido.json()).toMatchObject({ corto: 'Intersew', asegurado: true });

      // Editar: reemplazar el set de tipos y vaciar apellidos (null).
      const editado = await app.inject({
        method: 'PATCH',
        url: `/api/maquileros/${maquilero.id}`,
        headers: { cookie },
        payload: { tipos: [costura, estampado], apellidos: null },
      });
      expect(editado.statusCode).toBe(200);
      const editadoBody = editado.json<{ apellidos: string | null; tipos: { codigo: string }[] }>();
      expect(editadoBody.apellidos).toBeNull();
      expect(editadoBody.tipos.map((t) => t.codigo).sort()).toEqual(['costura', 'estampado']);

      // Listar: aparece (solo activos por defecto).
      const lista = await app.inject({
        method: 'GET',
        url: '/api/maquileros',
        headers: { cookie },
      });
      expect(lista.statusCode).toBe(200);
      expect(lista.json<{ total: number }>().total).toBe(1);

      // Desactivar (borrado suave).
      const desactivado = await app.inject({
        method: 'DELETE',
        url: `/api/maquileros/${maquilero.id}`,
        headers: { cookie },
      });
      expect(desactivado.statusCode).toBe(200);
      expect(desactivado.json()).toMatchObject({ activo: false });

      // Ya no aparece por defecto; sí con incluirInactivos.
      const listaActivos = await app.inject({
        method: 'GET',
        url: '/api/maquileros',
        headers: { cookie },
      });
      expect(listaActivos.json<{ total: number }>().total).toBe(0);
      const listaTodos = await app.inject({
        method: 'GET',
        url: '/api/maquileros?incluirInactivos=true',
        headers: { cookie },
      });
      expect(listaTodos.json<{ total: number }>().total).toBe(1);

      // Reactivar (PATCH activo:true).
      const reactivado = await app.inject({
        method: 'PATCH',
        url: `/api/maquileros/${maquilero.id}`,
        headers: { cookie },
        payload: { activo: true },
      });
      expect(reactivado.statusCode).toBe(200);
      expect(reactivado.json()).toMatchObject({ activo: true });
    });

    it('alta sin tipos → 400 (regla ≥1 tipo)', async () => {
      const cookie = await cookieAdmin();
      const res = await app.inject({
        method: 'POST',
        url: '/api/maquileros',
        headers: { cookie },
        payload: { corto: 'X', nombre: 'X', tipos: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('corto duplicado (insensible a mayúsculas) → 409', async () => {
      const cookie = await cookieAdmin();
      const { costura } = await idsTiposBase();
      const primero = await app.inject({
        method: 'POST',
        url: '/api/maquileros',
        headers: { cookie },
        payload: { corto: 'Intersew', nombre: 'Intersew', tipos: [costura] },
      });
      expect(primero.statusCode).toBe(201);

      const repetido = await app.inject({
        method: 'POST',
        url: '/api/maquileros',
        headers: { cookie },
        payload: { corto: 'intersew', nombre: 'Otro', tipos: [costura] },
      });
      expect(repetido.statusCode).toBe(409);
      expect(repetido.json()).toMatchObject({ codigo: 'CONFLICTO' });
    });
  });

  describe('filtros y selector', () => {
    it('filtra por tipoProceso y busca por corto/nombre', async () => {
      const cookie = await cookieAdmin();
      const { costura, estampado } = await idsTiposBase();
      await app.inject({
        method: 'POST',
        url: '/api/maquileros',
        headers: { cookie },
        payload: { corto: 'Costurero', nombre: 'Empresa Norte', tipos: [costura] },
      });
      await app.inject({
        method: 'POST',
        url: '/api/maquileros',
        headers: { cookie },
        payload: { corto: 'Estampador', nombre: 'Otra', tipos: [estampado] },
      });

      const porTipo = await app.inject({
        method: 'GET',
        url: `/api/maquileros?tipoProceso=${costura}`,
        headers: { cookie },
      });
      expect(porTipo.json<{ total: number }>().total).toBe(1);

      const porNombre = await app.inject({
        method: 'GET',
        url: '/api/maquileros?busqueda=norte',
        headers: { cookie },
      });
      expect(porNombre.json<{ total: number }>().total).toBe(1);
    });

    it('el selector GET /tipos-proceso devuelve los tipos sembrados (activos)', async () => {
      const cookie = await cookieAdmin();
      const res = await app.inject({
        method: 'GET',
        url: '/api/tipos-proceso',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const tipos = res.json<{ codigo: string }[]>();
      expect(tipos.map((t) => t.codigo)).toEqual(
        expect.arrayContaining(['costura', 'estampado', 'bordado', 'lavado', 'aplicacion']),
      );
    });
  });
});
