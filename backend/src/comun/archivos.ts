/**
 * Servicio de archivos sobre Cloudflare R2 (MEJORAS A5, REQUISITOS R6).
 *
 * En el sistema viejo las fotos de modelos y los documentos viven en carpetas
 * de red por convención de nombres; en v2 todo adjunto vive en un bucket R2
 * (API compatible con S3) y la base de datos guarda SOLO el registro
 * (`Archivo`: bucket + key + metadatos) — PLANMAESTRO §2 "Cómo funciona
 * Cloudflare R2" y §3 (FILES → R2).
 *
 * El navegador NUNCA recibe credenciales ni pasa el archivo por nuestro
 * servidor: el flujo es con **URLs prefirmadas**:
 *
 * 1. La pantalla pide subir → `solicitarSubida(tx, sesion, …)` crea el
 *    registro `Archivo` (en la transacción del módulo que adjunta) y devuelve
 *    una URL PUT prefirmada y de vida corta.
 * 2. El navegador sube el archivo DIRECTO a R2 con esa URL.
 * 3. Para ver/descargar, `urlDescarga(key)` devuelve una URL GET prefirmada.
 *
 * La verificación de permisos es del módulo que adjunta (fotos de modelos,
 * fichas técnicas R5…): este servicio es infraestructura común y no conoce
 * esos permisos.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';

import { ErrorValidacion } from './errores.js';
import type { SesionUsuario } from './permisos.js';
import type { Tx } from './transaccion.js';
import { validarEntrada } from './validacion.js';

/**
 * El objeto de R2 pesa MÁS de lo que el llamador está dispuesto a cargar en memoria
 * (`descargarContenido(key, maxBytes)`). Es una subclase propia —y no un `ErrorValidacion` a
 * secas— para que el llamador pueda distinguir "el archivo no sirve" (estado ESTABLE: no vale la
 * pena reintentarlo en cada petición) de "R2 falló" (transitorio: hay que reintentar). Lo usa el
 * logo de la empresa para caer al empaquetado y CACHEAR esa decisión.
 */
export class ErrorArchivoDemasiadoGrande extends ErrorValidacion {}

/** Tamaño máximo aceptado por subida: 50 MB (fotos, fichas, PDFs — sobra). */
export const TAMANO_MAXIMO_BYTES = 50 * 1024 * 1024;

/** Vigencia por defecto de la URL de subida (15 min: da tiempo en redes lentas). */
export const EXPIRACION_SUBIDA_SEGUNDOS = 15 * 60;

/** Vigencia por defecto de la URL de descarga (15 min; se genera al momento de usarse). */
export const EXPIRACION_DESCARGA_SEGUNDOS = 15 * 60;

/**
 * Variables de entorno R2 (PLANMAESTRO §2: token S3 por bucket, ambientes
 * `control-v2-prueba` / `control-v2-prod`). Se validan con Zod al arrancar
 * para fallar TEMPRANO y con mensaje claro, no a la primera subida.
 */
const esquemaEnvR2 = z.object({
  R2_ACCOUNT_ID: z.string().trim().min(1, 'Falta R2_ACCOUNT_ID (id de la cuenta Cloudflare).'),
  R2_ACCESS_KEY_ID: z.string().trim().min(1, 'Falta R2_ACCESS_KEY_ID (token S3 del bucket).'),
  R2_SECRET_ACCESS_KEY: z
    .string()
    .trim()
    .min(1, 'Falta R2_SECRET_ACCESS_KEY (secreto del token S3).'),
  R2_BUCKET: z.string().trim().min(1, 'Falta R2_BUCKET (nombre del bucket del ambiente).'),
});

