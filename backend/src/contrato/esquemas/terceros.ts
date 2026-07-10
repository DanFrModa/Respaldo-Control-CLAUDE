import { z } from 'zod';

/**
 * Esquemas Zod del MOTOR de cuenta corriente de terceros (Módulo 14, F9-E1; D12/D15/R10; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §3). UNA sola definición de reglas para
 * UI y servidor (alimenta el OpenAPI). El motor generaliza EsMa: `saldo(tercero) = Σ movimientos`,
 * nunca editable (D3). Modelo del tercero (D15a): el movimiento REFERENCIA a un Cliente o un
 * Proveedor por **tipo + id** (sin tabla `Tercero` polimórfica).
 *
 * Convención de SIGNO (documentada aquí y en el dominio `signoDeOrigen`): el API recibe siempre un
 * `importe` POSITIVO; el servidor le pone el signo según el `origen`. CARGOS (recibo_maquila,
 * factura_proveedor, entrada_sin_factura) AUMENTAN el saldo (monto +); ABONOS (nota_credito, pago,
 * abono, descuento) lo DISMINUYEN (monto −). En la salida, `monto` viaja ya CON SIGNO (Σ = saldo).
 */

// ── Constantes de dominio (para selectores/labels de la UI) ────────────────────────────────────────

/** Tipos de tercero (D15a): un movimiento apunta a un cliente (CxC) o a un proveedor (CxP/EsMa). */
export const TIPOS_TERCERO = ['cliente', 'proveedor'] as const;
/** Clave de un tipo de tercero. */
export type TipoTerceroClave = (typeof TIPOS_TERCERO)[number];

/**
 * Orígenes de un movimiento de terceros (eje 1). Los CUATRO primeros son CARGOS (+); los cuatro
 * últimos, ABONOS/reducciones (−). El orden refleja esa agrupación. `factura_cliente` (F9-E4) es el
 * cargo de CxC por VENTA. EXTENSIBLE: el signo lo fija el dominio (`signoDeOrigen`), no un CHECK de BD.
 */
export const ORIGENES_MOVIMIENTO_TERCERO = [
  'recibo_maquila',
  'factura_proveedor',
  'entrada_sin_factura',
  'factura_cliente',
  'nota_credito',
  'pago',
  'abono',
  'descuento',
] as const;
/** Clave de un origen de movimiento de terceros. */
export type OrigenMovimientoTerceroClave = (typeof ORIGENES_MOVIMIENTO_TERCERO)[number];

/** Etiquetas legibles de los orígenes (para la UI). */
export const ETIQUETAS_ORIGEN_MOVIMIENTO_TERCERO: Record<OrigenMovimientoTerceroClave, string> = {
  recibo_maquila: 'Recibo de maquila',
  factura_proveedor: 'Factura de proveedor',
  entrada_sin_factura: 'Entrada sin factura',
  factura_cliente: 'Factura de venta',
  nota_credito: 'Nota de crédito',
  pago: 'Pago',
  abono: 'Abono',
  descuento: 'Descuento',
};

/** Vistas del libro (dos FILTROS del mismo libro, NO dos libros): operativa (todo) / fiscal (CFDI). */
export const VISTAS_TERCERO = ['operativa', 'fiscal'] as const;
/** Clave de una vista del estado de cuenta. */
export type VistaTerceroClave = (typeof VISTAS_TERCERO)[number];

/** Fuente de un renglón del estado de cuenta unificado: el motor nuevo o el histórico EsMa (F6). */
export const FUENTES_MOVIMIENTO_TERCERO = ['motor', 'esma'] as const;
/** Clave de la fuente de un renglón. */
export type FuenteMovimientoTerceroClave = (typeof FUENTES_MOVIMIENTO_TERCERO)[number];

// ── Alta de un movimiento ──────────────────────────────────────────────────────────────────────────

/**
 * Cuerpo del alta de un movimiento de terceros. El `importe` es SIEMPRE positivo (el servidor le
 * pone el signo por `origen`). El tercero se referencia por `tipoTercero` + `idTercero` (D15a). Los
 * campos fiscales son mínimos en E1 (el parser de CFDI llega en E3): `uuidCfdi` obliga a `esFiscal`.
 */
