import { z } from 'zod';

/**
 * Contrato Zod del sub-recurso MEDIDAS POR TALLA de un avío del BOM (F8-E1, R18).
 *
 * Para CIERTOS avíos (cierres, elástico…) el consumo NO es único por prenda: se captura POR
 * TALLA. Este contrato modela el toggle `ModeloAvio.consumoPorTalla` + la tabla de medidas
 * `ModeloAvioTalla` (una fila por talla). Doc funcional:
 * `Documentacion_MJD/PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md` (R18).
 *
 * El endpoint de guardado es SET-COMPLETO (como los renglones del BOM en F1-E4): la lista de
 * `tallas` SIEMPRE reemplaza el set actual (el dominio sincroniza agrega/quita/actualiza en una
 * transacción A2). El toggle y las medidas van JUNTOS en el mismo payload.
 *
 * Decisiones cerradas (D13):
 *  • El precosto (E3) usa el PROMEDIO SIMPLE de estas medidas (decisión (g)); el MRP (E6) compra
 *    por medida×curva. Aquí solo se captura/lee; el consumo del precosto no se calcula en este
 *    contrato.
 *  • `consumo` decimal ≥ 0 (Prisma lo guarda como `Decimal(12,4)`); sale como `number`.
 *  • Al apagar el toggle, la lista de tallas sigue reemplazando el set: si se manda `tallas:[]` se
 *    vacían las medidas; si se mandan tallas con `consumoPorTalla=false`, quedan LATENTES (se
 *    guardan aunque el toggle esté off — se reusan si se vuelve a encender).
 */

/** Consumo por talla: número ≥ 0 (Prisma lo guarda como `Decimal(12,4)`). */
const esquemaConsumoTalla = z
  .number({ error: 'El consumo debe ser un número' })
  .nonnegative({ error: 'El consumo no puede ser negativo' });

/**
 * Renglón de captura de una medida por talla: la talla del catálogo y su `consumo`. La unicidad
 * de la talla DENTRO del avío la valida el esquema del set (sin repetir) y la respalda la PK
 * compuesta `[idModelo, idAvio, idTalla]`.
 */
export const esquemaModeloAvioTallaEntrada = z.object({
  idTalla: z
    .number({ error: 'El id de la talla es obligatorio' })
    .int({ error: 'El id de la talla debe ser entero' })
    .positive({ error: 'El id de la talla debe ser positivo' }),
  consumo: esquemaConsumoTalla,
});

/** Datos validados de un renglón de medida por talla. */
export type DatosModeloAvioTallaEntrada = z.infer<typeof esquemaModeloAvioTallaEntrada>;

/**
 * Cuerpo para GUARDAR (set-completo) las medidas por talla de un avío del BOM
 * (`PUT /api/modelos/:idModelo/avios/:idAvio/medidas`): el toggle `consumoPorTalla` + la lista de
 * `tallas` (sin `idTalla` repetido; puede ir VACÍA). El dominio sincroniza en UNA transacción A2.
 */
export const esquemaMedidasAvioGuardar = z
  .object({
    consumoPorTalla: z.boolean({ error: 'consumoPorTalla debe ser verdadero o falso' }),
    tallas: z
      .array(esquemaModeloAvioTallaEntrada)
      .max(200, { error: 'Demasiadas tallas en las medidas del avío' })
      .refine((items) => new Set(items.map((i) => i.idTalla)).size === items.length, {
        error: 'Hay tallas repetidas en las medidas del avío',
      }),
  })
  .describe('Set completo de medidas por talla de un avío del BOM del modelo.');

/** Datos validados del cuerpo de guardar medidas por talla. */
export type DatosMedidasAvioGuardar = z.infer<typeof esquemaMedidasAvioGuardar>;

/** Salida de UNA medida por talla (con la etiqueta de la talla embebida para la UI). */
export const esquemaModeloAvioTallaSalida = z
  .object({
    idTalla: z.number().int().describe('Id de la talla.'),
    etiquetaTalla: z.string().describe('Etiqueta de la talla (para la UI).'),
    consumo: z.number().describe('Consumo del avío para esta talla.'),
  })
  .describe('Medida (consumo) de un avío del BOM para una talla.');

/** Forma de una medida por talla tal como la devuelve la API. */
export type ModeloAvioTallaSalida = z.infer<typeof esquemaModeloAvioTallaSalida>;

/**
 * Salida completa de las medidas por talla de un avío del BOM (respuesta de los endpoints GET y
 * PUT): el renglón (modelo, avío), el toggle `consumoPorTalla` y las `tallas` con su medida,
 * ordenadas por el orden canónico de la talla y luego por etiqueta.
 */
export const esquemaModeloAvioMedidasSalida = z
  .object({
    idModelo: z.number().int().describe('Id del modelo.'),
    idAvio: z.number().int().describe('Id del avío (renglón del BOM).'),
    consumoPorTalla: z.boolean().describe('¿Este avío se consume por talla (R18)?'),
    tallas: z.array(esquemaModeloAvioTallaSalida).describe('Medidas por talla del avío.'),
  })
  .describe('Medidas por talla de un avío del BOM de un modelo.');

/** Forma de las medidas por talla de un avío tal como las devuelve la API. */
export type ModeloAvioMedidasSalida = z.infer<typeof esquemaModeloAvioMedidasSalida>;
