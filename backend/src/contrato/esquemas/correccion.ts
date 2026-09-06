import { z } from 'zod';

/**
 * ⭐⭐ CORREGIR un movimiento SIN FACTURA de un estado de cuenta (fila 0.145; `DECISIONES.md`
 * §Post-F9.203).
 *
 * DANIEL (6-sep-2026): *«Quiero tener manera de modificar cualquier registro que se meta en
 * cualquier estado de cuenta de los proveedores sin factura. **Sólo yo. Nadie más ni con permiso.
 * Sólo yo.**»* — y sobre la forma, tras plantearle el costo: *«Sí, está bien **con rastro**.»*
 *
 * ## Lo que este cuerpo PUEDE cambiar, y por qué no hay más
 *
 * Sólo tres cosas: el **importe**, la **fecha** y las **observaciones**. Y eso es el contrato
 * entero, no una omisión:
 *
 *  • **el PROVEEDOR y el TIPO de movimiento no son campos de este esquema**, y el objeto es
 *    `strict`: mandarlos es un 400, no un cambio silenciosamente ignorado. Cambiar de proveedor o
 *    de concepto no es *corregir* un renglón, es **otro renglón**: para eso ya existe cancelar y
 *    capturar de nuevo. Y estructuralmente tampoco podría: el servidor toma esos dos datos del
 *    movimiento corregido, nunca de la petición.
 *  • **el segmento con/sin factura tampoco viaja**: la corrección se COPIA verbatim del original.
 *    Un renglón sin factura sigue sin factura; y uno CON factura no llega hasta aquí (se rechaza).
 *
 * ## El motivo es obligatorio
 *
 * Es la mitad del *«con rastro»*: la bitácora guarda quién, cuándo, **qué decía antes** y por qué.
 * Sin motivo, la corrección sería indistinguible de una edición a secas.
 */
export const esquemaCorreccionSinFactura = z
  .strictObject({
    importe: z
      .number({ error: 'El importe debe ser un número' })
      .min(0.01, { error: 'El importe debe ser de al menos 0.01' })
      .optional()
      .describe('Nuevo importe POSITIVO. Omitir para dejarlo como está.'),
    fecha: z.iso
      .date({ error: 'La fecha debe venir como YYYY-MM-DD' })
      .optional()
      .describe('Nueva fecha del movimiento (YYYY-MM-DD). Omitir para dejarla como está.'),
    /**
     * Nuevas observaciones. `null` las BORRA (es un cambio válido: la nota estaba mal); omitirlas
     * las deja como estaban. Por eso es `.nullable().optional()` y no una cosa o la otra.
     */
    observaciones: z
      .string()
      .trim()
      .max(1000)
      .nullable()
      .optional()
      .describe('Nuevas observaciones, o null para dejarlas vacías. Omitir para no tocarlas.'),
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(1, { error: 'El motivo es obligatorio' })
      .max(1000)
      .describe('Por qué se corrige. Queda en la bitácora junto con lo que decía antes.'),
  })
  .refine(
    (d) => d.importe !== undefined || d.fecha !== undefined || d.observaciones !== undefined,
    {
      // Una corrección que no cambia nada quemaría dos folios y ensuciaría el estado de cuenta con
      // un par de renglones que no dicen nada. Se corta aquí, con el mensaje que explica qué falta.
      error: 'Indica al menos un cambio: importe, fecha u observaciones.',
      path: ['importe'],
    },
  )
  .describe('Corrección (anular + recapturar) de un movimiento sin factura.');

/** Datos validados de una corrección. */
export type DatosCorreccionSinFactura = z.infer<typeof esquemaCorreccionSinFactura>;

/** Los tres conceptos de EsMa que se pueden corregir (el CARGO no: nace de un recibo). */
export const CONCEPTOS_CORREGIBLES_ESMA = ['abono', 'descuento', 'pago'] as const;

/** Clave de un concepto corregible de EsMa. */
export type ConceptoCorregibleEsMaClave = (typeof CONCEPTOS_CORREGIBLES_ESMA)[number];

/**
 * Resultado de corregir un movimiento de EsMa: qué se anuló y qué nació en su lugar. Es deliberado
 * que devuelva los DOS ids y no sólo el nuevo: el rastro es la pareja, y con ella la pantalla puede
 * decir «el renglón 12 quedó sustituido por el 47» sin volver a preguntar.
 */
export const esquemaCorreccionEsMaSalida = z
  .object({
    concepto: z
      .enum(CONCEPTOS_CORREGIBLES_ESMA)
      .describe('Concepto corregido (abono/descuento/pago).'),
    idCorregido: z.number().int().describe('Id del movimiento que quedó anulado.'),
    idNuevo: z.number().int().describe('Id del movimiento bueno que lo sustituye.'),
  })
  .describe('Corrección de un movimiento sin factura de EsMa.');

/** Forma del resultado de una corrección de EsMa. */
export type CorreccionEsMaSalida = z.infer<typeof esquemaCorreccionEsMaSalida>;
