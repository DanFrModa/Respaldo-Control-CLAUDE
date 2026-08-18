import { z } from 'zod';

/**
 * Contrato Zod de las MEDIDAS de un avío "por medida" (rediseño R5, B11) — cierres, elástico… El avío
 * se COSTEA con un solo precio en el precosto (el PROMEDIO SIMPLE de los precios de sus medidas
 * activas) pero se COMPRA por medida, cada una con su precio real. Las medidas viven AGRUPADAS dentro
 * del avío padre (decisión Daniel). Se administran desde la pantalla de Avíos (sección expandible
 * "Medidas del avío"): un SET completo que el dominio sincroniza en UNA transacción (como los
 * proveedores del avío). Toda la lógica vive en el dominio (A1); aquí sólo las FORMAS.
 *
 * ⭐ **V1-E3g (§Post-F9.66) — la medida es un NÚMERO, no un texto.** Antes se capturaba la etiqueta a
 * mano ("15 cm") y `"53 cm"`, `"53cm"` y `"53"` eran tres medidas distintas: la orden de compra salía
 * partida en tres. Ahora se captura `valor` (solo el número) y la unidad vive UNA vez en el avío
 * (`unidadMedida`, ej. "cm"); la etiqueta la DERIVA el dominio. Daniel lo dijo así: *"el campo donde
 * se captura lo dejamos solo numérico, entonces obliga al usuario a evitar poner 53 cm, 53
 * centímetros o 53CM"* — se quita la ambigüedad en el origen en vez de limpiarla después.
 */

/** Un renglón de captura de medida: el NÚMERO + el precio real de compra + orden opcional. */
export const esquemaAvioMedidaEntrada = z.object({
  /**
   * Id de la medida que se está CORRIGIENDO. Se manda para editar una medida existente sin
   * perderla y sin crear otra: es el camino de las medidas heredadas marcadas `requiereRevision`,
   * cuya etiqueta va a cambiar al normalizarse ("15 cm" ⇒ "15 cm" con `valor` 15). Sin `id`, el
   * dominio casa por ETIQUETA derivada (comportamiento de siempre) y da de alta lo que no exista.
   */
  id: z
    .number({ error: 'El id de la medida debe ser un número' })
    .int({ error: 'El id de la medida debe ser entero' })
    .positive({ error: 'El id de la medida debe ser positivo' })
    .optional(),
  valor: z
    .number({ error: 'La medida es obligatoria y debe ser un número' })
    .positive({ error: 'La medida debe ser mayor que cero' })
    .max(999_999, { error: 'La medida es demasiado grande' })
    .describe(
      'NÚMERO de la medida, en la `unidadMedida` del avío (ej. 53 para un cierre de 53 cm).',
    ),
  precio: z
    .number({ error: 'El precio es obligatorio' })
    .nonnegative({ error: 'El precio no puede ser negativo' })
    .describe('Precio real de compra de esta medida (entra al promedio del precosto).'),
  orden: z
    .number({ error: 'El orden debe ser un número' })
    .int({ error: 'El orden debe ser entero' })
    .min(0, { error: 'El orden no puede ser negativo' })
    .optional()
    .describe('Orden de despliegue dentro del avío (opcional).'),
});

/** Datos validados de un renglón de medida. */
export type DatosAvioMedidaEntrada = z.infer<typeof esquemaAvioMedidaEntrada>;

/**
 * Cuerpo para reemplazar el SET COMPLETO de medidas de un avío (`PUT /api/avios/:id/medidas`): la
 * `unidadMedida` del avío + los renglones. El dominio sincroniza (agrega/quita/actualiza) en UNA
 * transacción A2. Puede quedar vacío (el avío deja de ser "por medida"). Sin `valor` repetido.
 *
 * `unidadMedida` es OBLIGATORIA si viene al menos una medida: sin ella el número no significa nada
 * (¿53 cm o 53 mm?) y es justo la ambigüedad que esta etapa vino a cerrar.
 */
