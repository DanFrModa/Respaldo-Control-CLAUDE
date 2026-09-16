/**
 * ⭐ Pruebas de integración de la REJA de las escrituras que dejan RASTRO NUEVO (fila 0.197).
 *
 * Lo que aquí se mide es UNA frase: **lo que el sistema le contesta a quien escribe dice lo mismo
 * que lo que quedó escrito** — por la RUTA, con su `preHandler` de permisos puesto. Hasta esta fila
 * los veintiún sitios de la 0.197 abrían con SU permiso de escritura, escribían —transacción
 * cerrada, folio A3 estampado, evento de outbox publicado— y DESPUÉS proyectaban la respuesta con
 * un `obtener*` que exige OTRA llave ⇒ quien llevara la de escribir y no la de consultar recibía un
 * **403 con el documento ya guardado**. Leía «no tienes permiso», concluía que no se guardó y
 * volvía a capturar: segundo folio quemado, segundo documento, segundo evento.
 *
 * Es la hermana de `api/ruta-critica/captura-sin-ver.int.test.ts` (fila 0.195) y de
 * `api/produccion/captura-sin-wip-ver.int.test.ts` (fila 0.196), con la misma forma. Se levanta una
 * app Fastify con SÓLO estas rutas montadas bajo `/api`, contra el Postgres efímero, con la
 * autenticación REAL (better-auth) y el seed real.
 *
 * 🔑 **CÓMO DISTINGUE QUIÉN NEGÓ** (la trampa de esta familia: una prueba que entra sólo por el
 * `preHandler` no mide el dominio):
 *  - el usuario `capturista` NO lleva `ordenes.ver`, así que un 201 con la orden proyectada sólo
 *    puede salir del DOMINIO en verde: el `preHandler` sólo mira `ordenes.administrar`, y la
 *    proyección la hace el dominio. Si el dominio negara, el cuerpo sería 403 y no una orden;
 *  - el mismo usuario recibe **403 en el `GET /api/ordenes/:id`**, que es el `preHandler` de
 *    consulta: así se ve que `ordenes.ver` NO se volvió decorativo. ⚠️ Esa aserción mide LA PUERTA,
 *    no el dominio (quitarle el `verificarPermiso` a `obtenerOrden` NO la pone roja, porque el
 *    `preHandler` niega antes); la mitad de dominio —la reja de los nueve `obtener*` y el A9 de las
 *    nueve proyectoras— la sostiene `dominio/eco-sin-ver.int.test.ts`, que sí cae;
 *  - el usuario `miron` (sólo `ordenes.ver`) recibe **403 en el POST** por el `preHandler`, y se
 *    comprueba que **no escribió nada** (la negativa de la puerta nunca toca la base).
 *
 * Aquí entran TRES de los veintiún sitios, elegidos porque son las tres FORMAS del defecto: un alta
 * con folio de secuencia atómica (`POST /api/ordenes`), una cancelación con efecto de negocio
 * (`POST /api/ordenes/:id/cancelar`) y el caso de las DOS LLAVES DE MÓDULOS DISTINTOS
 * (`POST /api/esma/ordenes/:id/pagada`, que escribe con `esma.modificar` y proyectaba con
 * `esma.ver-pagos`). Los dieciocho restantes se miden por dominio en el archivo hermano: montar
 * nueve plugins de rutas aquí no mediría nada que estos tres no midan ya.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from './errores.js';
import { rutasOrdenes } from './produccion/ordenes.rutas.js';
import { rutasCuentaEsMa } from './esma/cuenta.rutas.js';
import { rutasConceptosPago } from './pagos/conceptos-pago.rutas.js';
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
  estado: string;
  comentarios: { comentario: string }[];
}

/** Forma (parcial) del estatus "pagada" tal como sale por el API. */
interface PagadaHttp {
  idOrden: number;
  pagada: boolean;
  pagadaForzada: boolean | null;
}

/** Forma (parcial) de un concepto de pago tal como sale por el API. */
interface ConceptoHttp {
  id: number;
  nombre: string;
}

/** El escenario: un renglón de pedido del que puede nacer una orden, y una orden ya hecha. */
interface Escenario {
  idPedidoLinea: number;
  idOrden: number;
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
  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Cliente 0.197' } });
  const modelo = await cliente.modelo.create({
    data: { codigo: `M197-${String(Date.now())}`, descripcion: 'Modelo 0.197', llevaArte: false },
  });
  const pedido = await cliente.pedido.create({
    data: { folio: BigInt(995_001), idEmpresa, idCliente: clienteNeg.id },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 100, precio: 50 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(995_101),
      idEmpresa,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
    },
  });
  return { idPedidoLinea: linea.id, idOrden: orden.id };
}

