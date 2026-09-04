/**
 * ServicioCxP — CUENTAS POR PAGAR de proveedores (Módulo 14, F9-E2; D12/D15/R10; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §3.2/§3.4). CxP es un USO del MOTOR de
 * cuenta corriente de terceros (F9-E1): NO reimplementa el saldo ni la cancelación — COMPONE sobre
 * `dominio/terceros/cuenta-terceros.ts`. Toda la lógica de negocio de CxP vive aquí (A1); las rutas
 * delegan.
 *
 * COMPOSICIÓN (sin duplicar el motor):
 *  • Altas/cancelaciones → delegan a `registrarMovimientoTercero`/`cancelarMovimientoTercero` (mismo
 *    folio A3, mismo signo por origen, misma bitácora A7, misma transacción A2, mismo inverso D3).
 *  • Estado de cuenta → delega a `estadoDeCuentaTercero('proveedor', …)` (incluye la convivencia EsMa).
 *  • La ANTIGÜEDAD (aging) y el RESUMEN de la bandeja se calculan EN EL SERVIDOR (A1) con un agregado
 *    directo sobre `movimientos_tercero` + la pieza pura `aging.ts` (los límites viven en UN lugar).
 *
 * PERMISOS (A4, deny-by-default): CxP añade su propia capa `cxp.ver` (consultas) / `cxp.administrar`
 * (capturas/cancelaciones). Al delegar al motor se exige ADEMÁS `terceros.ver`/`.administrar` — es
 * DEFENSA EN PROFUNDIDAD, no un doble candado frágil: ambos permisos se reparten a los MISMOS roles en
 * el seed (Administración/Dirección administra; Directivo/Gerencial ve), así que ningún usuario válido
 * queda bloqueado y todo falla CERRADO. La vista `fiscal` exige, además, `terceros.fiscal` (motor).
 * Empresa activa (A9). Los importes se ocultan (null) sin `consultas.ver-importes`.
 */
import {
  esquemaMovimientoCxpCrear,
  esquemaBandejaCxpQuery,
  type DatosMovimientoCxpCrear,
  type BandejaCxpQuery,
  type BandejaCxpSalida,
  type BandejaCxpFila,
  type ResumenCxpSalida,
  type MovimientoTerceroSalida,
  type EstadoCuentaTerceroSalida,
  type DatosMovimientoTerceroCancelar,
} from '../../../contrato/index.js';
import type { z } from 'zod';

import { ErrorNoEncontrado } from '../../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../../comun/transaccion.js';
import { validarEntrada } from '../../../comun/validacion.js';
import { Prisma } from '../../../datos/index.js';

import {
  registrarMovimientoTercero,
  cancelarMovimientoTercero,
  estadoDeCuentaTercero,
} from '../cuenta-terceros.js';
import {
  armarPendiente,
  hayPendiente,
  pendienteParaSalida,
  tieneSaldo,
  type PendienteRevision,
  type SegmentoFactura,
} from '../../esma/formula-saldo.js';
import { aportesEsMaSaldoLote } from '../convivencia-esma.js';
import { leerLimitesAging } from '../config-aging.js';
import { type LimitesAging } from '../aging-comun.js';
import { netearCubetas, type CubetasAging, type CubetasBrutas } from './aging.js';
import { resolverSegmentoCxp, segmentoCartera } from './facturacion-cxp.js';

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Quita acentos y pasa a minúsculas para comparar (misma norma que el combobox del frontend). */
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Alta de un movimiento de CxP (por proveedor) ────────────────────────────────────────────────────

/**
 * Registra un movimiento de CxP para un PROVEEDOR (pago/abono/descuento/nota de crédito/entrada sin
 * factura). Fija `tipoTercero='proveedor'` y delega al motor (A2/A3/A7). Permiso `cxp.administrar` (+
 * `terceros.administrar` del motor, defensa en profundidad). Empresa activa (A9).
 *
 * V1-E3f pieza B (§Post-F9.57): el SEGMENTO con/sin factura ya no se acepta a ciegas — lo resuelve
 * {@link resolverSegmentoCxp} con la `modalidadFacturacion` del proveedor. Con `ambos` hay que
 * indicarlo (nadie más puede decidirlo); con `solo_con`/`solo_sin` la modalidad manda.
 */