/** Configuración resuelta para hablar con R2. */
export interface ConfigR2 {
  cuentaId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Lee y valida la configuración R2 desde variables de entorno (`R2_*`).
 * Lanza `ErrorValidacion` listando exactamente qué variable falta.
 */
export function configR2DesdeEnv(env: Record<string, string | undefined> = process.env): ConfigR2 {
  const valido = validarEntrada(esquemaEnvR2, env);
  return {
    cuentaId: valido.R2_ACCOUNT_ID,
    accessKeyId: valido.R2_ACCESS_KEY_ID,
    secretAccessKey: valido.R2_SECRET_ACCESS_KEY,
    bucket: valido.R2_BUCKET,
  };
}

/**
 * Cliente S3 apuntado a R2: endpoint `https://<cuenta>.r2.cloudflarestorage.com`
 * y región `auto` (lo que pide la doc de R2 para su API S3).
 */
export function crearClienteR2(config: ConfigR2): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.cuentaId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // R2 (y demás S3-compatibles) NO soportan los checksums CRC32 que el SDK v3
    // de AWS agrega por DEFECTO ("WHEN_SUPPORTED") a cada PutObject: el PUT
    // prefirmado saldría con `x-amz-checksum-crc32`/`x-amz-sdk-checksum-algorithm`
    // y R2 rechaza la subida (su respuesta de error no trae cabeceras CORS, así
    // que el navegador lo disfraza de "error de CORS"). "WHEN_REQUIRED" solo los
    // manda cuando la operación los exige (un PutObject normal no) → URL
    // prefirmada limpia que R2 acepta. Aplica a fotos de bordado/modelo y a los
    // adjuntos PDF de proveedor (todos usan este cliente).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** Dependencias del servicio (inyectables: los tests pasan cliente con credenciales falsas). */
export interface DepsArchivos {
  cliente: S3Client;
  bucket: string;
  /**
   * Modo LOCAL de la subida SERVER-SIDE (`subirContenido`): NO contacta a R2, devuelve la key como si
   * hubiera subido. Solo para dev/CI, donde R2 es DUMMY (`R2_*=dev`): el firmado de las URLs
   * prefirmadas ya es 100 % local, y esto extiende ese mismo criterio a la subida server-side (que sí
   * necesitaría red) para que el stack de e2e no requiera un R2 real. En prod queda en `false` (subida
   * real a R2). El registro `Archivo` se crea igual (lo hace el llamador en su transacción).
   */
  subidaLocal?: boolean;
}

/** Solicitud de subida de un adjunto. */
const esquemaSolicitudSubida = z.object({
  /** Nombre del archivo tal como lo llama el usuario (se conserva para mostrar). */
  nombreOriginal: z.string().trim().min(1, 'El nombre del archivo es obligatorio.').max(255),
  /** Tipo MIME que reporta el navegador (ej. `image/jpeg`). */
  tipoMime: z
    .string()
    .trim()
    .regex(/^[\w.+-]+\/[\w.+-]+$/, 'Tipo de archivo (MIME) inválido.'),
  /** Tamaño exacto en bytes; la URL prefirmada solo acepta ESTE tamaño. */
  tamanoBytes: z
    .number()
    .int('El tamaño debe ser un entero de bytes.')
    .positive('El archivo está vacío.')
    .max(TAMANO_MAXIMO_BYTES, 'El archivo excede el máximo de 50 MB.'),
  /**
   * Carpeta lógica dentro del bucket, por módulo (ej. `"modelos/fotos"`).
   * Solo organiza las keys; no implica permisos.
   */
  carpeta: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/,
      'Carpeta inválida (usa minúsculas y "/", ej. "modelos/fotos").',
    )
    .default('general'),
});

export type SolicitudSubida = z.input<typeof esquemaSolicitudSubida>;

/**
 * Solicitud de subida SERVER-SIDE: el servidor YA tiene los bytes (los recibió y procesó, p. ej. el XML
 * de un CFDI) y los sube él mismo a R2. Se usa cuando NO conviene el flujo presigned del navegador —
 * porque el objeto DEBE existir sí o sí antes de referenciarlo (un cargo fiscal sin su XML sería
 * irrecuperable). Mismo `nombreOriginal`/`tipoMime`/`carpeta` que el presigned; el tamaño se toma de
 * `contenido` (no se pasa aparte).
 */
