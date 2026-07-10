import { z } from 'zod';

import { esquemaCfdiDatos } from './cfdi.js';
import { esquemaMovimientoTerceroSalida } from './terceros.js';

/**
 * Esquemas Zod de la IMPORTACIÓN de CFDI de VENTAS a CxC (Módulo 14, F9-E4; R12; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §2). UNA sola definición para UI y servidor
 * (alimenta el OpenAPI). Es importación del XML ya timbrado de las ventas propias (emitido por fuera,
 * SINUBE u otro), NO emisión (R14/PAC es posterior). Reusa el parser de CFDI de E3 (`parsearCfdi`) TAL
 * CUAL; lo que cambia respecto a CxP es la conciliación: el EMISOR debe ser la empresa activa y el
 * RECEPTOR es el cliente. El flujo: previsualizar (parsear + conciliar candidatos) → importar (el
 * servidor sube el XML a R2 SERVER-SIDE + crea el cargo FISCAL de CxC por el TOTAL del CFDI, tx A2).
 */

/** Tipos de operación real a la que se puede ligar el CFDI de venta (referencia polimórfica). */
export const REF_TIPOS_CFDI_VENTA = ['pedido'] as const;
/** Clave de un tipo de referencia de venta. */
export type RefTipoCfdiVentaClave = (typeof REF_TIPOS_CFDI_VENTA)[number];

// ── Datos extraídos del CFDI de venta (previsualización) ─────────────────────────────────────────────

/**
 * Datos fiscales extraídos de un CFDI de VENTA. Iguales a los de CxP (reusa `esquemaCfdiDatos`), salvo
 * el `origen` derivado del tipo: I (ingreso) → `factura_cliente` (+), E (egreso) → `nota_credito` (−).
 */
export const esquemaCfdiVentaDatos = esquemaCfdiDatos
  .omit({ origen: true })
  .extend({
    origen: z
      .enum(['factura_cliente', 'nota_credito'])
      .describe('Origen de CxC derivado del tipo: I→factura_cliente (+), E→nota_credito (−).'),
  })
  .describe('Datos fiscales de un CFDI 4.0 de venta.');

/** Forma de los datos extraídos de un CFDI de venta. */
export type CfdiVentaDatos = z.infer<typeof esquemaCfdiVentaDatos>;

// ── Candidatos de conciliación ──────────────────────────────────────────────────────────────────────

/** Cliente candidato (match por RFC del receptor). Se ELIGE a mano en la pantalla (no auto-liga). */
export const esquemaCfdiCandidatoCliente = z
  .object({
    idCliente: z.number().int().describe('Id del cliente.'),
    nombre: z.string().describe('Nombre del cliente.'),
    rfc: z.string().nullable().describe('RFC del cliente (catálogo, F9-E4).'),
  })
  .describe('Cliente candidato por RFC.');

/** Forma de un candidato de cliente. */
export type CfdiCandidatoCliente = z.infer<typeof esquemaCfdiCandidatoCliente>;

/**
 * Pedido candidato para ligar el CFDI de venta (heurística honesta: mismo cliente + total cercano). El
 * total del pedido se DERIVA por suma de líneas (Σ cantidad×precio), nunca una columna editable; se
 * ordenan por cercanía al total del CFDI. La elección la hace el usuario (no se auto-liga).
 */
export const esquemaCfdiCandidatoPedido = z
  .object({
    idPedido: z.number().int().describe('Id del pedido.'),
    folio: z.number().int().describe('Folio del pedido (por empresa).'),
    fecha: z.string().nullable().describe('Fecha del pedido o null.'),
    ocCliente: z.string().nullable().describe('OC del cliente ligada al pedido, o null.'),
    total: z
      .number()
      .nullable()
      .describe('Total del pedido (derivado; null si se ocultan importes).'),
    diferencia: z
      .number()
      .nullable()
      .describe('|total pedido − total CFDI| (null si se ocultan importes).'),
    diferenciaRelativa: z
      .number()
      .nullable()
      .describe(
        'Diferencia relativa 0..1 respecto al total del CFDI (null si se ocultan importes).',
      ),
  })
  .describe('Pedido candidato para conciliar.');

