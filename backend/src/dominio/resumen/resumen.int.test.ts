/**
 * Tests de INTEGRACIÓN del RESUMEN OPERATIVO (rediseño R9) contra Postgres efímero
 * (testcontainers). Arma un dataset calculado A MANO alrededor de un "hoy" fijo (miércoles
 * 8-jul-2026, semana ISO 28) y ejercita el DOMINIO (no HTTP). Verifica:
 *  (a) órdenes ABIERTAS = con algo pendiente (la 100% cerrada no cuenta; criterio del tablero WIP);
 *  (b) WIP en maquila = enviado − recibido − incompletas (vivos) + maquileros con saldo (V1-E8v);
 *  (c) cortado esta semana vs anterior (canceladas fuera) + la serie de 7 barras;
 *  (d) % entregas a tiempo últimos 30 días + delta vs la ventana previa (vista de F7 refrescada);
 *  (e) existencia PT total (Σ de la vista en vivo) + almacenes con existencia;
 *  (f) órdenes por vencer (pendiente fechado dentro de 7 días; la RC completa no aparece);
 *  (g) RBAC por bloque: sin el permiso del bloque sale null; sin NINGUNO lanza ErrorPermiso (A4);
 *  (h) A9: nada de otra empresa se cuela en ningún bloque.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Almacen,
  Color,
  Empresa,
  PrismaClient,
  Proveedor,
  Talla,
  TipoProceso,
} from '../../datos/index.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { refrescarKpis } from '../../comun/jobs/refrescar-kpis.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { resumenOperativo } from './resumen.js';

/** "Hoy" fijo: miércoles 8-jul-2026 → semana ISO 28 (lun 6-jul a dom 12-jul). */
const AHORA = new Date('2026-07-08T12:00:00.000Z');

let cliente: PrismaClient;
let empresa: Empresa;
let empresa2: Empresa;
let rojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let maquilero: Proveedor;
let costura: TipoProceso;
let almacen: Almacen;
let idModelo: number;
let idClienteNeg: number;
let folioEtapa = 100n;

const PERM_TODOS: ClavePermiso[] = [
  'produccion.wip-ver',
  'indicadores.ver',
  'inventario-pt.ver',
  'rc.ruta-ver',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS, idEmpresa = empresa.id) =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos });
const bd = () => ({ cliente });

/** Crea una orden mínima con matriz opcional (una línea Rojo: CH+M). */
async function crearOrden(opciones: {
  idEmpresa: number;
  folio: bigint;
  matriz?: { ch: number; m: number };
  rcActiva?: boolean;
}): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio: opciones.folio,
      idEmpresa: opciones.idEmpresa,
      idModelo,
      idCliente: idClienteNeg,
      estado: 'capturada',
      fecha: new Date('2026-06-01T00:00:00.000Z'),
      ...(opciones.rcActiva === undefined ? {} : { rcActiva: opciones.rcActiva }),
      ...(opciones.matriz === undefined
        ? {}
        : {
            lineas: {
              create: [
                {
                  idColor: rojo.id,
                  tallas: {
                    create: [
                      { idTalla: tallaCH.id, cantidad: opciones.matriz.ch },
                      { idTalla: tallaM.id, cantidad: opciones.matriz.m },
                    ],
                  },
                },
              ],
            },
          }),
    },
  });
  return orden.id;
}

/** Inserta una etapa de producción con UN detalle (Rojo/M) directo (el Resumen solo LEE). */
async function crearEtapa(opciones: {
  idEmpresa: number;
  idOrden: number;
  tipo: 'corte' | 'envio_maquila' | 'recibo_maquila' | 'entrega_cliente';
  fecha: string;
  cantidad: number;
  conProceso?: boolean;
  conTercero?: boolean;
  cancelada?: boolean;
  /** Prendas INCOMPLETAS del recibo (V1-E8v): vuelven del taller pero no se producen. */
  incompletas?: number;
}): Promise<void> {
  folioEtapa += 1n;
  await cliente.etapaMovimiento.create({
    data: {
      folio: folioEtapa,
      idEmpresa: opciones.idEmpresa,
      idOrden: opciones.idOrden,
      tipo: opciones.tipo,
      fecha: new Date(`${opciones.fecha}T00:00:00.000Z`),
      ...(opciones.conProceso ? { idTipoProceso: costura.id } : {}),
      ...(opciones.conTercero ? { idTercero: maquilero.id } : {}),
      ...(opciones.cancelada
        ? { canceladoEn: new Date(`${opciones.fecha}T12:00:00.000Z`), motivoCancelacion: 'test' }
        : {}),
      detalles: {
        create: [
          {
            idColor: rojo.id,
            idTalla: tallaM.id,
            cantidad: opciones.cantidad,
            ...(opciones.incompletas === undefined
              ? {}
              : { cantidadIncompletas: opciones.incompletas }),
          },
        ],
      },
    },
  });
}

