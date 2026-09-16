/**
 * ⭐ Pruebas de integración de la REJA de las ediciones IDEMPOTENTES (fila 0.198).
 *
 * Lo que aquí se mide es UNA frase: **lo que el sistema le contesta a quien edita dice lo mismo que
 * lo que quedó guardado** — por la RUTA, con su `preHandler` de permisos puesto. Hasta esta fila los
 * diecinueve sitios de la 0.198 abrían con SU permiso de escritura, escribían —transacción cerrada—
 * y DESPUÉS proyectaban la respuesta con una consulta que exige OTRA llave ⇒ quien llevara la de
 * escribir y no la de consultar recibía un **403 con el cambio ya guardado**. Aquí no se quema folio
 * ni se duplica un evento (son PATCH/PUT idempotentes): el daño es que la pantalla decía «no tienes
 * permiso» sobre algo que sí se había guardado.
 *
 * Es la hermana de `api/escritura-sin-ver.int.test.ts` (fila 0.197), con la misma forma. Se levanta
 * una app Fastify con SÓLO estas rutas montadas bajo `/api`, contra el Postgres efímero, con la
 * autenticación REAL (better-auth) y el seed real.
 *
 * 🔑 **CÓMO DISTINGUE QUIÉN NEGÓ** (la trampa de esta familia: una prueba que entra sólo por el
 * `preHandler` no mide el dominio):
 *  - el usuario `editor` NO lleva `ordenes.ver` ni `edr.ver`, así que un 200 con el DTO proyectado
 *    sólo puede salir del DOMINIO en verde: el `preHandler` sólo mira la llave de escribir, y la
 *    proyección la hace el dominio. Si el dominio negara, el cuerpo sería 403 y no una orden;
 *  - el mismo usuario recibe **403 en el `GET /api/ordenes/:id`** y en el `GET /api/edr/:id`, que son
 *    los `preHandler` de consulta: así se ve que `ordenes.ver`/`edr.ver` NO se volvieron decorativos.
 *    ⚠️ Esas aserciones miden LA PUERTA, no el dominio (quitarle el `verificarPermiso` a
 *    `obtenerOrden`/`calcularEdr` NO las pone rojas, porque el `preHandler` niega antes); la mitad de
 *    dominio —la reja de las consultas y el A9 de las proyectoras— la sostiene
 *    `dominio/eco-idempotente-sin-ver.int.test.ts`, que sí cae;
 *  - el usuario `miron` (sólo `ordenes.ver`) recibe **403 en el PATCH** por el `preHandler`, y se
 *    comprueba que **no escribió nada** (la negativa de la puerta nunca toca la base).
 *
 * Aquí entran CUATRO de los diecinueve sitios, elegidos porque son las cuatro FORMAS del defecto: la
 * edición del encabezado (`PATCH /api/ordenes/:id`), la del detalle (`PUT /api/ordenes/:id/matriz`),
 * la captura con DOS llaves distintas dentro del mismo módulo (`PATCH /api/ordenes/:id/precios`, que
 * escribe con `ordenes.precio-maquila` y proyectaba con `ordenes.ver`) y la de OTRO módulo entero
 * con proyectora nueva (`PUT /api/edr/:id`, que escribe con `edr.capturar` y proyectaba con
 * `edr.ver`). Los quince restantes se miden por dominio en el archivo hermano: montar nueve plugins
 * de rutas aquí no mediría nada que estos cuatro no midan ya.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from './errores.js';
import { rutasOrdenes } from './produccion/ordenes.rutas.js';
import { rutasEdr } from './edr/edr.rutas.js';
import { registrarAuth } from '../auth/plugin.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;
let idEmpresa: number;

const PASSWORD = 'Control.2026!';

/** Forma (parcial) de una orden tal como sale por el API. */
interface OrdenHttp {
  id: number;
  folio: number;
  observaciones: string | null;
  lineas: { idColor: number }[];
}

/** Forma (parcial) del resumen de precios tal como sale por el API. */
interface PreciosHttp {
  idOrden: number;
  maquilaReal: number | null;
}

/** Forma (parcial) del EDR calculado tal como sale por el API. */
interface EdrHttp {
  encabezado: { id: number; anio: number; mes: number };
  gastos: number;
}

/** El escenario: una orden ya hecha, con el color y la talla que necesita su matriz. */
interface Escenario {
  idOrden: number;
  idColor: number;
  idTalla: number;
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

async function crearEscenario(): Promise<Escenario> {
  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Cliente 0.198' } });
  const modelo = await cliente.modelo.create({
    data: { codigo: `M198-${String(Date.now())}`, descripcion: 'Modelo 0.198', llevaArte: false },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(996_101),
      idEmpresa,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
    },
  });
  // La matriz color × talla (D4) no la siembra el seed.
  const color = await cliente.color.create({
    data: { nombre: `Negro 0.198 ${String(Date.now())}` },
  });
  const talla = await cliente.talla.create({ data: { etiqueta: `M198-${String(Date.now())}` } });
  return { idOrden: orden.id, idColor: color.id, idTalla: talla.id };
}

beforeAll(async () => {
  cliente = clientePruebas();
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasOrdenes, { prefix: '/api' });
  await instancia.register(rutasEdr, { prefix: '/api' });
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
  const empresa = await cliente.empresa.findFirstOrThrow({ select: { id: true } });
  idEmpresa = empresa.id;
});

/** Las llaves de ESCRIBIR de esta fila, SIN ninguna de VER: ése es el punto. */
const CLAVES_EDICION = ['ordenes.administrar', 'ordenes.precio-maquila', 'edr.capturar'];

