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

import {
  aporteCargoAlSaldo,
  cuentaAlSaldoPlano,
  WHERE_VIVO_ABONO,
  WHERE_VIVO_DESCUENTO,
  WHERE_VIVO_PAGO,
  whereSegmentoFactura,
  type SegmentoFactura,
  type WhereSegmentoFactura,
} from '../esma/formula-saldo.js';
import { etiquetaProcesoDelCargo } from '../esma/etiqueta-cargo.js';
import { esSinFactura, importeGuardadoDe } from '../finanzas/correccion-comun.js';
import { calcularSaldoMaquilero, type SaldoMaquileroCalculado } from '../esma/saldos.js';
import { saldosEsMaPorMaquilero, type AporteEsMaLote } from '../esma/saldos-todos.js';

export type { AporteEsMaLote };

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
 * Cláusula `where` del SEGMENTO de facturación sobre los movimientos EsMa — pedida a la definición
 * ÚNICA (`formula-saldo.ts` §segmento).
 *
 * ⭐ Este archivo TENÍA la respuesta correcta (`false` **o** sin definir) y `esma/estado-cuenta.ts`
 * y `esma/saldos.ts` tenían la otra (`= false`). El comentario de aquí llamaba a esa diferencia
 * «deliberada» —allá un filtro de consulta, aquí una partición—, y no lo era: los dos segmentos son
 * SIEMPRE una partición, porque Daniel arma DOS relaciones de pago por semana (§Post-F9.189(a)) y
 * un movimiento que no cae en ninguna no se paga nunca. La fila 0.113 lo unificó: gana ésta.
 */
