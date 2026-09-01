import { z } from 'zod';

/**
 * Contrato Zod de las FOTOS DEL ARTE **POR ORDEN DE PRODUCCIÓN** (§Post-F9.177).
 *
 * 🔴 DANIEL, textual: *«Un modelo de desarrollo que se va a usar para **4 órdenes diferentes** no
 * puede usar la misma foto ni del modelo **ni de arte** para todas las OP. Tendría que haber la
 * posibilidad de **modificar las fotos directamente en la OP**… **la OP es de donde cuelgan las
 * fotos directamente, no del desarrollo**»*. Y: *«aplica para fotos de la prenda pero también **del
 * arte**»*.
 *
 * Es el espejo, a nivel de RENGLÓN de arte, de lo que §Post-F9.169(b) hizo con la foto de la
 * prenda. Tres cosas, y las tres se leen en una sola respuesta:
 *
 *  • **HEREDAR** — las fotos del arte del modelo se leen VIVAS (`origen: 'modelo'`). Sin decisión de
 *    la OP, se ven todas: es el comportamiento de siempre y el de todo lo ya capturado.
 *  • **OCULTAR / MOSTRAR** — una MARCA reversible por *(renglón, foto del modelo)*. 🔴 **No borra
 *    nada (D3)**: la foto sigue en el arte del modelo, otra orden la sigue viendo y **R2 no se toca
 *    jamás**.
 *  • **SUBIR / QUITAR** — fotos que ESTA OP puso (`origen: 'orden'`). Ésas sí viven en R2 y son
 *    suyas: quitarlas las borra de verdad. Es además la ÚNICA forma que tiene de llevar foto un
 *    arte AGREGADO A MANO, que no hereda de nadie.
 *
 * Toda la lógica vive en el dominio (A1); aquí sólo las FORMAS. Permisos REUSADOS, sin ninguno
 * nuevo: leer = `ordenes.ver` **o** `desarrollo.ver` (la pareja de `exigirVerLaReceta`, V1-E3j) y
 * mutar = `desarrollo.administrar` (§Post-F9.72), los mismos que gobiernan el resto del renglón.
 */

/** Solicitud de OCULTAR: qué foto heredada del arte del modelo deja de enseñar este renglón. */
export const esquemaOrdenArteFotoOcultar = z
  .object({
    idModeloArteFoto: z
      .number({ error: 'La foto es obligatoria' })
      .int({ error: 'El id de la foto debe ser entero' })
      .positive({ error: 'El id de la foto debe ser positivo' })
      .describe('Id de la foto del arte del MODELO (`ModeloArteFoto.id`) que esta OP no enseña.'),
  })
  .describe('Datos para quitar de un renglón de arte de la OP una foto heredada del modelo.');

/** Datos validados para ocultar una foto de arte en una orden. */
export type DatosOrdenArteFotoOcultar = z.infer<typeof esquemaOrdenArteFotoOcultar>;

/**
 * Solicitud de SUBIR una foto propia al renglón de arte de la OP: el navegador manda los metadatos
 * y el backend devuelve la URL PUT prefirmada (flujo presigned de F0, espejo del adjunto de orden).
 */
export const esquemaOrdenArteFotoCrear = z
  .object({
    nombreOriginal: z
      .string({ error: 'El nombre del archivo es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre del archivo es obligatorio' })
      .max(255)
      .describe('Nombre del archivo tal como lo llama el usuario.'),
    tipoMime: z
      .string({ error: 'El tipo de archivo es obligatorio' })
      .trim()
      .regex(/^image\/[\w.+-]+$/, { error: 'La foto del arte debe ser una imagen' })
      .describe('Tipo MIME de la imagen (image/jpeg, image/png…).'),
    tamanoBytes: z
      .number({ error: 'El tamaño es obligatorio' })
      .int({ error: 'El tamaño debe ser un entero de bytes' })
      .positive({ error: 'El archivo está vacío' })
      .describe('Tamaño exacto en bytes (la URL prefirmada solo acepta este tamaño).'),
  })
  .describe('Datos para preparar la subida de una foto de arte a un renglón de la OP.');

/** Datos validados de alta de foto de arte de la OP. */
export type DatosOrdenArteFotoCrear = z.infer<typeof esquemaOrdenArteFotoCrear>;

