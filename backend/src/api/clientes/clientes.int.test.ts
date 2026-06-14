/**
 * Pruebas de integración de las rutas de Clientes (F1-E2 PIEZA C, D7): el API REST de
 * clientes + sus campos de referencia de punta a punta.
 *
 * Levantan la app Fastify REAL apuntada al Postgres efímero de testcontainers y la
 * ejercitan con `app.inject` (sin abrir puerto), reusando el seed real (admin
 * `Control.2026!`, 9 roles, FR Moda). Cubren: deny-by-default (un usuario con rol
 * `Basico`, sin `clientes.*`, recibe 403; sin sesión 401), CRUD del cliente, y el
 * sub-recurso de campos de referencia (`/clientes/:id/campos`).
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

describe('API de clientes (F1-E2 PIEZA C, D7)', () => {
  describe('autorización (deny-by-default)', () => {
    it('un usuario sin permiso recibe 403 al listar', async () => {
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

      const res = await app.inject({
        method: 'GET',
        url: '/api/clientes',
        headers: { cookie: cookieConsulta },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ codigo: 'PERMISO' });
    });

    it('sin sesión responde 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/clientes' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('CRUD del cliente', () => {
    it('crea, obtiene, lista, edita y desactiva un cliente', async () => {
      const cookie = await cookieAdmin();

      const creado = await app.inject({
        method: 'POST',
        url: '/api/clientes',
        headers: { cookie },
        payload: { nombre: 'Liverpool', email: 'compras@liverpool.mx' },
      });
      expect(creado.statusCode).toBe(201);
      const id = creado.json<{ id: number }>().id;
      expect(creado.json()).toMatchObject({ nombre: 'Liverpool', campos: [] });

      const obtenido = await app.inject({
        method: 'GET',
        url: `/api/clientes/${id}`,
        headers: { cookie },
      });
      expect(obtenido.statusCode).toBe(200);
      expect(obtenido.json()).toMatchObject({ id, nombre: 'Liverpool' });

      const lista = await app.inject({ method: 'GET', url: '/api/clientes', headers: { cookie } });
      expect(lista.statusCode).toBe(200);
      expect(lista.json<{ total: number }>().total).toBe(1);

      const editado = await app.inject({
        method: 'PATCH',
        url: `/api/clientes/${id}`,
        headers: { cookie },
        payload: { contacto: 'Ana' },
      });
      expect(editado.statusCode).toBe(200);
      expect(editado.json()).toMatchObject({ contacto: 'Ana' });

      const desactivado = await app.inject({
        method: 'DELETE',
        url: `/api/clientes/${id}`,
        headers: { cookie },
      });
      expect(desactivado.statusCode).toBe(200);
      expect(desactivado.json()).toMatchObject({ activo: false });
    });

    it('rechaza email inválido con 400', async () => {
      const cookie = await cookieAdmin();
      const res = await app.inject({
        method: 'POST',
        url: '/api/clientes',
        headers: { cookie },
        payload: { nombre: 'X', email: 'no-es-email' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza nombre duplicado con 409', async () => {
      const cookie = await cookieAdmin();
      await app.inject({
        method: 'POST',
        url: '/api/clientes',
        headers: { cookie },
        payload: { nombre: 'Pumas' },
      });
      const segundo = await app.inject({
        method: 'POST',
        url: '/api/clientes',
        headers: { cookie },
        payload: { nombre: 'pumas' },
      });
      expect(segundo.statusCode).toBe(409);
    });
  });

  describe('campos de referencia (D7)', () => {
    it('agrega, lista, edita y desactiva un campo del cliente', async () => {
      const cookie = await cookieAdmin();
      const creado = await app.inject({
        method: 'POST',
        url: '/api/clientes',
        headers: { cookie },
        payload: { nombre: 'Liverpool' },
      });
      const idCliente = creado.json<{ id: number }>().id;

      const campo = await app.inject({
        method: 'POST',
        url: `/api/clientes/${idCliente}/campos`,
        headers: { cookie },
        payload: { etiqueta: 'No. pedido', tipo: 'TEXTO' },
      });
      expect(campo.statusCode).toBe(201);
      const idCampo = campo.json<{ id: number }>().id;
      expect(campo.json()).toMatchObject({ etiqueta: 'No. pedido', tipo: 'TEXTO', orden: 0 });

      // El cliente ahora trae el campo embebido.
      const conCampo = await app.inject({
        method: 'GET',
        url: `/api/clientes/${idCliente}`,
        headers: { cookie },
      });
      expect(conCampo.json<{ campos: unknown[] }>().campos).toHaveLength(1);

      const listaCampos = await app.inject({
        method: 'GET',
        url: `/api/clientes/${idCliente}/campos`,
        headers: { cookie },
      });
      expect(listaCampos.statusCode).toBe(200);
      expect(listaCampos.json<{ datos: unknown[] }>().datos).toHaveLength(1);

      const editado = await app.inject({
        method: 'PATCH',
        url: `/api/clientes/${idCliente}/campos/${idCampo}`,
        headers: { cookie },
        payload: { tipo: 'NUMERO' },
      });
      expect(editado.statusCode).toBe(200);
      expect(editado.json()).toMatchObject({ tipo: 'NUMERO' });

      const desactivado = await app.inject({
        method: 'DELETE',
        url: `/api/clientes/${idCliente}/campos/${idCampo}`,
        headers: { cookie },
      });
      expect(desactivado.statusCode).toBe(200);
      expect(desactivado.json()).toMatchObject({ activo: false });
    });

    it('rechaza una etiqueta duplicada en el mismo cliente con 409', async () => {
      const cookie = await cookieAdmin();
      const creado = await app.inject({
        method: 'POST',
        url: '/api/clientes',
        headers: { cookie },
        payload: { nombre: 'Liverpool' },
      });
      const idCliente = creado.json<{ id: number }>().id;

      await app.inject({
        method: 'POST',
        url: `/api/clientes/${idCliente}/campos`,
        headers: { cookie },
        payload: { etiqueta: 'No. pedido' },
      });
      const dup = await app.inject({
        method: 'POST',
        url: `/api/clientes/${idCliente}/campos`,
        headers: { cookie },
        payload: { etiqueta: 'NO. PEDIDO' },
      });
      expect(dup.statusCode).toBe(409);
    });
  });
});
