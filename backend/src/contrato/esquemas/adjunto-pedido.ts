import { z } from 'zod';

/**
 * Contrato Zod de los ADJUNTOS del pedido interno (rediseño R3, B3). Archivos de apoyo del pedido
 * — típicamente el documento ORIGINAL de la OC del cliente (Excel/PDF/imágenes) — en Cloudflare R2
 * vía el motor de archivos de F0 (flujo presigned PUT/GET). Espejo EXACTO del adjunto de orden
 * (`adjunto-orden.ts`, F8-E6): sin clasificación documental. Tres formas:
 *
 *  • CREAR (solicitar subida): el navegador manda los metadatos (nombre/MIME/tamaño) y el backend
 *    registra el `Archivo` y devuelve la URL PUT prefirmada (el navegador sube DIRECTO a R2).
 *  • LISTAR: cada adjunto con su URL GET prefirmada + quién lo subió y cuándo.
 *  • ELIMINAR: por id de archivo (el pedido viaja en la URL).
 *
 * Toda la lógica vive en el dominio (A1); aquí sólo las FORMAS. Permiso `pedidos.ver` para
 * listar/descargar, `pedidos.administrar` para subir/eliminar (reusa el RBAC de pedidos, sin
 * permisos nuevos — mismo criterio que los adjuntos de orden con `ordenes.*`).
 */

/**
 * Solicitud de subida de un adjunto del pedido: el navegador manda los metadatos del archivo y el
 * backend devuelve la URL PUT prefirmada (flujo presigned de F0).
 */
export const esquemaPedidoAdjuntoCrear = z
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
  .describe('Datos para preparar la subida de un adjunto de un pedido.');

/** Datos validados de alta de adjunto de pedido. */
export type DatosPedidoAdjuntoCrear = z.infer<typeof esquemaPedidoAdjuntoCrear>;

/** Salida tras solicitar la subida: registro + URL PUT prefirmada para R2. */
export const esquemaPedidoAdjuntoSubida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo creado.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida de un adjunto de pedido (URL prefirmada).');

/** Forma de la respuesta al preparar la subida de un adjunto de pedido. */
export type PedidoAdjuntoSubida = z.infer<typeof esquemaPedidoAdjuntoSubida>;

/** Salida de un adjunto ya registrado, con su URL GET prefirmada para verlo/descargarlo. */
export const esquemaPedidoAdjuntoSalida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    tipoMime: z.string().describe('Tipo MIME del archivo.'),
    tamanoBytes: z.number().int().describe('Tamaño en bytes.'),
    urlDescarga: z.string().describe('URL GET prefirmada para ver/descargar el archivo.'),
    subidoPorId: z.string().nullable().describe('Quién subió el archivo, o null.'),
    creadoEn: z.iso.datetime().describe('Fecha en que se adjuntó (ISO 8601).'),
  })
  .describe('Adjunto de un pedido con su URL de descarga.');

/** Forma de un adjunto de pedido tal como lo devuelve la API. */
export type PedidoAdjuntoSalida = z.infer<typeof esquemaPedidoAdjuntoSalida>;

/** Lista de adjuntos de un pedido. */
export const esquemaPedidoAdjuntosLista = z
  .object({
    datos: z.array(esquemaPedidoAdjuntoSalida).describe('Adjuntos del pedido.'),
  })
  .describe('Adjuntos de un pedido interno.');

/** Forma de la lista de adjuntos de pedido. */
export type PedidoAdjuntosLista = z.infer<typeof esquemaPedidoAdjuntosLista>;
