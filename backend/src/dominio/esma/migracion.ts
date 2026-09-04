/**
 * MODO MIGRACIÓN de los CARGOS EsMa (F3-E6) — capa de dominio (A1).
 *
 * El servicio normal (`cargos.ts`) deriva el cargo de un RECIBO: nace `propuesto` (cantidad = piezas
 * del recibo, precio = precioPactado del recibo) y el admin lo `validado` fijando cantidad/precio
 * REALES. El histórico, en cambio, ya viene VALIDADO en el viejo (`EsMa_Recibos`: cada renglón trae
 * `CantRecEsMa` + `PrecioEsMa` reales, que el maquilero y la empresa ya conciliaron). Por eso el
 * cargo migrado nace con un estado y sus reales EXPLÍCITOS, SIN pasar por la cola de validación de v2.
 *
 * ⭐ Liga al recibo: en v2 el cargo nace de un recibo (`idEtapaRecibo`). En el histórico esa liga
 * formal NO existe (el viejo llevaba EsMa por su cuenta; el no-cuadre conocido —12,440 recibos vs
 * 7,401 cargos— lo confirma: NO hay 1:1). Por eso el cargo migrado lleva `idEtapaRecibo = NULL` (el
 * schema lo permite a propósito para el histórico). Se liga a ORDEN + MAQUILERO + PROCESO, que es lo
 * que el viejo sí tenía. La liga formal recibo↔cargo nace en v2 (F3-E4).
 *
 * Sigue siendo: A2 (transacción), A7 (bitácora, origen ETL), A9 (idEmpresa explícito — derivado de
 * la orden por el loader). NO toca kardex (D3 no aplica: el cargo es CxP de maquila). Idempotencia:
 * el loader resuelve "ya existe" por el `MapeoMigracion` de `IdEsMa_Recibos` ANTES de llamar.
 */
import type { EstadoCargoEsMa, EstadoRevisionEsMa } from '../../datos/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

/** Un cargo EsMa histórico a migrar (snapshot del viejo `EsMa` + `EsMa_Recibos`). */
export interface CargoEsMaMigrado {
  idEmpresa: number;
  idMaquilero: number;
  idOrden: number;
  idTipoProceso: number;
  /** Cantidad real conciliada en el viejo (`CantRecEsMa`). NULL si el viejo no la trae. */
  cantidadReal?: number | null;
  /** Precio real conciliado en el viejo (`PrecioEsMa`). NULL si nace sin precio. */
  precioReal?: number | null;
  /** Estado derivado del dato viejo (validado por defecto; revisión pendiente queda `propuesto`). */
  estado: EstadoCargoEsMa;
  observaciones?: string | null;
  /** Fecha original del cargo (`EsMa.FechaEsMa`); si `validado`, sella `validadoEn`. */
  fecha?: Date | null;
}

/** Resultado de migrar un cargo EsMa. */
export interface ResultadoCargoEsMaMigrado {
  idCargo: number;
}

/**
 * Crea un cargo EsMa HISTÓRICO (ligado a orden + maquilero + proceso, SIN `idEtapaRecibo`), en UNA
 * transacción (A2/A7). Estado + reales EXPLÍCITOS del viejo (no pasa por la cola de validación). Si
 * el estado es `validado`, sella `validadoEn` con la fecha original (`validadoPorId` = usuario ETL).
 */
