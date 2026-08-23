import { z } from 'zod';

/**
 * Esquemas Zod de VENTAS — la vista COMERCIAL sobre el EDR (proto `vVentas`; F7-E2; D2 #5). No es un
 * módulo nuevo: es la facturación por MODELO que ya alimenta el estado de resultados, presentada como
 * lista operativa por período (importe, unidades, ticket promedio, # de líneas). UNA sola definición
 * de reglas para UI y servidor (alimenta el OpenAPI). Toda la agregación vive en `dominio/edr/ventas.ts`
 * (A1); aquí solo las FORMAS.
 *
 * Fuente = `EdrLinea` (cantVendida × precioVenta FACTURADO, D2 #5); el mes sale del encabezado `Edr`.
 * v2 NO tiene folio de factura en el EDR → la columna identificadora del proto ("Factura") se sustituye
 * por el FOLIO DE LA OP (o null en líneas manuales sin orden). Se protege con `edr.ver` (es data del EDR).
 */

/** Filtros de la consulta de ventas por período (año + mes opcional + búsqueda + paginación). */
export const esquemaVentasQuery = z
  .object({
    anio: z.coerce.number().int().min(2000).max(2100).describe('Año del período.'),
    mes: z.coerce
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe('Mes 1-12 (omitido = todos los meses del año).'),
    busqueda: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe('Busca por cliente, código de modelo o folio de la OP.'),
    pagina: z.coerce.number().int().min(1).default(1).describe('Página 1-based.'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Renglones por página.'),
  })
  .describe('Filtros de la consulta de ventas por período.');

/** Parámetros de la consulta de ventas ya coaccionados. */
export type VentasQuery = z.infer<typeof esquemaVentasQuery>;

/**
 * Una línea de venta (facturación por modelo): la orden vendida (identificada por el FOLIO DE LA OP),
 * su cliente/modelo, la cantidad, el precio facturado y el importe. `anio`/`mes` son los del período
 * (útiles cuando la consulta abarca todo el año).
 */
export const esquemaVentaLinea = z
  .object({
    id: z.number().int().describe('Id de la línea del EDR.'),
    idOrden: z.number().int().nullable().describe('Orden vendida (null en líneas manuales).'),
    folioOrden: z
      .number()
      .int()
      .nullable()
      .describe('Folio de la OP (identificador; null en líneas manuales).'),
    idCliente: z.number().int().nullable().describe('Cliente de la línea.'),
    cliente: z.string().nullable().describe('Nombre del cliente.'),
    idModelo: z.number().int().nullable().describe('Modelo vendido.'),
    modelo: z.string().nullable().describe('Código del modelo.'),
    descripcion: z.string().nullable().describe('Descripción del modelo (o de la línea manual).'),
    cantidad: z.number().int().describe('Cantidad vendida (piezas).'),
    precio: z.number().describe('Precio de venta FACTURADO por prenda.'),
    importe: z.number().describe('cantidad × precio.'),
    anio: z.number().int().describe('Año del período de la línea.'),
    mes: z.number().int().describe('Mes 1-12 del período de la línea.'),
  })
  .describe('Una línea de venta (facturación por modelo).');

/** Forma de una línea de venta. */
export type VentaLinea = z.infer<typeof esquemaVentaLinea>;

/** Resumen agregado del período (calculado EN SERVIDOR sobre TODO el filtro, no la página). */
export const esquemaVentasResumen = z
  .object({
    importe: z.number().describe('Σ(cantidad × precio) del período (ventas).'),
    unidades: z.number().int().describe('Σ cantidad (piezas).'),
    ticketPromedio: z.number().describe('importe ÷ unidades (0 si no hay unidades).'),
    lineas: z.number().int().describe('Número de líneas del período.'),
  })
  .describe('Resumen agregado de ventas del período.');

/** Forma del resumen de ventas. */
export type VentasResumen = z.infer<typeof esquemaVentasResumen>;

/** Ventas por período: resumen (todo el filtro) + página de líneas + paginación. */
export const esquemaVentasSalida = z
  .object({
    anio: z.number().int().describe('Año consultado.'),
    mes: z.number().int().nullable().describe('Mes consultado (null = todos los meses del año).'),
    resumen: esquemaVentasResumen.describe(
      'Resumen del período (sobre TODO el filtro, no la página).',
    ),
    lineas: z.array(esquemaVentaLinea).describe('Líneas de la página.'),
    total: z.number().int().describe('Total de líneas del filtro (para paginar).'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Ventas por período: resumen + página de líneas.');

/** Forma de la salida de ventas. */
export type VentasSalida = z.infer<typeof esquemaVentasSalida>;
