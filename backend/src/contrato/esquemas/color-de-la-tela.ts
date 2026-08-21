/**
 * ⭐⭐ **LA TELA SE COMPRA POR COLOR** — contrato de V1-E3u (`DECISIONES.md` §Post-F9.89).
 *
 * Daniel: *"cuando se hace la receta no lleva el color, solo lleva la tela. Pero al pedir la tela,
 * no puedo pedir esa tela solamente, tengo que pedir el color en cada modelo. **Debo de tener la
 * posibilidad de ir comprando esa tela en diferentes colores (y pantones)**"*.
 *
 * Tres formas viajan por aquí:
 *  1. **El amarre** color-de-prenda → color-de-tela por renglón de receta (`OrdenTelaColor`), que
 *     es el puente que faltaba entre la matriz de la OP y lo que el almacén recibe.
 *  2. **La propuesta** del sistema para ese amarre — que se PROPONE pero no se guarda sola.
 *  3. **La corrección de precio** que, por decisión (b) de Daniel, **actualiza el catálogo**.
 */
import { z } from 'zod';

// ── 1) Amarre color de prenda → color de tela ────────────────────────────────────────────────────

/** De dónde salió una propuesta de color (para que la pantalla pueda decirlo, no solo pintarlo). */
export const esquemaOrigenPropuestaColor = z
  .enum(['liga-catalogo', 'mismo-pantone', 'mismo-nombre', 'unico-color', 'sin-propuesta'])
  .describe(
    'Cómo se propuso el color de tela, en orden de fuerza: `liga-catalogo` = la tela ya tenía ese ' +
      'color de prenda amarrado (`TelaColor.idColor`, la liga legada); `mismo-pantone` = el ' +
      'pantone de la OP y el del color de tela son el mismo código; `mismo-nombre` = se llaman ' +
      'igual; `unico-color` = la orden es de UN color y la tela tiene UN color dado de alta (no ' +
      'hay ambigüedad posible); `sin-propuesta` = el sistema no se atreve a proponer y lo dice.',
  );

/** Forma del origen de la propuesta. */
export type OrigenPropuestaColor = z.infer<typeof esquemaOrigenPropuestaColor>;

/** Un color de la TELA (del catálogo) que se puede elegir, con lo que hace falta para decidir. */
export const esquemaOpcionColorTela = z
  .object({
    idTelaColor: z.number().int().describe('Id del color de tela (`TelaColor`).'),
    nombre: z.string().describe('Nombre libre del color de ESA tela ("Marino Alsa 3040").'),
    pantone: z.string().nullable().describe('Pantone del color de la tela, o null.'),
    precio: z.number().nullable().describe('Precio por unidad de consumo de ESE color, o null.'),
    precioComplemento: z
      .number()
      .nullable()
      .describe('Precio del complemento (Cardigan) en ESE color, o null.'),
  })
  .describe('Color de tela elegible para un renglón de receta.');

/** Forma de una opción de color en la API. */
export type OpcionColorTela = z.infer<typeof esquemaOpcionColorTela>;

/** Un color de la MATRIZ de la orden y el color de tela que le toca (o el que se propone). */
export const esquemaColorDeLaOrden = z
  .object({
    idColor: z.number().int().describe('Color de la PRENDA (el de la matriz color×talla).'),
    color: z.string().describe('Nombre del color de la prenda.'),
    pantone: z
      .string()
      .nullable()
      .describe('Pantone que la OP capturó para ese color (`OrdenLinea.pantone`), o null.'),
    piezas: z.number().int().describe('Piezas de la orden en ese color (Σ de su fila de matriz).'),
    cantidadRequerida: z
      .number()
      .describe('Tela que pide ese color = piezas × consumo por prenda del renglón.'),
    idTelaColor: z
      .number()
      .int()
      .nullable()
      .describe('Color de tela YA amarrado a ese color de prenda en esta orden, o null.'),
    telaColor: z.string().nullable().describe('Nombre del color de tela amarrado, o null.'),
    propuestaIdTelaColor: z
      .number()
      .int()
      .nullable()
      .describe('Color de tela que el sistema PROPONE (no está guardado), o null.'),
    propuestaTelaColor: z.string().nullable().describe('Nombre del color propuesto, o null.'),
    origenPropuesta: esquemaOrigenPropuestaColor,
  })
  .describe('Color de la orden con su color de tela (amarrado y/o propuesto).');

/** Forma de un color de la orden en la API. */
export type ColorDeLaOrden = z.infer<typeof esquemaColorDeLaOrden>;