export async function registrarMovimientoCxp(
  sesion: SesionUsuario,
  idProveedor: number,
  entrada: z.input<typeof esquemaMovimientoCxpCrear>,
  bd?: ContextoBd,
): Promise<MovimientoTerceroSalida> {
  verificarPermiso(sesion, 'cxp.administrar');
  const datos: DatosMovimientoCxpCrear = validarEntrada(esquemaMovimientoCxpCrear, entrada);

  // La modalidad se lee DENTRO de la misma transacción en la que se escribe el movimiento (A2): si
  // se leyera fuera, un cambio concurrente de la modalidad dejaría el movimiento marcado con una
  // regla que ya no está vigente. `enTransaccion` reusa la tx del llamador si la hay, y el motor la
  // reusa a su vez al recibir `{ tx }` — una sola transacción, no tres.
  return enTransaccion(async (tx) => {
    const proveedor = await tx.proveedor.findUnique({
      where: { id: idProveedor },
      select: { modalidadFacturacion: true },
    });
    // Si el proveedor no existe se deja pasar: el motor responde 404 con su mensaje (A9).
    const esFiscal = resolverSegmentoCxp(
      datos.origen,
      proveedor?.modalidadFacturacion ?? null,
      datos.esFiscal,
    );

    return registrarMovimientoTercero(
      sesion,
      {
        tipoTercero: 'proveedor',
        idTercero: idProveedor,
        fecha: datos.fecha,
        origen: datos.origen,
        importe: datos.importe,
        esFiscal,
        ...(datos.refTipo === undefined ? {} : { refTipo: datos.refTipo }),
        ...(datos.refId === undefined ? {} : { refId: datos.refId }),
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
      },
      { tx },
    );
  }, bd);
}

/**
 * Registra el CARGO de CxP de una RECEPCIÓN de material contra una OC (F4): una entrada de mercancía
 * SIN factura formal todavía (`entrada_sin_factura`, esFiscal=false), ligada a la orden de compra por
 * `refTipo='orden-compra'`/`refId`. La factura formal se concilia luego (E3), marcando el movimiento
 * fiscal. Deja el origen LISTO para que el flujo de recepción de F4 lo invoque; hoy es capturable a
 * mano. Permiso `cxp.administrar`.
 */
export async function registrarCargoCompraCxp(
  sesion: SesionUsuario,
  idProveedor: number,
  datos: { importe: number; fecha: string; idOrdenCompra: number; observaciones?: string },
  bd?: ContextoBd,
): Promise<MovimientoTerceroSalida> {
  return registrarMovimientoCxp(
    sesion,
    idProveedor,
    {
      fecha: datos.fecha,
      origen: 'entrada_sin_factura',
      importe: datos.importe,
      // El origen ya define el segmento (sin factura): `resolverSegmentoCxp` lo confirma y NO deja
      // que la modalidad del proveedor lo vuelva fiscal sin comprobante que lo respalde.
      refTipo: 'orden-compra',
      refId: datos.idOrdenCompra,
      ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
    },
    bd,
  );
}

// ── Cancelación (inverso auditado, delega al motor) ─────────────────────────────────────────────────

/**
 * Cancela un movimiento de CxP por su INVERSO auditado (D3/A7). Verifica que el movimiento sea de un
 * PROVEEDOR (la ruta de CxP no cancela movimientos de CxC) y delega al motor. Permiso `cxp.administrar`
 * (+ `terceros.administrar`). Empresa activa (A9).
 */
export async function cancelarMovimientoCxp(
  sesion: SesionUsuario,
  id: number,
  cuerpo: DatosMovimientoTerceroCancelar,
  bd?: ContextoBd,
): Promise<MovimientoTerceroSalida> {
  verificarPermiso(sesion, 'cxp.administrar');
  const cliente = clienteLectura(bd);
  const mov = await cliente.movimientoTercero.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    select: { tipoTercero: true },
  });
  if (mov === null || mov.tipoTercero !== 'proveedor') {
    throw new ErrorNoEncontrado('MovimientoTercero', id);
  }
  return cancelarMovimientoTercero(sesion, id, cuerpo, bd);
}

// ── Estado de cuenta del proveedor (delega al motor, con permiso de CxP) ────────────────────────────