function facturaWhere(segmento: 'todos' | 'con' | 'sin'): WhereSegmentoFactura {
  return whereSegmentoFactura(segmento === 'todos' ? undefined : segmento);
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
 * (misma fórmula de F6 → no-regresión). Devuelve un Map idProveedor→{saldo, pendiente}: el saldo EsMa
 * (sólo lo REVISADO) y lo capturado que aún espera revisión; entra quien tenga saldo ≠ 0 **o** algo
 * pendiente (§Post-F9.188a: el maquilero con todo sin revisar no desaparece de la bandeja). Vista
 * operativa. El saldo es lo que la bandeja muestra como cubeta "Maquila" (sin antigüedad: los cargos
 * EsMa no traen fecha de vencimiento por ítem — el aging fino llega cuando EsMa registre por el motor).
 */
export async function aportesEsMaSaldoLote(
  cliente: Tx | PrismaClient,
  idEmpresa: number,
  segmento?: SegmentoFactura,
): Promise<Map<number, AporteEsMaLote>> {
  return saldosEsMaPorMaquilero(cliente, idEmpresa, segmento);
}

/** Opciones de la proyección del detalle EsMa. */
export interface OpcionesProyeccionEsMa {
  desde?: string | undefined;
  hasta?: string | undefined;
  /** Segmento de facturación: `todos` | `con` (conFactura = true) | `sin` (false o sin definir). */
  segmento: 'todos' | 'con' | 'sin';
  /** Si false, los `monto` viajan en null (se ocultan importes). */
  puedeVerImportes: boolean;
  /**
   * ⭐ Fila 0.145 — la BANDERA de quien pregunta (`Usuario.puedeCorregirSinFactura`). Decide el
   * `corregible` de cada renglón proyectado: sin ella, todos viajan en `false` y la pantalla no
   * pinta el botón. Es la MISMA regla que el servidor exige al corregir, para que nunca se ofrezca
   * un botón que después se rechaza.
   */
  puedeCorregir: boolean;
}

/**
 * Proyecta los movimientos EsMa de un proveedor a renglones del estado de cuenta unificado (fuente
 * "esma"). El `monto` de cada renglón es su aporte al saldo (cargo +, abono +, pago −, descuento −),
 * de modo que su Σ = el aporte EsMa del saldo. Los cargos `propuesto` (aún sin importe real) salen
 * con `monto = null`; los `sinCosto`, en 0. Filtra los cargos `cancelado`.
 *
 * ⭐ Un abono/pago/descuento CAPTURADO sin revisar tampoco aporta al saldo (criterio único de
 * `esma/formula-saldo.ts`), así que su `monto` va en null —igual que un cargo `propuesto`— para que
 * la promesa de arriba (Σ renglones = saldo) siga siendo cierta. Para que ese "—" no parezca un
 * error, el renglón lo DICE en sus observaciones: el dinero no se esconde, se explica.
 */
export async function proyectarMovimientosEsMa(
  cliente: Tx | PrismaClient,
  idEmpresa: number,
  idProveedor: number,
  nombre: string,
  opciones: OpcionesProyeccionEsMa,
): Promise<MovimientoTerceroSalida[]> {
  const { desde, hasta, segmento, puedeVerImportes, puedeCorregir } = opciones;
  const factura = facturaWhere(segmento);
  const oculto = (v: number): number | null => (puedeVerImportes ? redondear2(v) : null);
  /** Texto del renglón, avisando cuando está capturado y todavía no cuenta al saldo. */
  const conNota = (texto: string | null, cuenta: boolean): string | null =>
    cuenta ? texto : `${texto ?? ''} (pendiente de revisión)`.trim();

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
        // 0.114: el cargo puede colgar de un proceso de maquila O de un servicio de la orden
        // (corte/empaque). Se traen los dos y la etiqueta la redacta `etiquetaProcesoDelCargo`.
        servicio: true,
        tipoProceso: { select: { nombre: true } },
      },
    }),
    cliente.abonoMaquilero.findMany({
      // VIVOS (fila 0.145): un abono sustituido por una corrección no es movimiento.
      where: {
        idEmpresa,
        idMaquilero: idProveedor,
        ...WHERE_VIVO_ABONO,
        ...factura,
        ...rangoFecha(desde, hasta),
      },
      select: {
        id: true,
        monto: true,
        fecha: true,
        conFactura: true,
        observaciones: true,
        estadoRevision: true,
        creadoEn: true,
        creadoPorId: true,
      },
    }),
    cliente.descuentoMaquilero.findMany({
      // VIVOS (V1, fila 0.109): un descuento cancelado por un deshacer de cierre no es movimiento.
      where: {
        idEmpresa,
        idMaquilero: idProveedor,
        ...WHERE_VIVO_DESCUENTO,
        ...factura,
        ...rangoFecha(desde, hasta),
      },
      select: {
        id: true,
        monto: true,
        fecha: true,
        conFactura: true,
        observaciones: true,
        estadoRevision: true,
        creadoEn: true,
        creadoPorId: true,
        // Fila 0.145: el descuento que PROPUSO un cierre de orden no se corrige suelto (su dueño es
        // el cierre, que puede deshacerse). Se trae para poder decirlo en el renglón.
        idCierreMaquila: true,
      },
    }),
    cliente.pagoMaquilero.findMany({
      // VIVOS (fila 0.145): ver la nota del abono.
      where: {
        idEmpresa,
        idMaquilero: idProveedor,
        ...WHERE_VIVO_PAGO,
        ...factura,
        ...rangoFecha(desde, hasta),
      },
      select: {
        id: true,
        monto: true,
        fecha: true,
        conFactura: true,
        observaciones: true,
        estadoRevision: true,
        creadoEn: true,
        creadoPorId: true,
        // Fila 0.145: un pago APLICADO a cargos no cambia de importe (sale de las prendas por el
        // precio del cargo). El conteo basta para decirlo, sin traerse el detalle.
        _count: { select: { aplicaciones: true } },
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
    idMovimientoCorregido: null,
    // Fila 0.145: por defecto NADA de EsMa es corregible; cada concepto lo levanta si aplica, y con
    // él el texto CRUDO de sus observaciones (el de `observaciones` lleva adornos de lectura).
    observacionesGuardadas: null,
    importeGuardado: null,
    corregible: false,
    importeCorregible: false,
  });

  const filas: MovimientoTerceroSalida[] = [];

  for (const c of cargos) {
    const importeReal =
      c.cantidadReal === null || c.precioReal === null
        ? null
        : c.cantidadReal.toNumber() * c.precioReal.toNumber();
    // Signo + (cargo): validado con costo → importe real; sin costo → 0; propuesto → sin importe.
    // El criterio es el de la suma (formula-saldo.ts), no una copia local.
    const aporte = aporteCargoAlSaldo(c, importeReal);
    const monto = aporte === null ? null : oculto(aporte);
    filas.push({
      ...base(c.id, c.conFactura),
      origen: 'recibo_maquila',
      monto,
      observaciones:
        c.observaciones ??
        `Orden #${String(Number(c.orden.folio))} · ${etiquetaProcesoDelCargo(c)}${c.sinCosto ? ' (sin costo)' : ''}`,
      fecha: c.creadoEn.toISOString().slice(0, 10),
      creadoEn: c.creadoEn.toISOString(),
      creadoPorId: c.creadoPorId,
    });
  }

  for (const a of abonos) {
    // Signo + (abono EsMa = cargo extra al maquilero, convención F6). Sin revisar: no aporta.
    const cuentaA = cuentaAlSaldoPlano(a.estadoRevision);
    // Fila 0.145: un abono vivo y sin factura se corrige entero (importe incluido).
    const corrigeA = puedeCorregir && esSinFactura(a.conFactura);
    filas.push({
      ...base(a.id, a.conFactura),
      corregible: corrigeA,
      importeCorregible: corrigeA,
      observacionesGuardadas: a.observaciones,
      // ⭐ El importe GUARDADO. Lo normaliza `importeGuardadoDe` (positivo + oculto sólo por
      // permiso): la regla NO se escribe aquí, porque cuando estaba en cada sitio el motor la
      // cumplía y estas seis ramas no. A diferencia de `monto`, no se vacía por estar sin revisar
      // —que es, por definición, el caso de lo capturado por error—.
      importeGuardado: importeGuardadoDe(a.monto.toNumber(), puedeVerImportes),
      origen: 'abono',
      monto: cuentaA ? oculto(a.monto.toNumber()) : null,
      observaciones: conNota(a.observaciones, cuentaA),
      fecha: a.fecha.toISOString().slice(0, 10),
      creadoEn: a.creadoEn.toISOString(),
      creadoPorId: a.creadoPorId,
    });
  }

  for (const d of descuentos) {
    // Signo − (descuento resta). Sin revisar: no aporta.
    const cuentaD = cuentaAlSaldoPlano(d.estadoRevision);
    // Fila 0.145: el descuento que nació del CIERRE de una orden es del cierre (su liga es única y
    // el sustituto no podría heredarla): se arregla deshaciendo el cierre, no corrigiendo aquí.
    const corrigeD = puedeCorregir && esSinFactura(d.conFactura) && d.idCierreMaquila === null;
    filas.push({
      ...base(d.id, d.conFactura),
      corregible: corrigeD,
      importeCorregible: corrigeD,
      observacionesGuardadas: d.observaciones,
      // ⭐ El importe GUARDADO. Lo normaliza `importeGuardadoDe` (positivo + oculto sólo por
      // permiso): la regla NO se escribe aquí, porque cuando estaba en cada sitio el motor la
      // cumplía y estas seis ramas no. A diferencia de `monto`, no se vacía por estar sin revisar
      // —que es, por definición, el caso de lo capturado por error—.
      importeGuardado: importeGuardadoDe(d.monto.toNumber(), puedeVerImportes),
      origen: 'descuento',
      monto: cuentaD ? oculto(-d.monto.toNumber()) : null,
      observaciones: conNota(d.observaciones, cuentaD),
      fecha: d.fecha.toISOString().slice(0, 10),
      creadoEn: d.creadoEn.toISOString(),
      creadoPorId: d.creadoPorId,
    });
  }

  for (const p of pagos) {
    // Signo − (pago resta). Sin revisar: no aporta.
    const cuentaP = cuentaAlSaldoPlano(p.estadoRevision);
    // Fila 0.145: el pago se corrige; su IMPORTE, sólo si no está aplicado a cargos.
    const corrigeP = puedeCorregir && esSinFactura(p.conFactura);
    filas.push({
      ...base(p.id, p.conFactura),
      corregible: corrigeP,
      importeCorregible: corrigeP && p._count.aplicaciones === 0,
      observacionesGuardadas: p.observaciones,
      // ⭐ El importe GUARDADO. Lo normaliza `importeGuardadoDe` (positivo + oculto sólo por
      // permiso): la regla NO se escribe aquí, porque cuando estaba en cada sitio el motor la
      // cumplía y estas seis ramas no. A diferencia de `monto`, no se vacía por estar sin revisar
      // —que es, por definición, el caso de lo capturado por error—.
      importeGuardado: importeGuardadoDe(p.monto.toNumber(), puedeVerImportes),
      origen: 'pago',
      monto: cuentaP ? oculto(-p.monto.toNumber()) : null,
      observaciones: conNota(p.observaciones, cuentaP),
      fecha: p.fecha.toISOString().slice(0, 10),
      creadoEn: p.creadoEn.toISOString(),
      creadoPorId: p.creadoPorId,
    });
  }

  return filas;
}
