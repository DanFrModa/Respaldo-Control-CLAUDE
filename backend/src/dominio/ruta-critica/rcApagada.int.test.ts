/**
 * Tests de INTEGRACIÓN del INTERRUPTOR de la Ruta Crítica (V1-E3t,
 * `DECISIONES.md §Post-F9.36 punto 1`) contra el Postgres efímero.
 *
 * Prueban la conducta de HOY —la RC apagada— con el interruptor DE VERDAD (sin sustituirlo por
 * nada). Su gemelo `rcAutomatica.int.test.ts` prueba el motor como si estuviera encendida.
 *
 * Cubre las dos mitades de "apagar bien":
 *  • la ORDEN NUEVA NACE SIN RUTA aunque el catálogo esté completo (nada de ~26 procesos por orden
 *    que nadie va a capturar), y queda bitácora de por qué;
 *  • el CONSUMIDOR DE LA COLA SIGUE DRENANDO: `manejarEventoAutoAvance` procesa `orden-creada` sin
 *    lanzar, así que pg-boss marca el trabajo completo y ni el outbox ni `pgboss.job` se acumulan.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  crearTipoArtePrueba,
  limpiarBaseDatos,
} from '../../pruebas/contexto.js';
import { manejarEventoAutoAvance, type MensajeEventoDominio } from './autoAvance.js';
import { procesarOrdenCreada } from './rcAutomatica.js';

let cliente: PrismaClient;
let idEmpresa: number;
let idModelo: number;
let idClienteNegocio: number;
let idColor: number;
let idTalla: number;

const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await crearTipoArtePrueba(cliente);
  const empresa = await crearEmpresaPrueba(cliente);
  idEmpresa = empresa.id;
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  idClienteNegocio = clienteNegocio.id;
  const modelo = await cliente.modelo.create({ data: { codigo: 'A-100' } });
  idModelo = modelo.id;
  const color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  idColor = color.id;
  const talla = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  idTalla = talla.id;
  await cliente.factorCantidad.createMany({ data: [{ deCant: 1, aCant: 5000, factor: 1.0 }] });
});

/**
 * Siembra el catálogo RC COMPLETO. Es el detalle que da valor a estas pruebas: con esto puesto, la
 * única razón posible para que la orden nazca sin ruta es el interruptor.
 */
async function sembrarCatalogoRc(): Promise<void> {
  const familia = await cliente.familiaArticulo.create({ data: { nombre: 'Playeras' } });
  const articulo = await cliente.articuloRC.create({
    data: { nombre: 'SENCILLO 1/6', idFamiliaArticulo: familia.id },
  });
  const a = await cliente.procesoDef.create({
    data: { codigo: 'rev', nombre: 'Revisión', tipoDuracion: 'fija' },
  });
  const b = await cliente.procesoDef.create({
    data: { codigo: 'fin', nombre: 'Final', tipoDuracion: 'fija', ultimoProceso: true },
  });
  const plantilla = await cliente.plantillaRuta.create({
    data: { nombre: 'Ruta estándar', idArticuloRC: articulo.id },
  });
  const ra = await cliente.plantillaRutaProceso.create({
    data: { idPlantillaRuta: plantilla.id, idProcesoDef: a.id, tiempoEstandar: 2, orden: 0 },
  });
  const rb = await cliente.plantillaRutaProceso.create({
    data: { idPlantillaRuta: plantilla.id, idProcesoDef: b.id, tiempoEstandar: 3, orden: 1 },
  });
  await cliente.plantillaRutaDep.create({
    data: { idPlantillaRutaProceso: rb.id, idAntecesor: ra.id },
  });
  await cliente.duracionPorTipoTela.create({
    data: { nombre: 'Programar Tela Basica', dias: 30, factorTela: 1.0 },
  });
  await cliente.duracionPorAplicacion.create({
    data: { nombre: 'Sin Aplicación', clave: 'A0', dias: 0 },
  });
}

async function crearOrdenPrueba(): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
      idEmpresa,
      idModelo,
      idCliente: idClienteNegocio,
      estado: 'completa',
      fechaEntrega: new Date('2026-09-01T00:00:00.000Z'),
      lineas: { create: [{ idColor, tallas: { create: [{ idTalla, cantidad: 100 }] } }] },
    },
  });
  return orden.id;
}

describe('RC apagada (V1-E3t) — la generación automática NO corre', () => {
  it('con el catálogo RC COMPLETO, la orden nueva nace SIN ruta y queda bitácora del porqué', async () => {
    await sembrarCatalogoRc();
    const idOrden = await crearOrdenPrueba();

    await procesarOrdenCreada({ idEmpresa, idOrden }, bd());

    // 1) NADA de ruta: ni la bandera, ni los procesos, ni las fechas de programación.
    const orden = await cliente.orden.findUniqueOrThrow({
      where: { id: idOrden },
      select: { rcActiva: true, fechaEntregaRC: true, idArticuloRcProg: true },
    });
    expect(orden.rcActiva).toBeNull();
    expect(orden.fechaEntregaRC).toBeNull();
    expect(orden.idArticuloRcProg).toBeNull();
    expect(await cliente.rutaOrden.count({ where: { idOrden } })).toBe(0);

    // 2) Bitácora que lo explica (no se apaga en silencio): el motivo NOMBRA la decisión.
    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Orden', idEntidad: String(idOrden) },
    });
    expect(bitacora.datos).toMatchObject({ operacion: 'rc-automatica-omitida' });
    expect(JSON.stringify(bitacora.datos)).toContain('apagada');
  });

  it('el consumidor de la cola DRENA el evento: no lanza, así pg-boss lo marca completo', async () => {
    // Si el manejador propagara, pg-boss reintentaría para siempre y `pgboss.job` crecería sin
    // drenar nunca — el modo de fallo que esta etapa vino a evitar al NO apagar el consumidor.
    await sembrarCatalogoRc();
    const idOrden = await crearOrdenPrueba();
    const espia = vi.fn();
    const mensaje: MensajeEventoDominio = {
      id: 777,
      tipo: 'orden-creada',
      version: 1,
      idEmpresa,
      payload: { idEmpresa, idOrden },
    };

    await expect(manejarEventoAutoAvance(mensaje, espia, bd())).resolves.toBeUndefined();

    expect(espia).not.toHaveBeenCalled();
    const orden = await cliente.orden.findUniqueOrThrow({
      where: { id: idOrden },
      select: { rcActiva: true },
    });
    expect(orden.rcActiva).toBeNull();
  });

  it('una ruta YA generada NO se toca (D3: apagar no es borrar)', async () => {
    // Simula una orden histórica con su ruta viva: el interruptor no debe rozarla.
    await sembrarCatalogoRc();
    const idOrden = await crearOrdenPrueba();
    const proceso = await cliente.procesoDef.findFirstOrThrow({ where: { codigo: 'rev' } });
    await cliente.orden.update({
      where: { id: idOrden },
      data: { rcActiva: true, fechaProgramada: new Date() },
    });
    await cliente.rutaOrden.create({
      data: {
        idOrden,
        idProcesoDef: proceso.id,
        secuencia: 0,
        duracionDias: 2,
        fechaPlaneadaVigente: new Date('2026-08-20T00:00:00.000Z'),
      },
    });

    await procesarOrdenCreada({ idEmpresa, idOrden }, bd());

    const orden = await cliente.orden.findUniqueOrThrow({
      where: { id: idOrden },
      select: { rcActiva: true },
    });
    expect(orden.rcActiva).toBe(true);
    expect(await cliente.rutaOrden.count({ where: { idOrden } })).toBe(1);
  });
});
