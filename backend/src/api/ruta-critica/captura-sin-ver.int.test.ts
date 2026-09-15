/**
 * ⭐ Pruebas de integración de la REJA de la CAPTURA de la Ruta Crítica (fila 0.195).
 *
 * Lo que aquí se mide es UNA frase: **lo que el sistema le contesta a quien captura dice lo mismo
 * que lo que quedó escrito**. Hasta esta fila los dos `PUT` de captura abrían con `rc.capturar`,
 * escribían (transacción cerrada, bitácora puesta) y DESPUÉS proyectaban la respuesta con
 * `obtenerRutaOrden`, que exige `rc.ruta-ver` ⇒ quien llevara la llave de capturar pero no la de
 * consultar recibía un **403 con la captura ya guardada**. El usuario leía «no tienes permiso»,
 * concluía que no se guardó y volvía a capturar: el sistema informando mal sobre su propio estado.
 * Es la tercera de la familia 0.190/0.193, y la peor, porque el dato ya cambió.
 *
 * Se levanta una app Fastify con SÓLO estas rutas montadas bajo `/api`, contra el Postgres efímero,
 * con la autenticación REAL (better-auth) y el seed real. Las aserciones entran SIEMPRE por la ruta
 * (con su `preHandler` de permisos puesto): una guarda probada como función suelta no está probada.
 *
 * 🔑 **CÓMO DISTINGUE QUIÉN NEGÓ** (la trampa que el reviewer cazó dos veces en esta familia: una
 * prueba que entra sólo por el `preHandler` no mide el dominio):
 *  - el usuario `capturista` NO lleva `rc.ruta-ver`, así que un 200 con la ruta proyectada sólo
 *    puede salir del DOMINIO en verde: el `preHandler` sólo mira `rc.capturar`, y la proyección la
 *    hace el dominio. Si el dominio negara, el cuerpo sería 403 y no una ruta;
 *  - el mismo usuario recibe **403 en el `GET .../ruta`**, que es el `preHandler` de consulta: así
 *    se ve que `rc.ruta-ver` NO se volvió decorativo — la consulta suelta sigue cerrada. ⚠️ Esa
 *    aserción mide LA PUERTA, no el dominio (medido con mutación: quitarle el `verificarPermiso` a
 *    `obtenerRutaOrden` NO la pone roja, porque el `preHandler` niega antes); la mitad de dominio
 *    la sostienen las dos pruebas de `dominio/ruta-critica/rutaOrden.int.test.ts`, que sí caen;
 *  - el usuario `mirón` (sólo `rc.ruta-ver`) recibe **403 en el PUT** por el `preHandler`, y se
 *    comprueba que **no escribió nada** (la negativa de la puerta nunca toca la base);
 *  - la negativa del DOMINIO por su cuenta (rol no responsable) se mide sin ruta de por medio en
 *    `dominio/ruta-critica/cumplimiento.int.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from '../errores.js';
import { rutasProgramacionRc } from './programacion.rutas.js';
import { registrarAuth } from '../../auth/plugin.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrar } from '../../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;
let idEmpresa: number;

const PASSWORD = 'Control.2026!';

/** Forma (parcial) de la ruta tal como sale por el API. */
interface RutaSalida {
  idOrden: number;
  procesos: { id: number; fechaReal: string | null; estado: string }[];
}

/**
 * Crea un usuario con un rol NUEVO que tiene EXACTAMENTE las claves pedidas (ninguna más), y su
 * credencial. Devuelve el id del ROL, para poder hacerlo responsable de un proceso.
 */
