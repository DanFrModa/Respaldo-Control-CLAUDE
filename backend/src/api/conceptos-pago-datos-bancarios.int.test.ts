/**
 * ⭐ Pruebas de integración POR HTTP de las CUENTAS de los CONCEPTOS DE PAGO (fila 0.249).
 *
 * Es el mismo defecto que el de los proveedores, en el catálogo hermano. `conceptos-pago.ver` (que
 * en el seed llevan Directivo y Gerencial SIN administrar) entregaba beneficiario, banco y número
 * COMPLETO de cada cuenta. Ahora las cuentas sólo viajan a quien lleva `conceptos-pago.administrar`
 * o `pagos.corrida-armar` (`puedeVerCuentasDeConcepto`); a los demás les llegan en `null`.
 *
 * App Fastify con SÓLO las rutas de conceptos bajo `/api`, autenticación REAL y seed real. La CLABE
 * se busca en el TEXTO CRUDO de la respuesta, no en un campo: si se cuela por otro lado, también cae.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from './errores.js';
import { rutasBitacora } from './admin/bitacora.rutas.js';
import { rutasConceptosPago } from './pagos/conceptos-pago.rutas.js';
import { registrarAuth } from '../auth/plugin.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD = 'Control.2026!';
/** CLABE con dígito de control válido. */
const CLABE = '002010077777777771';

/** Forma (parcial) de un concepto tal como sale por el API. */
interface ConceptoHttp {
  id: number;
  nombre: string;
  rubro: string;
  cuentas: { cuenta: string; beneficiario: string }[] | null;
}

/** Crea un usuario con un rol NUEVO que tiene EXACTAMENTE las claves pedidas (ninguna más). */
async function crearUsuarioCon(username: string, claves: string[]): Promise<void> {
  const rol = await cliente.rol.create({
    data: {
      nombre: `Perfil ${username}`,
      descripcion: `Rol de prueba con ${String(claves.length)} permiso(s).`,
      permisos: { create: claves.map((clave) => ({ permiso: { connect: { clave } } })) },
    },
  });
  const usuario = await cliente.usuario.create({
    data: {
      username,
      nombre: `Usuario ${username}`,
      email: `${username}@control.local`,
      emailVerified: true,
      roles: { create: { idRol: rol.id } },
    },
  });
  await cliente.cuenta.create({
    data: {
      providerId: 'credential',
      accountId: usuario.id,
      userId: usuario.id,
      password: await hashPassword(PASSWORD),
    },
  });
}

async function cookieDe(username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  const set = res.headers['set-cookie'];
  const cookies = set === undefined ? [] : Array.isArray(set) ? set : [set];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

/** Un concepto con UNA cuenta (la default), escrito directo en la base. */
async function conceptoConCuenta(): Promise<number> {
  const c = await cliente.conceptoPago.create({
    data: {
      nombre: 'Nómina por fuera 0.249',
      rubro: 'nomina',
      formaPagoPreferida: 'transferencia',
      cuentas: {
        create: {
          beneficiario: 'Fulana de Tal',
          banco: 'BBVA',
          tipoCuenta: 'clabe',
          cuenta: CLABE,
          esDefault: true,
        },
      },
    },
  });
  return c.id;
}

beforeAll(async () => {
  cliente = clientePruebas();
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasConceptosPago, { prefix: '/api' });
  await instancia.register(rutasBitacora, { prefix: '/api' });
  await instancia.ready();
  app = instancia;
});

afterAll(async () => {
  await app.close();
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrar(cliente);
});

