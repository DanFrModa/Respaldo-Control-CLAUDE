/**
 * ⭐ Pruebas de integración POR HTTP de los DATOS BANCARIOS del proveedor (fila 0.249).
 *
 * Lo que se mide es UNA frase: **con sólo `proveedores.ver` (el directorio) el API NO entrega banco,
 * CLABE, `obsPago` ni las cuentas de pago; con `proveedores.administrar` los entrega completos.** Hasta
 * esta fila la pantalla los enmascaraba pero el API los mandaba enteros a cualquiera con la llave del
 * directorio — y esconder sin bloquear es maquillaje (§Post-F9.68).
 *
 * Se levanta una app Fastify con SÓLO las rutas de proveedores bajo `/api`, contra el Postgres
 * efímero, con la autenticación REAL (better-auth) y el seed real — así se mide lo que sale por el
 * cable después del serializador del contrato, no lo que devuelve una función.
 *
 * 🔑 Cómo se distingue quién tapa: el `preHandler` de los GET sólo pide `proveedores.ver`, así que
 * el 200 del lector sale del DOMINIO; si el dominio no tapara, la CLABE viajaría en el cuerpo. La
 * prueba busca la CLABE en el TEXTO CRUDO de la respuesta, no en un campo: si mañana el dato se
 * cuela por un campo nuevo, también cae.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from './errores.js';
import { rutasBitacora } from './admin/bitacora.rutas.js';
import { rutasProveedores } from './proveedores/proveedores.rutas.js';
import { registrarAuth } from '../auth/plugin.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD = 'Control.2026!';
/** CLABE con dígito de control válido. */
const CLABE = '002010077777777771';
/** Tarjeta de 16 dígitos (la segunda cuenta). */
const TARJETA = '4152313312345678';

