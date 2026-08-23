import { z } from 'zod';

import { TIPOS_TERCERO } from './terceros.js';

/**
 * Esquemas Zod de REPORTES FISCALES para el contador (Módulo 14, F9-E5; D12/R13; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §2/§3.2/§8). CONTROL NO lleva contabilidad:
 * entrega DATOS, no pólizas. El reporte es la VISTA FISCAL del libro de terceros (E1) — los movimientos
 * `esFiscal=true` de CxP (proveedores) y CxC (clientes), con su CFDI (folio, RFC, UUID, total). Todo el
 * cálculo es SERVER-SIDE (A1); la pantalla solo pinta. Permiso `terceros.fiscal` (A4) — es exactamente
 * su propósito. Empresa activa (A9). Los importes se ocultan (null) sin `consultas.ver-importes`.
 *
 * ALCANCE (qué EXISTE vs. qué NO): un `MovimientoTercero` guarda el TOTAL del CFDI (`monto`, con signo)
 * + `uuidCfdi` + `rfcTercero` + `idArchivoCfdi` (el XML en R2). El desglose de impuestos (base, IVA,
 * retenciones) NO se persiste en el movimiento — vive dentro del XML. Este reporte expone lo que EXISTE
 * (total/UUID/RFC); leer el desglose del XML sería otra lectura, fuera del alcance de E5.
 */

// ── Constantes de dominio (selectores de la UI) ─────────────────────────────────────────────────────

/** Tipo de movimiento fiscal por el SIGNO del monto: cargo (aumenta el saldo) o abono (lo baja). */
export const TIPOS_MOVIMIENTO_FISCAL = ['cargos', 'abonos'] as const;
/** Clave del filtro por tipo de movimiento. */
export type TipoMovimientoFiscalClave = (typeof TIPOS_MOVIMIENTO_FISCAL)[number];

/** Filtro por presencia de CFDI: `con` (tiene UUID) / `sin` (marcado fiscal, pendiente de su CFDI). */
export const FILTROS_CFDI = ['con', 'sin'] as const;
/** Clave del filtro por CFDI. */
export type FiltroCfdiClave = (typeof FILTROS_CFDI)[number];

// ── Reporte fiscal por periodo (movimientos fiscales paginados + totales) ────────────────────────────

/** Filtros/paginación del reporte fiscal (querystring; todo coaccionado desde texto). */
export const esquemaReporteFiscalQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Renglones por página (máx 100).'),
    desde: z.iso.date().optional().describe('Fecha inicial (YYYY-MM-DD), inclusiva.'),
    hasta: z.iso.date().optional().describe('Fecha final (YYYY-MM-DD), inclusiva.'),
    tipoTercero: z
      .enum(TIPOS_TERCERO)
      .optional()
      .describe('Filtra a proveedores (CxP) o clientes (CxC); ambos si se omite.'),
    idTercero: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra a un tercero concreto (según tipoTercero).'),
    tipo: z
      .enum(TIPOS_MOVIMIENTO_FISCAL)
      .optional()
      .describe('cargos (monto > 0) | abonos (monto < 0); ambos si se omite.'),
    cfdi: z
      .enum(FILTROS_CFDI)
      .optional()
      .describe('con (tiene UUID) | sin (pendiente de CFDI); ambos si se omite.'),
  })
  .refine((d) => d.idTercero === undefined || d.tipoTercero !== undefined, {
    error:
      'Para filtrar por un tercero concreto hay que indicar también su tipo (cliente/proveedor).',
    path: ['tipoTercero'],
  })
  .describe('Filtros y paginación del reporte fiscal del contador.');

/** Parámetros del reporte ya coaccionados. */
export type ReporteFiscalQuery = z.infer<typeof esquemaReporteFiscalQuery>;

/**
 * Un renglón del reporte fiscal: un movimiento `esFiscal=true` del libro de terceros con su detalle de
 * CFDI. `monto` viaja CON SIGNO (cargo +, abono −) o null si se ocultan importes; `esCargo` refleja el
 * signo aunque el importe esté oculto. `tieneXml` = el XML del CFDI está guardado en R2 (idArchivoCfdi).
 */
export const esquemaReporteFiscalFila = z
  .object({
    id: z.number().int().describe('Id del movimiento.'),
    folio: z.number().int().describe('Folio A3 del movimiento.'),
    fecha: z.string().describe('Fecha del movimiento (YYYY-MM-DD).'),
    tipoTercero: z.enum(TIPOS_TERCERO).describe('Cliente (CxC) o proveedor (CxP).'),
    idTercero: z.number().int().describe('Id del cliente o proveedor.'),
    tercero: z.string().describe('Nombre del tercero.'),
    rfcTercero: z.string().nullable().describe('RFC del tercero en el CFDI, o null.'),
    origen: z.string().describe('Origen/concepto del movimiento (etiqueta estable).'),
    uuidCfdi: z.string().nullable().describe('UUID (folio fiscal) del CFDI, o null si pendiente.'),
    tieneXml: z.boolean().describe('¿El XML del CFDI está guardado en R2 (idArchivoCfdi)?'),
    monto: z
      .number()
      .nullable()
      .describe('Total del CFDI CON SIGNO (Σ = neto), o null si se oculta.'),
    esCargo: z.boolean().describe('¿Es un cargo (monto > 0)? false = abono/nota de crédito.'),
    cancelado: z.boolean().describe('¿El movimiento fue cancelado (existe su inverso)?'),
    esInverso: z.boolean().describe('¿Es un movimiento inverso de cancelación?'),
  })
  .describe('Renglón del reporte fiscal (movimiento fiscal + detalle CFDI).');

