/**
 * Pruebas de integración de las rutas REST de CALIDAD (F6-E1) y de la consulta de BITÁCORA.
 * Levantan la app Fastify REAL apuntada al Postgres efímero (testcontainers) y la ejercitan con
 * `app.inject`, reusando el seed real (admin `Control.2026!`, FR Moda, el plan AQL default y los
 * tipos de producto base). Cubren:
 *  - deny-by-default: un usuario sin `calidad.administrar-catalogo` recibe 403 al ESCRIBIR;
 *  - CRUD de defecto end-to-end por HTTP (alta → aparece → editar → desactivar);
 *  - el GET de resolución del plan default sembrado (lote+nivel → muestra/límites);
 *  - la bitácora exige `admin.ver-bitacora` y lista lo que dejó el CRUD.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { construirApp } from '../app.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD_ADMIN = 'Control.2026!';

interface ResultadoLogin {
  status: number;
  cookies: string[];
}

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

function comoHeaderCookie(cookies: string[]): string {
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function cookieAdmin(): Promise<string> {
  const sesion = await login('admin', PASSWORD_ADMIN);
  expect(sesion.status).toBe(200);
  return comoHeaderCookie(sesion.cookies);
}

async function idRol(nombre: string): Promise<number> {
  const rol = await cliente.rol.findUniqueOrThrow({ where: { nombre }, select: { id: true } });
  return rol.id;
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

describe('API de Calidad (F6-E1)', () => {
  describe('autorización (deny-by-default)', () => {
    it('un usuario sin permiso de calidad recibe 403 al escribir y 403 al leer', async () => {
      const cookie = await cookieAdmin();
      const creado = await app.inject({
        method: 'POST',
        url: '/api/usuarios',
        headers: { cookie },
        payload: {
          username: 'sinpermiso',
          nombre: 'Sin Permiso',
          password: 'Clave.1234!',
          idsRoles: [await idRol('Basico')],
        },
      });
      expect(creado.statusCode).toBe(201);
      const cookieBasico = comoHeaderCookie((await login('sinpermiso', 'Clave.1234!')).cookies);

      // Basico no tiene calidad.ver → 403 al listar.
      const lista = await app.inject({
        method: 'GET',
        url: '/api/calidad/defectos',
        headers: { cookie: cookieBasico },
      });
      expect(lista.statusCode).toBe(403);

      // …ni puede escribir.
      const alta = await app.inject({
        method: 'POST',
        url: '/api/calidad/defectos',
        headers: { cookie: cookieBasico },
        payload: { clave: 'X', descripcion: 'X', nivelAQL: 1, aplicaGeneral: true },
      });
      expect(alta.statusCode).toBe(403);
      expect(alta.json()).toMatchObject({ codigo: 'PERMISO' });
    });

    it('sin sesión responde 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/calidad/defectos' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('CRUD de defectos (admin)', () => {
    it('crea, lista, edita y desactiva un defecto end-to-end', async () => {
      const cookie = await cookieAdmin();
      const tipos = await app.inject({
        method: 'GET',
        url: '/api/calidad/tipos-producto?porPagina=100',
        headers: { cookie },
      });
      const idTipo = tipos.json<{ datos: { id: number }[] }>().datos[0]?.id;
      expect(idTipo).toBeGreaterThan(0);

      const creado = await app.inject({
        method: 'POST',
        url: '/api/calidad/defectos',
        headers: { cookie },
        payload: {
          clave: 'COST-01',
          descripcion: 'Costura abierta',
          nivelAQL: 2.5,
          severidad: 'mayor',
          favorito: true,
          aplicaGeneral: false,
          tiposProducto: [idTipo],
        },
      });
      expect(creado.statusCode).toBe(201);
      const defecto = creado.json<{ id: number; tiposProducto: { id: number }[] }>();
      expect(defecto.tiposProducto.map((t) => t.id)).toContain(idTipo);

      const lista = await app.inject({
        method: 'GET',
        url: '/api/calidad/defectos?busqueda=COST',
        headers: { cookie },
      });
      expect(lista.json<{ total: number }>().total).toBe(1);

      const editado = await app.inject({
        method: 'PATCH',
        url: `/api/calidad/defectos/${String(defecto.id)}`,
        headers: { cookie },
        payload: { descripcion: 'Costura abierta en hombro' },
      });
      expect(editado.statusCode).toBe(200);
      expect(editado.json<{ descripcion: string }>().descripcion).toBe('Costura abierta en hombro');

      const baja = await app.inject({
        method: 'DELETE',
        url: `/api/calidad/defectos/${String(defecto.id)}`,
        headers: { cookie },
      });
      expect(baja.statusCode).toBe(200);
      expect(baja.json<{ activo: boolean }>().activo).toBe(false);
    });

    it('valida la entrada (Zod) → 400 con nivel AQL inválido', async () => {
      const cookie = await cookieAdmin();
      const res = await app.inject({
        method: 'POST',
        url: '/api/calidad/defectos',
        headers: { cookie },
        payload: { clave: 'Y', descripcion: 'Y', nivelAQL: 3, aplicaGeneral: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ codigo: 'VALIDACION' });
    });
  });

  describe('resolución del plan AQL default (seed ISO 2859 II)', () => {
    it('lote 400 nivel 2.5 → muestra 50, acepta 3, rechaza 4', async () => {
      const cookie = await cookieAdmin();
      const res = await app.inject({
        method: 'GET',
        url: '/api/calidad/planes-aql/resolver?tamanoLote=400&nivelAQL=2.5',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const r = res.json<{ tamanoMuestra: number; aceptar: number; rechazar: number }>();
      expect(r.tamanoMuestra).toBe(50);
      expect(r.aceptar).toBe(3);
      expect(r.rechazar).toBe(4);
    });
  });

  describe('bitácora', () => {
    it('exige admin.ver-bitacora y lista lo que dejó el CRUD', async () => {
      const cookie = await cookieAdmin();
      // Genera un registro A7 creando un tipo de producto.
      await app.inject({
        method: 'POST',
        url: '/api/calidad/tipos-producto',
        headers: { cookie },
        payload: { nombre: 'Gorro' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/bitacora?entidad=TipoProducto',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const pagina = res.json<{ total: number; datos: { entidad: string }[] }>();
      expect(pagina.total).toBeGreaterThanOrEqual(1);
      expect(pagina.datos.every((r) => r.entidad === 'TipoProducto')).toBe(true);

      // Un Basico no puede verla.
      const creado = await app.inject({
        method: 'POST',
        url: '/api/usuarios',
        headers: { cookie },
        payload: {
          username: 'nobit',
          nombre: 'No Bitacora',
          password: 'Clave.1234!',
          idsRoles: [await idRol('Basico')],
        },
      });
      expect(creado.statusCode).toBe(201);
      const cookieBasico = comoHeaderCookie((await login('nobit', 'Clave.1234!')).cookies);
      const negado = await app.inject({
        method: 'GET',
        url: '/api/admin/bitacora',
        headers: { cookie: cookieBasico },
      });
      expect(negado.statusCode).toBe(403);
    });
  });
});