export interface SolicitudSubidaContenido {
  nombreOriginal: string;
  tipoMime: string;
  carpeta?: string;
  contenido: Buffer;
}

/**
 * Resultado de `subirContenido`: los metadatos del objeto YA en R2, para que el llamador cree el
 * registro `Archivo` DENTRO de su transacción (A2). No incluye el registro: el objeto vive en R2 y su
 * fila en BD la crea el módulo, atado a su entidad y en la misma tx que el resto de la operación.
 */
export interface ContenidoSubido {
  bucket: string;
  key: string;
  nombreOriginal: string;
  tipoMime: string;
  tamanoBytes: number;
}

/** Resultado de `solicitarSubida`. */
export interface SubidaPreparada {
  /** Registro `Archivo` recién creado (su `id` se liga a la entidad del módulo). */
  archivo: {
    id: string;
    bucket: string;
    key: string;
    nombreOriginal: string;
    tipoMime: string;
    tamanoBytes: number;
  };
  /** URL PUT prefirmada: el navegador sube DIRECTO a R2 con `Content-Type` y tamaño exactos. */
  urlSubida: string;
  /** Vigencia de `urlSubida` en segundos. */
  expiraEnSegundos: number;
}

/**
 * Convierte un nombre de archivo del usuario en un segmento de key seguro:
 * sin acentos/ñ, sin espacios ni rutas, en minúsculas y acotado. La unicidad
 * NO depende de esto (la da el UUID de la key); esto solo deja la key legible.
 */
export function sanearNombreArchivo(nombre: string): string {
  const saneado = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacríticos (á→a, ñ→n)
    .replace(/[^a-zA-Z0-9._-]+/g, '-') // todo lo demás (espacios, /, \) → guion
    .replace(/^[-.]+|[-.]+$/g, '') // sin guiones/puntos en los extremos (evita "..")
    .toLowerCase()
    .slice(0, 100);
  return saneado === '' ? 'archivo' : saneado;
}

/** Servicio de archivos ya configurado contra un bucket. */
export interface ServicioArchivos {
  /**
   * Registra el adjunto en `Archivo` (DENTRO de la transacción del módulo que
   * adjunta, A2/A5) y devuelve la URL PUT prefirmada para subirlo a R2.
   *
   * Si la transacción del llamador se revierte, el registro desaparece y la
   * URL queda apuntando a una key huérfana que nunca se usó — inofensivo.
   *
   * @example
   * const subida = await servicio.solicitarSubida(tx, sesion, {
   *   nombreOriginal: "Modelo 501 frente.jpg",
   *   tipoMime: "image/jpeg",
   *   tamanoBytes: archivo.size,
   *   carpeta: "modelos/fotos",
   * });
   */
  solicitarSubida(
    tx: Tx,
    sesion: SesionUsuario,
    solicitud: SolicitudSubida,
  ): Promise<SubidaPreparada>;

  /**
   * Sube contenido a R2 SERVER-SIDE (el servidor ya tiene los bytes) y devuelve la key + metadatos
   * para persistir el `Archivo`. NO crea el registro ni abre transacción: el llamador debe crear el
   * `Archivo` DENTRO de su transacción DESPUÉS de que esto resuelva.
   *
   * ORDEN SEGURO (por qué server-side y no presigned): el objeto se sube ANTES de la transacción; si la
   * tx falla luego, el objeto queda huérfano en R2 (inocuo — trade-off ya aceptado en el repo). Al
   * revés sería fatal: un registro/cargo que referencia un objeto que el navegador nunca subió.
   *
   * @example
   * const subido = await servicio.subirContenido({
   *   nombreOriginal: "cfdi-<uuid>.xml", tipoMime: "application/xml",
   *   carpeta: "cfdi/proveedores/2026", contenido: Buffer.from(xml, "utf8"),
   * });
   * // luego, dentro de la tx:  tx.archivo.create({ data: { bucket: subido.bucket, key: subido.key, … } })
   */
  subirContenido(solicitud: SolicitudSubidaContenido): Promise<ContenidoSubido>;

