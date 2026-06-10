/**
 * Manejo de errores uniforme de la API (estándar de F0).
 *
 * Un solo `setErrorHandler` traduce cualquier error que escape de una ruta a
 * la respuesta JSON estándar `{ codigo, mensaje, detalles? }` en español:
 *
 *  - `ErrorDominio` (E2) → su status por `codigo` (400/403/404/409) y su mensaje
 *    (apto para el usuario). Es el camino normal: la lógica vive en el dominio
 *    (A1) y lanza errores de negocio; la ruta solo los deja pasar.
 *  - Error de validación de entrada de `fastify-type-provider-zod` (Zod en
 *    body/query/params) → 400 con las issues por campo. Cubre la validación de
 *    transporte ANTES de llegar al dominio.
 *  - `ResponseSerializationError` (la respuesta no cumplió su esquema Zod) → 500
 *    genérico: es un bug del servidor, no del cliente; se loguea, no se filtra.
 *  - Cualquier otro error → 500 genérico SIN cuerpo de diagnóstico (nunca se
 *    exponen stack ni secretos); el detalle queda en el log del servidor.
 */
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { FastifySchemaValidationError } from 'fastify/types/schema.js';

import { esErrorDominio } from '../comun/errores.js';
import {
  cuerpoDeErrorDominio,
  statusDeErrorDominio,
  type CuerpoError,
} from '../comun/errores-http.js';

/** Cuerpo genérico de error interno (no revela nada del fallo). */
const ERROR_INTERNO: CuerpoError = {
  codigo: 'ERROR_INTERNO',
  mensaje: 'Ocurrió un error inesperado. Inténtalo de nuevo más tarde.',
};

/** Registra el error handler único de la API en la instancia de Fastify. */
export function registrarManejadorErrores(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Los type guards de fastify-type-provider-zod reciben `unknown` y
    // estrechan `error`; se conserva el error tipado de Fastify para el tramo
    // final (statusCode/code/message), donde ya no aplica ningún guard.
    const errorFastify = error;

    // 1) Errores de negocio del dominio: mapeo estable por código.
    if (esErrorDominio(error)) {
      void reply.code(statusDeErrorDominio(error)).send(cuerpoDeErrorDominio(error));
      return;
    }

    // 2) Validación de la entrada (Zod vía fastify-type-provider-zod) → 400.
    if (hasZodFastifySchemaValidationErrors(error)) {
      void reply.code(400).send({
        codigo: 'VALIDACION',
        mensaje: 'Los datos enviados no son válidos.',
        detalles: error.validation.map((v: FastifySchemaValidationError) => ({
          campo: v.instancePath,
          mensaje: v.message,
        })),
      } satisfies CuerpoError);
      return;
    }

    // 3) La respuesta no cumplió su esquema declarado: bug del servidor → 500.
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'La respuesta no cumple su esquema de salida.');
      void reply.code(500).send(ERROR_INTERNO);
      return;
    }

    // 4) Errores con statusCode explícito de Fastify (p. ej. 404 de ruta, body
    //    JSON malformado 400): se respeta el status, con mensaje genérico seguro.
    const statusCode = typeof errorFastify.statusCode === 'number' ? errorFastify.statusCode : 500;
    if (statusCode < 500) {
      void reply.code(statusCode).send({
        codigo: errorFastify.code ?? 'SOLICITUD_INVALIDA',
        mensaje: errorFastify.message,
      } satisfies CuerpoError);
      return;
    }

    // 5) Todo lo demás es una falla interna: se loguea completa, se responde genérico.
    request.log.error({ err: errorFastify }, 'Error no controlado en una ruta.');
    void reply.code(500).send(ERROR_INTERNO);
  });

  // Ruta inexistente: mismo cuerpo uniforme `{ codigo, mensaje }` que el resto de
  // la API (en vez del 404 por defecto de Fastify `{ message, error, statusCode }`),
  // para que el cliente de E4 trate TODOS los errores igual.
  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({
      codigo: 'NO_ENCONTRADO',
      mensaje: 'Recurso no encontrado.',
    } satisfies CuerpoError);
  });
}
