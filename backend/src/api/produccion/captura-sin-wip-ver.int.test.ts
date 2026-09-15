/**
 * ⭐ Pruebas de integración de la REJA de la CAPTURA DE PLANTA (fila 0.196).
 *
 * Lo que aquí se mide es UNA frase: **lo que el sistema le contesta a quien captura dice lo mismo
 * que lo que quedó escrito** — en los OCHO sitios de producción que escribían y luego negaban
 * (corte, envío, empaque y cancelación de etapa en `dominio/produccion/etapas.ts`; recibo y su
 * cancelación en `recibos.ts`; entrega a cliente y su cancelación en `entregas-cliente.ts`). Hasta
 * esta fila los ocho abrían con SU permiso (`produccion.corte`/`.envio`/`.empaque`/`.recibo`/
 * `.entrega`/`.cancelar`), escribían —transacción cerrada, folio A3 estampado, evento de outbox
 * puesto— y DESPUÉS proyectaban la respuesta con `obtenerEtapa`/`obtenerRecibo`/`obtenerEntrega`,
 * que exigen `produccion.wip-ver` ⇒ quien llevara la llave de capturar pero no la de consultar
 * recibía un **403 con la captura ya guardada**. Leía «no tienes permiso», concluía que no se
 * guardó y volvía a capturar: doble etapa, doble folio, doble evento — y en el recibo y la entrega,
 * el inventario movido DOS veces.
 *
 * Es la hermana de `api/ruta-critica/captura-sin-ver.int.test.ts` (fila 0.195), con la misma forma.
 * Se levanta una app Fastify con SÓLO estas rutas montadas bajo `/api`, contra el Postgres efímero,
 * con la autenticación REAL (better-auth) y el seed real. Las aserciones entran SIEMPRE por la ruta
 * (con su `preHandler` de permisos puesto): una guarda probada como función suelta no está probada.
 *
 * 🔑 **CÓMO DISTINGUE QUIÉN NEGÓ** (la trampa de esta familia: una prueba que entra sólo por el
 * `preHandler` no mide el dominio):
 *  - el usuario `capturista` NO lleva `produccion.wip-ver`, así que un 201 con la etapa proyectada
 *    sólo puede salir del DOMINIO en verde: el `preHandler` sólo mira el permiso de captura, y la
 *    proyección la hace el dominio. Si el dominio negara, el cuerpo sería 403 y no una etapa;
 *  - el mismo usuario recibe **403 en el `GET .../etapas`**, que es el `preHandler` de consulta: así
 *    se ve que `produccion.wip-ver` NO se volvió decorativo. ⚠️ Esa aserción mide LA PUERTA, no el
 *    dominio (quitarle el `verificarPermiso` a `obtenerEtapa` NO la pone roja, porque el
 *    `preHandler` niega antes); la mitad de dominio la sostienen las pruebas de
 *    `dominio/produccion/{etapas,recibos,entregas-cliente}.int.test.ts`, que sí caen;
 *  - el usuario `miron` (sólo `produccion.wip-ver`) recibe **403 en el POST** por el `preHandler`, y
 *    se comprueba que **no escribió nada** (la negativa de la puerta nunca toca la base).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from '../errores.js';
import { rutasEtapasProduccion } from './etapas.rutas.js';
import { rutasRecibosProduccion } from './recibos.rutas.js';
import { rutasEntregasCliente } from './entregas-cliente.rutas.js';
import { registrarAuth } from '../../auth/plugin.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrar } from '../../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;
let idEmpresa: number;

const PASSWORD = 'Control.2026!';

/** Forma (parcial) de una etapa tal como sale por el API. */
interface EtapaHttp {
  id: number;
  folio: number;
  tipo: string;
  totalPiezas: number;
  precioPactado: number | null;
  cancelado: boolean;
}

/** Forma (parcial) de un recibo tal como sale por el API. */
interface ReciboHttp {
  id: number;
  folio: number;
  totalPiezas: number;
  idMovimientoEntrada: number | null;
  cancelado: boolean;
}

/** Forma (parcial) de una entrega tal como sale por el API. */
interface EntregaHttp {
  id: number;
  folio: number;
  totalPiezas: number;
  cancelado: boolean;
}

