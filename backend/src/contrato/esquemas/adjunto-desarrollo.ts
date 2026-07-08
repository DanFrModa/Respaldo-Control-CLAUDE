import { z } from 'zod';

/**
 * Contrato Zod del TECH PACK / ADJUNTOS del DESARROLLO (rediseño R5, B16). PDFs de referencia y fotos
 * de muestra ligados a un desarrollo, en Cloudflare R2 vía el motor de archivos de F0 (flujo presigned
 * PUT/GET). Espejo EXACTO del adjunto de la orden (`adjunto-orden.ts`), SIN clasificación documental.
 * Tres formas: CREAR (solicitar subida), LISTAR y ELIMINAR. Toda la lógica vive en el dominio (A1);
 * aquí sólo las FORMAS. Permiso `desarrollo.ver` para listar/descargar, `desarrollo.administrar` para
 * subir/eliminar (reusa el RBAC de desarrollo, sin permisos nuevos).
 */

/** Solicitud de subida de un adjunto del desarrollo: metadatos → URL PUT prefirmada (presigned F0). */
export const esquemaDesarrolloAdjuntoCrear = z
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
      .regex(/^[\w.+-]+\/[\w.+-]+$/, { error: 'Tipo de archivo (MIME) inválido' })
      .describe('Tipo MIME del archivo (ej. application/pdf, image/png).'),
    tamanoBytes: z
      .number({ error: 'El tamaño es obligatorio' })
      .int({ error: 'El tamaño debe ser un entero de bytes' })
      .positive({ error: 'El archivo está vacío' })
      .describe('Tamaño exacto en bytes (la URL prefirmada solo acepta este tamaño).'),
  })
  .describe('Datos para preparar la subida de un adjunto de un desarrollo (tech pack).');

/** Datos validados de alta de adjunto de desarrollo. */
export type DatosDesarrolloAdjuntoCrear = z.infer<typeof esquemaDesarrolloAdjuntoCrear>;

/** Salida tras solicitar la subida: registro + URL PUT prefirmada para R2. */
export const esquemaDesarrolloAdjuntoSubida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo creado.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida de un adjunto de desarrollo (URL prefirmada).');

/** Forma de la respuesta al preparar la subida de un adjunto de desarrollo. */
export type DesarrolloAdjuntoSubida = z.infer<typeof esquemaDesarrolloAdjuntoSubida>;

/** Salida de un adjunto ya registrado, con su URL GET prefirmada para verlo/descargarlo. */
export const esquemaDesarrolloAdjuntoSalida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    tipoMime: z.string().describe('Tipo MIME del archivo.'),
    tamanoBytes: z.number().int().describe('Tamaño en bytes.'),
    urlDescarga: z.string().describe('URL GET prefirmada para ver/descargar el archivo.'),
    subidoPorId: z.string().nullable().describe('Quién subió el archivo, o null.'),
    creadoEn: z.iso.datetime().describe('Fecha en que se adjuntó (ISO 8601).'),
  })
  .describe('Adjunto de un desarrollo con su URL de descarga.');

/** Forma de un adjunto de desarrollo tal como lo devuelve la API. */
export type DesarrolloAdjuntoSalida = z.infer<typeof esquemaDesarrolloAdjuntoSalida>;

/** Lista de adjuntos de un desarrollo. */
export const esquemaDesarrolloAdjuntosLista = z
  .object({
    datos: z.array(esquemaDesarrolloAdjuntoSalida).describe('Adjuntos del desarrollo.'),
  })
  .describe('Adjuntos (tech pack) de un desarrollo.');

/** Forma de la lista de adjuntos de desarrollo. */
export type DesarrolloAdjuntosLista = z.infer<typeof esquemaDesarrolloAdjuntosLista>;
