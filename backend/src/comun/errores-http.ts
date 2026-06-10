/**
 * Traducción de errores de dominio a HTTP (estándar de respuesta de errores).
 *
 * Las rutas REST nunca inspeccionan mensajes: el `codigo` estable de
 * `ErrorDominio` (E2) determina el status. Aquí vive ese mapeo y la forma del
 * cuerpo de error que recibe el frontend (siempre `{ codigo, mensaje, detalles? }`
 * en español). Lo aplica el error handler de Fastify (`src/api/errores.ts`).
 */
import type { CodigoErrorDominio, ErrorDominio } from './errores.js';

/** Cuerpo JSON uniforme de TODA respuesta de error de la API. */
export interface CuerpoError {
  /** Código estable (de dominio o de transporte) para que el front decida sin parsear texto. */
  codigo: string;
  /** Mensaje en español, listo para mostrarse al usuario. */
  mensaje: string;
  /** Detalle estructurado opcional (p. ej. issues de Zod por campo). */
  detalles?: unknown;
}

/** Status HTTP por código de error de dominio (doc de `errores.ts` §8.5). */
const HTTP_POR_CODIGO: Record<CodigoErrorDominio, number> = {
  VALIDACION: 400,
  NO_ENCONTRADO: 404,
  PERMISO: 403,
  CONFLICTO: 409,
  // Cuenta bloqueada/desactivada: 403 (la tabla de `errores.ts` mapea BLOQUEADO→403).
  BLOQUEADO: 403,
};

/** Status HTTP que corresponde a un error de dominio. */
export function statusDeErrorDominio(error: ErrorDominio): number {
  return HTTP_POR_CODIGO[error.codigo];
}

/** Arma el cuerpo de error para un error de dominio (sin filtrar causa/stack). */
export function cuerpoDeErrorDominio(error: ErrorDominio): CuerpoError {
  return {
    codigo: error.codigo,
    mensaje: error.message,
    // Solo se incluye `detalles` si existe (exactOptionalPropertyTypes).
    ...(error.detalles === undefined ? {} : { detalles: error.detalles }),
  };
}
