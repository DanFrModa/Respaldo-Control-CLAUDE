/**
 * Tests de INTEGRACIÓN de la SECUENCIA DE ESTAMPADO por orden (R4, B10) — Postgres efímero.
 * Cubre la reprogramación EN VIVO de las órdenes FLEXIBLES:
 *  • elegir DESPUÉS quita la arista "recibo estampado → envío costura" y ACTIVA lo que quedó listo,
 *  • elegir ANTES la agrega y regresa el envío 'activo' → 'pendiente' (sin revivir completados),
 *  • 409 si el modelo NO es flexible, si la orden no tiene ruta/estampado, o si el estampado
 *    ya está completado; elegir ANTES con el envío ya completado también es 409,
 *  • permisos (A4) y bitácora (A7).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorConflicto, ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { elegirSecuenciaEstampado } from './estampado.js';
import { generarRutaOrden } from './rutaOrden.js';

let cliente: PrismaClient;
let idEmpresa: number;
let idModelo: number;
let idClienteNegocio: number;
let idColor: number;
let idTalla: number;

const sesionProg = () => sesionDePrueba({ permisos: ['rc.programar', 'rc.ruta-ver'] });
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
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  idClienteNegocio = clienteNegocio.id;
  // Modelo FLEXIBLE por default en estos tests (los casos "forzados" lo cambian).
  const modelo = await cliente.modelo.create({
    data: { codigo: 'A-100', descripcion: 'Playera', secuenciaEstampado: 'flexible' },
  });
  idModelo = modelo.id;
  const color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  idColor = color.id;
  const talla = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  idTalla = talla.id;
});

/** Catálogo mínimo con estampado: corte → envío-est → recibo-est; corte → envío-costura. */
async function armarCatalogo(): Promise<{
  idArticulo: number;
  idTela: number;
  idConAplic: number;
  procs: { corte: number; envioEst: number; recibo: number; envioCostura: number };
}> {
  const familia = await cliente.familiaArticulo.create({ data: { nombre: 'Fam' } });
  const articulo = await cliente.articuloRC.create({
    data: { nombre: 'SENCILLO', idFamiliaArticulo: familia.id },
  });
  const tela = await cliente.duracionPorTipoTela.create({
    data: { nombre: 'Basica', dias: 5, factorTela: 1 },
  });
  const conAplic = await cliente.duracionPorAplicacion.create({
    data: { nombre: '2 Bordados', clave: 'A5', dias: 6 },
  });
  const crear = async (codigo: string, tipoEvento: string, condicional = false) => {
    const p = await cliente.procesoDef.create({
      data: {
        codigo,
        nombre: codigo.toUpperCase(),
        tipoEvento: tipoEvento as never,
        condicionAplicabilidad: condicional ? 'soloSiLlevaAplicacion' : 'ninguna',
      },
    });
    return p.id;
  };
  const corte = await crear('corte', 'corte');
  const envioEst = await crear('envio-est', 'envioEstampado', true);
  const recibo = await crear('recibo-est', 'reciboEstampado', true);
  const envioCostura = await crear('envio-costura', 'envioCostura');

  const plantilla = await cliente.plantillaRuta.create({
    data: { nombre: 'Base', idArticuloRC: articulo.id },
  });
  const renglones: Record<number, number> = {};
  for (const [i, idProc] of [corte, envioEst, recibo, envioCostura].entries()) {
    const r = await cliente.plantillaRutaProceso.create({
      data: { idPlantillaRuta: plantilla.id, idProcesoDef: idProc, tiempoEstandar: 2, orden: i },
    });
    renglones[idProc] = r.id;
  }
  await cliente.plantillaRutaDep.createMany({
    data: [
      { idPlantillaRutaProceso: renglones[envioEst]!, idAntecesor: renglones[corte]! },
      { idPlantillaRutaProceso: renglones[recibo]!, idAntecesor: renglones[envioEst]! },
      { idPlantillaRutaProceso: renglones[envioCostura]!, idAntecesor: renglones[corte]! },
    ],
  });
  return {
    idArticulo: articulo.id,
    idTela: tela.id,
    idConAplic: conAplic.id,
    procs: { corte, envioEst, recibo, envioCostura },
  };
}