export const esquemaMovimientoTerceroCrear = z
  .object({
    tipoTercero: z
      .enum(TIPOS_TERCERO)
      .describe('Tipo de tercero: cliente (CxC) o proveedor (CxP).'),
    idTercero: z.coerce
      .number({ error: 'El tercero es obligatorio' })
      .int({ error: 'El id del tercero debe ser entero' })
      .positive({ error: 'El id del tercero debe ser positivo' })
      .describe('Id del Cliente o Proveedor según `tipoTercero`.'),
    fecha: z.iso.date().describe('Fecha del movimiento (YYYY-MM-DD).'),
    origen: z
      .enum(ORIGENES_MOVIMIENTO_TERCERO)
      .describe('Origen del movimiento (eje 1). Determina el signo del monto.'),
    importe: z
      .number({ error: 'El importe es obligatorio' })
      .min(0.01, { error: 'El importe debe ser de al menos 0.01' })
      .describe('Importe POSITIVO (≥ 0.01; el servidor le pone el signo según el origen).'),
    esFiscal: z
      .boolean()
      .default(false)
      .describe('¿Movimiento fiscal (con CFDI)? Filtra la vista fiscal del contador.'),
    uuidCfdi: z
      .string()
      .trim()
      .max(60)
      .optional()
      .describe('UUID (folio fiscal) del CFDI. Único global; exige esFiscal=true.'),
    rfcTercero: z
      .string()
      .trim()
      .max(13)
      .optional()
      .describe('RFC del emisor/receptor del CFDI (si es fiscal).'),
    idArchivoCfdi: z
      .string()
      .trim()
      .max(64)
      .optional()
      .describe('Id del Archivo R2 del XML/PDF del CFDI (motor de F0). Normalmente lo pone E3/E4.'),
    refTipo: z
      .string()
      .trim()
      .max(40)
      .optional()
      .describe('Discriminador de la operación real ligada (recibo/oc/recepcion/pedido…).'),
    refId: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Id de la operación real ligada (según refTipo).'),
    observaciones: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.uuidCfdi === undefined || d.esFiscal, {
    error: 'Un movimiento con UUID de CFDI debe marcarse como fiscal.',
    path: ['esFiscal'],
  })
  .describe('Alta de un movimiento de cuenta corriente de terceros.');

/** Datos validados del alta de un movimiento. */
export type DatosMovimientoTerceroCrear = z.infer<typeof esquemaMovimientoTerceroCrear>;

/** Cuerpo de la cancelación de un movimiento (motivo obligatorio; genera el inverso auditado). */
export const esquemaMovimientoTerceroCancelar = z
  .object({
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(1, { error: 'El motivo es obligatorio' })
      .max(1000)
      .describe('Motivo de la cancelación (queda en la bitácora y el inverso).'),
  })
  .describe('Cancelación (por inverso auditado) de un movimiento de terceros.');

/** Datos validados de la cancelación. */
export type DatosMovimientoTerceroCancelar = z.infer<typeof esquemaMovimientoTerceroCancelar>;

// ── Salida de un movimiento (renglón del libro) ─────────────────────────────────────────────────────

/**
 * Un renglón del estado de cuenta unificado. `fuente` distingue el motor nuevo del histórico EsMa
 * (convivencia por lectura, opción b): en AMBOS casos `monto` viaja CON SIGNO como su contribución
 * al saldo, de modo que Σ(monto de todos los renglones) = saldo del tercero. Las columnas fiscales y
 * de referencia solo aplican a la fuente `motor` (en EsMa quedan en null).
 */
export const esquemaMovimientoTerceroSalida = z
  .object({
    fuente: z.enum(FUENTES_MOVIMIENTO_TERCERO).describe('Origen del renglón: motor nuevo o EsMa.'),
    id: z.number().int().describe('Id del renglón en su tabla de origen.'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    folio: z.number().int().nullable().describe('Folio A3 (solo motor; null en EsMa).'),
    tipoTercero: z.enum(TIPOS_TERCERO).describe('Tipo de tercero.'),
    idTercero: z.number().int().describe('Id del cliente o proveedor.'),
    tercero: z.string().describe('Nombre del tercero.'),
    fecha: z.string().describe('Fecha del movimiento (YYYY-MM-DD).'),
    origen: z.string().describe('Origen/concepto del movimiento (etiqueta estable).'),
    monto: z
      .number()
      .nullable()
      .describe('Importe CON SIGNO (Σ = saldo); null si se ocultan importes.'),
    fechaVencimiento: z
      .string()
      .nullable()
      .describe('Fecha de vencimiento derivada (aging D15d) o null.'),
    esFiscal: z.boolean().describe('¿Movimiento fiscal (con CFDI)?'),
    uuidCfdi: z.string().nullable().describe('UUID del CFDI o null.'),
    rfcTercero: z.string().nullable().describe('RFC del tercero o null.'),
    idArchivoCfdi: z.string().nullable().describe('Id del Archivo R2 del CFDI o null.'),
    refTipo: z.string().nullable().describe('Discriminador de la operación ligada o null.'),
    refId: z.number().int().nullable().describe('Id de la operación ligada o null.'),
    observaciones: z.string().nullable().describe('Observaciones o null.'),
    cancelado: z.boolean().describe('¿El movimiento fue cancelado (existe su inverso)?'),
    esInverso: z.boolean().describe('¿Es un movimiento inverso de cancelación?'),
    creadoEn: z.iso.datetime().describe('Cuándo se registró (ISO).'),
    creadoPorId: z.string().nullable().describe('Id de quien lo registró o null.'),
  })
  .describe('Renglón del estado de cuenta de un tercero.');

/** Forma de un renglón del libro. */
export type MovimientoTerceroSalida = z.infer<typeof esquemaMovimientoTerceroSalida>;

// ── Saldo derivado ──────────────────────────────────────────────────────────────────────────────────

/**
 * SALDO derivado de un tercero (D3): Σ movimientos. Para un proveedor incluye la CONVIVENCIA con
 * EsMa (F6): `saldo = saldoMovimientos + saldoEsMa`. La vista fiscal filtra a los movimientos con
 * CFDI (motor) y a los cargos con factura (EsMa). Todos los importes en null si se ocultan.
 */
export const esquemaSaldoTerceroSalida = z
  .object({
    tipoTercero: z.enum(TIPOS_TERCERO).describe('Tipo de tercero.'),
    idTercero: z.number().int().describe('Id del cliente o proveedor.'),
    tercero: z.string().describe('Nombre del tercero.'),
    saldo: z.number().nullable().describe('Saldo OPERATIVO total (motor + EsMa).'),
    saldoFiscal: z.number().nullable().describe('Saldo FISCAL total (solo movimientos con CFDI).'),
    saldoMovimientos: z.number().nullable().describe('Aporte del motor nuevo al saldo operativo.'),
    saldoEsMa: z
      .number()
      .nullable()
      .describe('Aporte de EsMa (F6) al saldo operativo; 0 en clientes.'),
    incluyeEsMa: z.boolean().describe('¿El saldo incluye movimientos de EsMa (proveedor)?'),
  })
  .describe('Saldo derivado de un tercero (Σ movimientos, nunca editable).');

/** Forma del saldo derivado. */
export type SaldoTerceroSalida = z.infer<typeof esquemaSaldoTerceroSalida>;

// ── Estado de cuenta (saldo + movimientos paginados) ─────────────────────────────────────────────────

/** Filtros del estado de cuenta / libro de un tercero (querystring; todo coaccionado desde texto). */
export const esquemaEstadoCuentaTerceroQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página (máx 100).'),
    desde: z.iso.date().optional().describe('Fecha inicial (YYYY-MM-DD), inclusiva.'),
    hasta: z.iso.date().optional().describe('Fecha final (YYYY-MM-DD), inclusiva.'),
    origen: z
      .enum(ORIGENES_MOVIMIENTO_TERCERO)
      .optional()
      .describe('Filtra por un origen concreto (solo motor).'),
    vista: z
      .enum(VISTAS_TERCERO)
      .default('operativa')
      .describe('operativa (todo) | fiscal (solo CFDI; exige terceros.fiscal).'),
  })
  .describe('Filtros y paginación del estado de cuenta de un tercero.');

