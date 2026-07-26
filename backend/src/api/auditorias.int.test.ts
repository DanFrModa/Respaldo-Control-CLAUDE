/**
 * Pruebas de integración de las rutas REST de AUDITORÍAS de calidad (F6-E2). Levantan la app Fastify
 * REAL apuntada al Postgres efímero (testcontainers), reusando el seed real (admin `Control.2026!`, FR
 * Moda, el plan AQL default). Cubren:
 *  - deny-by-default: un usuario sin permisos (Basico) recibe 403 al dar de alta y al capturar;
 *  - alta + captura end-to-end por HTTP (el resultado MANUAL se persiste);
 *  - el permiso de CAPTURA (`calidad.actualizar-auditorias`) gobierna la captura/override de muestra:
 *    un usuario con SOLO `calidad.generar-auditorias` da de alta (201) pero NO captura (403).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { construirApp } from '../app.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;
let idOrden: number;

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

/** Crea una orden COMPLETA con matriz (30 pzas) en la empresa del seed. Devuelve su id. */
async function crearOrden(): Promise<number> {
  const empresa = await cliente.empresa.findFirstOrThrow({ select: { id: true } });
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  const color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  const talla = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocio.id },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 30, precio: 10 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
      estado: 'completa',
      fechaCompletada: new Date(),
      lineas: {
        create: [{ idColor: color.id, tallas: { create: [{ idTalla: talla.id, cantidad: 30 }] } }],
      },
    },
  });
  return orden.id;
}

/** Crea un rol con permisos exactos y un usuario con ese rol; devuelve su cookie de sesión. */
async function usuarioConPermisos(
  cookieAdmin: string,
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
    headers: { cookie: cookieAdmin },
    payload: { username, nombre: username, password: 'Clave.1234!', idsRoles: [rol.id] },
  });
  expect(creado.statusCode).toBe(201);
  return comoHeaderCookie((await login(username, 'Clave.1234!')).cookies);
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
  idOrden = await crearOrden();
});

describe('API de Auditorías (F6-E2)', () => {
  it('deny-by-default: Basico (sin permisos) recibe 403 al dar de alta y al capturar', async () => {
    const cookieAdminVal = await cookieAdmin();
    const creado = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      headers: { cookie: cookieAdminVal },
      payload: {
        username: 'sinpermiso',
        nombre: 'Sin Permiso',
        password: 'Clave.1234!',
        idsRoles: [await idRol('Basico')],
      },
    });
    expect(creado.statusCode).toBe(201);
    const cookieBasico = comoHeaderCookie((await login('sinpermiso', 'Clave.1234!')).cookies);

    const alta = await app.inject({
      method: 'POST',
      url: '/api/calidad/auditorias',
      headers: { cookie: cookieBasico },
      payload: { idOrden },
    });
    expect(alta.statusCode).toBe(403);

    const captura = await app.inject({
      method: 'PATCH',
      url: '/api/calidad/auditorias/1/resultado',
      headers: { cookie: cookieBasico },
      payload: { resultado: 'aprobado', defectos: [] },
    });
    expect(captura.statusCode).toBe(403);
  });

  it('alta + captura por HTTP: el resultado MANUAL se persiste', async () => {
    const cookie = await cookieAdmin();

    const alta = await app.inject({
      method: 'POST',
      url: '/api/calidad/auditorias',
      headers: { cookie },
      payload: { idOrden, tipoAuditoria: 'final' },
    });
    expect(alta.statusCode).toBe(201);
    const auditoria = alta.json<{ id: number; numAuditoria: number; tamanoMuestra: number }>();
    expect(auditoria.numAuditoria).toBe(1);
    expect(auditoria.tamanoMuestra).toBeGreaterThan(0); // muestra del plan default del seed.

    const detalle = await app.inject({
      method: 'GET',
      url: `/api/calidad/auditorias/${String(auditoria.id)}`,
      headers: { cookie },
    });
    expect(detalle.statusCode).toBe(200);

    const captura = await app.inject({
      method: 'PATCH',
      url: `/api/calidad/auditorias/${String(auditoria.id)}/resultado`,
      headers: { cookie },
      payload: { resultado: 'aprobado', observaciones: 'OK', defectos: [] },
    });
    expect(captura.statusCode).toBe(200);
    expect(captura.json<{ resultado: string }>().resultado).toBe('aprobado');
  });

  it('SOLO generar-auditorias: da de alta (201) pero NO captura (403 — la captura exige actualizar)', async () => {
    const cookieAdminVal = await cookieAdmin();
    const cookie = await usuarioConPermisos(cookieAdminVal, 'generador', [
      'calidad.ver',
      'calidad.generar-auditorias',
    ]);

    const alta = await app.inject({
      method: 'POST',
      url: '/api/calidad/auditorias',
      headers: { cookie },
      payload: { idOrden },
    });
    expect(alta.statusCode).toBe(201);
    const id = alta.json<{ id: number }>().id;

    const captura = await app.inject({
      method: 'PATCH',
      url: `/api/calidad/auditorias/${String(id)}/resultado`,
      headers: { cookie },
      payload: { resultado: 'aprobado', defectos: [] },
    });
    expect(captura.statusCode).toBe(403);
  });
});

