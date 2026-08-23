import { z } from 'zod';

import { esquemaMovimientoTerceroSalida } from './terceros.js';

/**
 * Esquemas Zod de la IMPORTACIÓN de CFDI de proveedores (Módulo 14, F9-E3; R11; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §2). UNA sola definición para UI y servidor
 * (alimenta el OpenAPI). Es importación (jala el XML sellado del proveedor), NO emisión (R14/PAC es
 * posterior). El flujo: previsualizar (parsear + conciliar candidatos) → importar (el servidor sube el
 * XML a R2 SERVER-SIDE + crea el cargo FISCAL de CxP por el TOTAL del CFDI, en transacción A2).
 */

// ── Tipo de comprobante ────────────────────────────────────────────────────────────────────────────

/** Tipos de comprobante soportados: I = ingreso (factura → cargo) · E = egreso (nota de crédito). */
export const TIPOS_COMPROBANTE_CFDI = ['I', 'E'] as const;
/** Clave de un tipo de comprobante. */
export type TipoComprobanteCfdiClave = (typeof TIPOS_COMPROBANTE_CFDI)[number];

/** Etiquetas legibles del tipo de comprobante (para la UI). */
export const ETIQUETAS_TIPO_COMPROBANTE_CFDI: Record<TipoComprobanteCfdiClave, string> = {
  I: 'Ingreso (factura)',
  E: 'Egreso (nota de crédito)',
};

/** Tipos de operación real a la que se puede ligar el CFDI (referencia polimórfica del movimiento). */
export const REF_TIPOS_CFDI = ['orden-compra', 'recepcion'] as const;
/** Clave de un tipo de referencia. */
export type RefTipoCfdiClave = (typeof REF_TIPOS_CFDI)[number];

// ── Datos extraídos del CFDI (previsualización) ─────────────────────────────────────────────────────

/** Un concepto (renglón) del CFDI. */
export const esquemaCfdiConcepto = z
  .object({
    descripcion: z.string().describe('Descripción del concepto.'),
    cantidad: z.number().describe('Cantidad.'),
    valorUnitario: z.number().describe('Valor unitario.'),
    importe: z.number().describe('Importe del renglón.'),
  })
  .describe('Concepto (renglón) de un CFDI.');

/** Datos fiscales extraídos y validados de un CFDI 4.0. */
export const esquemaCfdiDatos = z
  .object({
    version: z.string().describe('Versión del CFDI (siempre 4.0).'),
    tipoComprobante: z.enum(TIPOS_COMPROBANTE_CFDI).describe('I = ingreso · E = egreso.'),
    origen: z
      .enum(['factura_proveedor', 'nota_credito'])
      .describe('Origen de CxP derivado del tipo: I→factura_proveedor (+), E→nota_credito (−).'),
    uuid: z.string().describe('UUID (folio fiscal) del Timbre Fiscal Digital.'),
    fecha: z.string().describe('Fecha de emisión (YYYY-MM-DD).'),
    fechaTimbrado: z.string().nullable().describe('Fecha del timbrado (ISO) o null.'),
    emisorRfc: z.string().describe('RFC del emisor (el proveedor).'),
    emisorNombre: z.string().nullable().describe('Razón social del emisor o null.'),
    receptorRfc: z.string().describe('RFC del receptor (debe ser la empresa activa).'),
    receptorNombre: z.string().nullable().describe('Razón social del receptor o null.'),
    moneda: z.string().describe('Moneda del comprobante.'),
    subtotal: z.number().describe('Subtotal (antes de impuestos).'),
    total: z.number().describe('Total del comprobante (por este monto entra el cargo).'),
    ivaTrasladado: z.number().describe('IVA trasladado total.'),
    isrRetenido: z.number().describe('ISR retenido total.'),
    ivaRetenido: z.number().describe('IVA retenido total.'),
    conceptos: z.array(esquemaCfdiConcepto).describe('Conceptos (renglones).'),
  })
  .describe('Datos fiscales de un CFDI 4.0.');

/** Forma de los datos extraídos. */
export type CfdiDatos = z.infer<typeof esquemaCfdiDatos>;

// ── Candidatos de conciliación ──────────────────────────────────────────────────────────────────────

/** Proveedor candidato (match por RFC del emisor). Se ELIGE a mano en la pantalla (no auto-liga). */
export const esquemaCfdiCandidatoProveedor = z
  .object({
    idProveedor: z.number().int().describe('Id del proveedor.'),
    nombre: z.string().describe('Nombre del proveedor.'),
    rfc: z.string().nullable().describe('RFC del proveedor (catálogo R15).'),
    nombreCorto: z.string().nullable().describe('Campo corto del proveedor, o null.'),
  })
  .describe('Proveedor candidato por RFC.');

/** Forma de un candidato de proveedor. */
export type CfdiCandidatoProveedor = z.infer<typeof esquemaCfdiCandidatoProveedor>;

/**
 * Orden de compra candidata para ligar el CFDI (heurística honesta: mismo proveedor + total cercano).
 * `diferencia`/`diferenciaRelativa` ayudan a ordenar; la elección la hace el usuario.
 */