/** Inserta un renglón de la RUTA viva de una orden. */
async function crearProcesoRuta(opciones: {
  idOrden: number;
  idProcesoDef: number;
  planeada: string | null;
  real?: string;
  ultimo?: boolean;
}): Promise<void> {
  await cliente.rutaOrden.create({
    data: {
      idOrden: opciones.idOrden,
      idProcesoDef: opciones.idProcesoDef,
      secuencia: 1,
      duracionDias: 2,
      ...(opciones.ultimo === undefined ? {} : { ultimoProceso: opciones.ultimo }),
      fechaPlaneadaVigente:
        opciones.planeada === null ? null : new Date(`${opciones.planeada}T00:00:00.000Z`),
      ...(opciones.real === undefined
        ? {}
        : { fechaReal: new Date(`${opciones.real}T00:00:00.000Z`), estado: 'completado' as const }),
    },
  });
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'Empresa Resumen');
  empresa2 = await crearEmpresaPrueba(cliente, 'Empresa Otra');

  rojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'MOD-1', descripcion: 'Playera' } });
  idModelo = modelo.id;
  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Tienda X' } });
  idClienteNeg = clienteNeg.id;
  maquilero = await cliente.proveedor.create({ data: { nombre: 'Taller A' } });
  costura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  almacen = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  folioEtapa = 100n;
});