  /**
   * URL GET prefirmada y de vida corta para ver/descargar la key. Se genera
   * cada vez que se necesita (no se guarda: expira).
   *
   * @param opciones.nombreDescarga fuerza `Content-Disposition: attachment`
   *   con ese nombre (para "Descargar" en vez de abrir en el navegador).
   */
  urlDescarga(
    key: string,
    opciones?: { nombreDescarga?: string; expiraEnSegundos?: number },
  ): Promise<string>;

  /**
   * Descarga el OBJETO de R2 a memoria (`GetObjectCommand`) y devuelve sus bytes. Es la operación
   * inversa de `subirContenido`: para cuando el SERVIDOR necesita el contenido, no una URL para el
   * navegador — hoy, el LOGO de la empresa, que hay que incrustar en los impresos PDF (react-pdf
   * necesita los bytes/data-URL, no puede seguir una URL prefirmada) y servirlo por el API.
   *
   * Solo para objetos PEQUEÑOS y de uso repetido: carga todo el objeto en RAM, no hace streaming.
   * Lanza si la key no existe o R2 falla; el llamador decide si eso es fatal (para el logo NO lo
   * es: cae al empaquetado).
   *
   * @param maxBytes tope DURO de tamaño. **Úsalo siempre** que el objeto venga de una subida
   *   presigned: la URL PUT NO firma `Content-Length` (ver la nota de `solicitarSubida`), así que
   *   el tamaño que validó el POST es una PROMESA del navegador, no un hecho — el objeto real en
   *   R2 puede ser mucho más grande. Se comprueba el `ContentLength` que devuelve R2 **antes** de
   *   bufferear y, por si el objeto viniera sin esa cabecera, también los bytes ya leídos. Si se
   *   excede, lanza `ErrorValidacion` sin dejar el objeto entero en memoria.
   */
  descargarContenido(key: string, maxBytes?: number): Promise<Buffer>;

  /**
   * Borra el OBJETO físico de R2 por su key (`DeleteObjectCommand`). Se usa al eliminar un adjunto
   * para no dejar el objeto huérfano en el bucket (salda la deuda técnica de §8: antes solo se
   * borraba el registro `Archivo` y el objeto quedaba en R2).
   *
   * El llamador la invoca en modo BEST-EFFORT (fuera de la transacción de BD): si R2 falla NO debe
   * revertir el borrado del registro; a lo sumo el objeto queda huérfano (el estado anterior). R2
   * es idempotente en DELETE (borrar una key inexistente responde 204, no error).
   */
  eliminarObjeto(key: string): Promise<void>;
}

/**
 * Operaciones de OBJETO CRUDO sobre el bucket (V1-E6a). Van en una interfaz APARTE de
 * {@link ServicioArchivos} a propósito: aquélla modela los ADJUNTOS de negocio (registro `Archivo`,
 * URLs prefirmadas para el navegador, keys con UUID) y la implementan a mano una docena de dobles de
 * prueba; esto de aquí es el bucket pelón, y hoy lo usa un solo cliente —el respaldo—, que no
 * adjunta nada a ninguna entidad. Separarlas evita obligar a esos dobles a fingir operaciones que su
 * módulo jamás llama.
 */
