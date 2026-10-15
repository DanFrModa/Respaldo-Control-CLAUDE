import { z } from 'zod';

/**
 * Contrato Zod de las REFERENCIAS DE PRECIO DE MAQUILA de una orden (fila 0.242, §Post-F9.255).
 *
 * Daniel: el precio de maquila lo captura producción, pero *«no puede ponerlo más caro que el que
 * está en la cotización a menos que se le autorice. Yo autorizo»*. Cada proceso de la orden tiene UNA
 * referencia y el precio que se le paga al taller se rechaza si pasa de `referencia × 1.05`, salvo
 * con `ordenes.autorizar-sobreprecio`:
 *  • procesos que NO son arte (costura): su referencia vive en `OrdenReferenciaProceso`;
 *  • procesos de ARTE (estampado, bordado, aplicación, lavado): la SUMA del precio de sus renglones
 *    de arte de la orden no excluidos (`OrdenArte.precio`, §Post-F9.254).
 *
 * Lectura: `GET /ordenes/:id/referencias-maquila` con `ordenes.ver`; los MONTOS van null (y `ocultas: true`)
 * sin una llave de precios de maquila (`puedeVerReferenciasDeMaquila`). Captura:
 * `PATCH /ordenes/:id/referencias-maquila` con `ordenes.precio-maquila`. Consulta de cambios:
 * `GET /ordenes/referencias-maquila/cambios` con `ordenes.autorizar-sobreprecio`.
 */

// ── Captura (PATCH /ordenes/:id/referencias-maquila) ─────────────────────────────────────────

const precio = z
  .number({ error: 'El precio de referencia debe ser un número' })
  .min(0, { error: 'El precio de referencia no puede ser negativo' })
  .multipleOf(0.01, { error: 'El precio de referencia no puede tener más de 2 decimales' })
  .max(9_999_999_999.99, { error: 'El precio de referencia es demasiado grande' })
  .describe('Precio de referencia por prenda.');

const nota = z
  .string()
  .trim()
  .max(500, { error: 'La nota no puede pasar de 500 caracteres' })
  .nullish()
  .describe('Nota libre del cambio (por qué se movió la referencia), opcional.');

/** Referencia de un proceso que NO es arte (costura): la fila `orden × proceso`. */
export const esquemaReferenciaProcesoCaptura = z
  .object({
    idTipoProceso: z.number().int().positive().describe('Tipo de proceso que NO es arte.'),
    precio,
    nota,
  })
  .strict()
  .describe('Captura la referencia de un proceso que no es arte (costura).');

/** Referencia de ARTE: el precio de UN renglón de arte de la orden (la referencia es la suma). */
export const esquemaReferenciaArteCaptura = z
  .object({
    idOrdenArte: z.number().int().positive().describe('Renglón de arte de la orden.'),
    precio,
    nota,
  })
  .strict()
  .describe('Captura el precio de un renglón de arte de la orden (su proceso suma sus renglones).');

/** Cuerpo del PATCH: una de las dos formas. */
export const esquemaReferenciaMaquilaPatchCuerpo = z
  .union([esquemaReferenciaProcesoCaptura, esquemaReferenciaArteCaptura])
  .describe('Captura de una referencia de precio de maquila de la orden (deja rastro).');

/** Forma del cuerpo de captura. */
export type DatosReferenciaMaquilaPatch = z.infer<typeof esquemaReferenciaMaquilaPatchCuerpo>;

// ── Salida: las referencias de una orden ─────────────────────────────────────────────

/** Estado de la referencia de un proceso. */
export const esquemaEstadoReferencia = z
  .enum(['lista', 'sin-referencia', 'arte-sin-precio'])
  .describe(
    'lista = hay referencia; sin-referencia = el proceso no la tiene (el envío no sale); ' +
      'arte-sin-precio = algún renglón de arte del proceso no tiene precio (el envío no sale).',
  );

/** Un renglón de arte de un proceso. */
export const esquemaReferenciaRenglonArte = z
  .object({
    idOrdenArte: z.number().int(),
    descripcion: z.string(),
    posicion: z.string().nullable(),
    precio: z.number().nullable().describe('Precio del renglón; null sin precio o tapado.'),
  })
  .describe('Renglón de arte de la orden que suma a la referencia de su proceso.');

/** Último cambio de la referencia de un proceso (quién · cuándo; sin montos). */
export const esquemaReferenciaUltimoCambio = z
  .object({
    capturadoPor: z.string().nullable(),
    capturadoEn: z.iso.datetime(),
  })
  .describe('Último cambio de la referencia (quién y cuándo).');