/** Orden de 100 pzas + su RC generada (modelo flexible → efectiva 'antes' por default). */
async function ordenProgramada(ctx: Awaited<ReturnType<typeof armarCatalogo>>): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000)),
      idEmpresa,
      idModelo,
      idCliente: idClienteNegocio,
      estado: 'completa',
      lineas: { create: [{ idColor, tallas: { create: [{ idTalla, cantidad: 100 }] } }] },
    },
  });
  await generarRutaOrden(
    sesionProg(),
    {
      idOrden: orden.id,
      idArticuloRC: ctx.idArticulo,
      fechaEntregaRC: new Date('2026-08-01T00:00:00Z'),
      idTipoTela: ctx.idTela,
      idAplicacion: ctx.idConAplic,
    },
    bd(),
  );
  return orden.id;
}

/** Ids (RutaOrden) del envío a costura y del recibo de estampado de la ruta viva. */
async function renglonesRuta(idOrden: number): Promise<{ envio: number; recibo: number }> {
  const filas = await cliente.rutaOrden.findMany({
    where: { idOrden },
    select: { id: true, procesoDef: { select: { tipoEvento: true } } },
  });
  const envio = filas.find((f) => f.procesoDef.tipoEvento === 'envioCostura')!.id;
  const recibo = filas.find((f) => f.procesoDef.tipoEvento === 'reciboEstampado')!.id;
  return { envio, recibo };
}