export async function crearCargoEsMaMigrado(
  sesion: SesionUsuario,
  entrada: CargoEsMaMigrado,
  bd?: ContextoBd,
): Promise<ResultadoCargoEsMaMigrado> {
  return enTransaccion(async (tx) => {
    const validado = entrada.estado === 'validado';
    const cargo = await tx.esMaCargo.create({
      data: {
        idEmpresa: entrada.idEmpresa,
        // idEtapaRecibo NULL: la liga formal recibo↔cargo nace en v2 (histórico sin amarre 1:1).
        idMaquilero: entrada.idMaquilero,
        idOrden: entrada.idOrden,
        idTipoProceso: entrada.idTipoProceso,
        ...(entrada.cantidadReal == null ? {} : { cantidadReal: entrada.cantidadReal }),
        ...(entrada.precioReal == null ? {} : { precioReal: entrada.precioReal }),
        estado: entrada.estado,
        observaciones: entrada.observaciones ?? null,
        ...(validado && entrada.fecha != null ? { validadoEn: entrada.fecha } : {}),
        ...(validado ? { validadoPorId: sesion.id } : {}),
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EsMaCargo',
      idEntidad: cargo.id,
      accion: 'CREAR',
      datos: {
        operacion: 'migracion',
        idEmpresa: entrada.idEmpresa,
        idOrden: entrada.idOrden,
        idMaquilero: entrada.idMaquilero,
        idTipoProceso: entrada.idTipoProceso,
        estado: entrada.estado,
      },
    });

    return { idCargo: cargo.id };
  }, bd);
}

// ─────────────────────────────────────────────────────────────────────────────
// MODO MIGRACIÓN de los MOVIMIENTOS planos de EsMa (F6-E6): ABONO / DESCUENTO / PAGO histórico.
//
// El viejo llevaba estos tres conceptos en tablas hijas de la cabecera `EsMa` (`EsMa_Abonos`,
// `EsMa_Desc`, `EsMa_Pagos`), sin encabezado propio: el maquilero + la fecha viven en la cabecera.
// v2 los volvió PLANOS (F6-E4): cada movimiento trae su maquilero/fecha. El histórico se inserta
// aquí, SIN pasar por los servicios normales (`movimientos.ts`/`pagos.ts`) porque:
//   • los servicios normales validan con Zod (rechazarían montos negativos, que el viejo SÍ tiene:
//     los "saldo anterior" negativos) y resuelven `conFactura` de la modalidad del proveedor — el
//     viejo NUNCA tuvo el flag de factura, así que `conFactura = null` (sin definir);
//   • ⭐ los PAGOS: `pagos.ts::crearPagoMaquilero` EXIGE `aplicaciones`, toma un
//     `pg_advisory_xact_lock` por maquilero y recalcula `Orden.pagada`. Los 5,935 pagos históricos
//     son LIBRES (el viejo nunca ligó pago↔cargo), así que se insertan SIN aplicaciones, SIN lock y
//     SIN recomputar `Orden.pagada` (el esquema permite un pago sin aplicaciones — E4 lo dejó a
//     propósito para este ETL). Ninguno dispara efectos derivados.
//
// Preservan la FECHA histórica (`EsMa.FechaEsMa`), el `estadoRevision` (asteriscos `Rev` del viejo:
// para pagos, `RevisionPendienteP`; abonos/descuentos no lo traían → `revisado`, ya conciliados) y
// `conFactura = null`. Siguen A2 (transacción) + A7 (bitácora, `operacion: 'migracion'`).
// Idempotencia: el loader resuelve "ya existe" por su `MapeoMigracion` ANTES de llamar.
// ─────────────────────────────────────────────────────────────────────────────

/** Un movimiento plano EsMa histórico (abono/descuento/pago) a migrar. */
export interface MovimientoEsMaMigrado {
  idEmpresa: number;
  idMaquilero: number;
  /** Importe del viejo (`AbonoEsMa`/`DescuentoEsMa`/`PagoEsMa`); nulos→0. Puede ser NEGATIVO (abonos
   * y descuentos de "saldo anterior"): se preserva tal cual para no alterar el saldo derivado. */
  monto: number;
  /** Fecha original del movimiento (`EsMa.FechaEsMa`). Obligatoria (la columna es `@db.Date`). */
  fecha: Date;
  /** Estado de revisión histórico (asteriscos `Rev` del viejo). */
  estadoRevision: EstadoRevisionEsMa;
  observaciones?: string | null;
}

/** Resultado de migrar un movimiento plano EsMa. */
export interface ResultadoMovimientoEsMaMigrado {
  id: number;
}

/** Datos comunes de un movimiento plano migrado (mismo shape para abono/descuento/pago). */
function datosMovimientoMigrado(
  sesion: SesionUsuario,
  entrada: MovimientoEsMaMigrado,
): {
  idEmpresa: number;
  idMaquilero: number;
  monto: number;
  fecha: Date;
  conFactura: null; // segmento: no particiona (es el TIPO del valor que se escribe, no un filtro)
  estadoRevision: EstadoRevisionEsMa;
  observaciones: string | null;
  creadoPorId: string;
  modificadoPorId: string;
} {
  return {
    idEmpresa: entrada.idEmpresa,
    idMaquilero: entrada.idMaquilero,
    monto: entrada.monto,
    fecha: entrada.fecha,
    // El viejo no tenía el flag de facturación: el movimiento migrado nace SIN definir (decisión h).
    // Esto ESCRIBE el «sin definir» — es el origen de los NULL que el segmento «sin factura» tiene
    // que incluir, no un filtro que los deje fuera.
    conFactura: null, // segmento: no particiona (escribe el valor, no filtra)
    estadoRevision: entrada.estadoRevision,
    observaciones: entrada.observaciones ?? null,
    creadoPorId: sesion.id,
    modificadoPorId: sesion.id,
  };
}

/** Crea un ABONO histórico (A2/A7), sin efectos derivados. */
export async function crearAbonoMigrado(
  sesion: SesionUsuario,
  entrada: MovimientoEsMaMigrado,
  bd?: ContextoBd,
): Promise<ResultadoMovimientoEsMaMigrado> {
  return enTransaccion(async (tx) => {
    const abono = await tx.abonoMaquilero.create({ data: datosMovimientoMigrado(sesion, entrada) });
    await registrarBitacora(tx, sesion, {
      entidad: 'AbonoMaquilero',
      idEntidad: abono.id,
      accion: 'CREAR',
      datos: {
        operacion: 'migracion',
        idEmpresa: entrada.idEmpresa,
        idMaquilero: entrada.idMaquilero,
        monto: entrada.monto,
      },
    });
    return { id: abono.id };
  }, bd);
}

/** Crea un DESCUENTO histórico (A2/A7), sin efectos derivados. */
export async function crearDescuentoMigrado(
  sesion: SesionUsuario,
  entrada: MovimientoEsMaMigrado,
  bd?: ContextoBd,
): Promise<ResultadoMovimientoEsMaMigrado> {
  return enTransaccion(async (tx) => {
    const desc = await tx.descuentoMaquilero.create({
      data: datosMovimientoMigrado(sesion, entrada),
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'DescuentoMaquilero',
      idEntidad: desc.id,
      accion: 'CREAR',
      datos: {
        operacion: 'migracion',
        idEmpresa: entrada.idEmpresa,
        idMaquilero: entrada.idMaquilero,
        monto: entrada.monto,
      },
    });
    return { id: desc.id };
  }, bd);
}

/**
 * Crea un PAGO histórico LIBRE (A2/A7): SIN `aplicaciones`, SIN lock por maquilero y SIN recomputar
 * `Orden.pagada` (el viejo nunca ligó pago↔cargo — ver TSDoc del bloque). No usar el servicio normal.
 */
export async function crearPagoMigrado(
  sesion: SesionUsuario,
  entrada: MovimientoEsMaMigrado,
  bd?: ContextoBd,
): Promise<ResultadoMovimientoEsMaMigrado> {
  return enTransaccion(async (tx) => {
    const pago = await tx.pagoMaquilero.create({ data: datosMovimientoMigrado(sesion, entrada) });
    await registrarBitacora(tx, sesion, {
      entidad: 'PagoMaquilero',
      idEntidad: pago.id,
      accion: 'CREAR',
      datos: {
        operacion: 'migracion',
        idEmpresa: entrada.idEmpresa,
        idMaquilero: entrada.idMaquilero,
        monto: entrada.monto,
      },
    });
    return { id: pago.id };
  }, bd);
}