/** Un renglón de TELA de la receta con el desglose por color de la orden. */
export const esquemaTelaConColores = z
  .object({
    idOrdenTela: z.number().int().describe('Renglón de receta (`OrdenTela`).'),
    idTela: z.number().int().describe('Tela del catálogo.'),
    tela: z.string().describe('Nombre de la tela.'),
    unidad: z.string().nullable().describe('Unidad de compra/consumo de la tela (KG/M).'),
    consumoPorPrenda: z.number().describe('Consumo por prenda congelado en ESTA orden.'),
    excluido: z.boolean().describe('¿El renglón es una lápida (esta orden no lo lleva)?'),
    liberado: z.boolean().describe('¿Desarrollo ya firmó este renglón (§Post-F9.72)?'),
    colores: z.array(esquemaColorDeLaOrden).describe('Un elemento por color de la matriz de la OP.'),
    opciones: z
      .array(esquemaOpcionColorTela)
      .describe('Colores dados de alta para ESA tela (lo elegible).'),
  })
  .describe('Renglón de tela de la receta con su desglose por color.');

/** Forma de un renglón de tela con colores en la API. */
export type TelaConColores = z.infer<typeof esquemaTelaConColores>;

/** Respuesta de "¿de qué color se compra la tela de esta orden?". */
export const esquemaColoresDeTelaSalida = z
  .object({
    idOrden: z.number().int(),
    folio: z.number().int().describe('Folio de la orden de producción.'),
    telas: z.array(esquemaTelaConColores).describe('Renglones de TELA de la receta congelada.'),
  })
  .describe('Colores de tela de una orden de producción (§Post-F9.89).');

/** Forma de la respuesta en la API. */
export type ColoresDeTelaSalida = z.infer<typeof esquemaColoresDeTelaSalida>;

/** Cuerpo de "amarra este color de prenda a este color de tela" (o quítalo, con null). */
export const esquemaAsignarColorTelaCuerpo = z
  .object({
    idTela: z.number().int().positive().describe('Tela de la receta de la orden.'),
    idColor: z.number().int().positive().describe('Color de la PRENDA (de la matriz de la orden).'),
    idTelaColor: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe('Color de la TELA que le toca; `null` QUITA el amarre (D3: se dice, no se borra).'),
  })
  .describe('Amarre color de prenda → color de tela, para UNA orden (§Post-F9.89).');

/** Datos validados del amarre. */
export type DatosAsignarColorTela = z.infer<typeof esquemaAsignarColorTelaCuerpo>;

// ── 2) Corrección de precio que ACTUALIZA EL CATÁLOGO (decisión (b)) ─────────────────────────────

/**
 * Cuerpo de la corrección de precio del color. Daniel eligió *"corregir ahí actualiza el catálogo"*:
 * el número que Compras teclea en la explosión **queda como el precio de ese color para las próximas
 * compras**. Por eso el cuerpo pide de dónde viene la corrección: sin eso, la bitácora podría decir
 * quién y cuándo, pero no **desde qué compra** — y esa es justo la pregunta que se hace quien ve un
 * precio distinto al del mes pasado.
 */
export const esquemaFijarPrecioColorCuerpo = z
  .object({
    precio: z
      .number()
      .nonnegative({ error: 'El precio no puede ser negativo' })
      .nullable()
      .describe('Nuevo precio del CUERPO en ese color; `null` lo deja sin precio.'),
    precioComplemento: z
      .number()
      .nonnegative({ error: 'El precio del complemento no puede ser negativo' })
      .nullable()
      .optional()
      .describe(
        'Nuevo precio del COMPLEMENTO en ese color. Si se omite, el que ya estaba se queda como ' +
          'está (omitir ≠ mandar `null`, que sí lo borra).',
      ),
    idOrden: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe('Orden de producción desde cuya explosión se corrigió (traza para la bitácora).'),
    idOrdenCompra: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe('Orden de compra desde la que se corrigió, si ya existía (traza, §Post-F9.89(b)).'),
  })
  .describe('Corrección del precio de un color de tela — ACTUALIZA EL CATÁLOGO (§Post-F9.89(b)).');

/** Datos validados de la corrección de precio. */
export type DatosFijarPrecioColor = z.infer<typeof esquemaFijarPrecioColorCuerpo>;

/** Respuesta de la corrección: el antes y el después, para que la pantalla lo pueda ENSEÑAR. */
export const esquemaFijarPrecioColorSalida = z
  .object({
    idTelaColor: z.number().int(),
    idTela: z.number().int(),
    tela: z.string(),
    color: z.string().describe('Nombre del color de tela.'),
    precioAnterior: z.number().nullable().describe('Lo que valía antes (para poder decirlo).'),
    precio: z.number().nullable().describe('Lo que vale ahora.'),
    precioComplementoAnterior: z.number().nullable(),
    precioComplemento: z.number().nullable(),
  })
  .describe('Resultado de corregir el precio de un color de tela (con el ANTES y el DESPUÉS).');

/** Forma de la respuesta en la API. */
export type FijarPrecioColorSalida = z.infer<typeof esquemaFijarPrecioColorSalida>;
