/**
 * ⭐⭐ **fila 0.257 — LA PREVIA DE COMPRA SABE SI LA RECETA CAMBIÓ DESDE LA ÚLTIMA EXPLOSIÓN.**
 *
 * Integración contra Postgres (en CI con testcontainers). El escenario EXACTO del reviewer de la
 * 0.232: explotar con un avío de captura contradictoria (5,300 donde eran 600), corregirlo, marcar
 * revisado, re-liberarlo y pedir la previa SIN re-explotar ⇒ la OC salía por 5,300 sin aviso. Desde
 * esta fila la previa lo trae como BLOQUEO y la generación lo rechaza: 0 OC.
 *
 * Y las INVERSAS, que son la otra mitad (regla de la 0.155): lo que NO mueve la compra —precio,
 * notas, banderas de costo, complemento, re-firmar, abrir/cerrar, arte, lápidas, el proveedor que
 * asigna Compras— NO bloquea. Sin ellas, «subir siempre» pasaría todas las pruebas de arriba.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Avio,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Proveedor,
  Talla,
  Tela,
  TelaColor,
} from '../../datos/index.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { Tx } from '../../comun/transaccion.js';
import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  crearTipoArtePrueba,
  limpiarBaseDatos,
} from '../../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { fusionarColores } from '../catalogos/colores.js';
import { repuntarReferenciasDeColor } from '../catalogos/colores-fusion-referencias.js';
import { registrarCorte } from '../produccion/etapas.js';
import { guardarMatrizOrden } from '../produccion/ordenes.js';
import { recalcularEstadoOrdenesDeModelo } from '../produccion/requisitos-orden.js';
import {
  abrirReceta,
  agregarRenglonReceta,
  cerrarReceta,
  corregirCapturaAvio,
  editarRenglonReceta,
  liberarReceta,
  marcarRecetaRevisada,
  quitarRenglonReceta,
  restaurarRenglonReceta,
} from '../produccion/receta-orden.js';
import { asignarColorDeTela } from './color-de-la-tela.js';
import {
  explosionarOrden,
  explosionarOrdenes,
  generarOCDesdeExplosion,
  previoCompraDesdeExplosion,
} from './mrp.js';
import {
  asignarProveedorDeMaterial,
  asignarProveedorDeMaterialEnBloque,
} from './proveedor-de-orden.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let telaFelpa: Tela;
let avioBoton: Avio; // 6 pza/prenda, proveedor $2
let avioCierre: Avio; // 1 pza/prenda, proveedor $5 — el que se agrega/firma después
let proveedor: Proveedor;
let proveedorOtro: Proveedor;
let cortador: Proveedor;
let maquilero: Proveedor;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let tonoGrana: TelaColor;
let tonoMarino: TelaColor;
let idClienteNegocio: number;
let idOrden: number;

const PERM: ClavePermiso[] = [
  'compras.ver',
  'compras.administrar',
  'ordenes.ver',
  'ordenes.administrar',
  'desarrollo.ver',
  'desarrollo.administrar',
  'produccion.corte',
  'colores.administrar',
];

const sesion = (): SesionUsuario => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM });
const bd = () => ({ cliente });

/** La frase del bloqueo para UNA orden (la misma que la generación usa para rechazar). */
const bloqueoDe = (folio: number): string =>
  `La receta de la orden ${String(folio)} cambió desde la última explosión (se corrigió, se ` +
  'quitó o se firmó un material, o cambió lo pedido): lo que se iba a comprar ya no ' +
  'corresponde. Vuelve a explotar, o quítala de esta compra para generar la de las demás.';
const esBloqueoDeReceta = (b: string): boolean => b.includes('cambió desde la última explosión');

const explotar = (ids: number[] = [idOrden]) => explosionarOrdenes(sesion(), ids, bd());
const previa = (ids: number[] = [idOrden]) =>
  previoCompraDesdeExplosion(
    sesion(),
    { fechaEntrega: '2026-09-30', idsOrden: ids, idsRequerimiento: [] },
    bd(),
  );
const comprar = (ids: number[] = [idOrden]) =>
  generarOCDesdeExplosion(
    sesion(),
    { fechaEntrega: '2026-09-30', idsOrden: ids, idsRequerimiento: [] },
    bd(),
  );

type Plan = Awaited<ReturnType<typeof previa>>;
const lineaDe = (plan: Plan, idAvio: number) =>
  plan.proveedores.flatMap((p) => p.renglones).find((r) => r.idMaterial === idAvio);

async function renglonAvio(idAvio: number, orden = idOrden): Promise<number> {
  const r = await cliente.ordenAvio.findFirstOrThrow({
    where: { idOrden: orden, idAvio },
    select: { id: true },
  });
  return r.id;
}
async function renglonTela(orden = idOrden): Promise<number> {
  const r = await cliente.ordenTela.findFirstOrThrow({
    where: { idOrden: orden, idTela: telaFelpa.id },
    select: { id: true },
  });
  return r.id;
}

/** Revisa y re-firma los renglones nombrados (el camino del reviewer: revisado + liberar). */
async function reFirmar(
  renglones: { tipo: 'tela' | 'avio' | 'arte'; id: number }[],
  orden = idOrden,
) {
  await marcarRecetaRevisada(sesion(), orden, bd());
  await liberarReceta(sesion(), orden, { renglones }, bd());
}

/** El botón pasa a comprarse POR MEDIDA y la receta arrastra 53 por talla (§Post-F9.105). */
async function botonContradictorio(): Promise<number> {
  await cliente.avio.update({ where: { id: avioBoton.id }, data: { unidadMedida: 'cm' } });
  await cliente.avioMedida.create({
    data: { idAvio: avioBoton.id, medida: '53 cm', valor: 53, precio: 6 },
  });
  const id = await renglonAvio(avioBoton.id);
  await cliente.ordenAvio.update({ where: { id }, data: { consumoPorTalla: true } });
  await cliente.ordenAvioTalla.createMany({
    data: [
      { idOrdenAvio: id, idTalla: tallaCH.id, consumo: 53 },
      { idOrdenAvio: id, idTalla: tallaM.id, consumo: 53 },
    ],
  });
  return id;
}