describe('API de Auditorías — consulta/impreso/modificar/cancelar (F6-E3)', () => {
  /** Da de alta una auditoría por HTTP con el admin y devuelve su id. */
  async function altaAuditoria(cookie: string): Promise<number> {
    const alta = await app.inject({
      method: 'POST',
      url: '/api/calidad/auditorias',
      headers: { cookie },
      payload: { idOrden, tipoAuditoria: 'final' },
    });
    expect(alta.statusCode).toBe(201);
    return alta.json<{ id: number }>().id;
  }

  it('lista paginada y filtra por resultado (calidad.ver)', async () => {
    const cookie = await cookieAdmin();
    const id = await altaAuditoria(cookie);
    await app.inject({
      method: 'PATCH',
      url: `/api/calidad/auditorias/${String(id)}/resultado`,
      headers: { cookie },
      payload: { resultado: 'aprobado', defectos: [] },
    });

    const lista = await app.inject({
      method: 'GET',
      url: '/api/calidad/auditorias?resultado=aprobado',
      headers: { cookie },
    });
    expect(lista.statusCode).toBe(200);
    const pagina = lista.json<{ total: number; datos: { id: number; resultado: string }[] }>();
    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]?.resultado).toBe('aprobado');
  });

  it('el impreso responde 200 application/pdf', async () => {
    const cookie = await cookieAdmin();
    const id = await altaAuditoria(cookie);
    const pdf = await app.inject({
      method: 'GET',
      url: `/api/calidad/auditorias/${String(id)}/impreso`,
      headers: { cookie },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // Los impresos NO se cachean (incidente del 26-jul-2026: tras un despliegue el navegador
    // seguía sirviendo el PDF viejo). Esta aserción va contra la APP REAL a propósito: la unit de
    // `api/cache-documentos.test.ts` prueba el hook, pero solo esto detecta que alguien lo
    // desconecte de `construirApp`.
    expect(pdf.headers['cache-control']).toBe('no-store');
  });

  it('modificar y cancelar por HTTP (con calidad.modificar-auditorias)', async () => {
    const cookieAdminVal = await cookieAdmin();
    const id = await altaAuditoria(cookieAdminVal);
    const cookie = await usuarioConPermisos(cookieAdminVal, 'modificador', [
      'calidad.ver',
      'calidad.modificar-auditorias',
    ]);

    const mod = await app.inject({
      method: 'PATCH',
      url: `/api/calidad/auditorias/${String(id)}`,
      headers: { cookie },
      payload: { observaciones: 'revisada por HTTP' },
    });
    expect(mod.statusCode).toBe(200);
    expect(mod.json<{ observaciones: string }>().observaciones).toBe('revisada por HTTP');

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/calidad/auditorias/${String(id)}/cancelacion`,
      headers: { cookie },
      payload: { motivo: 'duplicada' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json<{ cancelada: boolean }>().cancelada).toBe(true);
  });

  it('deny-by-default: solo generar/actualizar NO basta para modificar ni cancelar (403)', async () => {
    const cookieAdminVal = await cookieAdmin();
    const id = await altaAuditoria(cookieAdminVal);
    const cookie = await usuarioConPermisos(cookieAdminVal, 'capturador', [
      'calidad.ver',
      'calidad.generar-auditorias',
      'calidad.actualizar-auditorias',
    ]);

    const mod = await app.inject({
      method: 'PATCH',
      url: `/api/calidad/auditorias/${String(id)}`,
      headers: { cookie },
      payload: { observaciones: 'no debería' },
    });
    expect(mod.statusCode).toBe(403);

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/calidad/auditorias/${String(id)}/cancelacion`,
      headers: { cookie },
      payload: { motivo: 'no debería' },
    });
    expect(cancel.statusCode).toBe(403);
  });

  it('deny-by-default: sin calidad.ver no lista ni imprime (403)', async () => {
    const cookieAdminVal = await cookieAdmin();
    const id = await altaAuditoria(cookieAdminVal);
    const creado = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      headers: { cookie: cookieAdminVal },
      payload: {
        username: 'sinver',
        nombre: 'Sin Ver',
        password: 'Clave.1234!',
        idsRoles: [await idRol('Basico')],
      },
    });
    expect(creado.statusCode).toBe(201);
    const cookie = comoHeaderCookie((await login('sinver', 'Clave.1234!')).cookies);

    const lista = await app.inject({
      method: 'GET',
      url: '/api/calidad/auditorias',
      headers: { cookie },
    });
    expect(lista.statusCode).toBe(403);

    const pdf = await app.inject({
      method: 'GET',
      url: `/api/calidad/auditorias/${String(id)}/impreso`,
      headers: { cookie },
    });
    expect(pdf.statusCode).toBe(403);
  });
});