async function crearUsuarioCon(username: string, claves: string[]): Promise<number> {
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
  return rol.id;
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

/** Orden con RC viva + UN proceso de ruta (activo, con un ítem de checklist). */
async function crearOrdenConProceso(
  idRolResponsable: number,
): Promise<{ idOrden: number; idRuta: number; idItem: number }> {
  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Cliente RC' } });
  const modelo = await cliente.modelo.create({
    data: { codigo: `M-${String(Date.now())}`, descripcion: 'Modelo RC' },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(987_001),
      idEmpresa,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      rcActiva: true,
      fechaEntregaRC: new Date('2026-12-01T00:00:00Z'),
    },
  });
  const proceso = await cliente.procesoDef.create({
    data: { codigo: `p-${String(Date.now())}`, nombre: 'Proceso de prueba' },
  });
  // El rol del capturista es responsable del proceso: así el filtro N:M del DOMINIO pasa sin
  // necesidad de `rc.capturar-cualquiera` (se mide la reja real, no el atajo).
  await cliente.procesoDefRol.create({
    data: { idProcesoDef: proceso.id, idRol: idRolResponsable },
  });
  const renglon = await cliente.rutaOrden.create({
    data: {
      idOrden: orden.id,
      idProcesoDef: proceso.id,
      secuencia: 1,
      duracionDias: 3,
      ultimoProceso: false,
      estado: 'activo',
    },
  });
  const item = await cliente.rutaOrdenChecklist.create({
    data: { idRutaOrden: renglon.id, orden: 1, descripcion: 'Revisar molde' },
  });
  return { idOrden: orden.id, idRuta: renglon.id, idItem: item.id };
}

/** Orden de modelo FLEXIBLE con los dos procesos que el estampado reprograma (R4, B10). */
async function crearOrdenFlexibleConEstampado(): Promise<{ idOrden: number }> {
  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Cliente flexible' } });
  const modelo = await cliente.modelo.create({
    data: {
      codigo: `MF-${String(Date.now())}`,
      descripcion: 'Modelo flexible',
      secuenciaEstampado: 'flexible',
    },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(987_002),
      idEmpresa,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      rcActiva: true,
      fechaEntregaRC: new Date('2026-12-01T00:00:00Z'),
    },
  });
  const recibo = await cliente.procesoDef.create({
    data: {
      codigo: `re-${String(Date.now())}`,
      nombre: 'Recibo de estampado',
      tipoEvento: 'reciboEstampado',
    },
  });
  const envio = await cliente.procesoDef.create({
    data: {
      codigo: `ec-${String(Date.now())}`,
      nombre: 'Envío a costura',
      tipoEvento: 'envioCostura',
    },
  });
  await cliente.rutaOrden.create({
    data: {
      idOrden: orden.id,
      idProcesoDef: recibo.id,
      secuencia: 1,
      duracionDias: 2,
      estado: 'activo',
    },
  });
  await cliente.rutaOrden.create({
    data: {
      idOrden: orden.id,
      idProcesoDef: envio.id,
      secuencia: 2,
      duracionDias: 2,
      estado: 'pendiente',
    },
  });
  return { idOrden: orden.id };
}

/** Lo que de verdad quedó escrito del renglón de ruta (la otra mitad de la invariante). */
async function loEscrito(idRuta: number): Promise<{ estado: string; fechaReal: Date | null }> {
  const fila = await cliente.rutaOrden.findUniqueOrThrow({
    where: { id: idRuta },
    select: { estado: true, fechaReal: true },
  });
  return fila;
}

