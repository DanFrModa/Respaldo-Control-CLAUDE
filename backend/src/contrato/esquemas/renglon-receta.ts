import { z } from 'zod';

/**
 * Vocabulario COMPARTIDO de la receta de una orden: las tres secciones que la forman
 * (`OrdenTela` / `OrdenAvio` / `OrdenArte`).
 *
 * ⚠️ **Vive en su propio archivo por una razón de grafo, no de estética.** Lo necesitan las DOS
 * comparaciones de la receta y sus archivos se importan entre sí:
 *  • `receta-orden.ts` — la receta completa y su desalineación VERTICAL (contra el modelo), que
 *    publica `frenteAlGrupo` dentro de su salida, y
 *  • `hermanas-op.ts` — la comparación HORIZONTAL (contra las OP hermanas), que define
 *    `frenteAlGrupo`.
 *
 * Si el enum viviera en cualquiera de los dos, el otro tendría que importarlo y el ciclo **revienta
 * al arrancar** — MEDIDO, no supuesto: rehecho el ciclo a propósito, `npm run openapi` muere con
 *
 *     ReferenceError: Cannot access 'esquemaFrenteAlGrupo' before initialization
 *
 * porque los esquemas de Zod se construyen AL EVALUAR el módulo: `receta-orden` entra primero, pide
 * `hermanas-op`, éste vuelve a `receta-orden` (a medio evaluar) y, cuando el control regresa, el
 * `const` que faltaba sigue en TDZ. Un `z.enum` repetido en cada lado sería la otra salida, y es
 * peor: dos vocabularios que se separan en la primera corrección.
 */

/** Qué clase de renglón es (las tres secciones de la receta de la orden). */
export const esquemaTipoRenglonReceta = z
  .enum(['tela', 'avio', 'arte'])
  .describe('Sección de la receta a la que pertenece el renglón.');

/** Clave del tipo de renglón. */
export type TipoRenglonRecetaClave = z.infer<typeof esquemaTipoRenglonReceta>;
