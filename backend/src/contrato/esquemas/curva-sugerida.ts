/**
 * Contrato Zod del JALÓN DE LA CURVA DESDE LAS ÓRDENES (V1-E3r, §Post-F9.81 punto 3): *"si el
 * modelo no tiene curva y ya tiene una OP, que jale la curva de la OP"*.
 *
 * Se PROPONE y la persona confirma — asignar la curva escribe en el catálogo y lo hereda todo lo
 * posterior (D3). Si varias OP usan curvas distintas se enseñan TODAS con cuántas OP usa cada una:
 * una regla de desempate inventada fallaría en silencio justo donde importa.
 */
import { z } from 'zod';

/** Una curva candidata: la que usan N órdenes del modelo. */
export const esquemaCurvaSugerida = z
  .object({
    idsTalla: z
      .array(z.number().int())
      .describe('Ids de talla en el orden canónico. Es LO QUE SE CONFIRMA para asignarla.'),
    etiquetas: z.array(z.string()).describe('Etiquetas, en el mismo orden que `idsTalla`.'),
    ordenes: z
      .number()
      .int()
      .describe('Cuántas órdenes NO canceladas del modelo usan este conjunto.'),
    folios: z
      .array(z.number().int())
      .describe('Folios de esas órdenes (hasta 5), para que la persona reconozca cuál es cuál.'),
    idCurvaExistente: z
      .number()
      .int()
      .nullable()
      .describe('Id de la curva del catálogo que cubre EXACTAMENTE estas tallas, o null.'),
    nombre: z
      .string()
      .describe('Nombre de esa curva del catálogo, o el nombre con el que se crearía.'),
  })
  .describe('Curva de tallas que usan las órdenes de un modelo (candidata a llenar el hueco).');

/** Lo que la pantalla necesita para ofrecer (o no) el jalón de la curva. */
export const esquemaCurvasSugeridas = z
  .object({
    idModelo: z.number().int(),
    yaTieneCurva: z
      .boolean()
      .describe('true = el modelo YA tiene curva: no hay hueco que llenar y no se propone nada.'),
    sugerencias: z.array(esquemaCurvaSugerida),
  })
  .describe('Curvas que las órdenes de un modelo sugieren (V1-E3r, §Post-F9.81).');

/** Confirmación: la persona elige UNO de los conjuntos propuestos. */
export const esquemaAsignarCurvaDesdeOrdenes = z
  .object({
    idsTalla: z
      .array(z.number().int().positive({ error: 'El id de la talla debe ser positivo' }))
      .min(1, { error: 'Hay que confirmar al menos una talla' })
      .describe(
        'Ids de talla del conjunto elegido. El servidor RE-VALIDA que sea uno de los propuestos: ' +
          'no es una lista libre de tallas que asignar.',
      ),
  })
  .describe('Confirmación del jalón de la curva desde las órdenes.');

/** Datos validados de la confirmación. */
export type DatosAsignarCurvaDesdeOrdenes = z.infer<typeof esquemaAsignarCurvaDesdeOrdenes>;

/** Resultado de la asignación: lo justo para refrescar la pantalla y decir qué pasó. */
export const esquemaCurvaAsignada = z
  .object({
    idModelo: z.number().int(),
    idCurvaTalla: z.number().int(),
    nombreCurva: z.string(),
    etiquetas: z.array(z.string()),
    curvaCreada: z
      .boolean()
      .describe('true = la curva se CREÓ en el catálogo; false = se reusó una que ya existía.'),
  })
  .describe('Curva asignada al modelo desde sus órdenes.');
