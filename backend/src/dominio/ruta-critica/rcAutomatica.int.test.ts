/**
 * Tests de INTEGRACIÓN de la RC AUTOMÁTICA (rediseño R3, B5) contra el Postgres efímero. El
 * consumidor se invoca DIRECTO (`procesarOrdenCreada`, sin pg-boss — patrón F5-E6). Cubre:
 *  • genera la ruta con los DEFAULTS del catálogo (plantilla activa → artículo; tela default;
 *    aplicación según el BOM del modelo),
 *  • REUSA los parámetros de la última orden programada del MISMO modelo,
 *  • idempotencia: rcActiva → no-op (no pisa la ruta existente),
 *  • omisiones auditadas (sin fecha de entrega / sin plantillas): bitácora, sin lanzar,
 *  • una orden cancelada no se programa.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { manejarEventoAutoAvance, type MensajeEventoDominio } from './autoAvance.js';
import { procesarOrdenCreada } from './rcAutomatica.js';

let cliente: PrismaClient;
let idEmpresa: number;
let idClienteNegocio: number;
let idModelo: number;
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
  await cliente.factorCantidad.createMany({
    data: [{ deCant: 1, aCant: 5000, factor: 1.0 }],
  });
});

/** Siembra el catálogo RC mínimo: artículo + plantilla activa (2 procesos) + tela + aplicaciones. */
async function sembrarCatalogoRc(): Promise<{ idArticulo: number }> {
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
  await cliente.duracionPorAplicacion.create({
    data: { nombre: 'Estampado Sencillo', clave: 'A1', dias: 3 },
  });
  return { idArticulo: articulo.id };
}

/** Crea una orden completa (matriz Rojo/CH) con fecha de entrega opcional. */
async function crearOrdenPrueba(
  opciones: { fechaEntrega?: string; estado?: 'completa' | 'cancelada'; idModelo?: number } = {},
): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
      idEmpresa,
      idModelo: opciones.idModelo ?? idModelo,
      idCliente: idClienteNegocio,
      estado: opciones.estado ?? 'completa',
      fechaEntrega:
        opciones.fechaEntrega === undefined
          ? null
          : new Date(`${opciones.fechaEntrega}T00:00:00.000Z`),
      lineas: {
        create: [{ idColor, tallas: { create: [{ idTalla, cantidad: 100 }] } }],
      },
    },
  });
  return orden.id;
}

