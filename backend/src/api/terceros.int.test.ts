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
  // Modalidad de facturación (fila 0.110): el motor ya no marca "sin factura" en silencio, así que
  // un movimiento de proveedor que no diga `esFiscal` necesita que el catálogo lo tenga definido.
  // `solo_sin` no cambia nada de lo que este archivo mide: lo omitido nace `false` (como con el
  // viejo `.default(false)`) y el `esFiscal: true` explícito de más abajo se sigue respetando.
  const prov = await cliente.proveedor.create({
    data: { nombre: 'Proveedor HTTP', diasCredito: 15, modalidadFacturacion: 'solo_sin' },
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

// ⭐ Fila 0.252 — la ruta genérica es OTRA puerta al mismo defecto: la regla de maquila vive en el
// motor, así que vale también aquí (y no sólo en CxP y en el importador de CFDI).
describe('ruta genérica: la regla de maquila (fila 0.252)', () => {
  /** Un maquilero (rol de EsMa) con el rol que siembra el seed. */
  async function crearMaquilero(): Promise<number> {
    const rol = await cliente.rolProveedor.findUniqueOrThrow({
      where: { codigo: 'maquila-costura' },
    });
    const maq = await cliente.proveedor.create({
      data: {
        nombre: 'Maquilero HTTP',
        diasCredito: 8,
        modalidadFacturacion: 'ambos',
        roles: { create: { idRolProveedor: rol.id } },
      },
    });
    return maq.id;
  }

  function alta(cookie: string, idTercero: number, extra: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/terceros/movimientos',
      headers: { cookie },
      payload: {
        tipoTercero: 'proveedor',
        idTercero,
        fecha: '2026-07-01',
        importe: 500,
        esFiscal: false,
        ...extra,
      },
    });
  }

  it('rechaza el cargo manual (entrada sin factura) a un maquilero, sin escribir nada', async () => {
    const cookie = await cookieAdmin();
    const idMaquilero = await crearMaquilero();

    const res = await alta(cookie, idMaquilero, { origen: 'entrada_sin_factura' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      mensaje:
        'Este proveedor es de maquila: sus cargos adicionales, pagos y descuentos se capturan en su ' +
        'estado de cuenta de EsMa (la corrida le paga allí). Capturados aquí quedarían en un libro ' +
        'aparte que nunca se salda, y su deuda contada en dos lados.',
    });
    expect(await cliente.movimientoTercero.count()).toBe(0);
  });

  it('marca como COMPROBANTE la factura sin ref de un maquilero: se registra pero no suma', async () => {
    const cookie = await cookieAdmin();
    const idMaquilero = await crearMaquilero();

    const res = await alta(cookie, idMaquilero, {
      origen: 'factura_proveedor',
      importe: 11600,
      esFiscal: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ amparaEsMa: true, monto: 11600 });

    const saldo = await app.inject({
      method: 'GET',
      url: `/api/terceros/proveedor/${idMaquilero}/saldo`,
      headers: { cookie },
    });
    expect(saldo.json()).toMatchObject({ saldo: 0, saldoMovimientos: 0 });
  });

  it('control: el mismo cargo y la misma factura a un proveedor que NO es de maquila entran', async () => {
    const cookie = await cookieAdmin();
    const cargo = await alta(cookie, idProveedor, { origen: 'entrada_sin_factura' });
    expect(cargo.statusCode).toBe(201);
    const factura = await alta(cookie, idProveedor, { origen: 'factura_proveedor' });
    expect(factura.statusCode).toBe(201);
    expect(factura.json()).toMatchObject({ amparaEsMa: false });

    const saldo = await app.inject({
      method: 'GET',
      url: `/api/terceros/proveedor/${idProveedor}/saldo`,
      headers: { cookie },
    });
    expect(saldo.json()).toMatchObject({ saldo: 1000 });
  });
});