/** Forma de un renglón del reporte fiscal. */
export type ReporteFiscalFila = z.infer<typeof esquemaReporteFiscalFila>;

/** Totales del periodo (sobre TODO el filtro, no solo la página). Importes ocultables. */
export const esquemaTotalesFiscales = z
  .object({
    cargos: z.number().nullable().describe('Σ de los cargos (monto > 0) del filtro.'),
    abonos: z.number().nullable().describe('Σ de los abonos (monto < 0), en positivo, del filtro.'),
    neto: z.number().nullable().describe('Neto = cargos − abonos (Σ monto con signo).'),
    movimientos: z.number().int().describe('Cuántos movimientos cumplen el filtro.'),
  })
  .describe('Totales del reporte fiscal (del filtro, no de la página).');

/** Forma de los totales del reporte. */
export type TotalesFiscales = z.infer<typeof esquemaTotalesFiscales>;

/** Reporte fiscal: la página de movimientos fiscales + los totales del periodo. */
export const esquemaReporteFiscalSalida = z
  .object({
    desde: z.string().nullable().describe('Fecha inicial del filtro o null.'),
    hasta: z.string().nullable().describe('Fecha final del filtro o null.'),
    filas: z.array(esquemaReporteFiscalFila).describe('Renglones de la página (por fecha desc).'),
    total: z.number().int().describe('Total de movimientos que cumplen el filtro.'),
    pagina: z.number().int().describe('Página solicitada (1-based).'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
    totales: esquemaTotalesFiscales.describe('Totales del periodo (todo el filtro).'),
  })
  .describe('Reporte fiscal del contador (movimientos fiscales paginados + totales).');

/** Forma del reporte fiscal. */
export type ReporteFiscalSalida = z.infer<typeof esquemaReporteFiscalSalida>;

// ── Tablero de "salud fiscal" (conciliación consolidada + saldos por tercero) ────────────────────────

/** Filtros del tablero de salud fiscal (periodo opcional; por defecto todo). */
export const esquemaSaludFiscalQuery = z
  .object({
    desde: z.iso.date().optional().describe('Fecha inicial (YYYY-MM-DD), inclusiva.'),
    hasta: z.iso.date().optional().describe('Fecha final (YYYY-MM-DD), inclusiva.'),
  })
  .describe('Filtros del tablero de salud fiscal.');

/** Parámetros del tablero ya coaccionados. */
export type SaludFiscalQuery = z.infer<typeof esquemaSaludFiscalQuery>;

/** Saldo fiscal (Σ monto de los movimientos fiscales) de un tercero, agregado en el servidor. */
export const esquemaSaldoFiscalTercero = z
  .object({
    tipoTercero: z.enum(TIPOS_TERCERO).describe('Cliente (CxC) o proveedor (CxP).'),
    idTercero: z.number().int().describe('Id del cliente o proveedor.'),
    tercero: z.string().describe('Nombre del tercero.'),
    rfc: z.string().nullable().describe('RFC del tercero (catálogo), o null.'),
    saldoFiscal: z.number().nullable().describe('Σ monto de sus movimientos fiscales, o null.'),
    movimientos: z.number().int().describe('Cuántos movimientos fiscales tiene en el periodo.'),
  })
  .describe('Saldo fiscal agregado de un tercero.');

/** Forma del saldo fiscal por tercero. */
export type SaldoFiscalTercero = z.infer<typeof esquemaSaldoFiscalTercero>;

/**
 * TABLERO de salud fiscal: la conciliación consolidada (cuántos movimientos fiscales tienen CFDI/XML y
 * cuántos están pendientes) + los saldos fiscales por tercero. `pctConciliado` = movimientos con UUID ÷
 * total fiscales (0–100), null si no hay movimientos fiscales.
 */
export const esquemaSaludFiscalSalida = z
  .object({
    desde: z.string().nullable().describe('Fecha inicial del filtro o null.'),
    hasta: z.string().nullable().describe('Fecha final del filtro o null.'),
    totalFiscales: z.number().int().describe('Movimientos marcados fiscales en el periodo.'),
    conCfdi: z.number().int().describe('De ésos, cuántos tienen UUID (CFDI conciliado).'),
    sinCfdi: z.number().int().describe('Marcados fiscales SIN UUID (pendientes de CFDI).'),
    conXml: z.number().int().describe('Cuántos tienen el XML guardado en R2 (idArchivoCfdi).'),
    sinXml: z.number().int().describe('Cuántos NO tienen el XML guardado en R2.'),
    pctConciliado: z
      .number()
      .nullable()
      .describe('% conciliado = conCfdi ÷ totalFiscales (0–100); null si no hay fiscales.'),
    saldos: z
      .array(esquemaSaldoFiscalTercero)
      .describe('Saldos fiscales por tercero (|saldo| desc).'),
  })
  .describe('Tablero de salud fiscal (conciliación consolidada + saldos por tercero).');

/** Forma del tablero de salud fiscal. */
export type SaludFiscalSalida = z.infer<typeof esquemaSaludFiscalSalida>;
