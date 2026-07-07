import { z } from 'zod';

/**
 * Contrato Zod de los PRECIOS de la orden (rediseño R2 — requisito de Daniel §4.4.3, brecha B1):
 * el precio real negociado de MAQUILA y de APLICACIÓN (estampado/bordado) de una orden se captura
 * con permiso (`ordenes.precio-maquila`) y deja un rastro INMUTABLE (`OrdenPrecioEvento`: quién,
 * cuándo, con qué proveedor se negoció, anterior→nuevo — D3/A7).
 *
 * Lectura gateada (paridad con el acceso 36 del viejo, "Ver Precio Real de maquila"):
 *  • El RESUMEN (`GET /ordenes/:id/precios`) es `ordenes.ver`, pero los MONTOS reales van null
 *    si la sesión no tiene `ordenes.ver-precio-real-maquila` (mismo patrón que `pedidos.importes`).
 *  • El HISTORIAL (`GET /ordenes/:id/precios/eventos`) exige `ordenes.ver-precio-real-maquila`.
 */

// ── Campo de precio ───────────────────────────────────────────────────────────────────

/** Cuál precio de la orden se captura/cambió: maquila (costura) o aplicación (estampado/bordado). */
export const esquemaCampoPrecioOrden = z
  .enum(['maquila', 'aplicacion'])
  .describe('Precio de la orden: maquila (costura) o aplicación (estampado/bordado).');

/** Forma del campo de precio. */
export type CampoPrecioOrdenApi = z.infer<typeof esquemaCampoPrecioOrden>;

// ── Edición (PATCH /ordenes/:id/precios) ─────────────────────────────────────────────

/** Cuerpo de la captura del precio real negociado (un campo por llamada, como el proto). */
export const esquemaOrdenPreciosPatchCuerpo = z
  .object({
    campo: esquemaCampoPrecioOrden,
    precio: z
      .number({ error: 'El precio debe ser un número' })
      .min(0, { error: 'El precio no puede ser negativo' })
      .describe('Precio real negociado por prenda.'),
    idProveedor: z
      .number()
      .int()
      .positive()
      .nullish()
      .describe('Proveedor con quien se negoció (maquilero/estampador), opcional.'),
    nota: z.string().trim().max(500).nullish().describe('Nota libre de la negociación, opcional.'),
  })
  .describe('Captura del precio real de maquila/aplicación de la orden (deja rastro inmutable).');

/** Forma del cuerpo de edición de precios. */
export type DatosOrdenPreciosPatch = z.infer<typeof esquemaOrdenPreciosPatchCuerpo>;

// ── Salidas ──────────────────────────────────────────────────────────────────────────

/** Resumen del ÚLTIMO evento de un campo (sin montos: los montos van en el resumen gateado). */
export const esquemaOrdenPrecioUltimoEvento = z
  .object({
    capturadoPorId: z.string().nullable().describe('Id del usuario que capturó, o null.'),
    capturadoPor: z.string().nullable().describe('Nombre de quien capturó, o null.'),
    capturadoEn: z.iso.datetime().describe('Cuándo se capturó (ISO).'),
    idProveedor: z.number().int().nullable().describe('Proveedor con quien se negoció, o null.'),
    proveedor: z.string().nullable().describe('Nombre del proveedor negociado, o null.'),
  })
  .describe('Resumen del último evento de precio de un campo (quién · cuándo · proveedor).');

/** Forma del resumen del último evento. */
export type OrdenPrecioUltimoEvento = z.infer<typeof esquemaOrdenPrecioUltimoEvento>;

/**
 * RESUMEN de precios de la orden para el panel de detalle. Los montos REALES (`maquilaReal`/
 * `aplicacionReal`) van null si la sesión no tiene `ordenes.ver-precio-real-maquila`;
 * `precioVenta` va null si no tiene `pedidos.importes` (regla de importes del doc 02 §3).
 */
export const esquemaOrdenPreciosSalida = z
  .object({
    idOrden: z.number().int().describe('Id de la orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    precioVenta: z
      .number()
      .nullable()
      .describe('Precio de venta por prenda (del renglón del pedido), o null si no ve importes.'),
    maquilaReferencia: z
      .number()
      .nullable()
      .describe('Precio de maquila de REFERENCIA (heredado del modelo: maquilaBase), o null.'),
    maquilaReal: z
      .number()
      .nullable()
      .describe('Precio REAL de maquila de la orden, o null (sin captura o sin permiso).'),
    aplicacionReal: z
      .number()
      .nullable()
      .describe('Precio REAL de aplicación de la orden, o null (sin captura o sin permiso).'),
    puedeVerReales: z
      .boolean()
      .describe('Si la sesión tiene `ordenes.ver-precio-real-maquila` (los montos vienen).'),
    ultimoEventoMaquila: esquemaOrdenPrecioUltimoEvento
      .nullable()
      .describe('Último evento del precio de maquila, o null si nunca se ha capturado.'),
    ultimoEventoAplicacion: esquemaOrdenPrecioUltimoEvento
      .nullable()
      .describe('Último evento del precio de aplicación, o null.'),
  })
  .describe('Resumen de precios de la orden (venta/maquila/aplicación) con su rastro.');

/** Forma del resumen de precios. */
export type OrdenPreciosSalida = z.infer<typeof esquemaOrdenPreciosSalida>;

/** Un evento del historial inmutable de precios (con montos: endpoint gateado). */
export const esquemaOrdenPrecioEventoSalida = z
  .object({
    id: z.number().int().describe('Id del evento.'),
    campo: esquemaCampoPrecioOrden,
    precioAnterior: z.number().nullable().describe('Precio vigente ANTES del cambio, o null.'),
    precioNuevo: z.number().describe('Precio real que quedó vigente con este evento.'),
    idProveedor: z.number().int().nullable().describe('Proveedor negociado, o null.'),
    proveedor: z.string().nullable().describe('Nombre del proveedor negociado, o null.'),
    nota: z.string().nullable().describe('Nota de la negociación, o null.'),
    capturadoPorId: z.string().nullable().describe('Id del usuario que capturó, o null.'),
    capturadoPor: z.string().nullable().describe('Nombre de quien capturó, o null.'),
    capturadoEn: z.iso.datetime().describe('Cuándo se capturó (ISO).'),
  })
  .describe('Evento inmutable del historial de precios de la orden (D3/A7).');

/** Forma de un evento del historial. */
export type OrdenPrecioEventoSalida = z.infer<typeof esquemaOrdenPrecioEventoSalida>;

/** Historial completo de eventos de precio de una orden (más reciente primero). */
export const esquemaOrdenPrecioEventosLista = z
  .object({
    idOrden: z.number().int().describe('Id de la orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    eventos: z
      .array(esquemaOrdenPrecioEventoSalida)
      .describe('Eventos del historial (más reciente primero).'),
  })
  .describe('Historial inmutable de cambios de precio de la orden.');

/** Forma del historial de eventos. */
export type OrdenPrecioEventosLista = z.infer<typeof esquemaOrdenPrecioEventosLista>;