export interface OperacionesObjetoR2 {
  /**
   * Sube un ARCHIVO DEL DISCO a una key EXACTA, en streaming (V1-E6a, respaldo). Se
   * distingue de `subirContenido` en tres cosas que el respaldo necesita y los adjuntos no:
   *
   *  1. **No pasa por memoria**: manda un `ReadStream`, no un `Buffer`. El volcado de la base puede
   *     pesar cientos de MB y el contenedor de Railway tiene RAM contada — `subirContenido` además
   *     tiene un tope duro de 50 MB heredado del validador de adjuntos.
   *  2. **La key la manda el llamador**, sin UUID ni saneado: la retención necesita keys
   *     PREDECIBLES y ordenables por fecha, no aleatorias.
   *  3. **IGNORA `subidaLocal`**: sube de verdad, siempre. El modo no-op de dev/CI existe para no
   *     exigir un R2 real en las pruebas; aplicado a un respaldo produciría exactamente la mentira
   *     que el respaldo debe evitar ("subió bien" sin que exista el objeto). Quien no deba respaldar
   *     apaga el JOB, no la subida.
   *
   * No crea registro `Archivo`: un respaldo no es un adjunto de negocio, su rastro es
   * `RespaldoCorrida`.
   *
   * @returns los bytes que se enviaron (los del archivo en disco), para contrastarlos luego contra
   *   lo que reporte {@link ServicioArchivos.tamanoObjeto}.
   */
  subirArchivoDesdeRuta(key: string, ruta: string, tipoMime: string): Promise<number>;

  /**
   * Pregunta a R2 por el TAMAÑO de un objeto (`HeadObjectCommand`); `null` si no existe. Es la
   * COMPROBACIÓN de que una subida quedó: que un `PutObject` no haya lanzado no prueba que el
   * objeto esté ahí (proxies, reintentos, cortes a media transferencia). Verificar cuesta una
   * llamada y evita descubrir el hueco el día que haya que restaurar.
   */
  tamanoObjeto(key: string): Promise<number | null>;

  /**
   * Lista los objetos bajo un prefijo (`ListObjectsV2Command`, paginando hasta agotar). Lo usa la
   * retención del respaldo para saber qué hay guardado y desde cuándo. Devuelve key, tamaño y
   * `LastModified`.
   *
   * @param maxObjetos tope de seguridad: corta el paginado para no traerse un bucket entero si el
   *   prefijo estuviera mal puesto.
   */
  listarObjetos(
    prefijo: string,
    maxObjetos?: number,
  ): Promise<{ key: string; tamanoBytes?: number; ultimaModificacion?: Date }[]>;
}

/** El servicio completo: adjuntos de negocio + operaciones de objeto crudo sobre el mismo bucket. */
export type ServicioArchivosCompleto = ServicioArchivos & OperacionesObjetoR2;

