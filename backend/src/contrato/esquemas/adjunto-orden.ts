import { z } from 'zod';

/**
 * Contrato Zod de los ADJUNTOS de la orden de producción (F8-E6, R6). Archivos de apoyo
 * (Excel/PDF/imágenes) ligados a una orden, en Cloudflare R2 vía el motor de archivos de F0
 * (flujo presigned PUT/GET). Espejo del adjunto de proveedor (F1-E1B) SIN clasificación documental
 * (`tipo`): aquí un adjunto es sólo un archivo de apoyo. Tres formas:
 *
 *  • CREAR (solicitar subida): el navegador manda los metadatos (nombre/MIME/tamaño) y el backend
 *    registra el `Archivo` y devuelve la URL PUT prefirmada (el navegador sube DIRECTO a R2).
 *  • LISTAR: cada adjunto con su URL GET prefirmada + quién lo subió y cuándo.
 *  • ELIMINAR: por id de archivo (la orden viaja en la URL).
 *
 * Toda la lógica vive en el dominio (A1); aquí sólo las FORMAS. Permiso `ordenes.ver` para
 * listar/descargar, `ordenes.administrar` para subir/eliminar (reusa el RBAC de órdenes, sin
 * permisos nuevos).
 */

/**
 * Solicitud de subida de un adjunto de la orden: el navegador manda los metadatos del archivo y el
 * backend devuelve la URL PUT prefirmada (flujo presigned de F0).
 */
export const esquemaOrdenAdjuntoCrear = z
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
  .describe('Datos para preparar la subida de un adjunto de una orden.');

/** Datos validados de alta de adjunto de orden. */
export type DatosOrdenAdjuntoCrear = z.infer<typeof esquemaOrdenAdjuntoCrear>;

/** Salida tras solicitar la subida: registro + URL PUT prefirmada para R2. */
export const esquemaOrdenAdjuntoSubida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo creado.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida de un adjunto de orden (URL prefirmada).');

/** Forma de la respuesta al preparar la subida de un adjunto de orden. */
export type OrdenAdjuntoSubida = z.infer<typeof esquemaOrdenAdjuntoSubida>;

/** Salida de un adjunto ya registrado, con su URL GET prefirmada para verlo/descargarlo. */
export const esquemaOrdenAdjuntoSalida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    tipoMime: z.string().describe('Tipo MIME del archivo.'),
    tamanoBytes: z.number().int().describe('Tamaño en bytes.'),
    urlDescarga: z.string().describe('URL GET prefirmada para ver/descargar el archivo.'),
    subidoPorId: z.string().nullable().describe('Quién subió el archivo, o null.'),
    nombreSubidoPor: z
      .string()
      .nullable()
      .describe(
        'Nombre de quien lo subió; null si el id no resuelve (el adjunto se sigue viendo).',
      ),
    creadoEn: z.iso.datetime().describe('Fecha en que se adjuntó (ISO 8601).'),
  })
  .describe('Adjunto de una orden con su URL de descarga.');

/** Forma de un adjunto de orden tal como lo devuelve la API. */
export type OrdenAdjuntoSalida = z.infer<typeof esquemaOrdenAdjuntoSalida>;

/** Lista de adjuntos de una orden. */
export const esquemaOrdenAdjuntosLista = z
  .object({
    datos: z.array(esquemaOrdenAdjuntoSalida).describe('Adjuntos de la orden.'),
  })
  .describe('Adjuntos de una orden de producción.');

/** Forma de la lista de adjuntos de orden. */
export type OrdenAdjuntosLista = z.infer<typeof esquemaOrdenAdjuntosLista>;
