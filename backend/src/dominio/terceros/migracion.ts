/**
 * MODO MIGRACIÓN del motor de cuenta corriente de terceros (F9-E6; D15c; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §1 — apagar SINUBE). Inserta los SALDOS
 * INICIALES de CxC/CxP (el "punto de partida" que hoy vive en SINUBE) como movimientos de APERTURA,
 * en LOTE y respetando las mismas invariantes que el alta normal (`cuenta-terceros.ts`).
 *
 * Por qué un modo aparte y no `registrarMovimientoTercero` fila por fila: el histórico son MILES de
 * facturas pendientes; abrir una transacción + pedir un folio + una bitácora POR movimiento sería
 * lento (regla dura de Gabriel: el ETL escribe por LOTES, nunca 1×1). Aquí, por cada bloque de un
 * tercero: se reserva un BLOQUE de folios en UNA sentencia atómica (A3, `reservarBloqueFolios`), se
 * insertan los movimientos con `createManyAndReturn` (un solo INSERT) y se registra su idempotencia
 * (`MapeoMigracion`) en la MISMA transacción (A2) — o entran todos, o ninguno.
 *
 * Qué se REUSA del motor (A1, un solo lugar de verdad): el SIGNO por origen (`signoDeOrigen`) y la
 * fecha de VENCIMIENTO del aging (`calcularVencimiento`, exportada de `cuenta-terceros.ts`). El ETL
 * NO recalcula ninguna de las dos. La convención de saldo (`saldo = Σ monto`, D3) queda intacta: cada
 * apertura es un movimiento más, jamás una columna de saldo editable.
 *
 * Idempotencia ATÓMICA: el movimiento y su renglón de `MapeoMigracion` (clave natural =
 * `claveFuente`: folio de origen, UUID del CFDI, o `neto:<tipo>:<id>`) se crean en la misma tx. Una
 * re-corrida NO duplica porque el LOADER filtra por `MapeoMigracion` ANTES de llamar; si aun así
 * llegara un duplicado, el `skipDuplicates` del mapeo + la unique global del `uuidCfdi` lo frenan.
 *
 * Sigue A2 (transacción), A3 (folio por secuencia atómica, en bloque), A7 (bitácora, origen ETL),
 * A9 (idEmpresa explícito). NO pasa por Zod: es data de MIGRACIÓN ya saneada por el loader (el
 * servicio normal `registrarMovimientoTercero` sí valida con Zod, para la captura interactiva).
 */
import { type OrigenMovimientoTercero, type Prisma, type TipoTercero } from '../../datos/index.js';

import { datosCreacion, registrarBitacora } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { reservarBloqueFolios } from '../../comun/secuencias.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

import { signoDeOrigen } from './origen-tercero.js';
import { CLAVE_SECUENCIA_TERCERO, calcularVencimiento } from './cuenta-terceros.js';

/** El tercero (ya resuelto por el loader) al que pertenece el bloque de aperturas. */
export interface TerceroApertura {
  tipoTercero: TipoTercero;
  /** Id del Cliente o Proveedor (según `tipoTercero`). */
  idTercero: number;
  /**
   * Días de crédito del tercero (R15/D15d): base del vencimiento del aging. El loader lo resuelve
   * para LOS DOS por igual —`Cliente.diasCredito` y `Proveedor.diasCredito`—; `null` (nunca
   * capturado) = **contado, 0 días**.
   */
  diasCredito: number;
}

/** Un movimiento de APERTURA a insertar (ya saneado; el importe llega POSITIVO, el signo lo pone el origen). */
export interface AperturaMigrada {
  /** Origen del movimiento: fija su dirección contable (`signoDeOrigen`). */
  origen: OrigenMovimientoTercero;
  /** Fecha real del documento (la factura pendiente conserva SU fecha → el aging cuenta desde el día 1). */
  fecha: Date;
  /** Importe POSITIVO del documento; el motor le pone el signo por el origen. Debe ser > 0. */
  importe: number;
  /** ¿Es fiscal (con CFDI)? Los renglones con UUID nacen fiscales; los de saldo neto, no. */
  esFiscal: boolean;
  /** UUID del CFDI (si fiscal). Único global — evita re-importar el mismo comprobante. */
  uuidCfdi?: string | null;
  /** RFC del tercero del CFDI (si fiscal). */
  rfcTercero?: string | null;
  observaciones?: string | null;
  /** Referencia polimórfica a la operación real (si el corte la trae). */
  refTipo?: string | null;
  refId?: number | null;
  /** Clave natural de idempotencia (folio de origen · UUID · `neto:<tipo>:<id>`). Va a `MapeoMigracion`. */
  claveFuente: string;
}

/** Resultado de insertar un bloque de aperturas. */
export interface ResultadoAperturasMigradas {
  /** # de movimientos insertados en este bloque. */
  creados: number;
  /** Primer y último folio del bloque reservado (para el reporte). */
  folioDesde: bigint;
  folioHasta: bigint;
}

/** Redondeo monetario a 2 decimales (mismo criterio que el motor). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Los dos campos scalar del tercero según el tipo (D15a: exactamente uno poblado). */
function camposTercero(
  tipoTercero: TipoTercero,
  idTercero: number,
): { idCliente: number | null; idProveedor: number | null } {
  return tipoTercero === 'cliente'
    ? { idCliente: idTercero, idProveedor: null }
    : { idCliente: null, idProveedor: idTercero };
}