/** La referencia de UN proceso en la orden. */
export const esquemaReferenciaProcesoSalida = z
  .object({
    idTipoProceso: z.number().int(),
    codigo: z.string(),
    nombre: z.string(),
    esArte: z.boolean(),
    estado: esquemaEstadoReferencia,
    referencia: z.number().nullable().describe('Referencia por prenda; null si falta o tapada.'),
    tope: z
      .number()
      .nullable()
      .describe('Tope sin autorización (referencia × 1.05); null si falta o tapada.'),
    origen: z
      .enum(['precosto', 'manual'])
      .nullable()
      .describe('De dónde salió la referencia de un proceso que no es arte; null en arte.'),
    renglones: z.array(esquemaReferenciaRenglonArte).describe('Sólo en arte: sus renglones.'),
    ultimoCambio: esquemaReferenciaUltimoCambio.nullable(),
  })
  .describe('Referencia de precio de maquila de un proceso en la orden.');

/** Las referencias de una orden (el bloque del panel de precios). */
export const esquemaReferenciasOrdenSalida = z
  .object({
    idOrden: z.number().int(),
    folioOrden: z.number().int(),
    ocultas: z.boolean().describe('true = la sesión no ve los montos de referencia (van null).'),
    procesos: z.array(esquemaReferenciaProcesoSalida),
  })
  .describe('Referencias de precio de maquila de la orden, una por proceso.');

/** Forma de las referencias de una orden. */
export type ReferenciasOrdenSalida = z.infer<typeof esquemaReferenciasOrdenSalida>;
/** Forma de la referencia de un proceso. */
export type ReferenciaProcesoSalida = z.infer<typeof esquemaReferenciaProcesoSalida>;

// ── Consulta: referencias cambiadas y sobreprecios autorizados ───────────────────────

const fechaIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'La fecha debe venir como AAAA-MM-DD' });

/** Filtros de la consulta (todos opcionales). */
export const esquemaReferenciasCambiosQuery = z
  .object({
    desde: fechaIso.optional().describe('Desde este día del negocio (incluido).'),
    hasta: fechaIso.optional().describe('Hasta este día del negocio (incluido).'),
    folio: z.coerce.number().int().positive().optional().describe('Folio de la orden.'),
    soloSobreprecios: z
      .stringbool()
      .default(false)
      .describe('Sólo los sobreprecios autorizados ("true"/"false").'),
  })
  .describe('Filtros de la consulta de referencias cambiadas.');

/**
 * Los MISMOS filtros del lado del dominio (ya parseados: `soloSobreprecios` es booleano). El dominio
 * los re-valida con éste (A1) y la ruta le pasa la salida del de arriba.
 */
export const esquemaReferenciasCambiosFiltros = z.object({
  desde: fechaIso.optional(),
  hasta: fechaIso.optional(),
  folio: z.number().int().positive().optional(),
  soloSobreprecios: z.boolean().default(false),
});

/** Forma de los filtros que recibe el dominio. */
export type ReferenciasCambiosFiltros = z.input<typeof esquemaReferenciasCambiosFiltros>;

/** Un evento del rastro. */
export const esquemaReferenciaCambioSalida = z
  .object({
    id: z.number().int(),
    idOrden: z.number().int(),
    folioOrden: z.number().int(),
    idTipoProceso: z.number().int().nullable(),
    proceso: z
      .string()
      .nullable()
      .describe('Nombre del proceso; null = todos los de arte (aplicación de la orden).'),
    accion: z.enum(['prellenado', 'captura', 'arte', 'sobreprecio']),
    referenciaAnterior: z.number().nullable(),
    referenciaNueva: z.number().nullable(),
    precioAutorizado: z.number().nullable().describe('Sólo en sobreprecio.'),
    punto: z
      .enum(['orden_maquila', 'orden_aplicacion', 'envio', 'recibo', 'cargo_esma'])
      .nullable()
      .describe('Sólo en sobreprecio: dónde se fijó el precio.'),
    nota: z.string().nullable(),
    capturadoPor: z.string().nullable(),
    capturadoEn: z.iso.datetime(),
  })
  .describe('Cambio de referencia o sobreprecio autorizado.');

/** Lista de la consulta (la más reciente primero, con tope duro). */
export const esquemaReferenciasCambiosLista = z
  .object({
    eventos: z.array(esquemaReferenciaCambioSalida),
    truncado: z.boolean().describe('true = hubo más eventos que el tope; afina los filtros.'),
    limite: z.number().int(),
  })
  .describe('Referencias cambiadas y sobreprecios autorizados.');

/** Forma de la lista de la consulta. */
export type ReferenciasCambiosLista = z.infer<typeof esquemaReferenciasCambiosLista>;
