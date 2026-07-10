import { z } from 'zod';

/**
 * Esquemas Zod de CxC — CUENTAS POR COBRAR de clientes (Módulo 14, F9-E4; D12/D15/R10/R12; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §2/§3.1). CxC es un USO del motor de cuenta
 * corriente de terceros (F9-E1): NO redefine el saldo (`saldo = Σ movimientos`, D3) — lo envuelve para
 * el caso de negocio del CLIENTE: captura de cobros/abonos/descuentos/notas de crédito/cargos sin
 * factura, estado de cuenta y ANTIGÜEDAD DE SALDOS (aging). Es el ESPEJO de CxP (F9-E2), más simple:
 * los clientes NO tienen convivencia EsMa (no maquilan), así que no hay cubeta "maquila".
 *
 * Convención de SIGNO (heredada del motor, `signoDeOrigen`): el API recibe `importe` POSITIVO; el
 * servidor le pone el signo por el `origen`. Los CARGOS (`entrada_sin_factura` manual, `factura_cliente`
 * del CFDI) AUMENTAN el saldo del cliente ("nos debe más"); los ABONOS (`nota_credito`, `pago`, `abono`,
 * `descuento`) lo BAJAN. El saldo del cliente > 0 = nos debe.
 *
 * DOS EJES (motor E1): cada movimiento lleva `esFiscal` (para la vista/reporte del contador). El cargo
 * manual `entrada_sin_factura` es NO fiscal; el cargo por CFDI de venta (`factura_cliente`, E4) es
 * fiscal y lleva su UUID.
 */

// ── Orígenes CAPTURABLES por CxC (subconjunto de los del motor) ─────────────────────────────────────

/**
 * Orígenes que un usuario captura A MANO en CxC. Es un SUBCONJUNTO de los orígenes del motor:
 *  • `entrada_sin_factura` (CARGO +): una venta/cargo al cliente SIN CFDI todavía.
 *  • `nota_credito` / `pago` / `abono` / `descuento` (ABONOS −): reducen lo que el cliente debe.
 * NO se captura aquí `factura_cliente` (el cargo fiscal por venta nace del parser de CFDI de ventas,
 * E4) — igual que en CxP `factura_proveedor` no se captura a mano. El signo lo fija el dominio.
 */
export const ORIGENES_MOVIMIENTO_CXC = [
  'entrada_sin_factura',
  'nota_credito',
  'pago',
  'abono',
  'descuento',
] as const;
/** Clave de un origen capturable por CxC. */
export type OrigenMovimientoCxcClave = (typeof ORIGENES_MOVIMIENTO_CXC)[number];

/** Etiquetas legibles de los orígenes de CxC (para la UI). */
export const ETIQUETAS_ORIGEN_CXC: Record<OrigenMovimientoCxcClave, string> = {
  entrada_sin_factura: 'Cargo sin factura (venta)',
  nota_credito: 'Nota de crédito',
  pago: 'Cobro',
  abono: 'Abono',
  descuento: 'Descuento',
};

// ── Alta de un movimiento de CxC (por cliente) ──────────────────────────────────────────────────────

/**
 * Cuerpo del alta de un movimiento de CxC para un cliente (el `:id` del cliente va en la ruta). El
 * `importe` es SIEMPRE positivo (el servidor le pone el signo por `origen`). Sin `uuidCfdi` (E4 lo pone
 * el CFDI): `esFiscal` es una simple marca. `refTipo`/`refId` ligan el movimiento a la operación real
 * (p. ej. `pedido`).
 */
export const esquemaMovimientoCxcCrear = z
  .object({
    fecha: z.iso.date().describe('Fecha del movimiento (YYYY-MM-DD).'),
    origen: z
      .enum(ORIGENES_MOVIMIENTO_CXC)
      .describe('Origen del movimiento (determina el signo del monto).'),
    importe: z
      .number({ error: 'El importe es obligatorio' })
      .min(0.01, { error: 'El importe debe ser de al menos 0.01' })
      .describe('Importe POSITIVO (≥ 0.01; el servidor le pone el signo según el origen).'),
    esFiscal: z
      .boolean()
      .default(false)
      .describe('¿Movimiento fiscal (con CFDI)? El cargo sin factura lo deja en false.'),
    refTipo: z
      .string()
      .trim()
      .max(40)
      .optional()
      .describe('Discriminador de la operación real ligada (p. ej. "pedido").'),
    refId: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Id de la operación real ligada (según refTipo).'),
    observaciones: z.string().trim().max(1000).optional(),
  })
  .describe('Alta de un movimiento de cuenta corriente de un cliente (CxC).');

/** Datos validados del alta de un movimiento de CxC. */
export type DatosMovimientoCxcCrear = z.infer<typeof esquemaMovimientoCxcCrear>;

// ── Bandeja "por cobrar" con antigüedad de saldos (aging) ───────────────────────────────────────────