/**
 * Estado de cuenta de un PROVEEDOR (saldo + movimientos paginados, incluida la convivencia EsMa).
 * Delega al motor `estadoDeCuentaTercero`. Permiso `cxp.ver` (+ `terceros.ver`; la vista `fiscal`
 * exige además `terceros.fiscal`, lo valida el motor). Empresa activa (A9).
 */
export async function estadoCuentaProveedorCxp(
  sesion: SesionUsuario,
  idProveedor: number,
  parametros: Parameters<typeof estadoDeCuentaTercero>[3] = {},
  bd?: ContextoBd,
): Promise<EstadoCuentaTerceroSalida> {
  verificarPermiso(sesion, 'cxp.ver');
  return estadoDeCuentaTercero(sesion, 'proveedor', idProveedor, parametros, bd);
}

// ── Bandeja "por pagar" + resumen (aging server-side, A1) ───────────────────────────────────────────

/** Fila CRUDA del agregado SQL del motor (subtotales en `numeric` → Decimal, cero-drift vs el detalle). */
interface FilaAgregadoCxpCruda {
  idProveedor: number;
  proveedor: string;
  nombreCorto: string | null;
  diasCredito: number;
  corriente: Prisma.Decimal;
  d1a30: Prisma.Decimal;
  d31a60: Prisma.Decimal;
  mas60: Prisma.Decimal;
  creditos: Prisma.Decimal;
}

/** Fila del agregado del motor ya convertida a number (el netting/redondeo se hace en JS). */
interface FilaAgregadoCxp {
  idProveedor: number;
  proveedor: string;
  nombreCorto: string | null;
  diasCredito: number;
  corriente: number;
  d1a30: number;
  d31a60: number;
  mas60: number;
  creditos: number;
}

/**
 * Fila ya neteada: aging del MOTOR (4 cubetas) + la cubeta MAQUILA (aporte EsMa, SIN antigüedad) +
 * saldo combinado. Antes de ocultar importes.
 */
export interface FilaNeta extends CubetasAging {
  idProveedor: number;
  proveedor: string;
  nombreCorto: string | null;
  diasCredito: number;
  /** Aporte EsMa (maquila) — cubeta APARTE: no entra al aging del motor ni al "vencido". */
  maquila: number;
  /**
   * Maquila capturada y AÚN sin revisar: no suma al saldo ni a ninguna cubeta, pero decide si la fila
   * se ve (§Post-F9.188a: el maquilero con todo sin revisar no desaparece).
   */
  maquilaPorRevisar: PendienteRevision;
  /** Saldo combinado = corriente + d1a30 + d31a60 + mas60 + maquila. */
  saldo: number;
}

/**
 * Agrega, por proveedor, sus movimientos del motor en las cuatro cubetas de aging (BRUTAS) + los
 * créditos, por la empresa activa (A9). Cubetas por días de atraso sobre `fecha_vencimiento`
 * (`CURRENT_DATE − fecha_vencimiento`); los límites llegan como parámetro (F9-E5/D15d: configurables
 * por empresa, `leerLimitesAging`). Filtrar por `id_proveedor IS NOT NULL` equivale a
 * `tipo_tercero='proveedor'` (CHECK de exclusividad D15a) y evita castear el enum en crudo. Los
 * subtotales viajan en `::numeric` (Decimal) para CERO-DRIFT contra el `saldo` del detalle (que suma
 * `monto` Decimal vía Prisma `_sum`).
 */
