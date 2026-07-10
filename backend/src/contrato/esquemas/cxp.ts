import { z } from 'zod';

import { esquemaLimitesAging } from './terceros.js';

/**
 * Esquemas Zod de CxP — CUENTAS POR PAGAR de proveedores (Módulo 14, F9-E2; D12/D15/R10; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §3.2/§3.4). CxP es un USO del motor de
 * cuenta corriente de terceros (F9-E1): NO redefine el saldo (`saldo = Σ movimientos`, D3) — lo
 * envuelve para el caso de negocio del PROVEEDOR (formal e informal): captura de pagos/abonos/
 * descuentos/notas de crédito/entradas sin factura, estado de cuenta y ANTIGÜEDAD DE SALDOS (aging).
 *
 * Convención de SIGNO (heredada del motor, `signoDeOrigen`): el API recibe `importe` POSITIVO; el
 * servidor le pone el signo por el `origen`. Los CARGOS (`entrada_sin_factura`) AUMENTAN el saldo del
 * proveedor ("le debemos más"); los ABONOS (`nota_credito`, `pago`, `abono`, `descuento`) lo BAJAN.
 *
 * DOS EJES (motor E1): cada movimiento lleva `esFiscal` (para la vista/reporte del contador). El
 * proveedor INFORMAL (¿factura?=no, R15) lleva sus movimientos con `esFiscal=false` en el MISMO libro:
 * salen en la vista operativa y quedan fuera de la fiscal (no exige CFDI — el parser llega en E3).
 */

// ── Orígenes CAPTURABLES por CxP (subconjunto de los del motor) ─────────────────────────────────────

/**
 * Orígenes que un usuario captura A MANO en CxP. Es un SUBCONJUNTO de los orígenes del motor:
 *  • `entrada_sin_factura` (CARGO +): material/servicio recibido del proveedor SIN CFDI todavía —
 *    también el cargo que nace de una RECEPCIÓN de OC (F4), ligado con `refTipo`/`refId`.
 *  • `nota_credito` / `pago` / `abono` / `descuento` (ABONOS −): reducen el saldo.
 * NO se capturan aquí: `recibo_maquila` (nace en EsMa/F6, entra por convivencia) ni `factura_proveedor`
 * (la factura formal la concilia el parser de CFDI en E3). El signo lo fija el dominio (`signoDeOrigen`).
 */
export const ORIGENES_MOVIMIENTO_CXP = [
  'entrada_sin_factura',
  'nota_credito',
  'pago',
  'abono',
  'descuento',
] as const;
/** Clave de un origen capturable por CxP. */
export type OrigenMovimientoCxpClave = (typeof ORIGENES_MOVIMIENTO_CXP)[number];

/** Etiquetas legibles de los orígenes de CxP (para la UI). */
export const ETIQUETAS_ORIGEN_CXP: Record<OrigenMovimientoCxpClave, string> = {
  entrada_sin_factura: 'Entrada sin factura (cargo)',
  nota_credito: 'Nota de crédito',
  pago: 'Pago',
  abono: 'Abono',
  descuento: 'Descuento',
};

// ── Alta de un movimiento de CxP (por proveedor) ────────────────────────────────────────────────────

/**
 * Cuerpo del alta de un movimiento de CxP para un proveedor (el `:id` del proveedor va en la ruta).
 * El `importe` es SIEMPRE positivo (el servidor le pone el signo por `origen`). Sin `uuidCfdi` (E3):
 * `esFiscal` es una simple marca (para el proveedor informal se deja en `false`). `refTipo`/`refId`
 * ligan el movimiento a la operación real (p. ej. `orden-compra` de una recepción, F4).
 */
export const esquemaMovimientoCxpCrear = z
  .object({
    fecha: z.iso.date().describe('Fecha del movimiento (YYYY-MM-DD).'),
    origen: z
      .enum(ORIGENES_MOVIMIENTO_CXP)
      .describe('Origen del movimiento (determina el signo del monto).'),
    importe: z
      .number({ error: 'El importe es obligatorio' })
      .min(0.01, { error: 'El importe debe ser de al menos 0.01' })
      .describe('Importe POSITIVO (≥ 0.01; el servidor le pone el signo según el origen).'),
    esFiscal: z
      .boolean()
      .default(false)
      .describe('¿Movimiento fiscal (con CFDI)? El proveedor informal lo deja en false.'),
    refTipo: z
      .string()
      .trim()
      .max(40)
      .optional()
      .describe('Discriminador de la operación real ligada (p. ej. "orden-compra").'),
    refId: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Id de la operación real ligada (según refTipo).'),
    observaciones: z.string().trim().max(1000).optional(),
  })
  .describe('Alta de un movimiento de cuenta corriente de un proveedor (CxP).');

/** Datos validados del alta de un movimiento de CxP. */
export type DatosMovimientoCxpCrear = z.infer<typeof esquemaMovimientoCxpCrear>;

// ── Bandeja "por pagar" con antigüedad de saldos (aging) ────────────────────────────────────────────

/** Chips del filtro de la bandeja: proveedores con saldo ≠ 0 (default) o todos con movimientos. */
export const FILTROS_BANDEJA_CXP = ['con-saldo', 'todos'] as const;
/** Clave del filtro de la bandeja. */
export type FiltroBandejaCxpClave = (typeof FILTROS_BANDEJA_CXP)[number];