export const esquemaCfdiCandidatoOc = z
  .object({
    idOrdenCompra: z.number().int().describe('Id de la OC.'),
    numCompra: z.number().int().describe('Folio de la OC (por empresa).'),
    fecha: z.string().nullable().describe('Fecha de emisión de la OC o null.'),
    estatus: z.string().describe('Estatus de la OC.'),
    total: z
      .number()
      .nullable()
      .describe('Total de la OC (derivado; null si se ocultan importes).'),
    diferencia: z
      .number()
      .nullable()
      .describe('|total OC − total CFDI| (null si se ocultan importes).'),
    diferenciaRelativa: z
      .number()
      .nullable()
      .describe(
        'Diferencia relativa 0..1 respecto al total del CFDI (null si se ocultan importes).',
      ),
  })
  .describe('Orden de compra candidata para conciliar.');

/** Forma de una OC candidata. */
export type CfdiCandidatoOc = z.infer<typeof esquemaCfdiCandidatoOc>;

// ── Previsualización (POST /terceros/cfdi/previsualizar) ─────────────────────────────────────────────

/** Cuerpo de la previsualización / importación: el XML del CFDI como texto. */
export const esquemaCfdiXml = z
  .object({
    xml: z
      .string({ error: 'El XML del CFDI es obligatorio' })
      .trim()
      .min(1, { error: 'El XML del CFDI es obligatorio' })
      .max(2_000_000, { error: 'El XML es demasiado grande (máx 2 MB).' })
      .describe('Contenido del XML del CFDI (texto).'),
  })
  .describe('XML de un CFDI.');

/** Datos validados con el XML. */
export type DatosCfdiXml = z.infer<typeof esquemaCfdiXml>;

/** Resultado de la previsualización: datos extraídos + candidatos de conciliación + avisos. */
export const esquemaCfdiPrevisualizacion = z
  .object({
    datos: esquemaCfdiDatos.describe('Datos fiscales extraídos del XML.'),
    candidatoProveedor: esquemaCfdiCandidatoProveedor
      .nullable()
      .describe('Proveedor sugerido por RFC del emisor, o null si ninguno coincide.'),
    candidatosOc: z
      .array(esquemaCfdiCandidatoOc)
      .describe('Órdenes de compra candidatas (mismo proveedor, total cercano), por cercanía.'),
    yaImportado: z
      .boolean()
      .describe(
        '¿El UUID ya está importado? (chequeo previo; el import lo rechazaría de todos modos).',
      ),
    avisos: z.array(z.string()).describe('Avisos para revisión (receptor, sin OC, diferencias…).'),
  })
  .describe('Previsualización de un CFDI antes de importarlo.');

/** Forma de la previsualización. */
export type CfdiPrevisualizacion = z.infer<typeof esquemaCfdiPrevisualizacion>;

// ── Importación (POST /terceros/cfdi/importar) ──────────────────────────────────────────────────────

/**
 * Cuerpo de la importación: el XML + el proveedor elegido + (opcional) la operación real a ligar. El
 * cargo entra por el TOTAL del CFDI (verdad fiscal); las diferencias con la OC NO se fuerzan (viajan
 * como avisos). `refTipo` y `refId` van juntos o ninguno.
 */
export const esquemaCfdiImportarEntrada = z
  .object({
    xml: z
      .string({ error: 'El XML del CFDI es obligatorio' })
      .trim()
      .min(1, { error: 'El XML del CFDI es obligatorio' })
      .max(2_000_000, { error: 'El XML es demasiado grande (máx 2 MB).' })
      .describe('Contenido del XML del CFDI (texto).'),
    idProveedor: z.coerce
      .number({ error: 'El proveedor es obligatorio' })
      .int({ error: 'El id del proveedor debe ser entero' })
      .positive({ error: 'El id del proveedor debe ser positivo' })
      .describe('Proveedor al que se le carga el CFDI (elegido a mano).'),
    refTipo: z
      .enum(REF_TIPOS_CFDI)
      .optional()
      .describe('Tipo de operación real a ligar (orden-compra/recepcion). Con refId o ninguno.'),
    refId: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Id de la operación real ligada (según refTipo).'),
    observaciones: z.string().trim().max(1000).optional().describe('Observaciones opcionales.'),
  })
  .refine((d) => (d.refTipo === undefined) === (d.refId === undefined), {
    error: 'La liga a la operación necesita el tipo Y el id (o ninguno).',
    path: ['refId'],
  })
  .describe('Importación de un CFDI de proveedor a CxP.');

/** Datos validados de la importación. */
export type DatosCfdiImportar = z.infer<typeof esquemaCfdiImportarEntrada>;

/**
 * Resultado de importar un CFDI: el cargo fiscal creado + avisos. El XML ya lo subió el SERVIDOR a R2
 * dentro de la operación (server-side), así que no viaja ninguna URL de subida al navegador.
 */
export const esquemaCfdiImportarSalida = z
  .object({
    movimiento: esquemaMovimientoTerceroSalida.describe('El cargo/NC fiscal creado en CxP.'),
    avisos: z
      .array(z.string())
      .describe('Avisos (sin OC, diferencia con la OC, RFC del proveedor…).'),
  })
  .describe('Resultado de importar un CFDI de proveedor.');

/** Forma del resultado de la importación. */
export type CfdiImportarSalida = z.infer<typeof esquemaCfdiImportarSalida>;