async function agregarPorProveedor(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
  limites: LimitesAging,
  segmento?: SegmentoFactura,
): Promise<FilaAgregadoCxp[]> {
  const { d30, d60 } = limites;
  // El SEGMENTO de CxP vive en `es_fiscal`, que es NOT NULL: aquí `= FALSE` sí es la mitad exacta
  // (a diferencia de EsMa, donde `con_factura` es nullable — ver `formula-saldo.ts` §segmento).
  const factura =
    segmento === undefined ? Prisma.empty : Prisma.sql`AND m.es_fiscal = ${segmento === 'con'}`;
  const crudas = await cliente.$queryRaw<FilaAgregadoCxpCruda[]>(Prisma.sql`
    SELECT
      m.id_proveedor AS "idProveedor",
      p.nombre       AS "proveedor",
      p.nombre_corto AS "nombreCorto",
      COALESCE(p.dias_credito, 0)::int AS "diasCredito",
      COALESCE(SUM(m.monto) FILTER (
        WHERE m.monto > 0 AND (m.fecha_vencimiento IS NULL OR CURRENT_DATE - m.fecha_vencimiento <= 0)
      ), 0)::numeric AS "corriente",
      COALESCE(SUM(m.monto) FILTER (
        WHERE m.monto > 0 AND CURRENT_DATE - m.fecha_vencimiento BETWEEN 1 AND ${d30}
      ), 0)::numeric AS "d1a30",
      COALESCE(SUM(m.monto) FILTER (
        WHERE m.monto > 0 AND CURRENT_DATE - m.fecha_vencimiento BETWEEN ${d30 + 1} AND ${d60}
      ), 0)::numeric AS "d31a60",
      COALESCE(SUM(m.monto) FILTER (
        WHERE m.monto > 0 AND CURRENT_DATE - m.fecha_vencimiento > ${d60}
      ), 0)::numeric AS "mas60",
      COALESCE(-SUM(m.monto) FILTER (WHERE m.monto < 0), 0)::numeric AS "creditos"
    FROM movimientos_tercero m
    JOIN proveedores p ON p.id = m.id_proveedor
    WHERE m.id_empresa = ${idEmpresa} AND m.id_proveedor IS NOT NULL ${factura}
    GROUP BY m.id_proveedor, p.nombre, p.nombre_corto, p.dias_credito
  `);
  return crudas.map((f) => ({
    idProveedor: f.idProveedor,
    proveedor: f.proveedor,
    nombreCorto: f.nombreCorto,
    diasCredito: f.diasCredito,
    corriente: redondear2(f.corriente.toNumber()),
    d1a30: redondear2(f.d1a30.toNumber()),
    d31a60: redondear2(f.d31a60.toNumber()),
    mas60: redondear2(f.mas60.toNumber()),
    creditos: redondear2(f.creditos.toNumber()),
  }));
}

/** Saldo combinado de una fila = aging del motor + la cubeta de maquila. */
function saldoDeFila(f: FilaNeta): number {
  return redondear2(f.corriente + f.d1a30 + f.d31a60 + f.mas60 + f.maquila);
}

/** Netea una fila cruda del motor (aging + saldo motor); la cubeta de maquila se agrega luego. */
function netearFila(f: FilaAgregadoCxp): FilaNeta {
  const brutas: CubetasBrutas = {
    corriente: f.corriente,
    d1a30: f.d1a30,
    d31a60: f.d31a60,
    mas60: f.mas60,
    creditos: f.creditos,
  };
  const c = netearCubetas(brutas);
  const fila: FilaNeta = {
    idProveedor: f.idProveedor,
    proveedor: f.proveedor,
    nombreCorto: f.nombreCorto,
    diasCredito: f.diasCredito,
    corriente: c.corriente,
    d1a30: c.d1a30,
    d31a60: c.d31a60,
    mas60: c.mas60,
    maquila: 0,
    maquilaPorRevisar: armarPendiente(0, 0, 0, 0),
    saldo: 0,
  };
  fila.saldo = saldoDeFila(fila);
  return fila;
}

/**
 * Resumen (KPIs) sobre TODOS los proveedores con saldo ≠ 0 (independiente de página/filtro/búsqueda).
 * `carteraTotal` = Σ saldo combinado (motor + maquila EsMa) → cifra VERAZ del pasivo a proveedores.
 * `vencido` = Σ de las tres cubetas vencidas del MOTOR. `maquilaTotal` = Σ del aporte de maquila (EsMa)
 * SIN antigüedad, expuesto APARTE. El `alCorrientePct` se calcula SOLO sobre la cartera CLASIFICABLE
 * (la del motor): `(carteraMotor − vencido) ÷ carteraMotor` — la maquila NO cuenta como "al corriente"
 * (antigüedad desconocida). Sin cartera del motor (`carteraMotor ≈ 0`, p. ej. solo deuda de maquila) →
 * el % es `null` ("—"), NUNCA 100%.
 */