/**
 * Inserta un BLOQUE de movimientos de apertura de UN tercero de UNA empresa, en una transacción (A2):
 * reserva el bloque de folios (A3), hace un `createManyAndReturn`, escribe el `MapeoMigracion` de cada
 * uno (idempotencia atómica) y una bitácora resumen del bloque (A7). El signo del `monto` lo pone el
 * origen (`signoDeOrigen`, A1) y el vencimiento la fórmula del motor (`calcularVencimiento`, A1).
 *
 * Precondiciones (las garantiza el loader): `entradas` NO vacío, cada `importe > 0`, y ninguna
 * `claveFuente` ya existe en `MapeoMigracion` (el loader las filtró) — aquí solo llegan filas nuevas.
 *
 * @param entidadMapeo entidad de `MapeoMigracion` bajo la que se registran (p. ej. `'AperturaTercero'`).
 */
export async function insertarAperturasMigradas(
  sesion: SesionUsuario,
  idEmpresa: number,
  tercero: TerceroApertura,
  entidadMapeo: string,
  entradas: AperturaMigrada[],
  bd?: ContextoBd,
): Promise<ResultadoAperturasMigradas> {
  if (entradas.length === 0) {
    return { creados: 0, folioDesde: 0n, folioHasta: 0n };
  }

  return enTransaccion(async (tx) => {
    // 1) Reserva el bloque de folios de golpe (A3, una sentencia atómica). Los folios son
    //    [folioDesde … folioHasta]; se asignan en el MISMO orden que `entradas`.
    const n = entradas.length;
    const folioHasta = await reservarBloqueFolios(tx, idEmpresa, CLAVE_SECUENCIA_TERCERO, n);
    const folioDesde = folioHasta - BigInt(n) + 1n;

    const auditoria = datosCreacion(sesion);
    const { idCliente, idProveedor } = camposTercero(tercero.tipoTercero, tercero.idTercero);

    // 2) Arma las filas con su folio pre-asignado, el signo por origen y el vencimiento derivado.
    const data: Prisma.MovimientoTerceroCreateManyInput[] = entradas.map((e, i) => {
      const folio = folioDesde + BigInt(i);
      const monto = redondear2(signoDeOrigen(e.origen) * e.importe);
      const fechaVencimiento = calcularVencimiento(e.origen, e.fecha, tercero.diasCredito);
      return {
        idEmpresa,
        folio,
        tipoTercero: tercero.tipoTercero,
        idCliente,
        idProveedor,
        fecha: e.fecha,
        origen: e.origen,
        monto,
        fechaVencimiento,
        esFiscal: e.esFiscal,
        ...(e.uuidCfdi == null ? {} : { uuidCfdi: e.uuidCfdi }),
        ...(e.rfcTercero == null ? {} : { rfcTercero: e.rfcTercero }),
        ...(e.refTipo == null ? {} : { refTipo: e.refTipo }),
        ...(e.refId == null ? {} : { refId: e.refId }),
        ...(e.observaciones == null ? {} : { observaciones: e.observaciones }),
        ...auditoria,
      };
    });

    // 3) Un solo INSERT que devuelve las filas creadas (con su id + folio) para amarrar el mapeo.
    const creados = await tx.movimientoTercero.createManyAndReturn({
      data,
      select: { id: true, folio: true },
    });

    // 4) Idempotencia: registra cada movimiento en `MapeoMigracion` por su `claveFuente`, en la MISMA
    //    tx. Se correlaciona por FOLIO (no por el orden del retorno) para no depender de que
    //    `createManyAndReturn` preserve el orden — a prueba de futuros cambios del conector.
    const clavePorFolio = new Map<string, string>();
    for (let i = 0; i < entradas.length; i += 1) {
      clavePorFolio.set((folioDesde + BigInt(i)).toString(), entradas[i]!.claveFuente);
    }
    const mapeos = creados.map((m) => ({
      entidad: entidadMapeo,
      claveVieja: clavePorFolio.get(m.folio.toString()) ?? '',
      idNuevo: String(m.id),
    }));
    await tx.mapeoMigracion.createMany({ data: mapeos, skipDuplicates: true });

    // 5) Bitácora RESUMEN del bloque (A7). Una por bloque a propósito: es una carga masiva de
    //    migración (cada movimiento ya queda marcado con `creadoPorId = etl-sistema`); una bitácora
    //    por fila anularía el batch. Deja el rango de folios y el conteo para auditar el lote.
    await registrarBitacora(tx, sesion, {
      entidad: 'MovimientoTercero',
      idEntidad: creados[0]?.id ?? 0,
      accion: 'CREAR',
      datos: {
        operacion: 'migracion-apertura',
        tipoTercero: tercero.tipoTercero,
        idTercero: tercero.idTercero,
        idEmpresa,
        movimientos: creados.length,
        folioDesde: folioDesde.toString(),
        folioHasta: folioHasta.toString(),
      },
    });

    return { creados: creados.length, folioDesde, folioHasta };
  }, bd);
}