/** Una OP más del mismo modelo (Rojo CH 10 + M 10), con su receta firmada. */
async function otraOrden(folio: bigint): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: idClienteNegocio,
      idMaquilero: maquilero.id,
      estado: 'completa',
      fechaCompletada: new Date(),
      lineas: {
        create: [
          {
            idColor: colorRojo.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 10 },
                { idTalla: tallaM.id, cantidad: 10 },
              ],
            },
          },
        ],
      },
    },
  });
  await sembrarRecetaDeOrden(cliente, orden.id, modelo.id);
  return orden.id;
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  idClienteNegocio = clienteNegocio.id;
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  await cliente.direccionEntrega.create({
    data: { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Avíos del Centro' } });
  proveedorOtro = await cliente.proveedor.create({ data: { nombre: 'Avíos del Norte' } });
  maquilero = await cliente.proveedor.create({ data: { nombre: 'Maquila del Sur' } });
  const rolCorte = await cliente.rolProveedor.upsert({
    where: { codigo: 'corte' },
    update: {},
    create: { codigo: 'corte', nombre: 'Corte' },
  });
  cortador = await cliente.proveedor.create({
    data: { nombre: 'Corte Express', roles: { create: { idRolProveedor: rolCorte.id } } },
  });

  telaFelpa = await cliente.tela.create({
    data: { nombre: 'Felpa', unidadMedida: 'M', nombreComplemento: 'Cardigan' },
  });
  tonoGrana = await cliente.telaColor.create({
    data: { idTela: telaFelpa.id, nombre: 'Grana 7700', precio: 80 },
  });
  tonoMarino = await cliente.telaColor.create({
    data: { idTela: telaFelpa.id, nombre: 'Marino 3040', precio: 95 },
  });
  avioBoton = await cliente.avio.create({
    data: { clave: 'BOT-01', descripcion: 'Botón', unidad: 'pza' },
  });
  avioCierre = await cliente.avio.create({
    data: { clave: 'CIE-01', descripcion: 'Cierre', unidad: 'pza' },
  });
  await cliente.avioProveedor.createMany({
    data: [
      { idAvio: avioBoton.id, idProveedor: proveedor.id, precio: 2 },
      { idAvio: avioCierre.id, idProveedor: proveedor.id, precio: 5 },
    ],
  });

  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  await cliente.modeloTela.create({
    data: { idModelo: modelo.id, idTela: telaFelpa.id, consumoPorPrenda: 1.5 },
  });
  await cliente.modeloAvio.create({
    data: { idModelo: modelo.id, idAvio: avioBoton.id, consumoPorPrenda: 6 },
  });

  // OP de 100 piezas: Rojo CH 40 + M 60.
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
      idMaquilero: maquilero.id,
      estado: 'completa',
      fechaCompletada: new Date(),
      lineas: {
        create: [
          {
            idColor: colorRojo.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 40 },
                { idTalla: tallaM.id, cantidad: 60 },
              ],
            },
          },
        ],
      },
    },
  });
  idOrden = orden.id;
  await sembrarRecetaDeOrden(cliente, idOrden, modelo.id);
});

describe('1-2 · el escenario EXACTO del reviewer: corregir y re-firmar SIN re-explotar', () => {
  it('BLOQUEA la previa (nombrando la OP), la generación lo rechaza y no nace ninguna OC', async () => {
    const id = await botonContradictorio();
    const ex = await explotar(); // 53 × 100 = 5,300 en el snapshot
    expect(
      ex.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id)
        ?.cantidadRequerida,
    ).toBeCloseTo(5300);
    expect(ex.ordenes[0]?.recetaCambioDesdeExplosion).toBe(false);

    await corregirCapturaAvio(sesion(), idOrden, id, bd());
    await reFirmar([{ tipo: 'avio', id }]);

    const plan = await previa();
    expect(plan.ordenes[0]?.recetaCambioDesdeExplosion).toBe(true);
    expect(plan.bloqueos).toContain(bloqueoDe(1));
    // Lo que el snapshot compraría sigue siendo el número viejo: por eso se bloquea.
    expect(lineaDe(plan, avioBoton.id)?.cantidadTotal).toBeCloseTo(5300);

    const error = await comprar().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect((error as Error).message).toContain(bloqueoDe(1));
    expect(await cliente.ordenCompra.count()).toBe(0);
  });

  it('volver a explotar DESBLOQUEA y la OC sale por 600, no por 5,300', async () => {
    const id = await botonContradictorio();
    await explotar();
    await corregirCapturaAvio(sesion(), idOrden, id, bd());
    await reFirmar([{ tipo: 'avio', id }]);

    const ex = await explotar();
    expect(ex.ordenes[0]?.recetaCambioDesdeExplosion).toBe(false);
    const plan = await previa();
    expect(plan.ordenes[0]?.recetaCambioDesdeExplosion).toBe(false);
    expect(plan.bloqueos.some(esBloqueoDeReceta)).toBe(false);
    expect(lineaDe(plan, avioBoton.id)?.cantidadTotal).toBeCloseTo(600);

    const generadas = await comprar();
    expect(generadas.ordenesCompra).toHaveLength(1);
    const lineas = await cliente.ordenCompraLinea.findMany({
      where: { idAvio: avioBoton.id },
      select: { cantidad: true },
    });
    expect(lineas.map((l) => Number(l.cantidad))).toEqual([600]);
  });
});