/** Forma de un pedido candidato. */
export type CfdiCandidatoPedido = z.infer<typeof esquemaCfdiCandidatoPedido>;

// ── Previsualización (POST /terceros/cfdi-ventas/previsualizar) ──────────────────────────────────────

/** Resultado de la previsualización: datos extraídos + candidatos de conciliación + avisos. */
export const esquemaCfdiVentaPrevisualizacion = z
  .object({
    datos: esquemaCfdiVentaDatos.describe('Datos fiscales extraídos del XML.'),
    candidatoCliente: esquemaCfdiCandidatoCliente
      .nullable()
      .describe('Cliente sugerido por RFC del receptor, o null si ninguno coincide.'),
    candidatosPedido: z
      .array(esquemaCfdiCandidatoPedido)
      .describe('Pedidos candidatos (mismo cliente, total cercano), por cercanía.'),
    yaImportado: z
      .boolean()
      .describe(
        '¿El UUID ya está importado? (chequeo previo; el import lo rechazaría de todos modos).',
      ),
    avisos: z
      .array(z.string())
      .describe('Avisos para revisión (emisor, sin pedido, diferencias…).'),
  })
  .describe('Previsualización de un CFDI de venta antes de importarlo.');

/** Forma de la previsualización de venta. */
export type CfdiVentaPrevisualizacion = z.infer<typeof esquemaCfdiVentaPrevisualizacion>;

// ── Importación (POST /terceros/cfdi-ventas/importar) ────────────────────────────────────────────────

/**
 * Cuerpo de la importación: el XML + el cliente elegido + (opcional) el pedido a ligar. El cargo entra
 * por el TOTAL del CFDI (verdad fiscal); las diferencias con el pedido NO se fuerzan (viajan como
 * avisos). `refTipo` y `refId` van juntos o ninguno.
 */
export const esquemaCfdiVentaImportarEntrada = z
  .object({
    xml: z
      .string({ error: 'El XML del CFDI es obligatorio' })
      .trim()
      .min(1, { error: 'El XML del CFDI es obligatorio' })
      .max(2_000_000, { error: 'El XML es demasiado grande (máx 2 MB).' })
      .describe('Contenido del XML del CFDI (texto).'),
    idCliente: z.coerce
      .number({ error: 'El cliente es obligatorio' })
      .int({ error: 'El id del cliente debe ser entero' })
      .positive({ error: 'El id del cliente debe ser positivo' })
      .describe('Cliente al que se le carga el CFDI (elegido a mano).'),
    refTipo: z
      .enum(REF_TIPOS_CFDI_VENTA)
      .optional()
      .describe('Tipo de operación real a ligar (pedido). Con refId o ninguno.'),
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
  .describe('Importación de un CFDI de venta a CxC.');

/** Datos validados de la importación de venta. */
export type DatosCfdiVentaImportar = z.infer<typeof esquemaCfdiVentaImportarEntrada>;

/**
 * Resultado de importar un CFDI de venta: el cargo fiscal creado + avisos. El XML ya lo subió el
 * SERVIDOR a R2 dentro de la operación (server-side), así que no viaja ninguna URL de subida al navegador.
 */
export const esquemaCfdiVentaImportarSalida = z
  .object({
    movimiento: esquemaMovimientoTerceroSalida.describe('El cargo/NC fiscal creado en CxC.'),
    avisos: z
      .array(z.string())
      .describe('Avisos (sin pedido, diferencia con el pedido, RFC del cliente…).'),
  })
  .describe('Resultado de importar un CFDI de venta.');

/** Forma del resultado de la importación de venta. */
export type CfdiVentaImportarSalida = z.infer<typeof esquemaCfdiVentaImportarSalida>;