describe('procesarOrdenCreada (R3, B5)', () => {
  it('genera la ruta con los defaults del catálogo y marca la orden como programada', async () => {
    await sembrarCatalogoRc();
    const idOrden = await crearOrdenPrueba({ fechaEntrega: '2026-09-01' });

    await procesarOrdenCreada({ idEmpresa, idOrden }, bd());

    const orden = await cliente.orden.findUnique({
      where: { id: idOrden },
      select: { rcActiva: true, fechaEntregaRC: true, idArticuloRcProg: true },
    });
    expect(orden?.rcActiva).toBe(true);
    expect(orden?.fechaEntregaRC?.toISOString().slice(0, 10)).toBe('2026-09-01');
    const renglones = await cliente.rutaOrden.count({ where: { idOrden } });
    expect(renglones).toBe(2);
  });

  it('⭐ V1-E3d: la APLICACIÓN la decide la receta de LA ORDEN, no el arte del MODELO', async () => {
    // El sexto consumidor que cazó el reviewer: `tieneAplicacion` le preguntaba al `modeloArte`, así
    // que dos órdenes hermanas —una con el arte excluido de SU receta— recibían la misma plantilla y
    // los mismos procesos condicionales de estampado. Ahora cada orden responde por lo suyo.
    await sembrarCatalogoRc();
    const conAplicacion = await cliente.duracionPorAplicacion.findFirstOrThrow({
      where: { clave: 'A1' },
    });
    const sinAplicacion = await cliente.duracionPorAplicacion.findFirstOrThrow({
      where: { clave: 'A0' },
    });
    // Los dos MODELOS llevan arte: la diferencia va a estar SOLO en la receta de cada orden. Se
    // usan modelos distintos a propósito, porque `resolverParametros` reusa los parámetros de la
    // última orden programada del MISMO modelo (F5, "los resurtidos repiten parámetros") y eso
    // taparía lo que aquí se quiere medir.
    await cliente.modeloArte.create({ data: { idModelo, nombre: 'Logo pecho', precio: 10 } });
    const modeloB = await cliente.modelo.create({ data: { codigo: 'RC-B', llevaArte: true } });
    await cliente.modeloArte.create({
      data: { idModelo: modeloB.id, nombre: 'Logo pecho', precio: 10 },
    });

    // Orden A: su receta SÍ trae el arte. Orden B: se lo excluyeron (el caso de la jareta).
    const idA = await crearOrdenPrueba({ fechaEntrega: '2026-09-01' });
    const idB = await crearOrdenPrueba({ fechaEntrega: '2026-09-01', idModelo: modeloB.id });
    await cliente.ordenArte.create({ data: { idOrden: idA, nombre: 'Logo pecho', precio: 10 } });
    await cliente.ordenArte.create({
      data: { idOrden: idB, nombre: 'Logo pecho', precio: 10, excluido: true, estado: 'ajustado' },
    });

    await procesarOrdenCreada({ idEmpresa, idOrden: idA }, bd());
    await procesarOrdenCreada({ idEmpresa, idOrden: idB }, bd());

    const a = await cliente.orden.findUnique({
      where: { id: idA },
      select: { idDuracionAplicacion: true },
    });
    const b = await cliente.orden.findUnique({
      where: { id: idB },
      select: { idDuracionAplicacion: true },
    });
    expect(a?.idDuracionAplicacion).toBe(conAplicacion.id);
    expect(b?.idDuracionAplicacion).toBe(sinAplicacion.id);
  });

  it('REUSA los parámetros de la última orden programada del mismo modelo', async () => {
    const { idArticulo } = await sembrarCatalogoRc();
    // Una tela/aplicación DISTINTAS del default, usadas por la orden previa del modelo.
    const telaEspecial = await cliente.duracionPorTipoTela.create({
      data: { nombre: 'Importación Oriente', dias: 40, factorTela: 2.3 },
    });
    const aplicacionEspecial = await cliente.duracionPorAplicacion.create({
      data: { nombre: '2 Bordados', clave: 'A5', dias: 6 },
    });
    const idPrevia = await crearOrdenPrueba({ fechaEntrega: '2026-08-01' });
    await cliente.orden.update({
      where: { id: idPrevia },
      data: {
        rcActiva: true,
        fechaProgramada: new Date(),
        idArticuloRcProg: idArticulo,
        idDuracionTela: telaEspecial.id,
        idDuracionAplicacion: aplicacionEspecial.id,
      },
    });

    const idNueva = await crearOrdenPrueba({ fechaEntrega: '2026-09-15' });
    await procesarOrdenCreada({ idEmpresa, idOrden: idNueva }, bd());

    const orden = await cliente.orden.findUnique({
      where: { id: idNueva },
      select: { rcActiva: true, idDuracionTela: true, idDuracionAplicacion: true },
    });
    expect(orden?.rcActiva).toBe(true);
    expect(orden?.idDuracionTela).toBe(telaEspecial.id);
    expect(orden?.idDuracionAplicacion).toBe(aplicacionEspecial.id);
  });

  it('idempotente: una orden con RC activa NO se re-programa (el evento duplicado es no-op)', async () => {
    await sembrarCatalogoRc();
    const idOrden = await crearOrdenPrueba({ fechaEntrega: '2026-09-01' });
    await procesarOrdenCreada({ idEmpresa, idOrden }, bd());
    const antes = await cliente.orden.findUnique({
      where: { id: idOrden },
      select: { fechaProgramada: true },
    });

    await procesarOrdenCreada({ idEmpresa, idOrden }, bd());

    const despues = await cliente.orden.findUnique({
      where: { id: idOrden },
      select: { fechaProgramada: true },
    });
    expect(despues?.fechaProgramada?.getTime()).toBe(antes?.fechaProgramada?.getTime());
  });

  it('sin fecha de entrega: OMITE con bitácora (no lanza, no programa)', async () => {
    await sembrarCatalogoRc();
    const idOrden = await crearOrdenPrueba();

    await procesarOrdenCreada({ idEmpresa, idOrden }, bd());

    const orden = await cliente.orden.findUnique({
      where: { id: idOrden },
      select: { rcActiva: true },
    });
    expect(orden?.rcActiva).toBeNull();
    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Orden', idEntidad: String(idOrden) },
    });
    expect(bitacora?.datos).toMatchObject({ operacion: 'rc-automatica-omitida' });
  });

  it('sin plantillas activas: OMITE con bitácora (no lanza)', async () => {
    const idOrden = await crearOrdenPrueba({ fechaEntrega: '2026-09-01' });

    await procesarOrdenCreada({ idEmpresa, idOrden }, bd());

    const orden = await cliente.orden.findUnique({
      where: { id: idOrden },
      select: { rcActiva: true },
    });
    expect(orden?.rcActiva).toBeNull();
    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Orden', idEntidad: String(idOrden) },
    });
    expect(bitacora?.datos).toMatchObject({ operacion: 'rc-automatica-omitida' });
  });

  it('una orden CANCELADA no se programa (no-op silencioso)', async () => {
    await sembrarCatalogoRc();
    const idOrden = await crearOrdenPrueba({ fechaEntrega: '2026-09-01', estado: 'cancelada' });

    await procesarOrdenCreada({ idEmpresa, idOrden }, bd());

    const orden = await cliente.orden.findUnique({
      where: { id: idOrden },
      select: { rcActiva: true },
    });
    expect(orden?.rcActiva).toBeNull();
  });
});

