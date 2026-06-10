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

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';

import { ErrorValidacion } from './errores.js';
import type { SesionUsuario } from './permisos.js';
import type { Tx } from './transaccion.js';
import { validarEntrada } from './validacion.js';

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
  });
}

/** Dependencias del servicio (inyectables: los tests pasan cliente con credenciales falsas). */
export interface DepsArchivos {
  cliente: S3Client;
  bucket: string;
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
}

/** Construye el servicio con dependencias explícitas (producción y tests usan la misma vía). */
export function crearServicioArchivos(deps: DepsArchivos): ServicioArchivos {
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

      // ContentType y ContentLength van FIRMADOS: R2 rechaza una subida con
      // otro tipo u otro tamaño que los declarados. El presigner no firma
      // content-type salvo que se pida explícito (signableHeaders).
      const urlSubida = await getSignedUrl(
        deps.cliente,
        new PutObjectCommand({
          Bucket: deps.bucket,
          Key: key,
          ContentType: datos.tipoMime,
          ContentLength: datos.tamanoBytes,
        }),
        {
          expiresIn: EXPIRACION_SUBIDA_SEGUNDOS,
          signableHeaders: new Set(['content-type', 'content-length']),
        },
      );

      return { archivo, urlSubida, expiraEnSegundos: EXPIRACION_SUBIDA_SEGUNDOS };
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
  };
}

let servicioDesdeEnv: ServicioArchivos | undefined;

/**
 * Servicio de archivos del proceso, armado desde las variables `R2_*` la
 * primera vez que se pide (lazy: importar dominio no exige tener R2 configurado,
 * p. ej. en jobs que no tocan archivos).
 */
export function servicioArchivos(): ServicioArchivos {
  if (servicioDesdeEnv === undefined) {
    const config = configR2DesdeEnv();
    servicioDesdeEnv = crearServicioArchivos({
      cliente: crearClienteR2(config),
      bucket: config.bucket,
    });
  }
  return servicioDesdeEnv;
}