describe('resumenOperativo — bloques de producción (produccion.wip-ver)', () => {
  it('abiertas/WIP/cortado/serie cuadran a mano; lo cerrado, cancelado y ajeno NO cuenta (A9)', async () => {
    // Orden A (ABIERTA): pedido 35, cortado 30 ESTA semana, enviado 20, recibido 5 (costura).
    const ordenA = await crearOrden({
      idEmpresa: empresa.id,
      folio: 1n,
      matriz: { ch: 15, m: 20 },
    });
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: ordenA,
      tipo: 'corte',
      fecha: '2026-07-07',
      cantidad: 30,
    });
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: ordenA,
      tipo: 'envio_maquila',
      fecha: '2026-07-07',
      cantidad: 20,
      conProceso: true,
      conTercero: true,
    });
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: ordenA,
      tipo: 'recibo_maquila',
      fecha: '2026-07-08',
      cantidad: 5,
      conProceso: true,
      conTercero: true,
    });
    // Corte CANCELADO esta semana (no cuenta en ninguna suma).
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: ordenA,
      tipo: 'corte',
      fecha: '2026-07-07',
      cantidad: 99,
      cancelada: true,
    });

    // Orden B (CERRADA): pedido 10 = cortado (SEMANA PASADA) = enviado = recibido = entregado.
    const ordenB = await crearOrden({ idEmpresa: empresa.id, folio: 2n, matriz: { ch: 0, m: 10 } });
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: ordenB,
      tipo: 'corte',
      fecha: '2026-07-01',
      cantidad: 10,
    });
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: ordenB,
      tipo: 'envio_maquila',
      fecha: '2026-07-01',
      cantidad: 10,
      conProceso: true,
      conTercero: true,
    });
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: ordenB,
      tipo: 'recibo_maquila',
      fecha: '2026-07-02',
      cantidad: 10,
      conProceso: true,
      conTercero: true,
    });
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: ordenB,
      tipo: 'entrega_cliente',
      fecha: '2026-07-03',
      cantidad: 10,
    });

    // Empresa 2 (A9): orden con corte esta semana y pendientes — NO debe verse.
    const ordenAjena = await crearOrden({
      idEmpresa: empresa2.id,
      folio: 1n,
      matriz: { ch: 5, m: 5 },
    });
    await crearEtapa({
      idEmpresa: empresa2.id,
      idOrden: ordenAjena,
      tipo: 'corte',
      fecha: '2026-07-07',
      cantidad: 50,
    });

    const r = await resumenOperativo(sesion(), bd(), AHORA);

    // (a) Abiertas: solo la A (la B no tiene nada pendiente; la ajena es de otra empresa).
    expect(r.ordenesAbiertas).toEqual({ total: 1 });
    // (b) WIP en maquila: A enviado 20 − recibido 5 = 15 (la B netea 0); 1 maquilero con saldo.
    expect(r.wipMaquila).toEqual({ piezas: 15, maquileros: 1 });
    // (c) Cortado: esta semana 30 (el cancelado de 99 fuera), pasada 10 → +200%.
    expect(r.cortadoSemana).toEqual({ piezas: 30, piezasSemanaAnterior: 10, deltaPct: 200 });
    // Serie: 7 barras (vieja→actual), las últimas dos con 10 y 30, el resto en 0.
    expect(r.cortesPorSemana).toHaveLength(7);
    expect(r.cortesPorSemana?.map((s) => s.piezas)).toEqual([0, 0, 0, 0, 0, 10, 30]);
    expect(r.cortesPorSemana?.[6]).toMatchObject({ anioSemana: '2026-W28', etiqueta: 'S28' });
  });

  it('⭐ las PRENDAS INCOMPLETAS cierran la orden y sacan al maquilero del pie (V1-E8v)', async () => {
    // Las DOS consultas SQL en vivo de la portada llevaban la fórmula vieja: `contarOrdenesAbiertas`
    // («N órdenes abiertas») y `contarMaquilerosConSaldo` («en N maquileros»). Con 20 enviadas y 12
    // buenas + 8 incompletas de vuelta, el maquilero ya no tiene NADA (§Post-F9.147) y la orden no
    // tiene nada pendiente en maquila. Antes, la orden se quedaba abierta para siempre y el pie
    // seguía contando a un maquilero con las manos vacías.
    const orden = await crearOrden({ idEmpresa: empresa.id, folio: 9n, matriz: { ch: 0, m: 20 } });
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: orden,
      tipo: 'corte',
      fecha: '2026-07-07',
      cantidad: 20,
    });
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: orden,
      tipo: 'envio_maquila',
      fecha: '2026-07-07',
      cantidad: 20,
      conProceso: true,
      conTercero: true,
    });
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: orden,
      tipo: 'recibo_maquila',
      fecha: '2026-07-08',
      cantidad: 12,
      incompletas: 8,
      conProceso: true,
      conTercero: true,
    });
    // Se entregan al cliente las 12 buenas: ya no queda NADA por hacerle a esta orden.
    await crearEtapa({
      idEmpresa: empresa.id,
      idOrden: orden,
      tipo: 'entrega_cliente',
      fecha: '2026-07-09',
      cantidad: 12,
    });

    const r = await resumenOperativo(sesion(), bd(), AHORA);
    // (a) `contarOrdenesAbiertas`: 20 − 12 − 8 = 0 por recibir ⇒ la orden NO está abierta.
    expect(r.ordenesAbiertas).toEqual({ total: 0 });
    // (b) `contarMaquilerosConSaldo`: el maquilero devolvió las 20 (12 + 8) ⇒ sin saldo, sin pie.
    expect(r.wipMaquila).toEqual({ piezas: 0, maquileros: 0 });
  });
});

describe('resumenOperativo — entregas a tiempo (indicadores.ver, vista F7)', () => {
  it('últimos 30 días vs ventana previa, en puntos', async () => {
    const proc = await cliente.procesoDef.create({
      data: { codigo: 'entrega', nombre: 'Entrega' },
    });
    // Ventana actual (8-jun → 8-jul): 1 a tiempo + 1 tarde → 50%.
    const o1 = await crearOrden({ idEmpresa: empresa.id, folio: 10n });
    const o2 = await crearOrden({ idEmpresa: empresa.id, folio: 11n });
    await crearProcesoRuta({
      idOrden: o1,
      idProcesoDef: proc.id,
      planeada: '2026-06-22',
      real: '2026-06-20',
      ultimo: true,
    });
    await crearProcesoRuta({
      idOrden: o2,
      idProcesoDef: proc.id,
      planeada: '2026-06-20',
      real: '2026-06-25',
      ultimo: true,
    });
    // Ventana previa (9-may → 8-jun): 1 a tiempo → 100%.
    const o3 = await crearOrden({ idEmpresa: empresa.id, folio: 12n });
    await crearProcesoRuta({
      idOrden: o3,
      idProcesoDef: proc.id,
      planeada: '2026-05-25',
      real: '2026-05-20',
      ultimo: true,
    });
    await refrescarKpis(bd());

    const r = await resumenOperativo(sesion(['indicadores.ver']), bd(), AHORA);
    expect(r.entregasATiempo).toEqual({ porcentaje: 0.5, medibles: 2, deltaPuntos: -50 });
  });
});