describe('manejarEventoAutoAvance — politica de errores por tipo (H2 del reviewer)', () => {
  /** Arma un mensaje de la cola como lo entrega el relay (ADR-0011). */
  function mensaje(tipo: string, payload: unknown): MensajeEventoDominio {
    return { id: 777, tipo, version: 1, idEmpresa, payload };
  }

  it('orden-creada: un error INESPERADO deja bitacora rc-automatica-fallida y PROPAGA (pg-boss reintenta)', async () => {
    await sembrarCatalogoRc();
    // Sabotaje por la via del REUSO: la orden PREVIA del modelo quedo programada con un articulo
    // ACTIVO pero SIN plantilla (ni por familia) -> el consumidor reusa esos parametros y
    // `generarRutaOrden` LANZA al no resolver plantilla (error inesperado, no omision controlada).
    const familiaRota = await cliente.familiaArticulo.create({ data: { nombre: 'Sin plantilla' } });
    const articuloRoto = await cliente.articuloRC.create({
      data: { nombre: 'Articulo sin plantilla', idFamiliaArticulo: familiaRota.id },
    });
    const tela = await cliente.duracionPorTipoTela.findFirstOrThrow({ select: { id: true } });
    const aplicacion = await cliente.duracionPorAplicacion.findFirstOrThrow({
      select: { id: true },
    });
    const idPrevia = await crearOrdenPrueba({ fechaEntrega: '2026-08-01' });
    await cliente.orden.update({
      where: { id: idPrevia },
      data: {
        rcActiva: true,
        fechaProgramada: new Date(),
        idArticuloRcProg: articuloRoto.id,
        idDuracionTela: tela.id,
        idDuracionAplicacion: aplicacion.id,
      },
    });
    const idOrden = await crearOrdenPrueba({ fechaEntrega: '2026-09-01' });
    const espia = vi.fn();

    await expect(
      manejarEventoAutoAvance(mensaje('orden-creada', { idEmpresa, idOrden }), espia, bd()),
    ).rejects.toThrow();

    // Bitacora AUDITABLE del fallo (con el error y la fila outbox de origen) y orden SIN RC
    // (rcActiva intacta: el reintento re-procesa completo).
    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Orden', idEntidad: String(idOrden) },
    });
    expect(bitacora?.datos).toMatchObject({ operacion: 'rc-automatica-fallida', filaOutbox: 777 });
    expect(espia).toHaveBeenCalledTimes(1);
    const orden = await cliente.orden.findUnique({
      where: { id: idOrden },
      select: { rcActiva: true },
    });
    expect(orden?.rcActiva).toBeNull();
  });

  it('orden-creada: plantilla activa con articulo directo DESACTIVADO = omision controlada (no reintenta)', async () => {
    // Mala configuracion de catalogo (nota del reviewer): la plantilla activa apunta a un
    // articulo desactivado -> reintentar no lo arregla; se OMITE con bitacora auditada.
    await sembrarCatalogoRc();
    await cliente.articuloRC.updateMany({ data: { activo: false } });
    const idOrden = await crearOrdenPrueba({ fechaEntrega: '2026-09-01' });
    const espia = vi.fn();

    await manejarEventoAutoAvance(mensaje('orden-creada', { idEmpresa, idOrden }), espia, bd());

    expect(espia).not.toHaveBeenCalled();
    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Orden', idEntidad: String(idOrden) },
    });
    expect(bitacora?.datos).toMatchObject({ operacion: 'rc-automatica-omitida' });
    const orden = await cliente.orden.findUnique({
      where: { id: idOrden },
      select: { rcActiva: true },
    });
    expect(orden?.rcActiva).toBeNull();
  });

  it('orden-creada: una omision CONTROLADA (sin fecha de entrega) NO propaga', async () => {
    await sembrarCatalogoRc();
    const idOrden = await crearOrdenPrueba(); // sin fecha de entrega
    const espia = vi.fn();

    await manejarEventoAutoAvance(mensaje('orden-creada', { idEmpresa, idOrden }), espia, bd());

    expect(espia).not.toHaveBeenCalled();
    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Orden', idEntidad: String(idOrden) },
    });
    expect(bitacora?.datos).toMatchObject({ operacion: 'rc-automatica-omitida' });
  });

  it('los eventos del auto-avance F3->F5 CONSERVAN el tragado de errores (no propagan)', async () => {
    const espia = vi.fn();
    // Payload roto a proposito: el procesado lanza, pero el manejador lo atrapa y loguea
    // (comportamiento preexistente de F5-E6 que NO debe cambiar).
    await manejarEventoAutoAvance(mensaje('corte-registrado', null), espia, bd());
    expect(espia).toHaveBeenCalledTimes(1);
  });
});
