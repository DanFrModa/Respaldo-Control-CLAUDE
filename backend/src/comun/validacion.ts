/**
 * Validación de entradas con Zod → `ErrorValidacion`.
 *
 * Todos los servicios de dominio validan su entrada con un esquema Zod ANTES de
 * tocar la base de datos (PLANMAESTRO §9.2: "Zod en toda entrada"). Este helper
 * convierte el `ZodError` en nuestro `ErrorValidacion` (código `VALIDACION`),
 * con las issues aplanadas en `detalles` para que la pantalla marque el campo
 * exacto. Así las rutas REST no necesitan tratar `ZodError` de dominio como un
 * caso aparte: solo conocen `ErrorDominio`.
 */
import * as z from 'zod';

import { ErrorValidacion } from './errores.js';

/**
 * Valida `datos` contra `esquema` y devuelve el valor tipado (con defaults y
 * transformaciones aplicadas). Si la validación falla lanza `ErrorValidacion`
 * cuyo `detalles` es `{ formErrors, fieldErrors }` (formato de `z.flattenError`).
 *
 * @example
 * const entrada = validarEntrada(esquemaAlmacen, datosCrudos);
 */
export function validarEntrada<Esquema extends z.ZodType>(
  esquema: Esquema,
  datos: unknown,
): z.output<Esquema> {
  const resultado = esquema.safeParse(datos);
  if (!resultado.success) {
    throw new ErrorValidacion('Los datos capturados no son válidos.', {
      detalles: z.flattenError(resultado.error),
      causa: resultado.error,
    });
  }
  return resultado.data;
}