/** Construye el servicio con dependencias explícitas (producción y tests usan la misma vía). */
export function crearServicioArchivos(deps: DepsArchivos): ServicioArchivosCompleto {
  return {
    async solicitarSubida(tx, sesion, solicitud) {
      const datos = validarEntrada(esquemaSolicitudSubida, solicitud);

      // Key única y legible: carpeta/uuid/nombre-saneado. El UUID evita
      // colisiones; el nombre al final deja las URLs y logs entendibles.
      const key = `${datos.carpeta}/${randomUUID()}/${sanearNombreArchivo(datos.nombreOriginal)}`;

      const archivo = await tx.archivo.create({
        data: {
          bucket: deps.bucket,
          key,
          nombreOriginal: datos.nombreOriginal,
          tipoMime: datos.tipoMime,
          tamanoBytes: datos.tamanoBytes,
          subidoPorId: sesion.id,
        },
        select: {
          id: true,
          bucket: true,
          key: true,
          nombreOriginal: true,
          tipoMime: true,
          tamanoBytes: true,
        },
      });

      // NO firmamos content-type ni content-length. El navegador trata
      // `Content-Length` como "forbidden header" (lo fija él mismo, el JS no
      // puede) y maneja content-type de forma especial; firmarlos hace que el
      // canonical request de SigV4 NO cuadre y R2 rechace el PUT real con
      // 403 AccessDenied — y como la respuesta de error de R2 no trae cabeceras
      // CORS, el navegador lo disfraza de "error de CORS". Firmamos solo lo
      // esencial (host + los query `X-Amz-*`); la integridad se apoya en que la
      // URL es de un solo uso, con UUID en la key y vida corta. El `Content-Type`
      // del objeto lo fija el header que manda el navegador (ver `frontend/src/api/artes.ts`).
      const urlSubida = await getSignedUrl(
        deps.cliente,
        new PutObjectCommand({ Bucket: deps.bucket, Key: key }),
        { expiresIn: EXPIRACION_SUBIDA_SEGUNDOS },
      );

      return { archivo, urlSubida, expiraEnSegundos: EXPIRACION_SUBIDA_SEGUNDOS };
    },

    async subirContenido(solicitud) {
      const tamanoBytes = solicitud.contenido.byteLength;
      // Reutiliza la MISMA validación del presigned (nombre/mime/carpeta/tamaño); el tamaño real lo da
      // el buffer, no lo reporta el navegador.
      const datos = validarEntrada(esquemaSolicitudSubida, {
        nombreOriginal: solicitud.nombreOriginal,
        tipoMime: solicitud.tipoMime,
        tamanoBytes,
        carpeta: solicitud.carpeta,
      });

      const key = `${datos.carpeta}/${randomUUID()}/${sanearNombreArchivo(datos.nombreOriginal)}`;

      // Modo local (dev/CI): NO contacta a R2 (credenciales dummy) — la "subida" es un no-op y solo se
      // devuelve la key. En prod (subidaLocal=false) sube de verdad con PutObject (Body = los bytes).
      if (deps.subidaLocal !== true) {
        await deps.cliente.send(
          new PutObjectCommand({
            Bucket: deps.bucket,
            Key: key,
            Body: solicitud.contenido,
            ContentType: datos.tipoMime,
          }),
        );
      }

      return {
        bucket: deps.bucket,
        key,
        nombreOriginal: datos.nombreOriginal,
        tipoMime: datos.tipoMime,
        tamanoBytes,
      };
    },

    async urlDescarga(key, opciones) {
      if (key.trim() === '') {
        throw new ErrorValidacion('La key del archivo es obligatoria.');
      }
      return getSignedUrl(
        deps.cliente,
        new GetObjectCommand({
          Bucket: deps.bucket,
          Key: key,
          ResponseContentDisposition:
            opciones?.nombreDescarga === undefined
              ? undefined
              : `attachment; filename="${sanearNombreArchivo(opciones.nombreDescarga)}"`,
        }),
        { expiresIn: opciones?.expiraEnSegundos ?? EXPIRACION_DESCARGA_SEGUNDOS },
      );
    },

    async descargarContenido(key, maxBytes) {
      if (key.trim() === '') {
        throw new ErrorValidacion('La key del archivo es obligatoria.');
      }
      const respuesta = await deps.cliente.send(
        new GetObjectCommand({ Bucket: deps.bucket, Key: key }),
      );
      if (respuesta.Body === undefined) {
        throw new ErrorValidacion(`El objeto "${key}" no tiene contenido en R2.`);
      }
      // Corte por el tamaño que REPORTA R2, antes de bufferear nada: el `tamanoBytes` que validó
      // el POST no obliga a nada (la URL PUT no firma Content-Length), así que este es el único
      // punto donde se conoce el tamaño real sin traerse el objeto.
      if (maxBytes !== undefined && (respuesta.ContentLength ?? 0) > maxBytes) {
        throw new ErrorArchivoDemasiadoGrande(
          `El objeto "${key}" pesa más de lo permitido (${String(maxBytes)} bytes).`,
        );
      }
      // `transformToByteArray` lo da el SDK v3 para cualquier stream (Node o web).
      const bytes = Buffer.from(await respuesta.Body.transformToByteArray());
      // Cinturón y tirantes: si R2 no mandó `ContentLength`, el corte de arriba no aplicó.
      if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
        throw new ErrorArchivoDemasiadoGrande(
          `El objeto "${key}" pesa más de lo permitido (${String(maxBytes)} bytes).`,
        );
      }
      return bytes;
    },

    async subirArchivoDesdeRuta(key, ruta, tipoMime) {
      if (key.trim() === '') {
        throw new ErrorValidacion('La key del archivo es obligatoria.');
      }
      const info = await stat(ruta);
      // `ContentLength` explícito: con un stream el SDK no puede deducir el tamaño, y sin él usaría
      // `Transfer-Encoding: chunked`, que R2 rechaza en PutObject simple.
      await deps.cliente.send(
        new PutObjectCommand({
          Bucket: deps.bucket,
          Key: key,
          Body: createReadStream(ruta),
          ContentLength: info.size,
          ContentType: tipoMime,
        }),
      );
      return info.size;
    },

    async tamanoObjeto(key) {
      if (key.trim() === '') {
        throw new ErrorValidacion('La key del archivo es obligatoria.');
      }
      try {
        const respuesta = await deps.cliente.send(
          new HeadObjectCommand({ Bucket: deps.bucket, Key: key }),
        );
        return respuesta.ContentLength ?? null;
      } catch (error) {
        // "No existe" es una RESPUESTA, no un fallo: se distingue de un error de red o de permisos
        // (que sí deben propagar, porque significan que no sabemos si el objeto está o no).
        const nombre = (error as { name?: string }).name;
        const codigo = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (nombre === 'NotFound' || nombre === 'NoSuchKey' || codigo === 404) {
          return null;
        }
        throw error;
      }
    },

    async listarObjetos(prefijo, maxObjetos = 10_000) {
      const objetos: { key: string; tamanoBytes?: number; ultimaModificacion?: Date }[] = [];
      let continuacion: string | undefined;
      do {
        const respuesta = await deps.cliente.send(
          new ListObjectsV2Command({
            Bucket: deps.bucket,
            Prefix: prefijo,
            ContinuationToken: continuacion,
          }),
        );
        for (const objeto of respuesta.Contents ?? []) {
          if (objeto.Key === undefined) {
            continue;
          }
          objetos.push({
            key: objeto.Key,
            ...(objeto.Size === undefined ? {} : { tamanoBytes: objeto.Size }),
            ...(objeto.LastModified === undefined
              ? {}
              : { ultimaModificacion: objeto.LastModified }),
          });
        }
        continuacion = respuesta.IsTruncated === true ? respuesta.NextContinuationToken : undefined;
      } while (continuacion !== undefined && objetos.length < maxObjetos);
      return objetos;
    },

    async eliminarObjeto(key) {
      if (key.trim() === '') {
        throw new ErrorValidacion('La key del archivo es obligatoria.');
      }
      await deps.cliente.send(new DeleteObjectCommand({ Bucket: deps.bucket, Key: key }));
    },
  };
}

