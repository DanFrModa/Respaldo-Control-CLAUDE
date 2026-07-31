/**
 * Pruebas de integración de las rutas REST de CxC (F9-E4). Levantan la app Fastify REAL apuntada al
 * Postgres efímero (testcontainers), reusando el seed real (admin `Control.2026!`). Cubren el cableado
 * ruta→dominio y el RBAC deny-by-default (A4), espejo de CxP:
 *  - el admin captura un movimiento y la bandeja "por cobrar" lo refleja;
 *  - `cxc.ver` basta para la bandeja; un usuario sin `cxc.administrar` NO puede capturar (403);
 *  - la vista FISCAL del estado de cuenta exige `terceros.fiscal` (403 sin ella; 200 la operativa).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { construirApp } from '../app.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;
let idCliente: number;

const PASSWORD_ADMIN = 'Control.2026!';

async function login(username: string, password: string): Promise<string[]> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username, password },
  });
  const set = res.headers['set-cookie'];
  return set === undefined ? [] : Array.isArray(set) ? set : [set];
}

function comoHeaderCookie(cookies: string[]): string {
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function cookieAdmin(): Promise<string> {
  return comoHeaderCookie(await login('admin', PASSWORD_ADMIN));
}

/** Crea un usuario con permisos exactos (rol nuevo) y devuelve su cookie de sesión. */
async function usuarioConPermisos(
  cookie: string,
  username: string,
  permisos: string[],
): Promise<string> {
  const perms = await cliente.permiso.findMany({
    where: { clave: { in: permisos } },
    select: { id: true },
  });
  const rol = await cliente.rol.create({
    data: {
      nombre: `rol-${username}`,
      descripcion: 'rol de prueba',
      permisos: { create: perms.map((p) => ({ idPermiso: p.id })) },
    },
  });
  const creado = await app.inject({
    method: 'POST',
    url: '/api/usuarios',
    headers: { cookie },
    payload: { username, nombre: username, password: 'Clave.1234!', idsRoles: [rol.id] },
  });
  expect(creado.statusCode).toBe(201);
  return comoHeaderCookie(await login(username, 'Clave.1234!'));
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
  const cli = await cliente.cliente.create({
    data: { nombre: 'Cliente CxC HTTP', diasCredito: 30 },
  });
  idCliente = cli.id;
});

describe('rutas de CxC', () => {
  it('el admin captura un movimiento y la bandeja lo refleja', async () => {
    const cookie = await cookieAdmin();

    const alta = await app.inject({
      method: 'POST',
      url: `/api/cxc/clientes/${idCliente}/movimientos`,
      headers: { cookie },
      payload: { fecha: '2026-07-01', origen: 'entrada_sin_factura', importe: 1000 },
    });
    expect(alta.statusCode).toBe(201);
    expect(alta.json()).toMatchObject({ monto: 1000, origen: 'entrada_sin_factura' });

    const bandeja = await app.inject({
      method: 'GET',
      url: '/api/cxc/por-cobrar',
      headers: { cookie },
    });
    expect(bandeja.statusCode).toBe(200);
    const cuerpo = bandeja.json<{
      resumen: { clientesConSaldo: number };
      filas: { idCliente: number }[];
    }>();
    expect(cuerpo.resumen.clientesConSaldo).toBeGreaterThanOrEqual(1);
    expect(cuerpo.filas.some((f) => f.idCliente === idCliente)).toBe(true);
  });

  it('`cxc.ver` basta para la bandeja (no exige terceros.*)', async () => {
    const admin = await cookieAdmin();
    const soloCxcVer = await usuarioConPermisos(admin, 'cxcver', ['cxc.ver']);

    const bandeja = await app.inject({
      method: 'GET',
      url: '/api/cxc/por-cobrar',
      headers: { cookie: soloCxcVer },
    });
    expect(bandeja.statusCode).toBe(200);
  });

  it('deny-by-default: sin `cxc.administrar` no se captura (403)', async () => {
    const admin = await cookieAdmin();
    const viewer = await usuarioConPermisos(admin, 'cxcviewer', [
      'cxc.ver',
      'terceros.ver',
      'consultas.ver-importes',
    ]);

    const alta = await app.inject({
      method: 'POST',
      url: `/api/cxc/clientes/${idCliente}/movimientos`,
      headers: { cookie: viewer },
      payload: { fecha: '2026-07-01', origen: 'pago', importe: 10 },
    });
    expect(alta.statusCode).toBe(403);
  });

  it('la vista fiscal del estado de cuenta exige `terceros.fiscal`', async () => {
    const admin = await cookieAdmin();
    const viewer = await usuarioConPermisos(admin, 'cxcsinfiscal', [
      'cxc.ver',
      'terceros.ver',
      'consultas.ver-importes',
    ]);

    const operativa = await app.inject({
      method: 'GET',
      url: `/api/cxc/clientes/${idCliente}/estado-cuenta?vista=operativa`,
      headers: { cookie: viewer },
    });
    expect(operativa.statusCode).toBe(200);

    const fiscal = await app.inject({
      method: 'GET',
      url: `/api/cxc/clientes/${idCliente}/estado-cuenta?vista=fiscal`,
      headers: { cookie: viewer },
    });
    expect(fiscal.statusCode).toBe(403);
  });
});