function calcularResumen(
  conSaldo: FilaNeta[],
  visibles: FilaNeta[],
  puedeVerImportes: boolean,
): ResumenCxpSalida {
  const oculto = (v: number): number | null => (puedeVerImportes ? v : null);
  const carteraTotal = redondear2(conSaldo.reduce((s, f) => s + f.saldo, 0));
  const maquilaTotal = redondear2(conSaldo.reduce((s, f) => s + f.maquila, 0));
  const carteraMotor = redondear2(
    conSaldo.reduce((s, f) => s + f.corriente + f.d1a30 + f.d31a60 + f.mas60, 0),
  );
  const vencido = redondear2(conSaldo.reduce((s, f) => s + f.d1a30 + f.d31a60 + f.mas60, 0));
  const alCorrientePct = !tieneSaldo(carteraMotor)
    ? null
    : Math.min(100, Math.max(0, Math.round(((carteraMotor - vencido) / carteraMotor) * 100)));
  return {
    carteraTotal: oculto(carteraTotal),
    vencido: oculto(vencido),
    maquilaTotal: oculto(maquilaTotal),
    alCorrientePct,
    proveedoresConSaldo: conSaldo.length,
    // Lo que espera revisión, APARTE: no es deuda todavía, pero tampoco puede desaparecer del resumen.
    maquilaPorRevisar: pendienteParaSalida(sumarPorRevisar(visibles), puedeVerImportes),
  };
}

/** Σ del pendiente de maquila de las filas dadas (lo que espera revisión y NO suma a ningún saldo). */
function sumarPorRevisar(filas: FilaNeta[]): PendienteRevision {
  return armarPendiente(
    filas.reduce((s, f) => s + f.maquilaPorRevisar.abonos, 0),
    filas.reduce((s, f) => s + f.maquilaPorRevisar.pagos, 0),
    filas.reduce((s, f) => s + f.maquilaPorRevisar.descuentos, 0),
    filas.reduce((s, f) => s + f.maquilaPorRevisar.partidas, 0),
  );
}

/**
 * ⭐ LA CARTERA COMBINADA POR PROVEEDOR: el aging del MOTOR (CxP) + la cubeta de MAQUILA (EsMa), en
 * DOS agregados y nunca N+1. Es el universo de «a quién le debemos», y lo comparten la BANDEJA de
 * CxP y la **corrida semanal de pagos** (fila 0.113), que es literalmente la pantalla que Daniel
 * describió: *«en la pantalla donde están los saldos de todos los proveedores, con un campo abierto
 * a un lado para capturar lo que se le va a pagar esa semana»*.
 *
 * Se extrajo de {@link bandejaPorPagar} para que la corrida NO escriba su propia versión: si el
 * universo de la bandeja y el de la corrida se separaran, un proveedor podría aparecer en una y no
 * en la otra — y el que no aparece en la corrida no cobra.
 *
 * CONVIVENCIA EsMa (D15, opción b): el saldo del proveedor INCLUYE su aporte de maquila. Los
 * proveedores con SOLO deuda EsMa (0 en el motor) también entran → bandeja == estado de cuenta.
 *
 * ⭐ El aporte EsMa trae DOS cosas por maquilero (fila 0.115 + §Post-F9.188a): el saldo —sólo lo
 * REVISADO— y lo que sigue CAPTURADO sin revisar. Lo segundo no suma un centavo, pero decide si la
 * fila se ve: un maquilero con TODO sin revisar tiene saldo 0 y, si se cortara sólo por saldo,
 * DESAPARECERÍA justo cuando alguien tiene que decidir sobre ese dinero.
 *
 * `segmento` parte la cartera en la relación CON factura o la SIN factura (§Post-F9.189(a): son dos
 * corridas por semana — y, desde la fila 0.132, también dos listados de la BANDEJA). Los dos
 * criterios —`es_fiscal` en el motor, `con_factura` en EsMa— salen cada uno de su definición única;
 * el de EsMa vive en `formula-saldo.ts` porque su columna es NULLABLE y el «sin factura» tiene que
 * incluir lo migrado sin definir. **Sin `segmento` devuelve la vista operativa completa** (el chip
 * «Todos» de la bandeja).
 *
 * Sin permiso ni ocultamiento de importes: el que llama los aplica.
 */
