import { z } from 'zod';

/**
 * Contrato Zod de las MEDIDAS de un avío "por medida" (rediseño R5, B11) — cierres, elástico… El avío
 * se COSTEA con un solo precio en el precosto (el PROMEDIO SIMPLE de los precios de sus medidas
 * activas) pero se COMPRA por medida, cada una con su precio real. Las medidas viven AGRUPADAS dentro
 * del avío padre (decisión Daniel). Se administran desde la pantalla de Avíos (sección expandible
 * "Medidas del avío"): un SET completo que el dominio sincroniza en UNA transacción (como los
 * proveedores del avío). Toda la lógica vive en el dominio (A1); aquí sólo las FORMAS.
 */

/** Un renglón de captura de medida: etiqueta + precio real de compra + orden opcional. */
export const esquemaAvioMedidaEntrada = z.object({
  medida: z
    .string({ error: 'La medida es obligatoria' })
    .trim()
    .min(1, { error: 'La medida es obligatoria' })
    .max(60, { error: 'La medida no puede tener más de 60 caracteres' })
    .describe('Etiqueta de la medida (ej. "15 cm", "18 cm").'),
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
 * Cuerpo para reemplazar el SET COMPLETO de medidas de un avío (`PUT /api/avios/:id/medidas`): el
 * dominio sincroniza (agrega/quita/actualiza) en UNA transacción A2. Puede quedar vacío (el avío deja
 * de ser "por medida"). Sin `medida` repetida dentro del avío.
 */
export const esquemaAvioMedidasCuerpo = z
  .object({
    medidas: z
      .array(esquemaAvioMedidaEntrada)
      .max(100, { error: 'Demasiadas medidas en el avío' })
      .refine((items) => new Set(items.map((i) => i.medida.trim())).size === items.length, {
        error: 'Hay medidas repetidas en el avío',
      }),
  })
  .describe('Set completo de medidas de un avío "por medida".');

/** Datos validados del set de medidas del avío. */
export type DatosAvioMedidas = z.infer<typeof esquemaAvioMedidasCuerpo>;

/** Salida de UNA medida del avío (con su promedio se costea el precosto). */
export const esquemaAvioMedidaSalida = z
  .object({
    id: z.number().int().describe('Id de la medida.'),
    medida: z.string().describe('Etiqueta de la medida.'),
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
 */
export const esquemaAvioMedidasLista = z
  .object({
    datos: z.array(esquemaAvioMedidaSalida).describe('Medidas del avío (ordenadas).'),
    promedioPreCosto: z
      .number()
      .nullable()
      .describe('Promedio de precios de las medidas activas (el que usa el precosto), o null.'),
  })
  .describe('Medidas de un avío con el promedio del precosteo.');

/** Forma de la lista de medidas de un avío. */
export type AvioMedidasLista = z.infer<typeof esquemaAvioMedidasLista>;
