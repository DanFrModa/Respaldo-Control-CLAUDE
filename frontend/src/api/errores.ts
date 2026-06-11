/**
 * Manejo uniforme de errores del API en el frontend.
 *
 * El backend responde los errores con la forma estable `{ codigo, mensaje,
 * detalles? }` (contrato OpenAPI, `esquemaErrorApi`). `openapi-fetch` entrega
 * ese cuerpo en el campo `error` de la respuesta. Aqui se normaliza a un mensaje
 * en espanol listo para mostrar (toast), SIN inventar logica: solo presenta lo
 * que el servidor decidio (el frontend nunca razona reglas de negocio, A1).
 */

/** Forma del cuerpo de error del API (espejo de `esquemaErrorApi` del backend). */
export interface ErrorApi {
  codigo: string;
  mensaje: string;
  detalles?: unknown;
}

/** Mensaje de respaldo cuando no se reconoce el error (red caida, 5xx sin cuerpo, etc.). */
export const MENSAJE_ERROR_DESCONOCIDO =
  'Ocurrio un error inesperado. Intenta de nuevo en un momento.';

/** ¿El valor tiene la forma `{ codigo, mensaje }` del error del API? */
function esErrorApi(valor: unknown): valor is ErrorApi {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    typeof (valor as Record<string, unknown>).mensaje === 'string' &&
    typeof (valor as Record<string, unknown>).codigo === 'string'
  );
}

/**
 * Traduce el `error` de una respuesta de `openapi-fetch` (o un error de red) a un
 * mensaje en espanol. Prefiere el `mensaje` del backend; si no lo hay, el de
 * respaldo.
 */
export function mensajeDeError(error: unknown): string {
  if (esErrorApi(error)) {
    return error.mensaje;
  }
  if (error instanceof Error && error.message.length > 0) {
    return MENSAJE_ERROR_DESCONOCIDO;
  }
  return MENSAJE_ERROR_DESCONOCIDO;
}

/**
 * Error tipado que lanzan los hooks de datos cuando el API responde un fallo.
 * Lleva el codigo estable y el mensaje en espanol para que la UI decida (mostrar
 * toast, etc.). Se usa con TanStack Query (`throwOnError`/`onError`).
 */
export class ErrorDeApi extends Error {
  readonly codigo: string;

  constructor(error: unknown) {
    super(mensajeDeError(error));
    this.name = 'ErrorDeApi';
    this.codigo = esErrorApi(error) ? error.codigo : 'DESCONOCIDO';
  }
}