beforeAll(async () => {
  cliente = clientePruebas();
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasProgramacionRc, { prefix: '/api' });
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

describe('PUT /api/ruta-critica/procesos/:idRuta/cumplimiento — capturar sin poder ver (fila 0.195)', () => {
  it('quien captura SIN `rc.ruta-ver` recibe 200 con la ruta, no un 403 de adentro', async () => {
    const idRol = await crearUsuarioCon('capturista', ['rc.capturar']);
    const { idRuta } = await crearOrdenConProceso(idRol);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/ruta-critica/procesos/${String(idRuta)}/cumplimiento`,
      headers: { cookie: await cookieDe('capturista') },
      payload: { cumplido: true },
    });

    expect(res.statusCode).toBe(200);
    // Con renglones: un 200 vacío podría salir de cualquier capa; uno con la ruta proyectada sólo
    // sale del dominio, que es a quien esta fila le arregla el eco.
    expect(res.json<RutaSalida>().procesos.length).toBeGreaterThan(0);
  });

  it('lo que se le contesta dice LO MISMO que lo que quedó escrito (la invariante de la fila)', async () => {
    const idRol = await crearUsuarioCon('capturista', ['rc.capturar']);
    const { idRuta } = await crearOrdenConProceso(idRol);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/ruta-critica/procesos/${String(idRuta)}/cumplimiento`,
      headers: { cookie: await cookieDe('capturista') },
      // Sin `fechaReal`: el default es HOY del negocio. Fijar una fecha literal la ataría a la
      // VENTANA de captura (`rc.fecha-libre-cumplimiento`), que es otra reja y otra fila.
      payload: { cumplido: true },
    });
    expect(res.statusCode).toBe(200);

    const contestado = res.json<RutaSalida>().procesos.find((p) => p.id === idRuta);
    const escrito = await loEscrito(idRuta);
    expect(contestado?.estado).toBe('completado');
    expect(escrito.estado).toBe('completado');
    // La fecha que se le contestó es EXACTAMENTE la que quedó en la base (y no es nula).
    expect(escrito.fechaReal).not.toBeNull();
    expect(contestado?.fechaReal).toBe(escrito.fechaReal?.toISOString());
  });

  it('`rc.ruta-ver` NO quedó decorativo: el mismo capturista sigue sin poder CONSULTAR la ruta', async () => {
    const idRol = await crearUsuarioCon('capturista', ['rc.capturar']);
    const { idOrden } = await crearOrdenConProceso(idRol);

    const res = await app.inject({
      method: 'GET',
      url: `/api/ruta-critica/ordenes/${String(idOrden)}/ruta`,
      headers: { cookie: await cookieDe('capturista') },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ codigo: string }>().codigo).toBe('PERMISO');
  });

  it('quien sólo mira (`rc.ruta-ver`) recibe 403 de la PUERTA y no escribe nada', async () => {
    const idRolCap = await crearUsuarioCon('capturista', ['rc.capturar']);
    await crearUsuarioCon('miron', ['rc.ruta-ver']);
    const { idRuta } = await crearOrdenConProceso(idRolCap);

    const antes = await loEscrito(idRuta);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/ruta-critica/procesos/${String(idRuta)}/cumplimiento`,
      headers: { cookie: await cookieDe('miron') },
      payload: { cumplido: true },
    });

    expect(res.statusCode).toBe(403);
    expect(await loEscrito(idRuta)).toEqual(antes);
  });
});

describe('PUT /api/ruta-critica/checklist/:idItem — el mismo eco (fila 0.195)', () => {
  it('quien marca un ítem SIN `rc.ruta-ver` recibe 200 con la ruta y el ítem queda marcado', async () => {
    const idRol = await crearUsuarioCon('capturista', ['rc.capturar']);
    const { idRuta, idItem } = await crearOrdenConProceso(idRol);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/ruta-critica/checklist/${String(idItem)}`,
      headers: { cookie: await cookieDe('capturista') },
      payload: { hecho: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<RutaSalida>().procesos.length).toBeGreaterThan(0);
    const item = await cliente.rutaOrdenChecklist.findUniqueOrThrow({
      where: { id: idItem },
      select: { hecho: true },
    });
    expect(item.hecho).toBe(true);
    // Único ítem hecho ⇒ el proceso padre se auto-completa; la respuesta lo dice igual que la base.
    expect(res.json<RutaSalida>().procesos.find((p) => p.id === idRuta)?.estado).toBe('completado');
    expect((await loEscrito(idRuta)).estado).toBe('completado');
  });
});

describe('POST /api/ruta-critica/ordenes/:id/secuencia-estampado — el tercer sitio (fila 0.195)', () => {
  it('quien reprograma con `rc.programar` y sin `rc.ruta-ver` recibe 200, y la elección queda guardada', async () => {
    await crearUsuarioCon('programador', ['rc.programar']);
    const { idOrden } = await crearOrdenFlexibleConEstampado();

    const res = await app.inject({
      method: 'POST',
      url: `/api/ruta-critica/ordenes/${String(idOrden)}/secuencia-estampado`,
      headers: { cookie: await cookieDe('programador') },
      payload: { secuencia: 'despues' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<RutaSalida>().procesos.length).toBeGreaterThan(0);
    const orden = await cliente.orden.findUniqueOrThrow({
      where: { id: idOrden },
      select: { secEstampadoElegido: true },
    });
    expect(orden.secEstampadoElegido).toBe('despues');
  });
});
