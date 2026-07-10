/**
 * Pruebas de integración de las rutas REST del MOTOR de terceros (F9-E1). Levantan la app Fastify
 * REAL apuntada al Postgres efímero (testcontainers), reusando el seed real (admin `Control.2026!`).
 * Cubren el cableado ruta→dominio y el RBAC deny-by-default (A4):
 *  - el admin registra un movimiento y consulta el saldo (Σ movimientos, D3);
 *  - un usuario solo con `terceros.ver` NO puede registrar (403), pero SÍ ver el saldo;
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
    data: { nombre: 'Proveedor HTTP', diasCredito: 15 },
  });
  idProveedor = prov.id;
});

describe('rutas del motor de terceros', () => {
  it('el admin registra un movimiento y el saldo lo refleja (Σ movimientos)', async () => {
    const cookie = await cookieAdmin();

    const alta = await app.inject({
      method: 'POST',
      url: '/api/terceros/movimientos',
      headers: { cookie },
      payload: {
        tipoTercero: 'proveedor',
        idTercero: idProveedor,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 1000,
      },
    });
    expect(alta.statusCode).toBe(201);
    expect(alta.json()).toMatchObject({ monto: 1000, folio: 1 });

    const saldo = await app.inject({
      method: 'GET',
      url: `/api/terceros/proveedor/${idProveedor}/saldo`,
      headers: { cookie },
    });
    expect(saldo.statusCode).toBe(200);
    expect(saldo.json()).toMatchObject({ saldo: 1000 });
  });

  it('deny-by-default: solo `terceros.ver` no puede registrar (403) pero sí ver el saldo', async () => {
    const admin = await cookieAdmin();
    const soloVer = await usuarioConPermisos(admin, 'solover', [
      'terceros.ver',
      'consultas.ver-importes',
    ]);

    const alta = await app.inject({
      method: 'POST',
      url: '/api/terceros/movimientos',
      headers: { cookie: soloVer },
      payload: {
        tipoTercero: 'proveedor',
        idTercero: idProveedor,
        fecha: '2026-07-01',
        origen: 'pago',
        importe: 10,
      },
    });
    expect(alta.statusCode).toBe(403);

    const saldo = await app.inject({
      method: 'GET',
      url: `/api/terceros/proveedor/${idProveedor}/saldo`,
      headers: { cookie: soloVer },
    });
    expect(saldo.statusCode).toBe(200);
  });

  it('la vista fiscal del estado de cuenta exige `terceros.fiscal`', async () => {
    const admin = await cookieAdmin();
    // Registra un movimiento fiscal con el admin.
    await app.inject({
      method: 'POST',
      url: '/api/terceros/movimientos',
      headers: { cookie: admin },
      payload: {
        tipoTercero: 'proveedor',
        idTercero: idProveedor,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 500,
        esFiscal: true,
        uuidCfdi: 'AAAAAAAA-0000-0000-0000-000000000099',
      },
    });

    const soloVer = await usuarioConPermisos(admin, 'sinfiscal', [
      'terceros.ver',
      'consultas.ver-importes',
    ]);

    const operativa = await app.inject({
      method: 'GET',
      url: `/api/terceros/proveedor/${idProveedor}/estado-cuenta?vista=operativa`,
      headers: { cookie: soloVer },
    });
    expect(operativa.statusCode).toBe(200);

    const fiscal = await app.inject({
      method: 'GET',
      url: `/api/terceros/proveedor/${idProveedor}/estado-cuenta?vista=fiscal`,
      headers: { cookie: soloVer },
    });
    expect(fiscal.statusCode).toBe(403);
  });
});
