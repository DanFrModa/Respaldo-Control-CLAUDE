/**
 * ⭐ Pruebas de integración POR HTTP de los PRECIOS de telas y avíos (fila 0.249 parte B).
 *
 * Lo que se mide es UNA frase: **con sólo la llave de VOCABULARIO (`telas.ver`, `avios.ver`,
 * `proveedores.ver`) el API NO entrega ningún precio de tela ni de avío; con cualquiera de las
 * llaves de la regla (`catalogos/precios-de-catalogo.ts`) los entrega completos.** Hasta esta fila
 * la pantalla de proveedores-de-tela los escondía con `consultas.ver-importes` y el API los mandaba
 * enteros a cualquiera con `telas.ver` — esconder sin bloquear es maquillaje (§Post-F9.68).
 *
 * Se levanta una app Fastify con las rutas de telas, proveedores de tela, avíos y proveedores bajo
 * `/api`, contra el Postgres efímero, con la autenticación REAL (better-auth) y el seed real: se mide
 * lo que sale por el cable después del serializador del contrato, no lo que devuelve una función.
 *
 * 🔑 Cómo se distingue quién tapa: los `preHandler` de estos GET sólo piden la llave de vocabulario,
 * así que el 200 del lector sale del DOMINIO; si el dominio no tapara, el precio viajaría. Cada
 * precio sembrado es un número ÚNICO y se busca en el TEXTO CRUDO de la respuesta, no en un campo:
 * si mañana se cuela por un campo nuevo, también cae.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from './errores.js';
import { rutasAvios } from './avios/avios.rutas.js';
import { rutasProveedores } from './proveedores/proveedores.rutas.js';
import { rutasTelaProveedores } from './telas/tela-proveedores.rutas.js';
import { rutasTelas } from './telas/telas.rutas.js';
import { registrarAuth } from '../auth/plugin.js';
import type { ClavePermiso } from '../contrato/index.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD = 'Control.2026!';

/** Precios ÚNICOS de la tela: si cualquiera aparece en el texto crudo, se filtró. */
const PRECIOS_TELA = {
  sugerido: '9876.54',
  sugeridoComplemento: '8765.43',
  color: '7654.32',
  colorComplemento: '6543.21',
  proveedor: '5432.19',
  proveedorColor: '4321.87',
} as const;
/** Precios ÚNICOS del avío. */
const PRECIOS_AVIO = { referencia: '3210.98', proveedor: '2109.87', medida: '1098.76' } as const;

/**
 * Las llaves que DEBEN dejar ver los precios, escritas a mano a propósito (no importadas de
 * `precios-de-catalogo.ts`): si alguien quita una de la regla, esta prueba lo nota — iterar sobre
 * la misma constante que se prueba pasaría en verde por construcción.
 */
const LLAVES_PRECIO_TELA: ClavePermiso[] = [
  'consultas.ver-importes',
  'telas.administrar',
  'compras.administrar',
  'modelos.administrar',
];
const LLAVES_PRECIO_AVIO: ClavePermiso[] = [
  'consultas.ver-importes',
  'avios.administrar',
  'compras.administrar',
  'proveedores.administrar',
  'modelos.administrar',
];