/** Parámetros del estado de cuenta ya coaccionados. */
export type EstadoCuentaTerceroQuery = z.infer<typeof esquemaEstadoCuentaTerceroQuery>;

/** Estado de cuenta de un tercero: su saldo + la página de movimientos (motor + EsMa). */
export const esquemaEstadoCuentaTerceroSalida = z
  .object({
    tipoTercero: z.enum(TIPOS_TERCERO).describe('Tipo de tercero.'),
    idTercero: z.number().int().describe('Id del cliente o proveedor.'),
    tercero: z.string().describe('Nombre del tercero.'),
    vista: z.enum(VISTAS_TERCERO).describe('Vista aplicada (operativa/fiscal).'),
    desde: z.string().nullable().describe('Fecha inicial del filtro o null.'),
    hasta: z.string().nullable().describe('Fecha final del filtro o null.'),
    saldo: esquemaSaldoTerceroSalida.describe('Saldo derivado (all-time, no depende del periodo).'),
    movimientos: z
      .array(esquemaMovimientoTerceroSalida)
      .describe('Renglones de la página (motor + EsMa), por fecha desc.'),
    total: z.number().int().describe('Total de renglones que cumplen el filtro.'),
    pagina: z.number().int().describe('Página solicitada (1-based).'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Estado de cuenta de un tercero (saldo + movimientos paginados).');

/** Forma del estado de cuenta. */
export type EstadoCuentaTerceroSalida = z.infer<typeof esquemaEstadoCuentaTerceroSalida>;