describe('3-4 · las INVERSAS: lo que no mueve la compra NO bloquea', () => {
  it('editar SÓLO el precio (tela y avío) y re-firmar no bloquea, aunque la firma se cayó', async () => {
    await explotar();
    const idA = await renglonAvio(avioBoton.id);
    const idT = await renglonTela();
    await editarRenglonReceta(sesion(), idOrden, 'avio', idA, { precio: 9 }, bd());
    await editarRenglonReceta(sesion(), idOrden, 'tela', idT, { precio: 88 }, bd());
    // La firma SÍ se revocó (es lo que separa esta inversa de «re-firmar lo ya firmado»).
    expect((await cliente.ordenAvio.findUniqueOrThrow({ where: { id: idA } })).liberadoEn).toBe(
      null,
    );
    await reFirmar([
      { tipo: 'avio', id: idA },
      { tipo: 'tela', id: idT },
    ]);

    const plan = await previa();
    expect(plan.ordenes[0]?.recetaCambioDesdeExplosion).toBe(false);
    expect(plan.bloqueos.some(esBloqueoDeReceta)).toBe(false);
    expect((await comprar()).ordenesCompra).toHaveLength(1);
  });

  it('reenviar el MISMO consumo (vino en el cuerpo pero no cambió) no bloquea', async () => {
    await explotar();
    const idA = await renglonAvio(avioBoton.id);
    await editarRenglonReceta(sesion(), idOrden, 'avio', idA, { consumoPorPrenda: 6 }, bd());
    await reFirmar([{ tipo: 'avio', id: idA }]);
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('notas, paraCosto, paraPreCosto y el complemento no bloquean', async () => {
    await explotar();
    const idA = await renglonAvio(avioBoton.id);
    const idT = await renglonTela();
    await editarRenglonReceta(
      sesion(),
      idOrden,
      'avio',
      idA,
      { notas: 'ojo con el tono', paraCosto: false, paraPreCosto: false },
      bd(),
    );
    await editarRenglonReceta(
      sesion(),
      idOrden,
      'tela',
      idT,
      { consumoComplementoPorPrenda: 0.4, notas: 'con cárdigan' },
      bd(),
    );
    await reFirmar([
      { tipo: 'avio', id: idA },
      { tipo: 'tela', id: idT },
    ]);
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('marcar revisado y RE-FIRMAR lo ya firmado no bloquean', async () => {
    await explotar();
    const idA = await renglonAvio(avioBoton.id);
    await reFirmar([{ tipo: 'avio', id: idA }]); // ya estaba firmado: re-sella la firma
    const plan = await previa();
    expect(plan.ordenes[0]?.recetaCambioDesdeExplosion).toBe(false);
    expect(plan.bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('abrir y cerrar la receta sin tocar nada no bloquea', async () => {
    await explotar();
    await abrirReceta(sesion(), idOrden, { motivo: 'revisar el cierre con el cliente' }, bd());
    await cerrarReceta(sesion(), idOrden, bd());
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('agregar y editar un ARTE no bloquea (no se compra por MRP)', async () => {
    const idTipoArte = await crearTipoArtePrueba(cliente);
    await explotar();
    await agregarRenglonReceta(
      sesion(),
      idOrden,
      { tipo: 'arte', descripcion: 'Logo pecho', idTipoArte },
      bd(),
    );
    const arte = await cliente.ordenArte.findFirstOrThrow({ where: { idOrden } });
    await editarRenglonReceta(sesion(), idOrden, 'arte', arte.id, { puntadas: 9000 }, bd());
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('editar una LÁPIDA no bloquea (no está en la compra)', async () => {
    const idA = await renglonAvio(avioBoton.id);
    await quitarRenglonReceta(sesion(), idOrden, 'avio', idA, {}, bd());
    await explotar(); // ya sin el botón
    await editarRenglonReceta(sesion(), idOrden, 'avio', idA, { consumoPorPrenda: 9 }, bd());
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('editar un renglón SIN FIRMAR que el snapshot no trae no frena la compra de lo demás', async () => {
    // Lo normal (§Post-F9.72): un cierre que el cliente todavía no autoriza, y lo demás comprándose.
    await agregarRenglonReceta(
      sesion(),
      idOrden,
      { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1 },
      bd(),
    );
    await explotar(); // el cierre no está firmado: no entra
    const idC = await renglonAvio(avioCierre.id);
    await editarRenglonReceta(sesion(), idOrden, 'avio', idC, { consumoPorPrenda: 2 }, bd());
    const plan = await previa();
    expect(plan.bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });
});

describe('cambios que SÍ mueven la compra', () => {
  it('editar el CONSUMO de un renglón que la compra trae bloquea', async () => {
    await explotar();
    const idA = await renglonAvio(avioBoton.id);
    await editarRenglonReceta(sesion(), idOrden, 'avio', idA, { consumoPorPrenda: 4 }, bd());
    await reFirmar([{ tipo: 'avio', id: idA }]);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('guardar SÓLO el precio de un avío con la contradicción heredada SÍ bloquea (la normaliza)', async () => {
    const id = await botonContradictorio();
    await explotar(); // 5,300
    await editarRenglonReceta(sesion(), idOrden, 'avio', id, { precio: 3 }, bd());
    await reFirmar([{ tipo: 'avio', id }]);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('restaurar un renglón que se había ajustado bloquea', async () => {
    const idT = await renglonTela();
    await editarRenglonReceta(sesion(), idOrden, 'tela', idT, { consumoPorPrenda: 2 }, bd());
    await reFirmar([{ tipo: 'tela', id: idT }]);
    await explotar(); // tela a 2 × 100
    await restaurarRenglonReceta(sesion(), idOrden, 'tela', idT, bd()); // vuelve a 1.5
    await reFirmar([{ tipo: 'tela', id: idT }]);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('5 · QUITAR un avío firmado después de explotar bloquea (antes la OC lo compraba)', async () => {
    await explotar();
    const idA = await renglonAvio(avioBoton.id);
    await quitarRenglonReceta(sesion(), idOrden, 'avio', idA, { motivo: 'no lo lleva' }, bd());
    const plan = await previa();
    // El snapshot todavía trae el botón: sin el bloqueo, la OC lo compraría (lo que medía el hoy).
    expect(lineaDe(plan, avioBoton.id)?.cantidadTotal).toBeCloseTo(600);
    expect(plan.bloqueos).toContain(bloqueoDe(1));
    await expect(comprar()).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.ordenCompra.count()).toBe(0);

    await explotar();
    const limpia = await previa();
    expect(limpia.bloqueos.some(esBloqueoDeReceta)).toBe(false);
    expect(lineaDe(limpia, avioBoton.id)).toBeUndefined();
  });

  it('6 · FIRMAR un material nuevo después de explotar bloquea; re-explotar lo trae a la OC', async () => {
    await agregarRenglonReceta(
      sesion(),
      idOrden,
      { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1 },
      bd(),
    );
    await explotar(); // el cierre todavía no está firmado
    const idC = await renglonAvio(avioCierre.id);
    await liberarReceta(sesion(), idOrden, { renglones: [{ tipo: 'avio', id: idC }] }, bd());

    const plan = await previa();
    expect(lineaDe(plan, avioCierre.id)).toBeUndefined(); // la OC saldría SIN él
    expect(plan.bloqueos).toContain(bloqueoDe(1));

    await explotar();
    const limpia = await previa();
    expect(limpia.bloqueos.some(esBloqueoDeReceta)).toBe(false);
    expect(lineaDe(limpia, avioCierre.id)?.cantidadTotal).toBeCloseTo(100);
  });

  it('8 · cambiar el COLOR de la tela después de explotar bloquea; reenviar el mismo, no', async () => {
    await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoGrana.id },
      bd(),
    );
    await explotar();
    // Reenviar lo mismo es idempotente: no cambia nada que comprar.
    await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoGrana.id },
      bd(),
    );
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);

    await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoMarino.id },
      bd(),
    );
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });
});

describe('9 · la MATRIZ pedida', () => {
  const matriz = (ch: number, m: number) => ({
    lineas: [
      {
        idColor: colorRojo.id,
        tallas: [
          { idTalla: tallaCH.id, cantidad: ch },
          { idTalla: tallaM.id, cantidad: m },
        ],
      },
    ],
  });

  it('BAJAR lo pedido después de explotar bloquea (la 0.232 no lo veía: sólo avisaba al crecer)', async () => {
    await explotar();
    await guardarMatrizOrden(sesion(), idOrden, matriz(40, 30), bd());
    const plan = await previa();
    expect(plan.ordenes[0]?.piezasSinExplotar).toBe(0);
    expect(plan.bloqueos).toContain(bloqueoDe(1));
  });

  it('REPARTIR distinto con el mismo total también bloquea', async () => {
    await explotar();
    await guardarMatrizOrden(sesion(), idOrden, matriz(60, 40), bd());
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('guardar la MISMA matriz no bloquea', async () => {
    await explotar();
    await guardarMatrizOrden(sesion(), idOrden, matriz(40, 60), bd());
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('un SOBRE-CORTE sigue siendo sólo el aviso de la 0.232, no un bloqueo', async () => {
    await explotar();
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-09-01',
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 40 },
              { idTalla: tallaM.id, cantidad: 80 },
            ],
          },
        ],
      },
      bd(),
    );
    const plan = await previa();
    expect(plan.ordenes[0]?.piezasSinExplotar).toBe(20);
    expect(plan.bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });
});

describe('7 · varias OP en la misma compra', () => {
  it('una OP desfasada frena el acto entero y el bloqueo nombra SÓLO a ella', async () => {
    const idB = await otraOrden(2n);
    await explotar([idOrden, idB]);
    await editarRenglonReceta(
      sesion(),
      idB,
      'avio',
      await renglonAvio(avioBoton.id, idB),
      { consumoPorPrenda: 3 },
      bd(),
    );
    await reFirmar([{ tipo: 'avio', id: await renglonAvio(avioBoton.id, idB) }], idB);

    const plan = await previa([idOrden, idB]);
    expect(plan.bloqueos.filter(esBloqueoDeReceta)).toEqual([bloqueoDe(2)]);
    expect(plan.ordenes.find((o) => o.idOrden === idOrden)?.recetaCambioDesdeExplosion).toBe(false);
    await expect(comprar([idOrden, idB])).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.ordenCompra.count()).toBe(0);

    // Sacarla de la compra libera a la otra.
    const soloA = await previa([idOrden]);
    expect(soloA.bloqueos.some(esBloqueoDeReceta)).toBe(false);
    expect((await comprar([idOrden])).ordenesCompra).toHaveLength(1);
  });

  it('con DOS desfasadas, una sola frase las nombra a las dos', async () => {
    const idB = await otraOrden(2n);
    await explotar([idOrden, idB]);
    for (const orden of [idOrden, idB]) {
      await guardarMatrizOrden(
        sesion(),
        orden,
        {
          lineas: [
            {
              idColor: colorRojo.id,
              tallas: [
                { idTalla: tallaCH.id, cantidad: 5 },
                { idTalla: tallaM.id, cantidad: 5 },
              ],
            },
          ],
        },
        bd(),
      );
    }
    const plan = await previa([idOrden, idB]);
    expect(plan.bloqueos.filter(esBloqueoDeReceta)).toEqual([
      'La receta de las órdenes 1, 2 cambió desde la última explosión (se corrigió, se quitó o ' +
        'se firmó un material, o cambió lo pedido): lo que se iba a comprar ya no corresponde. ' +
        'Vuelve a explotar, o quítalas de esta compra para generar la de las demás.',
    ]);
  });
});

describe('las marcas son técnicas: viven en su tabla y no tocan la fila de la orden (A7, H6)', () => {
  it('sin fila = versión 0; explotar la crea; subir la versión no mueve `modificadoEn` de la orden', async () => {
    const antes = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
    expect(await cliente.ordenVersionReceta.findUnique({ where: { idOrden } })).toBeNull();
    await explotar();
    expect(await cliente.ordenVersionReceta.findUniqueOrThrow({ where: { idOrden } })).toEqual({
      idOrden,
      versionReceta: 0,
      versionExplotada: 0,
    });
    await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoGrana.id },
      bd(),
    );
    expect(await cliente.ordenVersionReceta.findUniqueOrThrow({ where: { idOrden } })).toEqual({
      idOrden,
      versionReceta: 1,
      versionExplotada: 0,
    });
    const despues = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
    expect(despues.modificadoEn.getTime()).toBe(antes.modificadoEn.getTime());
  });

  it('una mutación ANTES de cualquier explosión crea la fila en 1 (sin explotada)', async () => {
    await guardarMatrizOrden(
      sesion(),
      idOrden,
      {
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 41 },
              { idTalla: tallaM.id, cantidad: 60 },
            ],
          },
        ],
      },
      bd(),
    );
    expect(await cliente.ordenVersionReceta.findUniqueOrThrow({ where: { idOrden } })).toEqual({
      idOrden,
      versionReceta: 1,
      versionExplotada: null,
    });
    await explotar();
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });
});

describe('10 · un snapshot de ANTES de esta fila (versión explotada NULL)', () => {
  it('con snapshot pide re-explotar una vez; explotar lo sincroniza', async () => {
    await explotar();
    // El estado de una orden explotada antes del deploy: snapshot presente, versión desconocida.
    await cliente.$executeRaw`UPDATE orden_version_receta SET version_explotada = NULL WHERE id_orden = ${idOrden}`;
    const plan = await previa();
    expect(plan.ordenes[0]?.recetaCambioDesdeExplosion).toBe(true);
    expect(plan.bloqueos).toContain(bloqueoDe(1));

    await explosionarOrden(sesion(), idOrden, bd());
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('una orden que NUNCA se explotó (sin snapshot) no se marca: no hay compra vieja', async () => {
    const plan = await previa();
    expect(plan.ordenes[0]?.recetaCambioDesdeExplosion).toBe(false);
    expect(plan.bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('una explosión que dejó el snapshot VACÍO sí se desfasa si después se firma algo', async () => {
    // Todo lo firmado es de costo, no de producción ⇒ la explosión no escribe ni un renglón.
    const idA = await renglonAvio(avioBoton.id);
    const idT = await renglonTela();
    await editarRenglonReceta(sesion(), idOrden, 'avio', idA, { paraProduccion: false }, bd());
    await editarRenglonReceta(sesion(), idOrden, 'tela', idT, { paraProduccion: false }, bd());
    await reFirmar([
      { tipo: 'avio', id: idA },
      { tipo: 'tela', id: idT },
    ]);
    await agregarRenglonReceta(
      sesion(),
      idOrden,
      { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1 },
      bd(),
    );
    await explotar();
    expect(await cliente.requerimientoOrden.count({ where: { idOrden } })).toBe(0);
    await liberarReceta(
      sesion(),
      idOrden,
      { renglones: [{ tipo: 'avio', id: await renglonAvio(avioCierre.id) }] },
      bd(),
    );
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });
});

// ══════════════════════ 2ª vuelta (review de la 0.257): H2, H3, H5 y H1 ══════════════════════

describe('H3 · cada campo que la explosión lee, por separado, BLOQUEA', () => {
  it('el CONSUMO de la tela', async () => {
    await explotar();
    const idT = await renglonTela();
    await editarRenglonReceta(sesion(), idOrden, 'tela', idT, { consumoPorPrenda: 2 }, bd());
    await reFirmar([{ tipo: 'tela', id: idT }]);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('el AMARRE de proveedor de la tela', async () => {
    const amarre = await cliente.telaProveedor.create({
      data: { idTela: telaFelpa.id, idProveedor: proveedorOtro.id, precio: 47 },
    });
    await explotar();
    const idT = await renglonTela();
    await editarRenglonReceta(sesion(), idOrden, 'tela', idT, { idTelaProveedor: amarre.id }, bd());
    await reFirmar([{ tipo: 'tela', id: idT }]);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('el AMARRE de proveedor del avío', async () => {
    await explotar();
    const idA = await renglonAvio(avioBoton.id);
    // El par (botón, proveedor) del catálogo: el amarre es el ID DEL PROVEEDOR (sin FK propia).
    await editarRenglonReceta(
      sesion(),
      idOrden,
      'avio',
      idA,
      { idAvioProveedor: proveedor.id },
      bd(),
    );
    await reFirmar([{ tipo: 'avio', id: idA }]);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('«para producción» de la tela', async () => {
    await explotar();
    const idT = await renglonTela();
    await editarRenglonReceta(sesion(), idOrden, 'tela', idT, { paraProduccion: false }, bd());
    await reFirmar([{ tipo: 'tela', id: idT }]);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('«para producción» del avío', async () => {
    await explotar();
    const idA = await renglonAvio(avioBoton.id);
    await editarRenglonReceta(sesion(), idOrden, 'avio', idA, { paraProduccion: false }, bd());
    await reFirmar([{ tipo: 'avio', id: idA }]);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('SÓLO las medidas por talla (la bandera ya estaba encendida y no se mueve)', async () => {
    const idA = await renglonAvio(avioBoton.id);
    await cliente.ordenAvio.update({ where: { id: idA }, data: { consumoPorTalla: true } });
    await cliente.ordenAvioTalla.createMany({
      data: [
        { idOrdenAvio: idA, idTalla: tallaCH.id, consumo: 5 },
        { idOrdenAvio: idA, idTalla: tallaM.id, consumo: 7 },
      ],
    });
    await explotar();
    await editarRenglonReceta(
      sesion(),
      idOrden,
      'avio',
      idA,
      {
        tallas: [
          { idTalla: tallaCH.id, consumo: 5 },
          { idTalla: tallaM.id, consumo: 6 },
        ],
      },
      bd(),
    );
    await reFirmar([{ tipo: 'avio', id: idA }]);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('QUITAR una tela firmada bloquea', async () => {
    await explotar();
    await quitarRenglonReceta(sesion(), idOrden, 'tela', await renglonTela(), {}, bd());
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('RESTAURAR un avío ajustado bloquea', async () => {
    const idA = await renglonAvio(avioBoton.id);
    await editarRenglonReceta(sesion(), idOrden, 'avio', idA, { consumoPorPrenda: 9 }, bd());
    await reFirmar([{ tipo: 'avio', id: idA }]);
    await explotar(); // botón a 9 × 100
    await restaurarRenglonReceta(sesion(), idOrden, 'avio', idA, bd()); // vuelve a 6
    await reFirmar([{ tipo: 'avio', id: idA }]);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });
});

describe('H3 · las inversas que faltaban', () => {
  it('restaurar una tela que YA está como el modelo no bloquea', async () => {
    await explotar();
    const idT = await renglonTela();
    await restaurarRenglonReceta(sesion(), idOrden, 'tela', idT, bd());
    await reFirmar([{ tipo: 'tela', id: idT }]);
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('el color de una tela SIN FIRMAR (fuera del snapshot) no bloquea', async () => {
    const idT = await renglonTela();
    await editarRenglonReceta(sesion(), idOrden, 'tela', idT, { precio: 70 }, bd()); // se cae la firma
    await explotar(); // la tela ya no entra
    await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoGrana.id },
      bd(),
    );
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('firmar un renglón de COSTO (no de producción) no bloquea: no entra a la compra', async () => {
    await agregarRenglonReceta(
      sesion(),
      idOrden,
      { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1, paraProduccion: false },
      bd(),
    );
    await explotar();
    await liberarReceta(
      sesion(),
      idOrden,
      { renglones: [{ tipo: 'avio', id: await renglonAvio(avioCierre.id) }] },
      bd(),
    );
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });
});

describe('H2 · el proveedor que asigna COMPRAS (un avío que nadie más resuelve)', () => {
  let avioEtiqueta: Avio;

  beforeEach(async () => {
    // Sin `AvioProveedor` y sin amarre: sólo Compras puede decir a quién comprárselo.
    avioEtiqueta = await cliente.avio.create({
      data: { clave: 'ETI-01', descripcion: 'Etiqueta', unidad: 'pza' },
    });
    await agregarRenglonReceta(
      sesion(),
      idOrden,
      { tipo: 'avio', idAvio: avioEtiqueta.id, consumoPorPrenda: 1 },
      bd(),
    );
    await liberarReceta(
      sesion(),
      idOrden,
      { renglones: [{ tipo: 'avio', id: await renglonAvio(avioEtiqueta.id) }] },
      bd(),
    );
  });

  const asignar = (idProveedor: number | null, precio?: number) =>
    asignarProveedorDeMaterial(
      sesion(),
      idOrden,
      {
        tipo: 'avio',
        idMaterial: avioEtiqueta.id,
        idProveedor,
        ...(precio === undefined ? {} : { precio }),
      },
      bd(),
    );
  /** El renglón de la etiqueta en la previa, con el proveedor de su OC. */
  const deLaEtiqueta = (plan: Plan) => {
    for (const p of plan.proveedores) {
      const r = p.renglones.find((x) => x.idMaterial === avioEtiqueta.id);
      if (r !== undefined) return { proveedor: p.proveedor, precio: r.precioUnitario };
    }
    return undefined;
  };

  it('la PRIMERA asignación después de explotar no bloquea (el snapshot la trae «sin proveedor»)', async () => {
    await explotar();
    await asignar(proveedor.id, 1.5);
    const plan = await previa();
    expect(plan.bloqueos.some(esBloqueoDeReceta)).toBe(false);
    // Lo que se ve es la omisión, no una compra equivocada: Compras decide al re-explotar.
    expect(deLaEtiqueta(plan)).toBeUndefined();
    await explotar();
    expect(deLaEtiqueta(await previa())?.proveedor).toBe('Avíos del Centro');
  });

  it('REASIGNAR a otro proveedor bloquea; re-explotar le compra al nuevo, al precio nuevo', async () => {
    await asignar(proveedor.id, 1.5);
    await explotar(); // X a $1.5
    await asignar(proveedorOtro.id, 3);
    const plan = await previa();
    expect(plan.bloqueos).toContain(bloqueoDe(1));
    expect(deLaEtiqueta(plan)?.proveedor).toBe('Avíos del Centro'); // lo viejo, por eso se bloquea

    await explotar();
    const limpia = await previa();
    expect(limpia.bloqueos.some(esBloqueoDeReceta)).toBe(false);
    const linea = deLaEtiqueta(limpia);
    expect(linea?.proveedor).toBe('Avíos del Norte');
    expect(linea?.precio).toBeCloseTo(3);
  });

  it('cambiarle SÓLO el precio bloquea', async () => {
    await asignar(proveedor.id, 1.5);
    await explotar();
    await asignar(proveedor.id, 2);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('QUITAR la asignación bloquea', async () => {
    await asignar(proveedor.id, 1.5);
    await explotar();
    await asignar(null);
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('reasignar una etiqueta que el snapshot NO trae (sin firmar al explotar) no bloquea', async () => {
    await asignar(proveedor.id, 1.5);
    const idE = await renglonAvio(avioEtiqueta.id);
    await editarRenglonReceta(sesion(), idOrden, 'avio', idE, { precio: 9 }, bd()); // se cae la firma
    await explotar(); // la etiqueta no entra
    await asignar(proveedorOtro.id, 3);
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('reenviar el MISMO proveedor y precio no bloquea', async () => {
    await asignar(proveedor.id, 1.5);
    await explotar();
    await asignar(proveedor.id, 1.5);
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });
});

describe('H5 · la FUSIÓN de colores repunta el color de tela de la orden', () => {
  let rojoPantone: Color;

  beforeEach(async () => {
    // La orden trae a los DOS «rojos» en su matriz (el caso real de la fusión) y la tela se pide en
    // Grana para el duplicado.
    rojoPantone = await cliente.color.create({ data: { nombre: 'Rojo Pantone 18-1663' } });
    await cliente.ordenLinea.create({
      data: {
        idOrden,
        idColor: rojoPantone.id,
        tallas: { create: [{ idTalla: tallaCH.id, cantidad: 10 }] },
      },
    });
    await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: rojoPantone.id, idTelaColor: tonoGrana.id },
      bd(),
    );
  });

  const fusionar = () =>
    fusionarColores(sesion(), { idDestino: colorRojo.id, origenes: [rojoPantone.id] }, bd());

  it('con la tela en el snapshot, fusionar bloquea; re-explotar desbloquea', async () => {
    await explotar();
    await fusionar();
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
    await explotar();
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });

  it('una orden que NO estaba en el conjunto con candado rechaza la fusión (no toma candados fuera de orden)', async () => {
    // Lo que pasaría si alguien amarra el color entre que la fusión lee el conjunto y llega al
    // repunte: se simula pasándole un conjunto que no la incluye.
    const error = await cliente
      .$transaction((tx) =>
        repuntarReferenciasDeColor(tx, {
          idOrigen: rojoPantone.id,
          idDestino: colorRojo.id,
          ordenesConCandado: new Set<number>(),
        }),
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorConflicto);
    expect((error as Error).message).toContain('vuelve a intentar la fusión');
    // A2: no quedó nada a medias.
    expect(await cliente.ordenTelaColor.count({ where: { idColor: rojoPantone.id } })).toBe(1);
  });

  it('con la tela FUERA del snapshot (sin firmar), fusionar no bloquea', async () => {
    const idT = await renglonTela();
    await editarRenglonReceta(sesion(), idOrden, 'tela', idT, { precio: 70 }, bd());
    await explotar();
    await fusionar();
    expect((await previa()).bloqueos.some(esBloqueoDeReceta)).toBe(false);
  });
});

/**
 * H1 · LA CARRERA: una explosión EN VUELO contra una mutación en paralelo, con DOS conexiones reales.
 *
 * Determinista por construcción: la explosión corre en una transacción interactiva que se queda
 * abierta (barrera) hasta que la mutación, lanzada en otra conexión, o TERMINÓ (sin candado) o quedó
 * ESPERANDO un candado (con él) — se mira en `pg_locks`, no con un `sleep`. Recién entonces se suelta
 * la explosión. El resultado final es el que juzga.
 */
/**
 * Abre una transacción que corre `primero`, avisa, y NO confirma hasta que se le diga (`soltar`);
 * entonces corre `luego` (si lo hay) y confirma. Es la explosión «en vuelo» de las carreras.
 */
function transaccionEnVuelo(
  primero: (tx: Tx) => Promise<unknown>,
  luego?: (tx: Tx) => Promise<unknown>,
): { lista: Promise<unknown>; soltar: () => void; fin: Promise<void> } {
  let soltar: () => void = () => undefined;
  const barrera = new Promise<void>((r) => {
    soltar = r;
  });
  let avisar: () => void = () => undefined;
  const lista = new Promise<void>((r) => {
    avisar = r;
  });
  const fin = cliente.$transaction(
    async (tx) => {
      await primero(tx);
      avisar();
      await barrera;
      if (luego !== undefined) await luego(tx);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  return { lista: Promise.race([lista, fin]), soltar, fin };
}

/** La explosión de la orden de siempre, en vuelo. */
const explosionEnVuelo = () =>
  transaccionEnVuelo((tx) => explosionarOrden(sesion(), idOrden, { tx }));

/**
 * Espera a que la otra conexión TERMINE o quede ESPERANDO un candado (lo que pase primero), y dice
 * de qué clase es el candado: `consultivo` (el RCPV) u `otro` (una fila, una llave única). Se mira
 * en `pg_locks`, no con un `sleep`: así la carrera es determinista.
 */
async function terminaOEspera(otra: Promise<unknown>): Promise<'termino' | 'consultivo' | 'otro'> {
  let termino = false;
  otra.then(
    () => {
      termino = true;
    },
    () => {
      termino = true;
    },
  );
  for (let i = 0; i < 800; i++) {
    if (termino) return 'termino';
    const filas = await cliente.$queryRaw<{ locktype: string }[]>`
      SELECT locktype FROM pg_locks WHERE NOT granted`;
    if (filas.length > 0) {
      return filas.some((f) => f.locktype === 'advisory') ? 'consultivo' : 'otro';
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('la otra conexión ni terminó ni quedó esperando un candado');
}

describe('H1 · carrera entre una explosión en vuelo y una mutación (dos conexiones)', () => {
  it('R2 · editar el consumo DURANTE la explosión y re-firmar: la previa no compra lo viejo', async () => {
    // La orden nunca se explotó: no hay snapshot comiteado al que preguntarle.
    const idA = await renglonAvio(avioBoton.id);
    const vuelo = explosionEnVuelo();
    await vuelo.lista; // leyó el consumo 6 (600 piezas) y escribió el snapshot, sin confirmar
    const mutacion = editarRenglonReceta(
      sesion(),
      idOrden,
      'avio',
      idA,
      { consumoPorPrenda: 3 },
      bd(),
    );
    await terminaOEspera(mutacion);
    vuelo.soltar();
    await vuelo.fin;
    await mutacion;
    await reFirmar([{ tipo: 'avio', id: idA }]);

    const plan = await previa();
    // Sin el candado: 0/0, la previa no bloqueaba y compraba 600 donde eran 300.
    expect(plan.bloqueos).toContain(bloqueoDe(1));
    await explotar();
    expect(lineaDe(await previa(), avioBoton.id)?.cantidadTotal).toBeCloseTo(300);
  });

  it('R3 · firmar DURANTE una explosión que lo dejó fuera: la OC no sale sin él', async () => {
    await explotar(); // el snapshot comiteado trae el botón
    const idA = await renglonAvio(avioBoton.id);
    await editarRenglonReceta(sesion(), idOrden, 'avio', idA, { precio: 4 }, bd()); // se cae la firma
    const vuelo = explosionEnVuelo();
    await vuelo.lista; // explotó SIN el botón (no está firmado), sin confirmar
    const mutacion = liberarReceta(
      sesion(),
      idOrden,
      { renglones: [{ tipo: 'avio', id: idA }] },
      bd(),
    );
    await terminaOEspera(mutacion);
    vuelo.soltar();
    await vuelo.fin;
    await mutacion;

    const plan = await previa();
    // Sin el candado: 1/1, sin bloqueo, y la OC salía sin el botón.
    expect(lineaDe(plan, avioBoton.id)).toBeUndefined();
    expect(plan.bloqueos).toContain(bloqueoDe(1));
    await explotar();
    expect(lineaDe(await previa(), avioBoton.id)?.cantidadTotal).toBeCloseTo(600);
  });
});

/**
 * H1 (3ª vuelta) · LAS OTRAS CUATRO PUERTAS que toman el candado RCPV, cada una con su carrera.
 * Mismo molde que R2: la orden nunca se explotó (no hay snapshot COMITEADO al que preguntarle), una
 * explosión en vuelo ya escribió el suyo sin confirmar, y la mutación entra en paralelo. Sin el
 * candado, la mutación pregunta al snapshot comiteado (vacío) y no sube nada: la explosión confirma
 * lo viejo sellado como vigente y la previa compra lo viejo sin bloquear.
 */
describe('H1 · carrera en las otras puertas: color, matriz, proveedor de Compras y fusión', () => {
  /** Lanza `mutacion` con la explosión en vuelo, la suelta y espera a las dos. */
  async function enCarrera(
    mutacion: () => Promise<unknown>,
  ): Promise<'termino' | 'consultivo' | 'otro'> {
    const vuelo = explosionEnVuelo();
    await vuelo.lista;
    const otra = mutacion();
    const como = await terminaOEspera(otra);
    vuelo.soltar();
    await vuelo.fin;
    await otra;
    return como;
  }

  it('L4 · cambiar el COLOR de la tela durante la explosión: la previa no compra el color viejo', async () => {
    await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoGrana.id },
      bd(),
    );
    await enCarrera(() =>
      asignarColorDeTela(
        sesion(),
        idOrden,
        { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoMarino.id },
        bd(),
      ),
    );
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  /**
   * ⚠️ La MATRIZ es la única puerta cuya respuesta final NO depende del candado: sube la versión sin
   * preguntarle al snapshot, y la explosión sella la versión que leyó ANTES que la receta — así que
   * aun sin candado la orden queda desfasada. Lo que el candado garantiza aquí es la exclusión
   * (que la matriz espere a la explosión en vuelo, y no al revés), y eso es lo que se mide: espera
   * POR EL RCPV, no por la fila de `orden_version_receta` que la explosión ya insertó.
   */
  it('L5 · cambiar la MATRIZ durante la explosión: espera al candado y la previa bloquea', async () => {
    const como = await enCarrera(() =>
      guardarMatrizOrden(
        sesion(),
        idOrden,
        {
          lineas: [
            {
              idColor: colorRojo.id,
              tallas: [
                { idTalla: tallaCH.id, cantidad: 40 },
                { idTalla: tallaM.id, cantidad: 30 },
              ],
            },
          ],
        },
        bd(),
      ),
    );
    expect(como).toBe('consultivo');
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('L6 · REASIGNAR el proveedor de Compras durante la explosión: la previa no le compra al viejo', async () => {
    const etiqueta = await cliente.avio.create({
      data: { clave: 'ETI-02', descripcion: 'Etiqueta', unidad: 'pza' },
    });
    await agregarRenglonReceta(
      sesion(),
      idOrden,
      { tipo: 'avio', idAvio: etiqueta.id, consumoPorPrenda: 1 },
      bd(),
    );
    await liberarReceta(
      sesion(),
      idOrden,
      { renglones: [{ tipo: 'avio', id: await renglonAvio(etiqueta.id) }] },
      bd(),
    );
    const asignar = (idProveedor: number, precio: number) =>
      asignarProveedorDeMaterial(
        sesion(),
        idOrden,
        { tipo: 'avio', idMaterial: etiqueta.id, idProveedor, precio },
        bd(),
      );
    await asignar(proveedor.id, 1.5); // primera asignación: la explosión en vuelo la va a usar
    await enCarrera(() => asignar(proveedorOtro.id, 3));
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });

  it('L7 · FUSIONAR el color de prenda durante la explosión: la previa no compra lo viejo', async () => {
    const rojoPantone = await cliente.color.create({ data: { nombre: 'Rojo Pantone 18-1663' } });
    await cliente.ordenLinea.create({
      data: {
        idOrden,
        idColor: rojoPantone.id,
        tallas: { create: [{ idTalla: tallaCH.id, cantidad: 10 }] },
      },
    });
    await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: rojoPantone.id, idTelaColor: tonoGrana.id },
      bd(),
    );
    await enCarrera(() =>
      fusionarColores(sesion(), { idDestino: colorRojo.id, origenes: [rojoPantone.id] }, bd()),
    );
    expect((await previa()).bloqueos).toContain(bloqueoDe(1));
  });
});

/**
 * H6 · ESTRÉS — la explosión NO entra al grafo de candados de fila de `ordenes`.
 *
 * El caso que midió el reviewer, con la función REAL: guardar «lleva arte» de un modelo
 * (`recalcularEstadoOrdenesDeModelo`) actualiza las filas de sus órdenes por id ascendente; una
 * explosión de las mismas dos OP las recorre por FOLIO. Con el sello escrito en `ordenes`, la
 * explosión sostenía la fila de la primera OP hasta el COMMIT mientras explotaba la segunda, y el
 * recálculo —con la otra fila tomada— esperaba la primera: 8-11 deadlocks de 25. Aquí los folios
 * van al revés de los ids a propósito, que es lo que cruza los dos órdenes.
 *
 * Y la segunda mitad (H6, «¿queda algún ciclo?»): una mutación de la receta SÍ escribe la fila de
 * su orden (recalcula su estado), bajo RCPV. Se corre a la vez que las otras dos.
 */
describe('H6 · estrés: la explosión contra quien escribe las filas de `ordenes`, sin deadlocks', () => {
  const VUELTAS = 25;
  const esDeadlock = (e: unknown): boolean =>
    /deadlock|40P01|P2034/i.test(`${String(e)} ${JSON.stringify(e)}`);
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Corre las tareas a la vez y cuenta los deadlocks; cualquier OTRO error rompe la prueba. */
  async function contarDeadlocks(tareas: (() => Promise<unknown>)[]): Promise<number> {
    let deadlocks = 0;
    for (const r of await Promise.allSettled(tareas.map((t) => t()))) {
      if (r.status === 'fulfilled') continue;
      if (esDeadlock(r.reason)) deadlocks++;
      else throw r.reason;
    }
    return deadlocks;
  }

  let ids: number[] = [];
  beforeEach(async () => {
    await cliente.modelo.update({ where: { id: modelo.id }, data: { llevaArte: false } });
    // La segunda OP nace DESPUÉS (id mayor) con un folio MENOR: la explosión la recorre primero,
    // y el recálculo del modelo actualiza por id ascendente — los dos órdenes se cruzan.
    ids = [idOrden, await otraOrden(0n)];
  });

  /** Lo que el recálculo completó vuelve a quedar pendiente, para que cada vuelta escriba. */
  const pendientes = () =>
    cliente.orden.updateMany({ where: { id: { in: ids } }, data: { estado: 'capturada' } });
  const recalcularModelo = () =>
    cliente.$transaction((tx) => recalcularEstadoOrdenesDeModelo(tx, sesion(), modelo.id));

  /**
   * S3 DETERMINISTA — el cruce exacto, forzado con la barrera: la explosión ya selló la OP de folio
   * menor (id mayor) y se detiene ANTES de explotar la otra; el recálculo del modelo entra, toma la
   * fila de la de id menor y queda esperando. Con el sello en `ordenes` eso es un ciclo garantizado
   * (40P01); con la tabla propia la explosión no tiene ninguna fila de `ordenes` que el recálculo
   * espere, así que el recálculo TERMINA sin esperar nada.
   */
  it('S3 determinista · explosión a medias + «lleva arte»: el recálculo no espera ni hay deadlock', async () => {
    await pendientes();
    const [menor, mayor] = ids as [number, number];
    const vuelo = transaccionEnVuelo(
      (tx) => explosionarOrdenes(sesion(), [mayor], { tx }),
      (tx) => explosionarOrdenes(sesion(), [menor], { tx }),
    );
    await vuelo.lista;
    const recalculo = recalcularModelo();
    const como = await terminaOEspera(recalculo);
    vuelo.soltar(); // SIEMPRE, también si algo falla: la transacción en vuelo no se queda colgada
    const resultados = await Promise.allSettled([vuelo.fin, recalculo]);
    // Con el sello en `ordenes`: el recálculo ESPERA la fila de la OP ya sellada y, al soltar la
    // explosión, ésta pide la fila que el recálculo ya tiene ⇒ 40P01.
    expect(
      resultados.map((r) => (r.status === 'fulfilled' ? 'ok' : String(r.reason).slice(0, 120))),
    ).toEqual(['ok', 'ok']);
    expect(como).toBe('termino');
  });

  it(`S3 · explosión de las dos OP contra «lleva arte» del modelo: 0 deadlocks en ${String(VUELTAS)}`, async () => {
    // El recálculo arranca en distintos momentos DENTRO de la explosión (que dura del orden de
    // cien milisegundos): la ventana peligrosa es entre el sello de la primera OP y el de la segunda.
    const inicio = performance.now();
    await explosionarOrdenes(sesion(), ids, bd());
    const duracion = performance.now() - inicio;
    let deadlocks = 0;
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      await pendientes();
      deadlocks += await contarDeadlocks([
        () => explosionarOrdenes(sesion(), ids, bd()),
        async () => {
          await espera(((vuelta % 10) / 10) * duracion);
          await recalcularModelo();
        },
      ]);
    }
    expect(deadlocks).toBe(0);
  }, 240_000);

  it(`y con una mutación de la MATRIZ (RCPV + escribe la fila de su orden) a la vez: 0 en ${String(VUELTAS)}`, async () => {
    const inicio = performance.now();
    await explosionarOrdenes(sesion(), ids, bd());
    const duracion = performance.now() - inicio;
    let deadlocks = 0;
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      await pendientes();
      deadlocks += await contarDeadlocks([
        () => explosionarOrdenes(sesion(), ids, bd()),
        async () => {
          await espera(((vuelta % 10) / 10) * duracion);
          await recalcularModelo();
        },
        async () => {
          await espera((((vuelta * 3) % 10) / 10) * duracion);
          await guardarMatrizOrden(
            sesion(),
            idOrden,
            {
              lineas: [
                {
                  idColor: colorRojo.id,
                  tallas: [
                    { idTalla: tallaCH.id, cantidad: 40 + (vuelta % 2) },
                    { idTalla: tallaM.id, cantidad: 60 },
                  ],
                },
              ],
            },
            bd(),
          );
        },
      ]);
    }
    expect(deadlocks).toBe(0);
  }, 240_000);
});

/**
 * S1 · LOS CANDADOS RCPV SE TOMAN EN ORDEN ASCENDENTE, en todas las transacciones que toman varios.
 *
 * Ninguna otra prueba lo verifica: si un lote de explosión los tomara en orden de FOLIO, o la fusión
 * o el proveedor en bloque en el orden del cuerpo, dos transacciones con las mismas dos órdenes se
 * esperarían en cruz. Aquí van a la vez, vuelta tras vuelta: las dos explosiones del lote (en los
 * dos órdenes del cuerpo), una fusión que toca las dos OP, el proveedor en bloque en el orden del
 * cuerpo [Y, X] y una edición de receta. Los folios van al revés de los ids, que es lo que cruza el
 * orden de folio con el de id. Molde de la S1 del reviewer de la 0.257.
 */
describe('S1 · estrés: los candados RCPV siempre en orden ascendente, sin deadlocks', () => {
  const VUELTAS = 15;
  const esDeadlock = (e: unknown): boolean =>
    /deadlock|40P01|P2034/i.test(`${String(e)} ${JSON.stringify(e)}`);

  it(`${String(VUELTAS)} vueltas de explosiones [Y,X] y [X,Y] + fusión + proveedor en bloque [Y,X]: 0 deadlocks`, async () => {
    const X = idOrden; // id menor, folio 1
    const Y = await otraOrden(0n); // id MAYOR, folio 0 ⇒ por folio va primero
    const idA = await renglonAvio(avioBoton.id, X);
    const rechazos: string[] = [];
    let deadlocks = 0;
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      // Un color de prenda nuevo en las DOS OP, con su color de tela amarrado: la fusión las toca a
      // las dos (y toma sus dos candados).
      const origen = await cliente.color.create({ data: { nombre: `Origen ${String(vuelta)}` } });
      for (const id of [X, Y]) {
        await cliente.ordenLinea.create({
          data: {
            idOrden: id,
            idColor: origen.id,
            tallas: { create: [{ idTalla: tallaCH.id, cantidad: 5 }] },
          },
        });
        await asignarColorDeTela(
          sesion(),
          id,
          { idTela: telaFelpa.id, idColor: origen.id, idTelaColor: tonoGrana.id },
          bd(),
        );
      }
      const resultados = await Promise.allSettled([
        explosionarOrdenes(sesion(), [Y, X], bd()),
        fusionarColores(sesion(), { idDestino: colorRojo.id, origenes: [origen.id] }, bd()),
        editarRenglonReceta(sesion(), X, 'avio', idA, { notas: `n${String(vuelta)}` }, bd()),
        asignarProveedorDeMaterialEnBloque(
          sesion(),
          {
            idProveedor: proveedor.id,
            asignaciones: [
              { idOrden: Y, tipo: 'avio', idMaterial: avioBoton.id },
              { idOrden: X, tipo: 'avio', idMaterial: avioBoton.id },
            ],
          },
          bd(),
        ),
        explosionarOrdenes(sesion(), [X, Y], bd()),
      ]);
      for (const r of resultados) {
        if (r.status === 'fulfilled') continue;
        if (esDeadlock(r.reason)) deadlocks++;
        else rechazos.push(String(r.reason).slice(0, 200));
      }
    }
    expect(rechazos).toEqual([]);
    expect(deadlocks).toBe(0);
  }, 120_000);
});