/** Chips del filtro de la bandeja: clientes con saldo ≠ 0 (default) o todos con movimientos. */
export const FILTROS_BANDEJA_CXC = ['con-saldo', 'todos'] as const;
/** Clave del filtro de la bandeja. */
export type FiltroBandejaCxcClave = (typeof FILTROS_BANDEJA_CXC)[number];

/** Filtros/paginación de la bandeja de CxC (querystring; todo coaccionado desde texto). */
export const esquemaBandejaCxcQuery = z
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
      .enum(FILTROS_BANDEJA_CXC)
      .default('con-saldo')
      .describe('con-saldo (saldo ≠ 0) | todos (con movimientos).'),
    busqueda: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe('Filtra por nombre del cliente (sin acentos ni mayúsculas).'),
  })
  .describe('Filtros y paginación de la bandeja de cuentas por cobrar.');

/** Parámetros de la bandeja ya coaccionados. */
export type BandejaCxcQuery = z.infer<typeof esquemaBandejaCxcQuery>;

/**
 * Un renglón de la bandeja de CxC: el cliente con su saldo por cobrar y su ANTIGÜEDAD (aging) en las
 * cuatro cubetas. La cubeta `corriente` es lo NO vencido (o abonos netos); `d1a30`/`d31a60`/`mas60` son
 * días de atraso sobre `fechaVencimiento` (fecha + días de crédito del cliente, D15d). Se cumple
 * `saldo = corriente + d1a30 + d31a60 + mas60` (los cobros/abonos netean, de más viejo a más nuevo).
 * A diferencia de CxP, NO hay cubeta "maquila" (los clientes no maquilan). Todos los importes viajan en
 * null si se ocultan (`consultas.ver-importes`).
 */
export const esquemaBandejaCxcFila = z
  .object({
    idCliente: z.number().int().describe('Id del cliente.'),
    cliente: z.string().describe('Nombre del cliente.'),
    diasCredito: z.number().int().describe('Días de crédito del cliente (0 = contado).'),
    saldo: z.number().nullable().describe('Saldo por cobrar (Σ movimientos del cliente).'),
    corriente: z.number().nullable().describe('No vencido (neto de cobros).'),
    d1a30: z.number().nullable().describe('Vencido 1–30 días.'),
    d31a60: z.number().nullable().describe('Vencido 31–60 días.'),
    mas60: z.number().nullable().describe('Vencido +60 días.'),
  })
  .describe('Renglón de la bandeja de cuentas por cobrar (cliente + saldo + aging).');

/** Forma de un renglón de la bandeja de CxC. */
export type BandejaCxcFila = z.infer<typeof esquemaBandejaCxcFila>;

/**
 * Resumen (KPIs) de CxC calculado EN EL SERVIDOR (A1) sobre TODOS los clientes con saldo ≠ 0 —
 * independiente de la página o el filtro de la tabla. `carteraTotal` = Σ saldos → el activo total por
 * cobrar; `vencido` = Σ de las tres cubetas vencidas; `alCorrientePct` = `(cartera − vencido) ÷ cartera`
 * (0–100) sobre TODA la cartera (los clientes no tienen maquila, así que no hay saldo sin clasificar);
 * `null` ("—") solo si no hay cartera. `clientesConSaldo` = cuántos tienen saldo ≠ 0. Los importes en
 * null si se ocultan; el conteo siempre viaja.
 */
export const esquemaResumenCxcSalida = z
  .object({
    carteraTotal: z.number().nullable().describe('Cartera total por cobrar (Σ saldos).'),
    vencido: z.number().nullable().describe('Total vencido (Σ cubetas 1–30/31–60/+60).'),
    alCorrientePct: z
      .number()
      .nullable()
      .describe('% al corriente = (cartera − vencido) ÷ cartera (0–100); null si no hay cartera.'),
    clientesConSaldo: z.number().int().describe('Clientes con saldo ≠ 0.'),
  })
  .describe('Resumen (KPIs) de cuentas por cobrar.');

/** Forma del resumen de CxC. */
export type ResumenCxcSalida = z.infer<typeof esquemaResumenCxcSalida>;

/** Bandeja de CxC: la página de clientes + su resumen (KPIs) de vistazo. */
export const esquemaBandejaCxcSalida = z
  .object({
    filas: z.array(esquemaBandejaCxcFila).describe('Renglones de la página (saldo desc).'),
    total: z.number().int().describe('Total de clientes que cumplen el filtro.'),
    pagina: z.number().int().describe('Página solicitada (1-based).'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
    resumen: esquemaResumenCxcSalida.describe('KPIs sobre toda la cartera con saldo.'),
  })
  .describe('Bandeja de cuentas por cobrar (clientes con aging + resumen).');

/** Forma de la bandeja de CxC. */
export type BandejaCxcSalida = z.infer<typeof esquemaBandejaCxcSalida>;
