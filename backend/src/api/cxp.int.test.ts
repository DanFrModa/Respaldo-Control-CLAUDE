/**
 * Pruebas de integración de las rutas REST de CxP (F9-E2). Levantan la app Fastify REAL apuntada al
 * Postgres efímero (testcontainers), reusando el seed real (admin `Control.2026!`). Cubren el cableado
 * ruta→dominio y el RBAC deny-by-default (A4):
 *  - el admin captura un movimiento y la bandeja "por pagar" lo refleja;
 *  - `cxp.ver` basta para la bandeja (no exige `terceros.*`); el estado de cuenta sí necesita `terceros.ver`;
 *  - un usuario sin `cxp.administrar` NO puede capturar (403);
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
let idProveedor: number;

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
  const prov = await cliente.proveedor.create({
    data: { nombre: 'Proveedor CxP HTTP', diasCredito: 15 },
  });
  idProveedor = prov.id;
});

describe('rutas de CxP', () => {
  it('el admin captura un movimiento y la bandeja lo refleja', async () => {
    const cookie = await cookieAdmin();

    const alta = await app.inject({
      method: 'POST',
      url: `/api/cxp/proveedores/${idProveedor}/movimientos`,
      headers: { cookie },
      payload: { fecha: '2026-07-01', origen: 'entrada_sin_factura', importe: 1000 },
    });
    expect(alta.statusCode).toBe(201);
    expect(alta.json()).toMatchObject({ monto: 1000, origen: 'entrada_sin_factura' });

    const bandeja = await app.inject({
      method: 'GET',
      url: '/api/cxp/por-pagar',
      headers: { cookie },
    });
    expect(bandeja.statusCode).toBe(200);
    const cuerpo = bandeja.json<{
      resumen: { proveedoresConSaldo: number };
      filas: { idProveedor: number }[];
    }>();
    expect(cuerpo.resumen.proveedoresConSaldo).toBeGreaterThanOrEqual(1);
    expect(cuerpo.filas.some((f) => f.idProveedor === idProveedor)).toBe(true);
  });

  it('`cxp.ver` basta para la bandeja (no exige terceros.*)', async () => {
    const admin = await cookieAdmin();
    const soloCxpVer = await usuarioConPermisos(admin, 'cxpver', ['cxp.ver']);

    const bandeja = await app.inject({
      method: 'GET',
      url: '/api/cxp/por-pagar',
      headers: { cookie: soloCxpVer },
    });
    expect(bandeja.statusCode).toBe(200);
  });

  it('deny-by-default: sin `cxp.administrar` no se captura (403)', async () => {
    const admin = await cookieAdmin();
    const viewer = await usuarioConPermisos(admin, 'cxpviewer', [
      'cxp.ver',
      'terceros.ver',
      'consultas.ver-importes',
    ]);

    const alta = await app.inject({
      method: 'POST',
      url: `/api/cxp/proveedores/${idProveedor}/movimientos`,
      headers: { cookie: viewer },
      payload: { fecha: '2026-07-01', origen: 'pago', importe: 10 },
    });
    expect(alta.statusCode).toBe(403);
  });

  it('la vista fiscal del estado de cuenta exige `terceros.fiscal`', async () => {
    const admin = await cookieAdmin();
    const viewer = await usuarioConPermisos(admin, 'cxpsinfiscal', [
      'cxp.ver',
      'terceros.ver',
      'consultas.ver-importes',
    ]);

    const operativa = await app.inject({
      method: 'GET',
      url: `/api/cxp/proveedores/${idProveedor}/estado-cuenta?vista=operativa`,
      headers: { cookie: viewer },
    });
    expect(operativa.statusCode).toBe(200);

    const fiscal = await app.inject({
      method: 'GET',
      url: `/api/cxp/proveedores/${idProveedor}/estado-cuenta?vista=fiscal`,
      headers: { cookie: viewer },
    });
    expect(fiscal.statusCode).toBe(403);
  });
});
