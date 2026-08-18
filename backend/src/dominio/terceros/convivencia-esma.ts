/**
 * CONVIVENCIA con EsMa (F9-E1, opción (b) — compatibilidad de LECTURA; D12/D15). El motor de
 * terceros NO migra datos de EsMa: los re-expresa por LECTURA. Un proveedor que maquila tiene UNA
 * sola cuenta (D15a), así que su estado de cuenta y su saldo, vistos desde el motor, INCLUYEN sus
 * movimientos EsMa (F6) sin tocarlos.
 *
 *  • SALDO: reusa `calcularSaldoMaquilero` (F6) TAL CUAL → el aporte EsMa se calcula con la MISMA
 *    fórmula de siempre. Esa reutilización es la GARANTÍA de la no-regresión (los 319 saldos del ETL,
 *    incl. los descuadrados, dan idéntico que antes de E1).
 *  • DETALLE: proyecta los renglones EsMa (cargo/abono/descuento/pago) a la forma de un renglón del
 *    motor, con `fuente = "esma"` y el `monto` YA CON SIGNO como su aporte al saldo (misma convención
 *    de `dominio/esma/estado-cuenta.ts`: cargo +, abono +, pago −, descuento −). Así Σ(monto de TODOS
 *    los renglones, motor + EsMa) = el saldo del tercero. La vista fiscal filtra a `conFactura = true`.
 *
 * OJO — signos: EsMa usa su propia convención (ahí `abono` es un cargo EXTRA al maquilero, +),
 * distinta del motor nuevo (donde `abono` resta). NO se mezclan: cada renglón viaja en su `fuente` y
 * su `monto` refleja su aporte real al saldo. Las columnas fiscales/de referencia del motor quedan en
 * null para EsMa (su CFDI se concilia en E3 sobre el propio cargo, sin salir de EsMa).
 */
import type { MovimientoTerceroSalida } from '../../contrato/index.js';
import { type Tx } from '../../comun/transaccion.js';
import type { PrismaClient } from '../../datos/index.js';

import { calcularSaldoMaquilero, type SaldoMaquileroCalculado } from '../esma/saldos.js';
import { saldosEsMaPorMaquilero } from '../esma/saldos-todos.js';

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Rango sobre una columna `@db.Date` (fecha del movimiento), inclusivo en ambos extremos. */
function rangoFecha(
  desde: string | undefined,
  hasta: string | undefined,
): { fecha?: { gte?: Date; lte?: Date } } {
  if (desde === undefined && hasta === undefined) {
    return {};
  }
  return {
    fecha: {
      ...(desde === undefined ? {} : { gte: aDateColumna(desde) }),
      ...(hasta === undefined ? {} : { lte: aDateColumna(hasta) }),
    },
  };
}

/** Rango sobre `creadoEn` (datetime): [desde 00:00, hasta+1día) para incluir todo el día `hasta`. */
function rangoCreado(
  desde: string | undefined,
  hasta: string | undefined,
): { creadoEn?: { gte?: Date; lt?: Date } } {
  if (desde === undefined && hasta === undefined) {
    return {};
  }
  return {
    creadoEn: {
      ...(desde === undefined ? {} : { gte: aDateColumna(desde) }),
      ...(hasta === undefined ? {} : { lt: new Date(aDateColumna(hasta).getTime() + 86_400_000) }),
    },
  };
}

/**
 * Cláusula `where` del SEGMENTO de facturación sobre los movimientos EsMa (V1-E3f pieza B).
 *
 * ⚠️ `EsMaCargo.conFactura` es NULLABLE ("sin definir": así quedaron los movimientos que migraron
 * del Access, donde la pregunta jamás se hizo). El segmento `sin` filtra por **`not: true`** —o sea
 * los `false` **y** los sin definir— y NO por `= false`. Es a propósito, y es la única diferencia
 * con el filtro de la pantalla propia de EsMa (`esma/estado-cuenta.ts`, que sí usa `= false`):
 *
 *   aquí los dos segmentos tienen que ser una PARTICIÓN EXACTA del saldo, porque eso es justo lo
 *   que pidió Daniel (*"quisiera tener por separado los que son con factura y los sin factura"*).
 *   Con `= false`, los movimientos sin definir se caerían de los DOS lados y la suma de los
 *   segmentos no daría el saldo total — un hueco silencioso en un número de dinero.
 */