/** El escenario de una orden lista para capturar planta. */
interface Escenario {
  idOrden: number;
  idColor: number;
  idTalla: number;
  idCortador: number;
  idMaquilero: number;
  idEmpacador: number;
  idTipoProceso: number;
  idAlmacen: number;
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

/** Un proveedor con el rol pedido (los `RolProveedor` los siembra el seed). */
async function proveedorConRol(nombre: string, codigoRol: string): Promise<number> {
  const rol = await cliente.rolProveedor.findUniqueOrThrow({ where: { codigo: codigoRol } });
  const prov = await cliente.proveedor.create({
    data: { nombre, roles: { create: { idRolProveedor: rol.id } } },
  });
  return prov.id;
}

/** Orden con matriz Rojo/CH = 30 piezas, más los terceros, el proceso y el almacén de PT. */
async function crearEscenario(): Promise<Escenario> {
  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Cliente planta' } });
  const modelo = await cliente.modelo.create({
    data: { codigo: `MP-${String(Date.now())}`, descripcion: 'Modelo de planta' },
  });
  const color = await cliente.color.create({ data: { nombre: 'Rojo planta' } });
  const talla = await cliente.talla.create({ data: { etiqueta: 'CH-p', orden: 1 } });
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(996_001),
      idEmpresa,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      lineas: {
        create: [{ idColor: color.id, tallas: { create: [{ idTalla: talla.id, cantidad: 30 }] } }],
      },
    },
  });
  const proceso = await cliente.tipoProceso.findFirstOrThrow({ where: { codigo: 'costura' } });
  const almacen = await cliente.almacen.findFirstOrThrow({ where: { tipo: 'PT' } });
  return {
    idOrden: orden.id,
    idColor: color.id,
    idTalla: talla.id,
    idCortador: await proveedorConRol('Corte planta', 'corte'),
    idMaquilero: await proveedorConRol('Costura planta', 'maquila-costura'),
    idEmpacador: await proveedorConRol('Empaque planta', 'empaque'),
    idTipoProceso: proceso.id,
    idAlmacen: almacen.id,
  };
}

/** Matriz de una celda (color×talla) con la cantidad dada. */
const matriz = (e: Escenario, cantidad: number) => [
  { idColor: e.idColor, tallas: [{ idTalla: e.idTalla, cantidad }] },
];