let servicioDesdeEnv: ServicioArchivosCompleto | undefined;

/**
 * Servicio de archivos del proceso, armado desde las variables `R2_*` la
 * primera vez que se pide (lazy: importar dominio no exige tener R2 configurado,
 * p. ej. en jobs que no tocan archivos).
 */
export function servicioArchivos(): ServicioArchivosCompleto {
  if (servicioDesdeEnv === undefined) {
    const config = configR2DesdeEnv();
    servicioDesdeEnv = crearServicioArchivos({
      cliente: crearClienteR2(config),
      bucket: config.bucket,
      // Solo dev/CI (R2 dummy) lo activa por env; prod (Railway) no lo setea → subida server-side real.
      subidaLocal: process.env.R2_SUBIDA_LOCAL === 'true',
    });
  }
  return servicioDesdeEnv;
}

/**
 * Decisión de arranque ante `R2_SUBIDA_LOCAL`. Un modo que descarta subidas (XML fiscales de CFDI y
 * adjuntos) en un no-op NO puede embarcar mudo: `avisar` (warn RUIDOSO) cuando el R2 es DUMMY (dev/CI,
 * donde el no-op es lo esperado) y `abortar` (rehúsa arrancar) cuando hay un R2 REAL disponible (ahí el
 * no-op sí es peligroso: se descartarían documentos teniendo dónde guardarlos). `ok` = flag apagado.
 */