describe('Cuentas de los conceptos de pago por HTTP (fila 0.249)', () => {
  it('con SÓLO `conceptos-pago.ver`: el LISTADO llega con `cuentas: null` y sin la CLABE', async () => {
    await crearUsuarioCon('lector', ['conceptos-pago.ver']);
    await conceptoConCuenta();
    const cookie = await cookieDe('lector');

    const res = await app.inject({
      method: 'GET',
      url: '/api/conceptos-pago',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const datos = res.json<{ datos: ConceptoHttp[] }>().datos;
    expect(datos).toHaveLength(1);
    // El catálogo sí llega: nombre y rubro son lo que el lector vino a ver.
    expect(datos[0]).toMatchObject({
      nombre: 'Nómina por fuera 0.249',
      rubro: 'nomina',
      cuentas: null,
    });
    expect(res.body).not.toContain(CLABE);
    expect(res.body).not.toContain('Fulana de Tal');
  });

  it('con SÓLO `conceptos-pago.ver`: la FICHA llega sin cuentas y la lista de CUENTAS es 403', async () => {
    await crearUsuarioCon('lector', ['conceptos-pago.ver']);
    const id = await conceptoConCuenta();
    const cookie = await cookieDe('lector');

    const ficha = await app.inject({
      method: 'GET',
      url: `/api/conceptos-pago/${String(id)}`,
      headers: { cookie },
    });
    expect(ficha.statusCode).toBe(200);
    expect(ficha.json<ConceptoHttp>().cuentas).toBeNull();
    expect(ficha.body).not.toContain(CLABE);

    for (const url of [
      `/api/conceptos-pago/${String(id)}/cuentas`,
      `/api/conceptos-pago/${String(id)}/cuentas?incluirInactivas=true`,
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(CLABE);
    }
  });

  it('con `conceptos-pago.administrar`: listado, ficha y cuentas COMPLETOS', async () => {
    await crearUsuarioCon('admin249', ['conceptos-pago.ver', 'conceptos-pago.administrar']);
    const id = await conceptoConCuenta();
    const cookie = await cookieDe('admin249');

    const lista = await app.inject({
      method: 'GET',
      url: '/api/conceptos-pago',
      headers: { cookie },
    });
    expect(lista.json<{ datos: ConceptoHttp[] }>().datos[0]?.cuentas?.map((c) => c.cuenta)).toEqual(
      [CLABE],
    );
    const ficha = await app.inject({
      method: 'GET',
      url: `/api/conceptos-pago/${String(id)}`,
      headers: { cookie },
    });
    expect(ficha.json<ConceptoHttp>().cuentas?.[0]?.beneficiario).toBe('Fulana de Tal');
    const cuentas = await app.inject({
      method: 'GET',
      url: `/api/conceptos-pago/${String(id)}/cuentas`,
      headers: { cookie },
    });
    expect(cuentas.statusCode).toBe(200);
    expect(cuentas.body).toContain(CLABE);
  });

  it('con `pagos.corrida-armar` (sin administrar el catálogo) el listado SÍ trae las cuentas', async () => {
    // La corrida toma de aquí la cuenta por omisión al «Agregar un concepto del catálogo»: sin ella
    // un concepto por transferencia caería en silencio a efectivo.
    await crearUsuarioCon('armador', ['conceptos-pago.ver', 'pagos.corrida-armar']);
    await conceptoConCuenta();
    const cookie = await cookieDe('armador');

    const lista = await app.inject({
      method: 'GET',
      url: '/api/conceptos-pago',
      headers: { cookie },
    });
    expect(lista.statusCode).toBe(200);
    expect(lista.json<{ datos: ConceptoHttp[] }>().datos[0]?.cuentas?.map((c) => c.cuenta)).toEqual(
      [CLABE],
    );
  });

  it('editar el concepto (PATCH sin cuentas) no toca sus cuentas, y el eco las trae', async () => {
    await crearUsuarioCon('admin249', ['conceptos-pago.ver', 'conceptos-pago.administrar']);
    const id = await conceptoConCuenta();
    const cookie = await cookieDe('admin249');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/conceptos-pago/${String(id)}`,
      headers: { cookie },
      payload: { notas: 'Cada viernes', predeterminado: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<ConceptoHttp>().cuentas?.map((c) => c.cuenta)).toEqual([CLABE]);
    expect(
      await cliente.conceptoPagoCuenta.count({
        where: { idConcepto: id, activo: true, cuenta: CLABE },
      }),
    ).toBe(1);
  });

  it('el 403 de las cuentas nombra las DOS llaves que las abren', async () => {
    await crearUsuarioCon('lector', ['conceptos-pago.ver']);
    const id = await conceptoConCuenta();
    const cookie = await cookieDe('lector');
    const res = await app.inject({
      method: 'GET',
      url: `/api/conceptos-pago/${String(id)}/cuentas`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('conceptos-pago.administrar');
    expect(res.body).toContain('pagos.corrida-armar');
  });

  /** 🔒 La bitácora la lee quien no ve las cuentas (`admin.ver-bitacora`): no puede copiarlas. */
  it('la BITÁCORA de las cuentas no copia beneficiario, banco, alias ni notas', async () => {
    await crearUsuarioCon('admin249', ['conceptos-pago.ver', 'conceptos-pago.administrar']);
    await crearUsuarioCon('auditor', ['admin.ver-bitacora']);
    const id = await conceptoConCuenta();
    const admin = await cookieDe('admin249');

    const alta = await app.inject({
      method: 'POST',
      url: `/api/conceptos-pago/${String(id)}/cuentas`,
      headers: { cookie: admin },
      payload: {
        beneficiario: 'Mengana Pérez',
        banco: 'Santander',
        tipoCuenta: 'clabe',
        cuenta: '014180001234567897',
        alias: 'la de Mengana',
        notas: 'respaldo 014180001234567897',
      },
    });
    expect(alta.statusCode).toBe(201);
    const idCuenta = alta.json<{ id: number }>().id;
    const correccion = await app.inject({
      method: 'PATCH',
      url: `/api/conceptos-pago/${String(id)}/cuentas/${String(idCuenta)}`,
      headers: { cookie: admin },
      payload: { beneficiario: 'Mengana Pérez López', banco: 'HSBC', alias: 'otra', notas: 'x' },
    });
    expect(correccion.statusCode).toBe(200);
    const retiro = await app.inject({
      method: 'PATCH',
      url: `/api/conceptos-pago/${String(id)}/cuentas/${String(idCuenta)}`,
      headers: { cookie: admin },
      payload: { activo: false },
    });
    expect(retiro.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/bitacora?porPagina=100',
      headers: { cookie: await cookieDe('auditor') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ConceptoPagoCuenta');
    for (const secreto of [
      '014180001234567897',
      'Santander',
      'HSBC',
      'Mengana',
      'la de Mengana',
      'respaldo',
    ]) {
      expect(res.body, `la bitácora filtra "${secreto}"`).not.toContain(secreto);
    }
  });
});
