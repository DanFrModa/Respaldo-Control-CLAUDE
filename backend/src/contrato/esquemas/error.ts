import { z } from 'zod';

/**
 * Cuerpo de error uniforme de la API (lo produce el error handler de
 * `src/api/errores.ts`). Documentar este esquema en las respuestas de error de
 * cada ruta hace que el OpenAPI —y el cliente del frontend (E4)— conozca la
 * forma estable `{ codigo, mensaje, detalles? }` sin parsear texto libre.
 */
export const esquemaErrorApi = z
  .object({
    codigo: z
      .string()
      .describe('Código estable del error (p. ej. VALIDACION, PERMISO, NO_AUTENTICADO).'),
    mensaje: z.string().describe('Mensaje en español, apto para mostrar al usuario.'),
    detalles: z
      .unknown()
      .optional()
      .describe('Detalle estructurado opcional (p. ej. errores por campo).'),
  })
  .describe('Respuesta de error de la API.');

/** Forma del cuerpo de error de la API. */
export type ErrorApi = z.infer<typeof esquemaErrorApi>;