function facturaWhere(segmento: 'todos' | 'con' | 'sin'): { conFactura?: boolean | { not: true } } {
  if (segmento === 'todos') return {};
  return segmento === 'con' ? { conFactura: true } : { conFactura: { not: true } };
}

/**
 * APORTE de EsMa al saldo de un proveedor (reusa `calcularSaldoMaquilero`, F6 — no-regresión). Para
 * la vista operativa `soloFiscal = false` (todo); para la fiscal, `soloFiscal = true` (conFactura=con).
 */
export async function aporteEsMaSaldo(
  cliente: Tx | PrismaClient,
  idEmpresa: number,
  idProveedor: number,
  soloFiscal: boolean,
): Promise<number> {
  const desglose: SaldoMaquileroCalculado = await calcularSaldoMaquilero(
    cliente,
    idEmpresa,
    idProveedor,
    soloFiscal ? 'con' : undefined,
  );
  return desglose.saldo;
}

/**
 * APORTE EsMa al saldo de CADA proveedor con movimientos EsMa, en UN agregado (NUNCA N+1) — la versión
 * EN LOTE de {@link aporteEsMaSaldo}, para la BANDEJA de CxP (F9-E2). Reusa {@link saldosEsMaPorMaquilero}
 * (misma fórmula de F6 → no-regresión). Devuelve un Map idProveedor→saldo EsMa (solo ≠ 0), vista
 * operativa. Es el aporte que la bandeja muestra como cubeta "Maquila" (sin antigüedad: los cargos EsMa
 * no traen fecha de vencimiento por ítem — el aging fino llega cuando EsMa registre por el motor).
 */
export async function aportesEsMaSaldoLote(
  cliente: Tx | PrismaClient,
  idEmpresa: number,
): Promise<Map<number, number>> {
  return saldosEsMaPorMaquilero(cliente, idEmpresa);
}

/** Opciones de la proyección del detalle EsMa. */
export interface OpcionesProyeccionEsMa {
  desde?: string | undefined;
  hasta?: string | undefined;
  /** Segmento de facturación: `todos` | `con` (conFactura = true) | `sin` (false o sin definir). */
  segmento: 'todos' | 'con' | 'sin';
  /** Si false, los `monto` viajan en null (se ocultan importes). */
  puedeVerImportes: boolean;
}

/**
 * Proyecta los movimientos EsMa de un proveedor a renglones del estado de cuenta unificado (fuente
 * "esma"). El `monto` de cada renglón es su aporte al saldo (cargo +, abono +, pago −, descuento −),
 * de modo que su Σ = el aporte EsMa del saldo. Los cargos `propuesto` (aún sin importe real) salen
 * con `monto = null`; los `sinCosto`, en 0. Filtra los cargos `cancelado`.
 */