/** Crea un usuario con un rol NUEVO que tiene EXACTAMENTE las claves pedidas (ninguna más). */
async function crearUsuarioCon(username: string, claves: ClavePermiso[]): Promise<void> {
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

async function get(cookie: string, url: string): Promise<{ status: number; body: string }> {
  const res = await app.inject({ method: 'GET', url, headers: { cookie } });
  return { status: res.statusCode, body: res.body };
}

interface Sembrado {
  idProveedor: number;
  idTela: number;
  idTelaProveedor: number;
  idAvio: number;
}

/** Una tela y un avío con TODOS sus precios llenos, y el proveedor que los surte. */
async function sembrarCatalogos(): Promise<Sembrado> {
  const rol = await cliente.rolProveedor.findFirstOrThrow({ select: { id: true } });
  const proveedor = await cliente.proveedor.create({
    data: { nombre: 'Textiles 0.249', roles: { create: { idRolProveedor: rol.id } } },
  });
  const color = await cliente.color.create({ data: { nombre: 'Marino 0.249' } });
  const tela = await cliente.tela.create({
    data: {
      nombre: 'Felpa 0.249',
      unidadMedida: 'KG',
      idProveedor: proveedor.id,
      nombreComplemento: 'Cardigan',
      precioSugerido: PRECIOS_TELA.sugerido,
      precioSugeridoComplemento: PRECIOS_TELA.sugeridoComplemento,
      colores: {
        create: {
          nombre: 'Marino Alsa',
          pantone: '19-4005 TCX',
          precio: PRECIOS_TELA.color,
          precioComplemento: PRECIOS_TELA.colorComplemento,
        },
      },
    },
  });
  const telaProveedor = await cliente.telaProveedor.create({
    data: {
      idTela: tela.id,
      idProveedor: proveedor.id,
      precio: PRECIOS_TELA.proveedor,
      manejaPrecioPorColor: true,
      condiciones: 'contado',
      colores: { create: { idColor: color.id, precio: PRECIOS_TELA.proveedorColor } },
    },
  });
  const avio = await cliente.avio.create({
    data: {
      clave: 'CIE-0249',
      descripcion: 'Cierre 0.249',
      unidadMedida: 'cm',
      precioReferencia: PRECIOS_AVIO.referencia,
      proveedores: {
        create: {
          idProveedor: proveedor.id,
          precio: PRECIOS_AVIO.proveedor,
          condiciones: 'crédito 30',
          habitual: true,
        },
      },
      medidas: {
        create: { medida: '53 cm', valor: 53, precio: PRECIOS_AVIO.medida, orden: 0 },
      },
    },
  });
  return {
    idProveedor: proveedor.id,
    idTela: tela.id,
    idTelaProveedor: telaProveedor.id,
    idAvio: avio.id,
  };
}

/** Las URLs de lectura de la tela (todas con `telas.ver`). */
function urlsTela(s: Sembrado): string[] {
  return [
    '/api/telas',
    `/api/telas/${String(s.idTela)}`,
    `/api/telas/${String(s.idTela)}/colores`,
    `/api/telas/${String(s.idTela)}/proveedores`,
    `/api/telas/${String(s.idTela)}/proveedores/${String(s.idTelaProveedor)}`,
  ];
}

/** Las URLs de lectura del avío (todas con `avios.ver`). */
function urlsAvio(s: Sembrado): string[] {
  return [
    '/api/avios',
    `/api/avios/${String(s.idAvio)}`,
    `/api/avios/${String(s.idAvio)}/proveedores`,
    `/api/avios/${String(s.idAvio)}/medidas`,
  ];
}

beforeAll(async () => {
  cliente = clientePruebas();
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasTelas, { prefix: '/api' });
  await instancia.register(rutasTelaProveedores, { prefix: '/api' });
  await instancia.register(rutasAvios, { prefix: '/api' });
  await instancia.register(rutasProveedores, { prefix: '/api' });
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

describe('Precios del catálogo de TELAS por HTTP (fila 0.249 parte B)', () => {
  it('con SÓLO `telas.ver`: ni listado, ni ficha, ni colores, ni proveedores traen un precio', async () => {
    await crearUsuarioCon('lector', ['telas.ver']);
    const s = await sembrarCatalogos();
    const cookie = await cookieDe('lector');

    for (const url of urlsTela(s)) {
      const res = await get(cookie, url);
      expect(res.status, url).toBe(200);
      for (const precio of Object.values(PRECIOS_TELA)) {
        expect(res.body, `${url} filtró ${precio}`).not.toContain(precio);
      }
      // La marca viaja y dice la verdad: tapado, no «sin precio».
      expect(res.body, url).toContain('"preciosOcultos":true');
      expect(res.body, url).not.toContain('"preciosOcultos":false');
    }

    // Y el VOCABULARIO sí llega: nombre, color, pantone, proveedor, condiciones.
    const ficha = await get(cookie, `/api/telas/${String(s.idTela)}`);
    expect(ficha.body).toContain('Felpa 0.249');
    expect(ficha.body).toContain('Marino Alsa');
    expect(ficha.body).toContain('19-4005 TCX');
    const provs = await get(cookie, `/api/telas/${String(s.idTela)}/proveedores`);
    expect(provs.body).toContain('Textiles 0.249');
    expect(provs.body).toContain('contado');
  });

  it.each(LLAVES_PRECIO_TELA)(
    'con `telas.ver` + %s: los precios llegan COMPLETOS',
    async (llave) => {
      await crearUsuarioCon('conllave', ['telas.ver', llave]);
      const s = await sembrarCatalogos();
      const cookie = await cookieDe('conllave');

      const ficha = await get(cookie, `/api/telas/${String(s.idTela)}`);
      expect(ficha.status).toBe(200);
      for (const precio of [
        PRECIOS_TELA.sugerido,
        PRECIOS_TELA.sugeridoComplemento,
        PRECIOS_TELA.color,
        PRECIOS_TELA.colorComplemento,
      ]) {
        expect(ficha.body).toContain(precio);
      }
      expect(ficha.body).not.toContain('"preciosOcultos":true');

      const colores = await get(cookie, `/api/telas/${String(s.idTela)}/colores`);
      expect(colores.body).toContain(PRECIOS_TELA.color);

      const provs = await get(cookie, `/api/telas/${String(s.idTela)}/proveedores`);
      expect(provs.body).toContain(PRECIOS_TELA.proveedor);
      expect(provs.body).toContain(PRECIOS_TELA.proveedorColor);

      const lista = await get(cookie, '/api/telas');
      expect(lista.body).toContain(PRECIOS_TELA.sugerido);
    },
  );

  it('editar la tela SIN mandar precios ni colores (lo que hace el formulario si no los vio) NO los borra', async () => {
    await crearUsuarioCon('admin249', ['telas.ver', 'telas.administrar']);
    const s = await sembrarCatalogos();
    const cookie = await cookieDe('admin249');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/telas/${String(s.idTela)}`,
      headers: { cookie },
      payload: { descripcion: 'Cambió la descripción' },
    });
    expect(res.statusCode).toBe(200);

    const enBd = await cliente.tela.findUniqueOrThrow({
      where: { id: s.idTela },
      include: { colores: true },
    });
    expect(enBd.precioSugerido?.toFixed(2)).toBe(PRECIOS_TELA.sugerido);
    expect(enBd.precioSugeridoComplemento?.toFixed(2)).toBe(PRECIOS_TELA.sugeridoComplemento);
    expect(enBd.colores[0]?.precio?.toFixed(2)).toBe(PRECIOS_TELA.color);
    expect(enBd.colores[0]?.precioComplemento?.toFixed(2)).toBe(PRECIOS_TELA.colorComplemento);
  });
});

describe('Precios del catálogo de AVÍOS por HTTP (fila 0.249 parte B)', () => {
  it('con SÓLO `avios.ver`: ni listado, ni ficha, ni proveedores, ni medidas traen un precio', async () => {
    await crearUsuarioCon('lector', ['avios.ver']);
    const s = await sembrarCatalogos();
    const cookie = await cookieDe('lector');

    for (const url of urlsAvio(s)) {
      const res = await get(cookie, url);
      expect(res.status, url).toBe(200);
      for (const precio of Object.values(PRECIOS_AVIO)) {
        expect(res.body, `${url} filtró ${precio}`).not.toContain(precio);
      }
      expect(res.body, url).toContain('"preciosOcultos":true');
      expect(res.body, url).not.toContain('"preciosOcultos":false');
    }

    const ficha = await get(cookie, `/api/avios/${String(s.idAvio)}`);
    expect(ficha.body).toContain('CIE-0249');
    expect(ficha.body).toContain('Textiles 0.249');
    expect(ficha.body).toContain('crédito 30');
    // Las medidas viajan (sin precio) y el promedio del precosto también se tapa.
    const medidas = await get(cookie, `/api/avios/${String(s.idAvio)}/medidas`);
    expect(medidas.body).toContain('53 cm');
    expect(medidas.body).toContain('"promedioPreCosto":null');
  });

  it.each(LLAVES_PRECIO_AVIO)(
    'con `avios.ver` + %s: los precios llegan COMPLETOS',
    async (llave) => {
      await crearUsuarioCon('conllave', ['avios.ver', llave]);
      const s = await sembrarCatalogos();
      const cookie = await cookieDe('conllave');

      const ficha = await get(cookie, `/api/avios/${String(s.idAvio)}`);
      expect(ficha.status).toBe(200);
      expect(ficha.body).toContain(PRECIOS_AVIO.referencia);
      expect(ficha.body).toContain(PRECIOS_AVIO.proveedor);
      expect(ficha.body).not.toContain('"preciosOcultos":true');

      const provs = await get(cookie, `/api/avios/${String(s.idAvio)}/proveedores`);
      expect(provs.body).toContain(PRECIOS_AVIO.proveedor);

      const medidas = await get(cookie, `/api/avios/${String(s.idAvio)}/medidas`);
      expect(medidas.body).toContain(PRECIOS_AVIO.medida);

      const lista = await get(cookie, '/api/avios');
      expect(lista.body).toContain(PRECIOS_AVIO.referencia);
    },
  );

  it('«Avíos que surte» del proveedor: con SÓLO `proveedores.ver` tampoco trae el precio', async () => {
    await crearUsuarioCon('lector', ['proveedores.ver']);
    const s = await sembrarCatalogos();
    const cookie = await cookieDe('lector');

    const res = await get(cookie, `/api/proveedores/${String(s.idProveedor)}/avios`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('CIE-0249');
    expect(res.body).not.toContain(PRECIOS_AVIO.proveedor);
    expect(res.body).toContain('"preciosOcultos":true');
  });

  it('«Avíos que surte» con `proveedores.administrar` (quien asigna el avío con su precio) SÍ lo trae', async () => {
    await crearUsuarioCon('admin249', ['proveedores.ver', 'proveedores.administrar']);
    const s = await sembrarCatalogos();
    const cookie = await cookieDe('admin249');

    const res = await get(cookie, `/api/proveedores/${String(s.idProveedor)}/avios`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(PRECIOS_AVIO.proveedor);
    expect(res.body).toContain('"preciosOcultos":false');
  });

  it('editar el avío SIN mandar precio de referencia ni proveedores NO los borra', async () => {
    await crearUsuarioCon('admin249', ['avios.ver', 'avios.administrar']);
    const s = await sembrarCatalogos();
    const cookie = await cookieDe('admin249');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/avios/${String(s.idAvio)}`,
      headers: { cookie },
      payload: { descripcion: 'Cierre 0.249 (corregido)' },
    });
    expect(res.statusCode).toBe(200);

    const enBd = await cliente.avio.findUniqueOrThrow({
      where: { id: s.idAvio },
      include: { proveedores: true },
    });
    expect(enBd.precioReferencia?.toFixed(2)).toBe(PRECIOS_AVIO.referencia);
    expect(enBd.proveedores[0]?.precio?.toFixed(2)).toBe(PRECIOS_AVIO.proveedor);
  });
});
