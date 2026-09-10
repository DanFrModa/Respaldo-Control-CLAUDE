import { z } from 'zod';

/**
 * Contrato Zod de las FOTOS DEL MODELO OCULTAS EN UNA ORDEN (§Post-F9.169(b), DANIEL: *"la foto
 * debería de ser de la OP no del desarrollo… también la opción de quitarlas de la OP"*).
 *
 * 🔴 **OCULTAR NO ES BORRAR (D3).** Estas tres formas NO hablan de archivos: hablan de una MARCA por
 * *(orden, foto del modelo)*. La foto sigue en la galería del modelo, otra orden del mismo modelo la
 * sigue viendo y **R2 no se toca nunca** (no hay `Archivo` que crear ni destruir aquí — compárese
 * con `adjunto-orden.ts`, que sí es el contrato de subir/quitar archivos de la orden).
 *
 *  • OCULTAR: el id de la foto del MODELO que esta orden deja de enseñar.
 *  • LISTAR: qué fotos oculta esta orden (para que la pantalla las pinte apagadas y ofrezca
 *    traerlas de vuelta — una foto oculta que no se puede recuperar sería una trampa).
 *  • MOSTRAR: por id de la foto (la orden viaja en la URL).
 *
 * Toda la lógica vive en el dominio (A1); aquí sólo las FORMAS. Permiso `ordenes.ver` para listar y
 * `ordenes.administrar` para ocultar/mostrar: los MISMOS que ya gobiernan subir y quitar fotos de la
 * orden — sin permisos nuevos.
 */

/** Solicitud de OCULTAR: qué foto del modelo deja de enseñar esta orden. */
export const esquemaOrdenFotoOcultar = z
  .object({
    idModeloFoto: z
      .number({ error: 'La foto es obligatoria' })
      .int({ error: 'El id de la foto debe ser entero' })
      .positive({ error: 'El id de la foto debe ser positivo' })
      .describe('Id de la foto del MODELO (`ModeloFoto.id`) que esta orden deja de enseñar.'),
  })
  .describe('Datos para ocultar en una orden una foto heredada del modelo.');

/** Datos validados para ocultar una foto del modelo en una orden. */
export type DatosOrdenFotoOcultar = z.infer<typeof esquemaOrdenFotoOcultar>;

/** Salida de UNA foto oculta: qué foto y desde cuándo (quién queda en la bitácora, A7). */
export const esquemaOrdenFotoOcultaSalida = z
  .object({
    idModeloFoto: z.number().int().describe('Id de la foto del modelo que esta orden no enseña.'),
    ocultadaEn: z.iso.datetime().describe('Cuándo se ocultó en esta orden (ISO 8601).'),
  })
  .describe('Una foto del modelo oculta en esta orden.');

/** Forma de una foto oculta tal como la devuelve la API. */
export type OrdenFotoOcultaSalida = z.infer<typeof esquemaOrdenFotoOcultaSalida>;

/** Lista de las fotos del modelo que esta orden oculta (vacía = enseña todas, el caso normal). */
export const esquemaOrdenFotosOcultasLista = z
  .object({
    datos: z
      .array(esquemaOrdenFotoOcultaSalida)
      .describe('Fotos del modelo ocultas en esta orden; vacío = la orden las enseña todas.'),
  })
  .describe('Fotos del modelo ocultas en una orden de producción.');

/** Forma de la lista de fotos ocultas de una orden. */
export type OrdenFotosOcultasLista = z.infer<typeof esquemaOrdenFotosOcultasLista>;