export async function proyectarMovimientosEsMa(
  cliente: Tx | PrismaClient,
  idEmpresa: number,
  idProveedor: number,
  nombre: string,
  opciones: OpcionesProyeccionEsMa,
): Promise<MovimientoTerceroSalida[]> {
  const { desde, hasta, segmento, puedeVerImportes } = opciones;
  const factura = facturaWhere(segmento);
  const oculto = (v: number): number | null => (puedeVerImportes ? redondear2(v) : null);

  const [cargos, abonos, descuentos, pagos] = await Promise.all([
    cliente.esMaCargo.findMany({
      where: {
        idEmpresa,
        idMaquilero: idProveedor,
        estado: { not: 'cancelado' },
        ...factura,
        ...rangoCreado(desde, hasta),
      },
      select: {
        id: true,
        estado: true,
        sinCosto: true,
        cantidadReal: true,
        precioReal: true,
        conFactura: true,
        observaciones: true,
        creadoEn: true,
        creadoPorId: true,
        orden: { select: { folio: true } },
        tipoProceso: { select: { nombre: true } },
      },
    }),
    cliente.abonoMaquilero.findMany({
      where: { idEmpresa, idMaquilero: idProveedor, ...factura, ...rangoFecha(desde, hasta) },
      select: {
        id: true,
        monto: true,
        fecha: true,
        conFactura: true,
        observaciones: true,
        creadoEn: true,
        creadoPorId: true,
      },
    }),
    cliente.descuentoMaquilero.findMany({
      where: { idEmpresa, idMaquilero: idProveedor, ...factura, ...rangoFecha(desde, hasta) },
      select: {
        id: true,
        monto: true,
        fecha: true,
        conFactura: true,
        observaciones: true,
        creadoEn: true,
        creadoPorId: true,
      },
    }),
    cliente.pagoMaquilero.findMany({
      where: { idEmpresa, idMaquilero: idProveedor, ...factura, ...rangoFecha(desde, hasta) },
      select: {
        id: true,
        monto: true,
        fecha: true,
        conFactura: true,
        observaciones: true,
        creadoEn: true,
        creadoPorId: true,
      },
    }),
  ]);

  const base = (id: number, conFactura: boolean | null) => ({
    fuente: 'esma' as const,
    id,
    idEmpresa,
    folio: null,
    tipoTercero: 'proveedor' as const,
    idTercero: idProveedor,
    tercero: nombre,
    fechaVencimiento: null,
    esFiscal: conFactura === true,
    uuidCfdi: null,
    rfcTercero: null,
    idArchivoCfdi: null,
    refTipo: 'esma' as const,
    refId: id,
    cancelado: false,
    esInverso: false,
  });

  const filas: MovimientoTerceroSalida[] = [];

  for (const c of cargos) {
    const importeReal =
      c.cantidadReal === null || c.precioReal === null
        ? null
        : c.cantidadReal.toNumber() * c.precioReal.toNumber();
    // Signo + (cargo): validado con costo → importe real; sin costo → 0; propuesto → sin importe.
    const monto =
      c.estado !== 'validado'
        ? null
        : c.sinCosto
          ? oculto(0)
          : importeReal === null
            ? null
            : oculto(importeReal);
    filas.push({
      ...base(c.id, c.conFactura),
      origen: 'recibo_maquila',
      monto,
      observaciones:
        c.observaciones ??
        `Orden #${String(Number(c.orden.folio))} · ${c.tipoProceso.nombre}${c.sinCosto ? ' (sin costo)' : ''}`,
      fecha: c.creadoEn.toISOString().slice(0, 10),
      creadoEn: c.creadoEn.toISOString(),
      creadoPorId: c.creadoPorId,
    });
  }

  for (const a of abonos) {
    // Signo + (abono EsMa = cargo extra al maquilero, convención F6).
    filas.push({
      ...base(a.id, a.conFactura),
      origen: 'abono',
      monto: oculto(a.monto.toNumber()),
      observaciones: a.observaciones,
      fecha: a.fecha.toISOString().slice(0, 10),
      creadoEn: a.creadoEn.toISOString(),
      creadoPorId: a.creadoPorId,
    });
  }

  for (const d of descuentos) {
    // Signo − (descuento resta).
    filas.push({
      ...base(d.id, d.conFactura),
      origen: 'descuento',
      monto: oculto(-d.monto.toNumber()),
      observaciones: d.observaciones,
      fecha: d.fecha.toISOString().slice(0, 10),
      creadoEn: d.creadoEn.toISOString(),
      creadoPorId: d.creadoPorId,
    });
  }

  for (const p of pagos) {
    // Signo − (pago resta).
    filas.push({
      ...base(p.id, p.conFactura),
      origen: 'pago',
      monto: oculto(-p.monto.toNumber()),
      observaciones: p.observaciones,
      fecha: p.fecha.toISOString().slice(0, 10),
      creadoEn: p.creadoEn.toISOString(),
      creadoPorId: p.creadoPorId,
    });
  }

  return filas;
}