beforeAll(async () => {
  cliente = clientePruebas();
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasEtapasProduccion, { prefix: '/api' });
  await instancia.register(rutasRecibosProduccion, { prefix: '/api' });
  await instancia.register(rutasEntregasCliente, { prefix: '/api' });
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

/** Las seis claves de captura de planta, SIN `produccion.wip-ver`: ése es el punto de la fila. */
const CLAVES_CAPTURA = [
  'produccion.corte',
  'produccion.envio',
  'produccion.empaque',
  'produccion.recibo',
  'produccion.entrega',
  'produccion.cancelar',
];

describe('Capturar planta sin poder consultar el WIP (fila 0.196)', () => {
  it('CORTE: quien corta SIN `produccion.wip-ver` recibe 201 con su corte, no un 403 de adentro', async () => {
    await crearUsuarioCon('capturista', CLAVES_CAPTURA);
    const e = await crearEscenario();
    const cookie = await cookieDe('capturista');

    const res = await app.inject({
      method: 'POST',
      url: '/api/produccion/cortes',
      headers: { cookie },
      payload: {
        idOrden: e.idOrden,
        idCortador: e.idCortador,
        fecha: '2026-06-18',
        precioPactado: 3.75,
        lineas: matriz(e, 10),
      },
    });

    expect(res.statusCode).toBe(201);
    const corte = res.json<EtapaHttp>();
    expect(corte.tipo).toBe('corte');
    expect(corte.totalPiezas).toBe(10);
    // Quien tecleó el precio lo recibe de vuelta (el eco conserva `ocultarPrecio: false`).
    expect(corte.precioPactado).toBe(3.75);

    // La otra mitad de la invariante: lo contestado dice LO MISMO que lo escrito.
    const fila = await cliente.etapaMovimiento.findUniqueOrThrow({
      where: { id: corte.id },
      include: { detalles: true },
    });
    expect(Number(fila.folio)).toBe(corte.folio);
    expect(fila.detalles.reduce((s, d) => s + d.cantidad, 0)).toBe(corte.totalPiezas);
  });

  it('la consulta suelta SIGUE cerrada: el mismo capturista recibe 403 en el historial de etapas', async () => {
    await crearUsuarioCon('capturista', CLAVES_CAPTURA);
    const e = await crearEscenario();
    const cookie = await cookieDe('capturista');

    const res = await app.inject({
      method: 'GET',
      url: `/api/produccion/ordenes/${String(e.idOrden)}/etapas`,
      headers: { cookie },
    });

    // ⚠️ Esto lo niega el `preHandler`, no el dominio: mide que `produccion.wip-ver` no quedó
    // decorativo como PUERTA. La reja de dominio de `obtenerEtapa` la miden las pruebas de dominio.
    expect(res.statusCode).toBe(403);
  });

  it('ENVÍO, EMPAQUE, RECIBO y ENTREGA: el ciclo entero se captura sin `produccion.wip-ver`', async () => {
    await crearUsuarioCon('capturista', CLAVES_CAPTURA);
    const e = await crearEscenario();
    const cookie = await cookieDe('capturista');

    const corte = await app.inject({
      method: 'POST',
      url: '/api/produccion/cortes',
      headers: { cookie },
      payload: {
        idOrden: e.idOrden,
        idCortador: e.idCortador,
        fecha: '2026-06-18',
        lineas: matriz(e, 20),
      },
    });
    expect(corte.statusCode).toBe(201);

    const envio = await app.inject({
      method: 'POST',
      url: '/api/produccion/envios',
      headers: { cookie },
      payload: {
        idOrden: e.idOrden,
        idTipoProceso: e.idTipoProceso,
        idMaquilero: e.idMaquilero,
        fecha: '2026-06-19',
        precioPactado: 8,
        lineas: matriz(e, 20),
      },
    });
    expect(envio.statusCode).toBe(201);
    expect(envio.json<EtapaHttp>().precioPactado).toBe(8);

    const empaque = await app.inject({
      method: 'POST',
      url: '/api/produccion/empaques',
      headers: { cookie },
      payload: {
        idOrden: e.idOrden,
        idEmpacador: e.idEmpacador,
        fecha: '2026-06-22',
        lineas: matriz(e, 12),
      },
    });
    expect(empaque.statusCode).toBe(201);
    expect(empaque.json<EtapaHttp>().tipo).toBe('empaque');

    const recibo = await app.inject({
      method: 'POST',
      url: '/api/produccion/recibos',
      headers: { cookie },
      payload: {
        idOrden: e.idOrden,
        idTipoProceso: e.idTipoProceso,
        idMaquilero: e.idMaquilero,
        fecha: '2026-06-20',
        precioPactado: 8,
        idAlmacenPrimeras: e.idAlmacen,
        lineas: matriz(e, 20),
      },
    });
    expect(recibo.statusCode).toBe(201);
    const cuerpoRecibo = recibo.json<ReciboHttp>();
    expect(cuerpoRecibo.totalPiezas).toBe(20);
    // El recibo de costura metió la mercancía a PT: el eco lo dice, y la base también.
    expect(cuerpoRecibo.idMovimientoEntrada).not.toBeNull();

    const entrega = await app.inject({
      method: 'POST',
      url: '/api/produccion/entregas-cliente',
      headers: { cookie },
      payload: {
        idOrden: e.idOrden,
        idAlmacen: e.idAlmacen,
        fecha: '2026-06-21',
        lineas: matriz(e, 15),
      },
    });
    expect(entrega.statusCode).toBe(201);
    const cuerpoEntrega = entrega.json<EntregaHttp>();
    expect(cuerpoEntrega.totalPiezas).toBe(15);

    // Lo contestado dice lo mismo que lo escrito, y NADA se escribió dos veces: el 403 de antes
    // empujaba a recapturar, y ahí nacían el doble corte, el doble recibo y la doble salida de PT.
    const etapas = await cliente.etapaMovimiento.findMany({
      where: { idOrden: e.idOrden },
      select: { id: true, tipo: true },
    });
    expect(etapas).toHaveLength(5);
    expect(new Set(etapas.map((x) => x.tipo)).size).toBe(5);
  });

  it('CANCELAR: quien cancela SIN `produccion.wip-ver` recibe la etapa, el recibo y la entrega cancelados', async () => {
    await crearUsuarioCon('capturista', CLAVES_CAPTURA);
    const e = await crearEscenario();
    const cookie = await cookieDe('capturista');

    const post = async (url: string, payload: Record<string, unknown>) => {
      const res = await app.inject({ method: 'POST', url, headers: { cookie }, payload });
      expect(res.statusCode).toBe(201);
      return res.json<{ id: number }>().id;
    };
    const idCorte = await post('/api/produccion/cortes', {
      idOrden: e.idOrden,
      idCortador: e.idCortador,
      fecha: '2026-06-18',
      lineas: matriz(e, 20),
    });
    await post('/api/produccion/envios', {
      idOrden: e.idOrden,
      idTipoProceso: e.idTipoProceso,
      idMaquilero: e.idMaquilero,
      fecha: '2026-06-19',
      lineas: matriz(e, 20),
    });
    const idRecibo = await post('/api/produccion/recibos', {
      idOrden: e.idOrden,
      idTipoProceso: e.idTipoProceso,
      idMaquilero: e.idMaquilero,
      fecha: '2026-06-20',
      idAlmacenPrimeras: e.idAlmacen,
      lineas: matriz(e, 20),
    });
    const idEntrega = await post('/api/produccion/entregas-cliente', {
      idOrden: e.idOrden,
      idAlmacen: e.idAlmacen,
      fecha: '2026-06-21',
      lineas: matriz(e, 15),
    });

    // La entrega se cancela primero (devuelve el género), luego el recibo, luego el corte: es el
    // orden real de un desenredo, y de paso comprueba los inversos auditados (D3).
    const cancelarEntrega = await app.inject({
      method: 'POST',
      url: `/api/produccion/entregas-cliente/${String(idEntrega)}/cancelar`,
      headers: { cookie },
      payload: { motivo: 'el cliente no la recibió' },
    });
    expect(cancelarEntrega.statusCode).toBe(200);
    expect(cancelarEntrega.json<EntregaHttp>().cancelado).toBe(true);

    const cancelarRecibo = await app.inject({
      method: 'POST',
      url: `/api/produccion/recibos/${String(idRecibo)}/cancelar`,
      headers: { cookie },
      payload: { motivo: 'llegó incompleto' },
    });
    expect(cancelarRecibo.statusCode).toBe(200);
    expect(cancelarRecibo.json<ReciboHttp>().cancelado).toBe(true);

    // El corte tiene un envío VIVO: no se puede cancelar hasta cancelar el envío. Se comprueba de
    // paso que la regla del dominio sigue mandando (y que este 409 NO es un 403 disfrazado).
    const conEnvioVivo = await app.inject({
      method: 'POST',
      url: `/api/produccion/cortes/${String(idCorte)}/cancelar`,
      headers: { cookie },
      payload: { motivo: 'se cortó de más' },
    });
    expect(conEnvioVivo.statusCode).toBe(409);

    // Y lo escrito coincide: las dos cancelaciones quedaron selladas en la base.
    const canceladas = await cliente.etapaMovimiento.count({
      where: { idOrden: e.idOrden, canceladoEn: { not: null } },
    });
    expect(canceladas).toBe(2);
  });

  it('el MIRÓN (sólo `produccion.wip-ver`) recibe 403 en el POST y NO escribe nada', async () => {
    await crearUsuarioCon('miron', ['produccion.wip-ver']);
    const e = await crearEscenario();

    const res = await app.inject({
      method: 'POST',
      url: '/api/produccion/cortes',
      headers: { cookie: await cookieDe('miron') },
      payload: {
        idOrden: e.idOrden,
        idCortador: e.idCortador,
        fecha: '2026-06-18',
        lineas: matriz(e, 10),
      },
    });

    expect(res.statusCode).toBe(403);
    expect(await cliente.etapaMovimiento.count({ where: { idOrden: e.idOrden } })).toBe(0);
  });
});