export interface DecisionArranqueSubidaLocal {
  accion: 'ok' | 'avisar' | 'abortar';
  /** Mensaje para loguear (avisar) o con el que abortar. Vacío cuando `accion === 'ok'`. */
  mensaje?: string;
}

/**
 * Valores PLACEHOLDER de credenciales R2: no son un R2 real (los del `docker-compose.yml` son `dev`).
 * El vacío también cuenta como dummy. Si el access-key o el secret son uno de estos, NO hay un R2 real
 * donde escribir → el no-op de la subida local es inofensivo.
 */
const CREDENCIALES_R2_DUMMY = new Set(['', 'dev', 'dummy', 'local', 'test']);

/**
 * ¿Las credenciales R2 del entorno son placeholders (dev/CI) y no un R2 real? Se mira el access-key y el
 * secret: si CUALQUIERA es dummy/vacío, no hay un R2 real disponible. (Criterio propio: el presign
 * nunca necesitó distinguirlos porque firmar es local; la subida server-side sí lo requiere.)
 *
 * Exportada desde V1-E6a: el guard de arranque del RESPALDO diario la reusa para no programar un job
 * que subiría cada noche a una cuenta que no existe (`comun/respaldo/config.ts`).
 */
export function credencialesR2SonDummy(env: Record<string, string | undefined>): boolean {
  const accessKey = (env.R2_ACCESS_KEY_ID ?? '').trim().toLowerCase();
  const secret = (env.R2_SECRET_ACCESS_KEY ?? '').trim().toLowerCase();
  return CREDENCIALES_R2_DUMMY.has(accessKey) || CREDENCIALES_R2_DUMMY.has(secret);
}

/**
 * Decide qué hacer con `R2_SUBIDA_LOCAL` al arrancar. Función PURA (recibe el env, no toca nada): el
 * llamador (`servidor.ts`) ejecuta el efecto (log.warn o exit≠0). Testeable en aislamiento.
 *
 * La señal de peligro NO es `NODE_ENV` (la imagen de producción se usa TAMBIÉN en e2e, que corre con el
 * flag encendido a propósito), sino "hay un R2 REAL y aun así se pide no-op": flag + credenciales reales
 * → `abortar`; flag + credenciales dummy (dev/CI) → `avisar`; flag apagado → `ok`.
 */
export function decidirArranqueSubidaLocal(
  env: Record<string, string | undefined> = process.env,
): DecisionArranqueSubidaLocal {
  if (env.R2_SUBIDA_LOCAL !== 'true') {
    return { accion: 'ok' };
  }
  if (credencialesR2SonDummy(env)) {
    return {
      accion: 'avisar',
      mensaje:
        '⚠️ R2_SUBIDA_LOCAL=true con credenciales R2 DUMMY — la subida server-side a R2 es NO-OP (solo ' +
        'dev/CI). Con un R2 real, los XML de CFDI y adjuntos NO se guardarían.',
    };
  }
  return {
    accion: 'abortar',
    mensaje:
      'R2_SUBIDA_LOCAL=true con credenciales R2 REALES: la subida server-side sería NO-OP y descartaría ' +
      'los XML de CFDI / adjuntos teniendo un R2 disponible. Es un modo SOLO para dev/CI — quita ' +
      'R2_SUBIDA_LOCAL y reinicia.',
  };
}
