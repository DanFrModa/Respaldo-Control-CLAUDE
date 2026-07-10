/**
 * Pruebas de integración de las rutas REST de REPORTES FISCALES (F9-E5). Levantan la app Fastify REAL
 * sobre Postgres efímero (testcontainers) con el seed real (admin `Control.2026!`). Cubren el cableado
 * ruta→dominio y el RBAC deny-by-default (A4):
 *  - el admin ve el reporte y el tablero de salud; un movimiento fiscal capturado aparece;
 *  - los exports Excel/PDF responden el binario con su Content-Type;
 *  - sin `terceros.fiscal` NO hay reporte ni tablero ni exports (403).
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
    data: { nombre: 'Proveedor Fiscal HTTP', diasCredito: 30, rfc: 'PFH900101AAA' },
  });
  idProveedor = prov.id;
});

/** Captura un movimiento fiscal de proveedor por la ruta del motor (para poblar el reporte). */
async function capturarFiscal(cookie: string): Promise<void> {
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
      esFiscal: true,
      uuidCfdi: 'UUID-HTTP-1',
      rfcTercero: 'PFH900101AAA',
    },
  });
  expect(alta.statusCode).toBe(201);
}

describe('rutas de reportes fiscales', () => {
  it('el admin ve el reporte con el movimiento fiscal capturado', async () => {
    const cookie = await cookieAdmin();
    await capturarFiscal(cookie);

    const rep = await app.inject({
      method: 'GET',
      url: '/api/reportes-fiscales',
      headers: { cookie },
    });
    expect(rep.statusCode).toBe(200);
    const cuerpo = rep.json<{
      total: number;
      totales: { cargos: number | null };
      filas: { uuidCfdi: string | null }[];
    }>();
    expect(cuerpo.total).toBeGreaterThanOrEqual(1);
    expect(cuerpo.totales.cargos).toBe(1000);
    expect(cuerpo.filas.some((f) => f.uuidCfdi === 'UUID-HTTP-1')).toBe(true);
  });

  it('el admin ve el tablero de salud fiscal', async () => {
    const cookie = await cookieAdmin();
    await capturarFiscal(cookie);

    const salud = await app.inject({
      method: 'GET',
      url: '/api/reportes-fiscales/salud',
      headers: { cookie },
    });
    expect(salud.statusCode).toBe(200);
    const cuerpo = salud.json<{
      totalFiscales: number;
      conCfdi: number;
      pctConciliado: number | null;
    }>();
    expect(cuerpo.totalFiscales).toBeGreaterThanOrEqual(1);
    expect(cuerpo.conCfdi).toBeGreaterThanOrEqual(1);
    expect(cuerpo.pctConciliado).toBe(100);
  });

  it('los exports Excel y PDF responden el binario con su Content-Type', async () => {
    const cookie = await cookieAdmin();
    await capturarFiscal(cookie);

    const excel = await app.inject({
      method: 'GET',
      url: '/api/reportes-fiscales/excel',
      headers: { cookie },
    });
    expect(excel.statusCode).toBe(200);
    expect(excel.headers['content-type']).toContain('spreadsheetml');
    expect(excel.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');

    const pdf = await app.inject({
      method: 'GET',
      url: '/api/reportes-fiscales/impreso',
      headers: { cookie },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('deny-by-default: sin `terceros.fiscal` no hay reporte ni tablero ni exports (403)', async () => {
    const admin = await cookieAdmin();
    const sinFiscal = await usuarioConPermisos(admin, 'sinfiscal', [
      'cxp.ver',
      'terceros.ver',
      'consultas.ver-importes',
    ]);

    for (const url of [
      '/api/reportes-fiscales',
      '/api/reportes-fiscales/salud',
      '/api/reportes-fiscales/excel',
      '/api/reportes-fiscales/impreso',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie: sinFiscal } });
      expect(res.statusCode, `${url} debe negar sin terceros.fiscal`).toBe(403);
    }
  });
});