/** Filtros/paginación de la bandeja de CxP (querystring; todo coaccionado desde texto). */
export const esquemaBandejaCxpQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página (máx 100).'),
    filtro: z
      .enum(FILTROS_BANDEJA_CXP)
      .default('con-saldo')
      .describe('con-saldo (saldo ≠ 0) | todos (con movimientos).'),
    busqueda: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe('Filtra por nombre/clave del proveedor (sin acentos ni mayúsculas).'),
  })
  .describe('Filtros y paginación de la bandeja de cuentas por pagar.');

/** Parámetros de la bandeja ya coaccionados. */
export type BandejaCxpQuery = z.infer<typeof esquemaBandejaCxpQuery>;

/**
 * Un renglón de la bandeja de CxP: el proveedor con su saldo por pagar y su ANTIGÜEDAD (aging) en las
 * cuatro cubetas del MOTOR + la cubeta MAQUILA (aporte EsMa, SIN antigüedad). La cubeta `corriente` es
 * lo NO vencido (o abonos netos); `d1a30`/`d31a60`/`mas60` son días de atraso sobre `fechaVencimiento`
 * (fecha + días de crédito, R15); `maquila` es el saldo de maquila de EsMa (F6, convivencia D15b),
 * que NO tiene antigüedad por ítem y por eso va en cubeta aparte (no en "corriente" en silencio). Se
 * cumple `saldo = corriente + d1a30 + d31a60 + mas60 + maquila` (los abonos/pagos del motor netean, de
 * más viejo a más nuevo). Todos los importes viajan en null si se ocultan (`consultas.ver-importes`).
 */
export const esquemaBandejaCxpFila = z
  .object({
    idProveedor: z.number().int().describe('Id del proveedor.'),
    proveedor: z.string().describe('Nombre del proveedor.'),
    corto: z.string().nullable().describe('Clave corta del proveedor (o null).'),
    diasCredito: z.number().int().describe('Días de crédito del proveedor (0 = contado).'),
    saldo: z.number().nullable().describe('Saldo por pagar combinado (motor + maquila EsMa).'),
    corriente: z.number().nullable().describe('No vencido (neto de abonos).'),
    d1a30: z.number().nullable().describe('Vencido 1–30 días.'),
    d31a60: z.number().nullable().describe('Vencido 31–60 días.'),
    mas60: z.number().nullable().describe('Vencido +60 días.'),
    maquila: z
      .number()
      .nullable()
      .describe('Saldo de maquila (EsMa) SIN antigüedad (cubeta aparte).'),
  })
  .describe('Renglón de la bandeja de cuentas por pagar (proveedor + saldo + aging + maquila).');

/** Forma de un renglón de la bandeja de CxP. */
export type BandejaCxpFila = z.infer<typeof esquemaBandejaCxpFila>;

/**
 * Resumen (KPIs) de CxP calculado EN EL SERVIDOR (A1) sobre TODOS los proveedores con saldo ≠ 0 —
 * independiente de la página o el filtro de la tabla. `carteraTotal` = Σ saldos COMBINADOS (motor +
 * maquila EsMa) → el pasivo total a proveedores; `vencido` = Σ de las tres cubetas vencidas del motor;
 * `maquilaTotal` = Σ del aporte de maquila (EsMa) SIN antigüedad, mostrado APARTE. El `alCorrientePct`
 * se calcula SOLO sobre la cartera CLASIFICABLE (la del motor): `(carteraMotor − vencido) ÷
 * carteraMotor` — la maquila NO cuenta como "al corriente" porque su antigüedad es desconocida (un
 * maquilero con deuda EsMa vieja y 0 motor NO debe pintar 100%). Si no hay cartera del motor
 * (`carteraMotor ≈ 0`), el % viaja en `null` ("—"), NUNCA 100%. `proveedoresConSaldo` = cuántos tienen
 * saldo ≠ 0. Los importes en null si se ocultan; el conteo siempre viaja.
 */
export const esquemaResumenCxpSalida = z
  .object({
    carteraTotal: z
      .number()
      .nullable()
      .describe('Cartera total por pagar (Σ saldos combinados: motor + maquila).'),
    vencido: z.number().nullable().describe('Total vencido del motor (Σ cubetas 1–30/31–60/+60).'),
    maquilaTotal: z
      .number()
      .nullable()
      .describe('Saldo de maquila (EsMa) SIN antigüedad, agregado (aparte del %).'),
    alCorrientePct: z
      .number()
      .nullable()
      .describe(
        '% al corriente = (carteraMotor − vencido) ÷ carteraMotor (0–100); null si no hay cartera del motor.',
      ),
    proveedoresConSaldo: z.number().int().describe('Proveedores con saldo ≠ 0.'),
  })
  .describe('Resumen (KPIs) de cuentas por pagar.');

/** Forma del resumen de CxP. */
export type ResumenCxpSalida = z.infer<typeof esquemaResumenCxpSalida>;

/** Bandeja de CxP: la página de proveedores + su resumen (KPIs) de vistazo. */
export const esquemaBandejaCxpSalida = z
  .object({
    filas: z.array(esquemaBandejaCxpFila).describe('Renglones de la página (saldo desc).'),
    total: z.number().int().describe('Total de proveedores que cumplen el filtro.'),
    pagina: z.number().int().describe('Página solicitada (1-based).'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
    resumen: esquemaResumenCxpSalida.describe('KPIs sobre toda la cartera con saldo.'),
    limitesAging: esquemaLimitesAging.describe(
      'Límites de aging vigentes de la empresa (F9-E5/D15d) para las cabeceras dinámicas.',
    ),
  })
  .describe('Bandeja de cuentas por pagar (proveedores con aging + resumen).');

/** Forma de la bandeja de CxP. */
export type BandejaCxpSalida = z.infer<typeof esquemaBandejaCxpSalida>;
