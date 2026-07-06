import { z } from 'zod';

/**
 * Contrato Zod de los FACTORES del cliente para la lista de precios (F8-E4, D13/R20a — Desarrollo y
 * Cotización). Sub-recurso del Cliente: un DEFAULT por cliente (`idClienteDepartamento` NULL) + un
 * OVERRIDE opcional por departamento (decisión (a)). Los cuatro factores (margen, descuentos,
 * regalías, costo de ventas) van EN PORCENTAJE, estilo "sobre la venta" (la fórmula la aplica el
 * dominio, `dominio/costos/precio-lista.ts`, A1: aquí solo las FORMAS).
 *
 * Los porcentajes son IMPORTES sensibles: se OCULTAN (null) en la salida sin `consultas.ver-importes`
 * (mismo criterio que precosto/EsMa). La unicidad `[idCliente, idClienteDepartamento]` la enforcea el
 * dominio (upsert) — Postgres trata los NULL como distintos, así que el default único lo cuida E4.
 */

/**
 * Un porcentaje de factor: 0 ≤ % (finito). El TOPE fino (`margen < 100`, y la suma de los otros tres
 * `< 100`) lo valida el DOMINIO con un mensaje claro (no divide por ≤ 0); aquí solo el piso y el rango
 * físico de la columna `Decimal(5,2)` (≤ 999.99).
 */
const porcentajeFactor = z
  .number({ error: 'El porcentaje es obligatorio' })
  .min(0, { error: 'El porcentaje no puede ser negativo' })
  .max(999.99, { error: 'El porcentaje es demasiado grande' });

/**
 * Guardar (upsert) los factores de un cliente o de uno de sus departamentos. `idClienteDepartamento`
 * NULL/omitido = DEFAULT del cliente; un id = override de ese departamento (que debe pertenecer al
 * cliente, lo valida el dominio). Todos los porcentajes son obligatorios (no hay "medio factor").
 */
export const esquemaClienteFactoresGuardar = z.object({
  idClienteDepartamento: z
    .number({ error: 'El id del departamento debe ser un número' })
    .int({ error: 'El id del departamento debe ser entero' })
    .positive({ error: 'El id del departamento debe ser positivo' })
    .nullable()
    .optional()
    .describe('Departamento del override (null/omitido = default del cliente).'),
  margenPct: porcentajeFactor.describe('% de margen sobre la venta (debe ser < 100).'),
  descuentosPct: porcentajeFactor.describe('% de descuentos sobre la venta.'),
  regaliasPct: porcentajeFactor.describe('% de regalías sobre la venta.'),
  costoVentasPct: porcentajeFactor.describe('% de costo de ventas sobre la venta.'),
});

/** Datos validados para guardar factores. */
export type DatosClienteFactoresGuardar = z.infer<typeof esquemaClienteFactoresGuardar>;

/** Salida de un renglón de factores (default o de un departamento). Importes ocultos sin permiso. */
export const esquemaClienteFactoresSalida = z
  .object({
    id: z.number().int().describe('Id del renglón de factores.'),
    idCliente: z.number().int().describe('Cliente dueño de los factores.'),
    idClienteDepartamento: z
      .number()
      .int()
      .nullable()
      .describe('Departamento del override, o null (default del cliente).'),
    margenPct: z.number().nullable().describe('% de margen (o null sin importes).'),
    descuentosPct: z.number().nullable().describe('% de descuentos (o null sin importes).'),
    regaliasPct: z.number().nullable().describe('% de regalías (o null sin importes).'),
    costoVentasPct: z.number().nullable().describe('% de costo de ventas (o null sin importes).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que los creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que los modificó.'),
  })
  .describe('Factores de lista de precios de un cliente/departamento (D13/R20a).');

/** Forma de un renglón de factores tal como lo devuelve la API. */
export type ClienteFactoresSalida = z.infer<typeof esquemaClienteFactoresSalida>;

/** Lista de factores de un cliente (default + overrides por departamento). */
export const esquemaClienteFactoresLista = z
  .object({
    datos: z
      .array(esquemaClienteFactoresSalida)
      .describe('Factores del cliente (default + overrides por departamento).'),
  })
  .describe('Factores de lista de precios de un cliente (D13/R20a).');

/** Forma de la lista de factores de un cliente. */
export type ClienteFactoresLista = z.infer<typeof esquemaClienteFactoresLista>;
