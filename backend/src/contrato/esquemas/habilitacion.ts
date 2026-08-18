import { z } from 'zod';

/**
 * Esquemas Zod de la HABILITACIÓN / SURTIDO de avíos por orden (rediseño R6, brecha B13 —
 * `docs/rediseno/REDISENO-FRONTEND.md §4.6`; decisión de Daniel 6-jul-2026). UNA sola definición de
 * reglas para UI y servidor (alimenta el OpenAPI). Es el tablero "qué avíos lleva la orden vs. qué
 * ya se envió": por cada avío de la RECETA del modelo (BOM `ModeloAvio paraProduccion`) cruza el
 * REQUERIDO (consumo × piezas de la orden, R18) contra el ENVIADO (Σ de renglones de NOTAS DE
 * SALIDA **confirmadas** de esa orden×avío) y deja la FALTA + un estado por avío. A diferencia de
 * `estatusMaterialesOrden` (MRP, que cruza contra COMPRAS/recepciones), aquí el "enviado" sale de
 * las NOTAS DE SALIDA — nunca se doble-cuenta con las compras.
 *
 * Estados por avío (decisión de Daniel — el SOBRE-SURTIDO es un estado VÁLIDO, no un error):
 *  • `completo`      — falta ≤ 0 y no sobra (enviado cubre exactamente lo requerido).
 *  • `parcial`       — se envió algo pero aún falta.
 *  • `pendiente`     — no se ha enviado nada.
 *  • `sobre-surtido` — enviado > requerido (re-envío por extravío/daño; el % pasa de 100).
 *  • `extra`         — avío enviado a la orden que NO está en su receta (fuera de BOM).
 *
 * Solo CANTIDADES (los importes no aplican aquí, A9 sella por empresa de la orden).
 */

/** Estado de surtido de un avío de la orden. */
export const esquemaEstadoHabilitacion = z
  .enum(['completo', 'parcial', 'pendiente', 'sobre-surtido', 'extra'])
  .describe('Estado de surtido del avío en la orden.');

/** Estado de surtido de un avío. */
export type EstadoHabilitacion = z.infer<typeof esquemaEstadoHabilitacion>;

/** Un renglón (avío) del tablero de habilitación de una orden. */
export const esquemaHabilitacionAvio = z
  .object({
    idAvio: z.number().int().describe('Avío del catálogo.'),
    clave: z.string().describe('Clave del avío.'),
    descripcion: z.string().describe('Descripción del avío.'),
    unidad: z.string().nullable().describe('Unidad del avío (pza, m…), o null.'),
    esGenerico: z.boolean().describe('¿El avío es genérico (stock)?'),
    requerido: z
      .number()
      .describe('Cantidad requerida = consumo × piezas de la orden (R18). 0 en los extras.'),
    enviado: z
      .number()
      .describe('Cantidad ya enviada = Σ renglones de notas de salida CONFIRMADAS (orden×avío).'),
    falta: z.number().describe('Faltante = max(0, requerido − enviado). 0 en completos/extras.'),
    porcentaje: z
      .number()
      .describe('% de surtido real del avío (enviado/requerido×100; puede pasar de 100).'),
    esExtra: z.boolean().describe('¿Es un avío enviado FUERA de la receta de la orden?'),
    estado: esquemaEstadoHabilitacion,
    consumoPorTalla: z
      .boolean()
      .describe('¿Este avío se captura POR TALLA (R18)? Sólo esos pueden tener tallas sin medida.'),
    tallasSinMedida: z
      .array(z.string())
      .describe(
        'Etiquetas de las tallas que la orden PIDE (piezas > 0) y que NO tienen medida capturada ' +
          'en este avío (§Post-F9.64). Su requerido se calculó con el consumo por prenda. AVISA, ' +
          'NO BLOQUEA. Vacío en avíos de consumo plano y en los que sí están completos. Un cero ' +
          'CAPTURADO no aparece aquí: es una decisión, no un olvido.',
      ),
  })
  .describe('Renglón de habilitación de un avío en la orden.');

/** Un renglón de habilitación (avío) de la orden. */
export type HabilitacionAvio = z.infer<typeof esquemaHabilitacionAvio>;

/** Tablero de habilitación / surtido de avíos de UNA orden de producción (B13, R6). */
export const esquemaHabilitacionOrden = z
  .object({
    idOrden: z.number().int().describe('Orden de producción.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    idModelo: z.number().int().describe('Modelo de la orden.'),
    modelo: z.string().describe('Código del modelo.'),
    totalPiezas: z
      .number()
      .int()
      .describe('Σ de piezas color×talla de la orden (base del requerido).'),
    idMaquilero: z.number().int().nullable().describe('Maquilero asignado a la orden, o null.'),
    maquilero: z.string().nullable().describe('Nombre del maquilero asignado, o null.'),
    porcentajeGlobal: z
      .number()
      .describe('% global de surtido (Σ min(enviado, requerido) / Σ requerido × 100).'),
    totalRequerido: z.number().describe('Σ de requerido de los avíos de la receta.'),
    totalEnviado: z
      .number()
      .describe('Σ de enviado (capado al requerido) de los avíos de la receta.'),
    completos: z.number().int().describe('# de avíos de la receta completos.'),
    parciales: z.number().int().describe('# de avíos de la receta parciales.'),
    pendientes: z.number().int().describe('# de avíos de la receta sin enviar.'),
    faltaTotal: z.number().describe('Σ de faltantes de los avíos de la receta.'),
    faltanAvios: z.number().int().describe('# de avíos de la receta con faltante > 0.'),
    aviosSinMedida: z
      .number()
      .int()
      .describe(
        '# de avíos de la receta con al menos una talla sin medida capturada (§Post-F9.64). El ' +
          'conteo se AGREGA EN SERVIDOR (nunca pivoteando en el cliente).',
      ),
    avios: z.array(esquemaHabilitacionAvio).describe('Renglones (receta + extras).'),
  })
  .describe('Habilitación / surtido de avíos de una orden (requerido vs. enviado).');

/** Tablero de habilitación de una orden. */
export type HabilitacionOrden = z.infer<typeof esquemaHabilitacionOrden>;