export const esquemaAvioMedidasCuerpo = z
  .object({
    unidadMedida: z
      .string({ error: 'La unidad de las medidas debe ser texto' })
      .trim()
      .max(12, { error: 'La unidad de las medidas no puede tener más de 12 caracteres' })
      .nullable()
      .default(null)
      .describe('Unidad en que se expresan las medidas del avío (cm, mm, pulg…).'),
    medidas: z
      .array(esquemaAvioMedidaEntrada)
      .max(100, { error: 'Demasiadas medidas en el avío' })
      .refine((items) => new Set(items.map((i) => i.valor)).size === items.length, {
        error: 'Hay medidas repetidas en el avío',
      }),
  })
  .refine((c) => c.medidas.length === 0 || (c.unidadMedida !== null && c.unidadMedida !== ''), {
    error: 'Falta la unidad de las medidas del avío (cm, mm…): sin ella el número no dice nada',
    path: ['unidadMedida'],
  })
  .describe('Set completo de medidas de un avío "por medida".');

/** Datos validados del set de medidas del avío. */
export type DatosAvioMedidas = z.infer<typeof esquemaAvioMedidasCuerpo>;

/** Salida de UNA medida del avío (con su promedio se costea el precosto). */
export const esquemaAvioMedidaSalida = z
  .object({
    id: z.number().int().describe('Id de la medida.'),
    medida: z
      .string()
      .describe('ETIQUETA de la medida ("53 cm"), derivada de `valor` + la unidad del avío.'),
    valor: z
      .number()
      .nullable()
      .describe(
        'NÚMERO de la medida. `null` SOLO en filas heredadas cuya etiqueta no se pudo convertir ' +
          '("S", "vieja", rangos): quedan marcadas `requiereRevision` en vez de perderse (D3).',
      ),
    requiereRevision: z
      .boolean()
      .describe(
        '¿Esta medida necesita que alguien la corrija a mano? La migración no pudo normalizarla y ' +
          'NO adivinó. Es un AVISO, no un bloqueo: la medida sigue viva y sigue promediando.',
      ),
    precio: z.number().describe('Precio real de compra de esta medida.'),
    orden: z.number().int().describe('Orden de despliegue.'),
    activo: z.boolean().describe('Falso si está desactivada (borrado suave).'),
  })
  .describe('Medida de un avío "por medida".');

/** Forma de una medida tal como la devuelve la API. */
export type AvioMedidaSalida = z.infer<typeof esquemaAvioMedidaSalida>;

/**
 * Lista de medidas de un avío + el PROMEDIO de precios que usa el precosto (`GET /api/avios/:id/medidas`).
 * `promedioPreCosto` = AVG de los precios de las medidas ACTIVAS (null si no hay ninguna); es el valor
 * que la calculadora muestra como "Promedio (precosteo)".
 *
 * `avisos` son advertencias que **NO bloquean** (V1-E3g): medidas pendientes de revisión, falta de
 * `unidadMedida`, o números absurdos para la unidad (un cierre de 1 cm casi seguro quiso ser 100).
 */
export const esquemaAvioMedidasLista = z
  .object({
    datos: z.array(esquemaAvioMedidaSalida).describe('Medidas del avío (ordenadas).'),
    unidadMedida: z
      .string()
      .nullable()
      .describe('Unidad en que se expresan las medidas de este avío (cm, mm…), o null.'),
    promedioPreCosto: z
      .number()
      .nullable()
      .describe('Promedio de precios de las medidas activas (el que usa el precosto), o null.'),
    avisos: z
      .array(z.string())
      .describe(
        'Advertencias que NO bloquean (revisión pendiente, unidad faltante, valor absurdo).',
      ),
  })
  .describe('Medidas de un avío con el promedio del precosteo.');

/** Forma de la lista de medidas de un avío. */
export type AvioMedidasLista = z.infer<typeof esquemaAvioMedidasLista>;