describe('Editar sin poder consultar (fila 0.198)', () => {
  it('ENCABEZADO DE ORDEN: quien edita SIN `ordenes.ver` recibe 200 con su orden, no un 403 de adentro', async () => {
    await crearUsuarioCon('editor', CLAVES_EDICION);
    const e = await crearEscenario();
    const cookie = await cookieDe('editor');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/ordenes/${String(e.idOrden)}`,
      headers: { cookie },
      payload: { observaciones: 'entra por la puerta 3' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<OrdenHttp>().observaciones).toBe('entra por la puerta 3');
  });

  it('ENCABEZADO DE ORDEN: lo contestado dice LO MISMO que lo guardado', async () => {
    await crearUsuarioCon('editor', CLAVES_EDICION);
    const e = await crearEscenario();
    const cookie = await cookieDe('editor');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/ordenes/${String(e.idOrden)}`,
      headers: { cookie },
      payload: { observaciones: 'entra por la puerta 3' },
    });

    const fila = await cliente.orden.findUniqueOrThrow({ where: { id: e.idOrden } });
    expect(fila.observaciones).toBe(res.json<OrdenHttp>().observaciones);
  });

  it('MATRIZ: quien guarda la matriz SIN `ordenes.ver` recibe 200 con su orden y su renglón', async () => {
    await crearUsuarioCon('editor', CLAVES_EDICION);
    const e = await crearEscenario();
    const cookie = await cookieDe('editor');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/ordenes/${String(e.idOrden)}/matriz`,
      headers: { cookie },
      payload: { lineas: [{ idColor: e.idColor, tallas: [{ idTalla: e.idTalla, cantidad: 30 }] }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<OrdenHttp>().lineas).toHaveLength(1);
  });

  it('PRECIOS: las dos llaves son DISTINTAS, y quien captura el precio sin `ordenes.ver` recibe su resumen', async () => {
    await crearUsuarioCon('editor', CLAVES_EDICION);
    const e = await crearEscenario();
    const cookie = await cookieDe('editor');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/ordenes/${String(e.idOrden)}/precios`,
      headers: { cookie },
      payload: { campo: 'maquila', precio: 12.5 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<PreciosHttp>().maquilaReal).toBe(12.5);
  });

  it('EDR: quien genera el mes SIN `edr.ver` recibe 200 con el EDR calculado (proyectora NUEVA)', async () => {
    await crearUsuarioCon('editor', CLAVES_EDICION);
    const cookie = await cookieDe('editor');

    const res = await app.inject({
      method: 'POST',
      url: '/api/edr/generar',
      headers: { cookie },
      payload: { anio: 2026, mes: 6 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<EdrHttp>().encabezado.mes).toBe(6);
  });

  it('EDR: quien captura el encabezado SIN `edr.ver` recibe 200 con sus gastos', async () => {
    await crearUsuarioCon('editor', CLAVES_EDICION);
    const cookie = await cookieDe('editor');
    const generado = await app.inject({
      method: 'POST',
      url: '/api/edr/generar',
      headers: { cookie },
      payload: { anio: 2026, mes: 6 },
    });
    const idEdr = generado.json<EdrHttp>().encabezado.id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/edr/${String(idEdr)}`,
      headers: { cookie },
      payload: { gastos: 1500 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<EdrHttp>().gastos).toBe(1500);
  });

  it('la consulta suelta SIGUE cerrada: el mismo editor recibe 403 en el detalle de la orden', async () => {
    await crearUsuarioCon('editor', CLAVES_EDICION);
    const e = await crearEscenario();
    const cookie = await cookieDe('editor');

    const res = await app.inject({
      method: 'GET',
      url: `/api/ordenes/${String(e.idOrden)}`,
      headers: { cookie },
    });

    // ⚠️ Esto lo niega el `preHandler`, no el dominio: mide que `ordenes.ver` no quedó decorativo
    // como PUERTA. La reja de dominio la mide `dominio/eco-idempotente-sin-ver.int.test.ts`.
    expect(res.statusCode).toBe(403);
  });

  it('la consulta suelta SIGUE cerrada: el mismo editor recibe 403 en el resumen de precios', async () => {
    await crearUsuarioCon('editor', CLAVES_EDICION);
    const e = await crearEscenario();
    const cookie = await cookieDe('editor');

    const res = await app.inject({
      method: 'GET',
      url: `/api/ordenes/${String(e.idOrden)}/precios`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(403);
  });

  it('la consulta suelta SIGUE cerrada: el mismo editor recibe 403 en el detalle del EDR', async () => {
    await crearUsuarioCon('editor', CLAVES_EDICION);
    const cookie = await cookieDe('editor');
    const generado = await app.inject({
      method: 'POST',
      url: '/api/edr/generar',
      headers: { cookie },
      payload: { anio: 2026, mes: 6 },
    });
    const idEdr = generado.json<EdrHttp>().encabezado.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/edr/${String(idEdr)}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(403);
  });

  it('el MIRÓN (sólo `ordenes.ver`) recibe 403 en el PATCH y NO escribe nada', async () => {
    await crearUsuarioCon('miron', ['ordenes.ver']);
    const e = await crearEscenario();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/ordenes/${String(e.idOrden)}`,
      headers: { cookie: await cookieDe('miron') },
      payload: { observaciones: 'no debería guardarse' },
    });

    expect(res.statusCode).toBe(403);
    const fila = await cliente.orden.findUniqueOrThrow({ where: { id: e.idOrden } });
    expect(fila.observaciones).toBeNull();
  });
});