beforeAll(async () => {
  cliente = clientePruebas();
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasOrdenes, { prefix: '/api' });
  await instancia.register(rutasCuentaEsMa, { prefix: '/api' });
  await instancia.register(rutasConceptosPago, { prefix: '/api' });
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
const CLAVES_ESCRITURA = [
  'ordenes.administrar',
  'ordenes.cancelar',
  'esma.modificar',
  'conceptos-pago.administrar',
];

describe('Escribir sin poder consultar (fila 0.197)', () => {
  it('ALTA DE ORDEN: quien captura SIN `ordenes.ver` recibe 201 con su orden, no un 403 de adentro', async () => {
    await crearUsuarioCon('capturista', CLAVES_ESCRITURA);
    const e = await crearEscenario();
    const cookie = await cookieDe('capturista');

    const res = await app.inject({
      method: 'POST',
      url: '/api/ordenes',
      headers: { cookie },
      payload: { idPedidoLinea: e.idPedidoLinea },
    });

    expect(res.statusCode).toBe(201);
    const orden = res.json<OrdenHttp>();
    // La otra mitad de la invariante: lo contestado dice LO MISMO que lo escrito (y el folio de la
    // secuencia atómica es irrepetible: el 403 de antes empujaba a recapturar y quemar otro).
    const fila = await cliente.orden.findUniqueOrThrow({ where: { id: orden.id } });
    expect(Number(fila.folio)).toBe(orden.folio);
  });

  it('la consulta suelta SIGUE cerrada: el mismo capturista recibe 403 en el detalle de la orden', async () => {
    await crearUsuarioCon('capturista', CLAVES_ESCRITURA);
    const e = await crearEscenario();
    const cookie = await cookieDe('capturista');

    const res = await app.inject({
      method: 'GET',
      url: `/api/ordenes/${String(e.idOrden)}`,
      headers: { cookie },
    });

    // ⚠️ Esto lo niega el `preHandler`, no el dominio: mide que `ordenes.ver` no quedó decorativo
    // como PUERTA. La reja de dominio de `obtenerOrden` la mide `dominio/eco-sin-ver.int.test.ts`.
    expect(res.statusCode).toBe(403);
  });

  it('CANCELAR ORDEN: quien cancela SIN `ordenes.ver` recibe 200 con la orden cancelada', async () => {
    await crearUsuarioCon('capturista', CLAVES_ESCRITURA);
    const e = await crearEscenario();
    const cookie = await cookieDe('capturista');

    const res = await app.inject({
      method: 'POST',
      url: `/api/ordenes/${String(e.idOrden)}/cancelar`,
      headers: { cookie },
      payload: { motivo: 'el cliente bajó el pedido' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<OrdenHttp>().estado).toBe('cancelada');
  });

  it('COMENTARIO: quien comenta SIN `ordenes.ver` recibe la orden con su comentario', async () => {
    await crearUsuarioCon('capturista', CLAVES_ESCRITURA);
    const e = await crearEscenario();
    const cookie = await cookieDe('capturista');

    const res = await app.inject({
      method: 'POST',
      url: `/api/ordenes/${String(e.idOrden)}/comentarios`,
      headers: { cookie },
      payload: { comentario: 'falta la tela del forro' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json<OrdenHttp>().comentarios).toHaveLength(1);
  });

  it('PAGADA: las dos llaves son de MÓDULOS distintos, y quien modifica EsMa sin ver sus pagos recibe su override', async () => {
    await crearUsuarioCon('capturista', CLAVES_ESCRITURA);
    const e = await crearEscenario();
    const cookie = await cookieDe('capturista');

    const res = await app.inject({
      method: 'POST',
      url: `/api/esma/ordenes/${String(e.idOrden)}/pagada`,
      headers: { cookie },
      payload: { pagadaForzada: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<PagadaHttp>().pagada).toBe(true);
  });

  it('CONCEPTO DE PAGO: quien lo da de alta SIN `conceptos-pago.ver` recibe 201 con su concepto', async () => {
    await crearUsuarioCon('capturista', CLAVES_ESCRITURA);
    const cookie = await cookieDe('capturista');

    const res = await app.inject({
      method: 'POST',
      url: '/api/conceptos-pago',
      headers: { cookie },
      payload: { nombre: 'Luz', rubro: 'servicios' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json<ConceptoHttp>().nombre).toBe('Luz');
  });

  it('el MIRÓN (sólo `ordenes.ver`) recibe 403 en el POST y NO escribe nada', async () => {
    await crearUsuarioCon('miron', ['ordenes.ver']);
    const e = await crearEscenario();
    const antes = await cliente.orden.count({ where: { idEmpresa } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/ordenes',
      headers: { cookie: await cookieDe('miron') },
      payload: { idPedidoLinea: e.idPedidoLinea },
    });

    expect(res.statusCode).toBe(403);
    expect(await cliente.orden.count({ where: { idEmpresa } })).toBe(antes);
  });
});