export async function carteraCombinadaPorProveedor(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
  limites: LimitesAging,
  segmento?: SegmentoFactura,
): Promise<FilaNeta[]> {
  const crudas = await agregarPorProveedor(cliente, idEmpresa, limites, segmento);
  const aportesEsMa = await aportesEsMaSaldoLote(cliente, idEmpresa, segmento);

  const porId = new Map<number, FilaNeta>();
  for (const f of crudas) {
    porId.set(f.idProveedor, netearFila(f));
  }
  const idsSoloEsMa = [...aportesEsMa.keys()].filter((id) => !porId.has(id));
  const infoSoloEsMa =
    idsSoloEsMa.length === 0
      ? []
      : await cliente.proveedor.findMany({
          where: { id: { in: idsSoloEsMa } },
          select: { id: true, nombre: true, nombreCorto: true, diasCredito: true },
        });
  const infoPorId = new Map(infoSoloEsMa.map((p) => [p.id, p]));
  for (const [id, aporte] of aportesEsMa) {
    const existente = porId.get(id);
    if (existente !== undefined) {
      existente.maquila = aporte.saldo;
      existente.maquilaPorRevisar = aporte.pendiente;
      existente.saldo = saldoDeFila(existente);
      continue;
    }
    const info = infoPorId.get(id);
    if (info === undefined) {
      continue; // Proveedor inexistente (borrado): sin nombre no se puede etiquetar la fila.
    }
    porId.set(id, {
      idProveedor: id,
      proveedor: info.nombre,
      nombreCorto: info.nombreCorto,
      diasCredito: info.diasCredito ?? 0,
      corriente: 0,
      d1a30: 0,
      d31a60: 0,
      mas60: 0,
      maquila: aporte.saldo,
      maquilaPorRevisar: aporte.pendiente,
      saldo: redondear2(aporte.saldo),
    });
  }
  return [...porId.values()];
}

/**
 * BANDEJA "por pagar": los proveedores con su saldo por pagar y su antigüedad (aging), + el resumen
 * (KPIs) de la cartera. La agregación y el aging son SERVER-SIDE (A1): la pantalla solo pinta
 * escalares. El resumen se calcula sobre TODA la cartera con saldo (no la página). Permiso `cxp.ver`.
 * Empresa activa (A9). Importes ocultables (`consultas.ver-importes`); el aging igual se ordena por el
 * saldo real (el ocultamiento solo afecta la salida, no el cálculo).
 *
 * CONVIVENCIA EsMa (D15, opción b): el saldo del proveedor INCLUYE su aporte de maquila (EsMa/F6), en
 * UNA sola consulta agregada (`aportesEsMaSaldoLote`, NUNCA N+1). Así (a) un maquilero con deuda EsMa
 * y 0 en el motor APARECE en la bandeja, (b) `carteraTotal`/`vencido`/`proveedoresConSaldo` son
 * veraces, y (c) la bandeja concuerda con el estado de cuenta del click. El aporte EsMa va en una
 * cubeta APARTE ("maquila", SIN antigüedad): los cargos EsMa no traen fecha de vencimiento por ítem
 * — el aging fino de maquila llegará cuando EsMa registre por el motor (E6/decisión posterior).
 *
 * ⭐ §Post-F9.188(a) (Daniel): un maquilero con TODO sin revisar NO desaparece de la bandeja. Su saldo
 * es 0 (al saldo sólo entra lo revisado, fila 0.115) pero la fila se queda, con su «por revisar»
 * explicado. Los KPIs siguen contando sólo saldo ≠ 0: lo pendiente todavía no es deuda.
 *
 * ⭐ SEGMENTO CON / SIN FACTURA (fila 0.132, §Post-F9.192(5)). Daniel, sobre la bandeja del viernes
 * («a quién le debo»): *«debería partirse en Con factura / Sin factura, con totales y antigüedad por
 * separado, porque son dos relaciones de pago distintas»*. Con `segmento` la bandeja devuelve la
 * cartera de ESA relación **y su resumen** —cartera, vencido, cubetas, proveedores con saldo y
 * maquila por revisar son los del segmento, no los de la cartera completa—; por eso el segmento
 * aplicado viaja de vuelta en la salida (una cartera parcial que se leyera como total sería peor que
 * no partirla). `todos` deja la bandeja exactamente como estaba.
 *
 * El criterio NO se escribe aquí: el segmento sólo se traduce (`segmentoCartera`) y se le pasa a
 * {@link carteraCombinadaPorProveedor}, que lo aplica en sus dos fuentes con la definición única de
 * cada una (`es_fiscal`, NOT NULL, en el motor; `con_factura`, NULLABLE, en EsMa — donde el «sin»
 * incluye lo migrado sin definir). Es la misma cartera que ya usa la corrida semanal de pagos (fila
 * 0.113), así que la bandeja del segmento y la corrida del segmento no pueden divergir: el que no
 * aparece en la corrida no cobra.
 */