/** Salida tras solicitar la subida: registro + URL PUT prefirmada para R2. */
export const esquemaOrdenArteFotoSubida = z
  .object({
    idFoto: z.number().int().describe('Id del renglón `OrdenArteFoto` creado.'),
    idArchivo: z.string().describe('Id del registro Archivo creado.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida de una foto de arte de la OP (URL prefirmada).');

/** Forma de la respuesta al preparar la subida de una foto de arte de la OP. */
export type OrdenArteFotoSubida = z.infer<typeof esquemaOrdenArteFotoSubida>;

/**
 * UNA foto tal como la ve el renglón de arte de ESTA orden, venga de donde venga.
 *
 * ⚠️ Los dos ids son EXCLUYENTES y dicen quién manda sobre la foto:
 *  • `origen: 'modelo'` → `idModeloArteFoto` (y `idFoto` null): heredada. Se puede OCULTAR, nunca
 *    borrar — es de otro dueño.
 *  • `origen: 'orden'`  → `idFoto` (y `idModeloArteFoto` null): la subió esta OP. Se puede QUITAR
 *    de verdad (borra el archivo y su objeto de R2).
 */
export const esquemaOrdenArteFotoSalida = z
  .object({
    origen: z
      .enum(['modelo', 'orden'])
      .describe('De dónde viene la foto: heredada del arte del modelo, o subida a esta OP.'),
    idModeloArteFoto: z
      .number()
      .int()
      .nullable()
      .describe('Id de `ModeloArteFoto` cuando `origen` es "modelo"; null si no.'),
    idFoto: z
      .number()
      .int()
      .nullable()
      .describe('Id de `OrdenArteFoto` cuando `origen` es "orden"; null si no.'),
    urlDescarga: z.string().describe('URL GET prefirmada para ver la imagen.'),
    nombreOriginal: z
      .string()
      .describe('Nombre original del archivo (para el visor y la descarga).'),
    oculta: z
      .boolean()
      .describe('Heredada que esta OP dejó de enseñar. Siempre false en las de origen "orden".'),
    principal: z
      .boolean()
      .describe(
        'Es la PRIMERA foto heredada de ESTE arte (su principal). Nunca lo es una subida a la OP. ' +
          '⚠️ Nace aquí: el arte del modelo NO tiene concepto de foto principal (`ModeloArteFoto` ' +
          'sólo lleva `orden`); es la convención "la primera es la principal" sobre ese orden. ' +
          'Y ojo: en el IMPRESO la marca significa otra cosa (sólo la primerísima del PRIMER arte, ' +
          'como garantía anti-recorte de la rejilla).',
      ),
  })
  .describe('Una foto del arte tal como la enseña esta orden.');

/** Forma de una foto de arte de la OP. */
export type OrdenArteFotoSalida = z.infer<typeof esquemaOrdenArteFotoSalida>;

/** Las fotos de UN renglón de arte de la orden. */
export const esquemaOrdenArteConFotos = z
  .object({
    idOrdenArte: z.number().int().describe('Id del renglón de arte de la orden (`OrdenArte.id`).'),
    descripcion: z.string().describe('Descripción del arte EN ESTA ORDEN.'),
    agregadoAMano: z
      .boolean()
      .describe(
        'Renglón sin arte del modelo detrás: no hereda nada, sólo puede tener fotos suyas.',
      ),
    fotos: z
      .array(esquemaOrdenArteFotoSalida)
      .describe('Heredadas primero (en el orden del modelo), luego las que subió esta OP.'),
  })
  .describe('Un renglón de arte de la orden con las fotos que enseña.');

/** Forma de un renglón de arte con sus fotos. */
export type OrdenArteConFotos = z.infer<typeof esquemaOrdenArteConFotos>;

/** Lista completa: cada renglón de arte de la orden con sus fotos. */
export const esquemaOrdenArtesConFotosLista = z
  .object({
    datos: z
      .array(esquemaOrdenArteConFotos)
      .describe('Renglones de arte de la orden, cada uno con las fotos que enseña.'),
  })
  .describe('Fotos del arte de una orden de producción.');

/** Forma de la lista de artes con fotos de una orden. */
export type OrdenArtesConFotosLista = z.infer<typeof esquemaOrdenArtesConFotosLista>;