describe('elegirSecuenciaEstampado (R4, B10)', () => {
  it('exige rc.programar', async () => {
    const ctx = await armarCatalogo();
    const idOrden = await ordenProgramada(ctx);
    await expect(
      elegirSecuenciaEstampado(sesionDePrueba(), { idOrden, secuencia: 'despues' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('flexible: elegir DESPUÉS quita la espera y elegir ANTES la regresa (en vivo)', async () => {
    const ctx = await armarCatalogo();
    const idOrden = await ordenProgramada(ctx);
    const { envio, recibo } = await renglonesRuta(idOrden);

    // La generación (flexible sin elección = antes) dejó la arista recibo→envío.
    expect(
      await cliente.rutaOrdenDep.count({ where: { idRutaOrden: envio, idAntecesor: recibo } }),
    ).toBe(1);

    // DESPUÉS: quita la arista, guarda la elección y refleja la secuencia efectiva.
    const rutaDespues = await elegirSecuenciaEstampado(
      sesionProg(),
      { idOrden, secuencia: 'despues' },
      bd(),
    );
    expect(rutaDespues.secEstampadoElegido).toBe('despues');
    expect(rutaDespues.secuenciaEstampadoEfectiva).toBe('despues');
    expect(
      await cliente.rutaOrdenDep.count({ where: { idRutaOrden: envio, idAntecesor: recibo } }),
    ).toBe(0);

    // ANTES: la regresa y el envío (que aún no se completa) vuelve a esperar.
    const rutaAntes = await elegirSecuenciaEstampado(
      sesionProg(),
      { idOrden, secuencia: 'antes' },
      bd(),
    );
    expect(rutaAntes.secEstampadoElegido).toBe('antes');
    expect(
      await cliente.rutaOrdenDep.count({ where: { idRutaOrden: envio, idAntecesor: recibo } }),
    ).toBe(1);

    // Bitácora de la operación (A7).
    const bit = await cliente.bitacora.findMany({
      where: { entidad: 'Orden', idEntidad: String(idOrden) },
    });
    expect(
      bit.some(
        (b) => (b.datos as { operacion?: string }).operacion === 'elegir-secuencia-estampado',
      ),
    ).toBe(true);
  });

  it('elegir DESPUÉS activa el envío cuando sus demás antecesores ya estaban completados', async () => {
    const ctx = await armarCatalogo();
    const idOrden = await ordenProgramada(ctx);
    const { envio } = await renglonesRuta(idOrden);
    // Completa el CORTE a mano (es el otro antecesor del envío a costura).
    const corteRuta = await cliente.rutaOrden.findFirst({
      where: { idOrden, procesoDef: { tipoEvento: 'corte' } },
    });
    await cliente.rutaOrden.update({
      where: { id: corteRuta!.id },
      data: { estado: 'completado', fechaReal: new Date(), origenCaptura: 'manual' },
    });
    // Con 'antes' vigente el envío sigue esperando el estampado; al elegir DESPUÉS queda listo.
    await elegirSecuenciaEstampado(sesionProg(), { idOrden, secuencia: 'despues' }, bd());
    const envioFila = await cliente.rutaOrden.findUnique({ where: { id: envio } });
    expect(envioFila!.estado).toBe('activo');
  });

  it('elegir ANTES regresa un envío ACTIVO a pendiente (el estampado no ha llegado)', async () => {
    const ctx = await armarCatalogo();
    const idOrden = await ordenProgramada(ctx);
    const { envio } = await renglonesRuta(idOrden);
    const corteRuta = await cliente.rutaOrden.findFirst({
      where: { idOrden, procesoDef: { tipoEvento: 'corte' } },
    });
    await cliente.rutaOrden.update({
      where: { id: corteRuta!.id },
      data: { estado: 'completado', fechaReal: new Date(), origenCaptura: 'manual' },
    });
    await elegirSecuenciaEstampado(sesionProg(), { idOrden, secuencia: 'despues' }, bd());
    expect((await cliente.rutaOrden.findUnique({ where: { id: envio } }))!.estado).toBe('activo');
    // Cambio de opinión: ANTES otra vez → el envío deja de estar listo.
    await elegirSecuenciaEstampado(sesionProg(), { idOrden, secuencia: 'antes' }, bd());
    expect((await cliente.rutaOrden.findUnique({ where: { id: envio } }))!.estado).toBe(
      'pendiente',
    );
  });

  it('409 si el modelo NO es flexible', async () => {
    await cliente.modelo.update({
      where: { id: idModelo },
      data: { secuenciaEstampado: 'antes' },
    });
    const ctx = await armarCatalogo();
    const idOrden = await ordenProgramada(ctx);
    await expect(
      elegirSecuenciaEstampado(sesionProg(), { idOrden, secuencia: 'despues' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('409 si el estampado ya está completado (la elección ya no cambia nada)', async () => {
    const ctx = await armarCatalogo();
    const idOrden = await ordenProgramada(ctx);
    const { recibo } = await renglonesRuta(idOrden);
    await cliente.rutaOrden.update({
      where: { id: recibo },
      data: { estado: 'completado', fechaReal: new Date(), origenCaptura: 'evento' },
    });
    await expect(
      elegirSecuenciaEstampado(sesionProg(), { idOrden, secuencia: 'despues' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('409 al elegir ANTES si el envío a costura ya se completó (ya se cosió sin esperar)', async () => {
    const ctx = await armarCatalogo();
    const idOrden = await ordenProgramada(ctx);
    await elegirSecuenciaEstampado(sesionProg(), { idOrden, secuencia: 'despues' }, bd());
    const { envio } = await renglonesRuta(idOrden);
    await cliente.rutaOrden.update({
      where: { id: envio },
      data: { estado: 'completado', fechaReal: new Date(), origenCaptura: 'evento' },
    });
    await expect(
      elegirSecuenciaEstampado(sesionProg(), { idOrden, secuencia: 'antes' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('409 si la orden no tiene ruta generada', async () => {
    await armarCatalogo();
    const orden = await cliente.orden.create({
      data: {
        folio: BigInt(1),
        idEmpresa,
        idModelo,
        idCliente: idClienteNegocio,
        estado: 'completa',
      },
    });
    await expect(
      elegirSecuenciaEstampado(sesionProg(), { idOrden: orden.id, secuencia: 'antes' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});