/** Forma (parcial) de un proveedor tal como sale por el API. */
interface ProveedorHttp {
  id: number;
  nombre: string;
  rfc: string | null;
  telefono: string | null;
  banco: string | null;
  clabe: string | null;
  obsPago: string | null;
  cuentasPago: { cuenta: string; beneficiario: string; banco: string | null }[] | null;
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

/** Un proveedor con TODO el dato bancario lleno: el par viejo, `obsPago` y DOS cuentas. */
async function proveedorConBanco(): Promise<number> {
  const rol = await cliente.rolProveedor.findFirstOrThrow({ select: { id: true } });
  const p = await cliente.proveedor.create({
    data: {
      nombre: 'Taller 0.249',
      rfc: 'TAL010101AB1',
      telefono: '555-0249',
      banco: 'BBVA',
      clabe: CLABE,
      obsPago: `Depositar a ${CLABE}`,
      modalidadFacturacion: 'ambos',
      roles: { create: { idRolProveedor: rol.id } },
      cuentasPago: {
        create: [
          {
            beneficiario: 'Fulana de Tal',
            banco: 'BBVA',
            tipoCuenta: 'clabe',
            cuenta: CLABE,
            esDefault: true,
          },
          { beneficiario: 'Su esposa', tipoCuenta: 'tarjeta', cuenta: TARJETA },
        ],
      },
    },
  });
  return p.id;
}

beforeAll(async () => {
  cliente = clientePruebas();
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasProveedores, { prefix: '/api' });
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

describe('Datos bancarios del proveedor por HTTP (fila 0.249)', () => {
  it('con SÓLO `proveedores.ver`: la FICHA llega sin banco, CLABE, obsPago ni cuentas', async () => {
    await crearUsuarioCon('lector', ['proveedores.ver']);
    const id = await proveedorConBanco();
    const cookie = await cookieDe('lector');

    const res = await app.inject({
      method: 'GET',
      url: `/api/proveedores/${String(id)}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const p = res.json<ProveedorHttp>();
    expect(p).toMatchObject({
      nombre: 'Taller 0.249',
      rfc: 'TAL010101AB1',
      telefono: '555-0249',
      banco: null,
      clabe: null,
      obsPago: null,
      cuentasPago: null,
    });
    // En el TEXTO CRUDO: ni la CLABE ni la tarjeta, ni el beneficiario, por ningún campo.
    expect(res.body).not.toContain(CLABE);
    expect(res.body).not.toContain(TARJETA);
    expect(res.body).not.toContain('Fulana de Tal');
  });

  it('con SÓLO `proveedores.ver`: el LISTADO tampoco los trae', async () => {
    await crearUsuarioCon('lector', ['proveedores.ver']);
    await proveedorConBanco();
    const cookie = await cookieDe('lector');

    const res = await app.inject({ method: 'GET', url: '/api/proveedores', headers: { cookie } });

    expect(res.statusCode).toBe(200);
    const datos = res.json<{ datos: ProveedorHttp[] }>().datos;
    expect(datos.length).toBeGreaterThan(0);
    for (const p of datos) {
      expect(p.cuentasPago).toBeNull();
      expect(p.clabe).toBeNull();
      expect(p.banco).toBeNull();
      expect(p.obsPago).toBeNull();
    }
    expect(res.body).not.toContain(CLABE);
    expect(res.body).not.toContain(TARJETA);
  });

  it('con SÓLO `proveedores.ver`: la lista de CUENTAS (activas y retiradas) es 403', async () => {
    await crearUsuarioCon('lector', ['proveedores.ver']);
    const id = await proveedorConBanco();
    const cookie = await cookieDe('lector');

    for (const url of [
      `/api/proveedores/${String(id)}/cuentas-pago`,
      `/api/proveedores/${String(id)}/cuentas-pago?incluirInactivas=true`,
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(CLABE);
    }
  });

  it('con `proveedores.administrar`: ficha, listado y cuentas COMPLETOS', async () => {
    await crearUsuarioCon('admin249', ['proveedores.ver', 'proveedores.administrar']);
    const id = await proveedorConBanco();
    const cookie = await cookieDe('admin249');

    const ficha = await app.inject({
      method: 'GET',
      url: `/api/proveedores/${String(id)}`,
      headers: { cookie },
    });
    expect(ficha.statusCode).toBe(200);
    const p = ficha.json<ProveedorHttp>();
    expect(p).toMatchObject({ banco: 'BBVA', clabe: CLABE, obsPago: `Depositar a ${CLABE}` });
    expect(p.cuentasPago?.map((c) => c.cuenta)).toEqual([CLABE, TARJETA]);

    const listado = await app.inject({
      method: 'GET',
      url: '/api/proveedores',
      headers: { cookie },
    });
    const enLista = listado.json<{ datos: ProveedorHttp[] }>().datos.find((x) => x.id === id);
    expect(enLista?.cuentasPago?.map((c) => c.beneficiario)).toEqual([
      'Fulana de Tal',
      'Su esposa',
    ]);

    const cuentas = await app.inject({
      method: 'GET',
      url: `/api/proveedores/${String(id)}/cuentas-pago`,
      headers: { cookie },
    });
    expect(cuentas.statusCode).toBe(200);
    expect(cuentas.body).toContain(CLABE);
    expect(cuentas.body).toContain(TARJETA);
  });

  it('editar el proveedor (PATCH del formulario, sin campos bancarios) NO los borra', async () => {
    await crearUsuarioCon('admin249', ['proveedores.ver', 'proveedores.administrar']);
    const id = await proveedorConBanco();
    const cookie = await cookieDe('admin249');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/proveedores/${String(id)}`,
      headers: { cookie },
      payload: { telefono: '555-9999', notas: 'Cambió de teléfono' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<ProveedorHttp>().clabe).toBe(CLABE);
    const enBd = await cliente.proveedor.findUniqueOrThrow({ where: { id } });
    expect(enBd).toMatchObject({
      telefono: '555-9999',
      banco: 'BBVA',
      clabe: CLABE,
      obsPago: `Depositar a ${CLABE}`,
    });
    expect(
      await cliente.proveedorCuentaPago.count({ where: { idProveedor: id, activo: true } }),
    ).toBe(2);
  });

  it('el lector no puede editar (403) y su intento no toca nada', async () => {
    await crearUsuarioCon('lector', ['proveedores.ver']);
    const id = await proveedorConBanco();
    const cookie = await cookieDe('lector');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/proveedores/${String(id)}`,
      headers: { cookie },
      payload: { clabe: null, banco: null, obsPago: null },
    });

    expect(res.statusCode).toBe(403);
    const enBd = await cliente.proveedor.findUniqueOrThrow({ where: { id } });
    expect(enBd).toMatchObject({ banco: 'BBVA', clabe: CLABE, obsPago: `Depositar a ${CLABE}` });
  });

  /**
   * 🔒 LA BITÁCORA NO ES UNA PUERTA TRASERA (fila 0.249, hallazgo del reviewer). `GET
   * /admin/bitacora` la leen con `admin.ver-bitacora` seis roles que NO llevan
   * `proveedores.administrar`. Si la edición copiara el antes y el después de banco, CLABE u
   * `obsPago`, o el beneficiario de una cuenta, lo que la ficha tapa saldría por aquí. Se recorre
   * TODO el ciclo por HTTP (editar la ficha, dar de alta una cuenta, corregirla y retirarla) y luego
   * se lee la bitácora como auditor, buscando cada valor en el TEXTO CRUDO.
   */
  it('la BITÁCORA no copia banco, CLABE, obsPago ni beneficiario: el auditor no los ve', async () => {
    await crearUsuarioCon('admin249', ['proveedores.ver', 'proveedores.administrar']);
    await crearUsuarioCon('auditor', ['admin.ver-bitacora']);
    const id = await proveedorConBanco();
    const admin = await cookieDe('admin249');
    const CLABE_NUEVA = '012180001234567899';
    const OBS_NUEVA = `Ahora a ${CLABE_NUEVA}`;

    const ficha = await app.inject({
      method: 'PATCH',
      url: `/api/proveedores/${String(id)}`,
      headers: { cookie: admin },
      payload: { banco: 'Banorte', clabe: CLABE_NUEVA, obsPago: OBS_NUEVA, telefono: '555-1111' },
    });
    expect(ficha.statusCode).toBe(200);

    const alta = await app.inject({
      method: 'POST',
      url: `/api/proveedores/${String(id)}/cuentas-pago`,
      headers: { cookie: admin },
      payload: {
        beneficiario: 'Mengana Pérez',
        banco: 'Santander',
        tipoCuenta: 'clabe',
        cuenta: '014180001234567897',
        alias: 'la de Mengana',
        notas: 'cuenta de respaldo 014180001234567897',
      },
    });
    expect(alta.statusCode).toBe(201);
    const idCuenta = alta.json<{ id: number }>().id;

    const correccion = await app.inject({
      method: 'PATCH',
      url: `/api/proveedores/${String(id)}/cuentas-pago/${String(idCuenta)}`,
      headers: { cookie: admin },
      payload: { beneficiario: 'Mengana Pérez López', banco: 'HSBC', alias: 'otra', notas: 'x' },
    });
    expect(correccion.statusCode).toBe(200);
    const retiro = await app.inject({
      method: 'PATCH',
      url: `/api/proveedores/${String(id)}/cuentas-pago/${String(idCuenta)}`,
      headers: { cookie: admin },
      payload: { activo: false },
    });
    expect(retiro.statusCode).toBe(200);

    const auditor = await cookieDe('auditor');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/bitacora?porPagina=100',
      headers: { cookie: auditor },
    });
    expect(res.statusCode).toBe(200);
    // La bitácora SÍ registró los cambios (no se volvió ciega)…
    expect(res.body).toContain('ProveedorCuentaPago');
    expect(res.body).toContain('555-1111');
    // …pero ningún dato bancario, ni el de antes ni el de después.
    for (const secreto of [
      CLABE,
      CLABE_NUEVA,
      '014180001234567897',
      'BBVA',
      'Banorte',
      'Santander',
      'HSBC',
      'Depositar a',
      OBS_NUEVA,
      'Mengana',
      'la de Mengana',
      'cuenta de respaldo',
    ]) {
      expect(res.body, `la bitácora filtra "${secreto}"`).not.toContain(secreto);
    }
  });
});