describe('resumenOperativo — existencia PT (inventario-pt.ver)', () => {
  it('suma el kardex en vivo (entradas − salidas) y cuenta almacenes con existencia', async () => {
    const entrada = await cliente.tipoMovimientoInventario.create({
      data: { codigo: 'entrada-test', nombre: 'Entrada', direccion: 'entrada' },
    });
    const salida = await cliente.tipoMovimientoInventario.create({
      data: { codigo: 'salida-test', nombre: 'Salida', direccion: 'salida' },
    });
    const mov = (folio: bigint, idTipoMov: number, cantidad: number, idEmpresa = empresa.id) =>
      cliente.movimiento.create({
        data: {
          folio,
          idEmpresa,
          idTipoMov,
          idAlmacen: almacen.id,
          fecha: new Date('2026-07-01T00:00:00.000Z'),
          detallesPt: {
            create: [{ idModelo, idColor: rojo.id, idTalla: tallaM.id, cantidad }],
          },
        },
      });
    await mov(1n, entrada.id, 100);
    await mov(2n, salida.id, 40);
    await mov(3n, entrada.id, 500, empresa2.id); // A9: de otra empresa, fuera.

    const r = await resumenOperativo(sesion(['inventario-pt.ver']), bd(), AHORA);
    expect(r.existenciaPt).toEqual({ piezas: 60, almacenes: 1 });
  });
});

describe('resumenOperativo — órdenes por vencer (rc.ruta-ver)', () => {
  it('aparece la orden con pendiente fechado dentro de 7 días; la RC completa y la ajena no', async () => {
    const proc = await cliente.procesoDef.create({ data: { codigo: 'corte', nombre: 'Corte' } });
    const proc2 = await cliente.procesoDef.create({ data: { codigo: 'envio', nombre: 'Envío' } });
    // Orden con RC viva: 1 cumplido + 1 pendiente que vence mañana → 50% avance, enRiesgo.
    const ordenViva = await crearOrden({
      idEmpresa: empresa.id,
      folio: 20n,
      matriz: { ch: 15, m: 20 },
      rcActiva: true,
    });
    await crearProcesoRuta({
      idOrden: ordenViva,
      idProcesoDef: proc.id,
      planeada: '2026-07-05',
      real: '2026-07-05',
    });
    await crearProcesoRuta({ idOrden: ordenViva, idProcesoDef: proc2.id, planeada: '2026-07-09' });
    // Orden con RC viva TODA cumplida → no aparece.
    const ordenLista = await crearOrden({ idEmpresa: empresa.id, folio: 21n, rcActiva: true });
    await crearProcesoRuta({
      idOrden: ordenLista,
      idProcesoDef: proc.id,
      planeada: '2026-07-05',
      real: '2026-07-06',
    });
    // A9: orden ajena con pendiente para mañana → no aparece.
    const ordenAjena = await crearOrden({ idEmpresa: empresa2.id, folio: 22n, rcActiva: true });
    await crearProcesoRuta({ idOrden: ordenAjena, idProcesoDef: proc.id, planeada: '2026-07-09' });

    const r = await resumenOperativo(sesion(['rc.ruta-ver']), bd(), AHORA);
    expect(r.ordenesPorVencer).toHaveLength(1);
    expect(r.ordenesPorVencer?.[0]).toMatchObject({
      idOrden: ordenViva,
      folio: 20,
      codigoModelo: 'MOD-1',
      cliente: 'Tienda X',
      piezas: 35,
      avancePct: 50,
      semaforo: 'enRiesgo',
      etapasAtrasadas: 0,
    });
  });
});

describe('resumenOperativo — RBAC por bloque (A4)', () => {
  it('cada bloque sale null sin su permiso (y los demás sí llegan)', async () => {
    const r = await resumenOperativo(sesion(['produccion.wip-ver']), bd(), AHORA);
    expect(r.ordenesAbiertas).not.toBeNull();
    expect(r.wipMaquila).not.toBeNull();
    expect(r.cortadoSemana).not.toBeNull();
    expect(r.cortesPorSemana).not.toBeNull();
    expect(r.entregasATiempo).toBeNull();
    expect(r.existenciaPt).toBeNull();
    expect(r.ordenesPorVencer).toBeNull();
  });

  it('sin NINGÚN permiso de bloque lanza ErrorPermiso (deny-by-default)', async () => {
    await expect(resumenOperativo(sesion([]), bd(), AHORA)).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