export async function bandejaPorPagar(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaBandejaCxpQuery> = {},
  bd?: ContextoBd,
): Promise<BandejaCxpSalida> {
  verificarPermiso(sesion, 'cxp.ver');
  const filtros: BandejaCxpQuery = validarEntrada(esquemaBandejaCxpQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const oculto = (v: number): number | null => (puedeVerImportes ? v : null);

  // Límites de aging vigentes de la empresa (F9-E5/D15d: configurables); default 30/60.
  const limites = await leerLimitesAging(cliente, idEmpresa);
  // ⭐ El SEGMENTO viaja como PARÁMETRO a la cartera y NO se re-implementa aquí (fila 0.132): el
  // criterio «con/sin» sale de la definición única de cada fuente. `todos` → `undefined` (no
  // segmenta): las filas, el aging y los KPIs quedan cifra por cifra como estaban; la salida sólo
  // gana el eco de `segmento`. Todo lo de abajo —los dos cortes, la búsqueda, el orden y la
  // paginación— es el MISMO código para los tres segmentos: lo único que cambia es el universo del
  // que parten.
  const netas = await carteraCombinadaPorProveedor(
    cliente,
    idEmpresa,
    limites,
    segmentoCartera(filtros.segmento),
  );
  // Dos cortes distintos, a propósito: `conSaldo` alimenta los KPIs (cartera, vencido, proveedores
  // CON SALDO — ahí un pendiente no es deuda todavía); `visibles` es lo que la tabla enseña con el
  // chip "con saldo": saldo ≠ 0 **o** algo por revisar (§Post-F9.188a — el que tiene todo sin
  // revisar no desaparece). Las DOS mitades salen de `formula-saldo.ts` —`tieneSaldo` y
  // `hayPendiente`— para que este corte no se separe del del tablero de EsMa. El pendiente se mide
  // por CONTEO, no por neto: un abono y un pago capturados iguales netean 0 y esconderían la fila.
  const conSaldo = netas.filter((f) => tieneSaldo(f.saldo));
  const visibles = netas.filter((f) => tieneSaldo(f.saldo) || hayPendiente(f.maquilaPorRevisar));
  const resumen = calcularResumen(conSaldo, visibles, puedeVerImportes);

  // Universo de la tabla según el chip; la búsqueda NO afecta al resumen (KPIs de toda la cartera).
  let base = filtros.filtro === 'todos' ? netas : visibles;
  if (filtros.busqueda !== undefined && filtros.busqueda !== '') {
    const q = normalizar(filtros.busqueda);
    base = base.filter(
      (f) =>
        normalizar(f.proveedor).includes(q) ||
        (f.nombreCorto !== null && normalizar(f.nombreCorto).includes(q)),
    );
  }
  // Orden estable: mayor saldo primero, luego por nombre (determinista).
  base.sort((a, b) => b.saldo - a.saldo || a.proveedor.localeCompare(b.proveedor, 'es'));

  const total = base.length;
  const inicio = (filtros.pagina - 1) * filtros.porPagina;
  const pagina = base.slice(inicio, inicio + filtros.porPagina);

  const filas: BandejaCxpFila[] = pagina.map((f) => ({
    idProveedor: f.idProveedor,
    proveedor: f.proveedor,
    nombreCorto: f.nombreCorto,
    diasCredito: f.diasCredito,
    saldo: oculto(f.saldo),
    corriente: oculto(f.corriente),
    d1a30: oculto(f.d1a30),
    d31a60: oculto(f.d31a60),
    mas60: oculto(f.mas60),
    maquila: oculto(f.maquila),
    maquilaPorRevisar: pendienteParaSalida(f.maquilaPorRevisar, puedeVerImportes),
  }));

  return {
    filas,
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
    resumen,
    segmento: filtros.segmento,
    limitesAging: { limite1: limites.d30, limite2: limites.d60 },
  };
}
