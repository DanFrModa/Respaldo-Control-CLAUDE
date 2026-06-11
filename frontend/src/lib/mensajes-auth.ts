/**
 * Traduccion de errores de better-auth a mensajes en espanol para el formulario
 * de login. Archivo PURO (sin `authClient`) para poder probarse por unidad;
 * `lib/auth-client.ts` lo re-exporta.
 *
 * Dos fuentes de error en el login (backend E3):
 *  1. **Bloqueo / cuenta desactivada** (regla de negocio del servidor, doc
 *     funcional 00 §1.1): el backend corta el login con un 403 y un `message` YA
 *     en espanol ("Estas bloqueado. Contacta al administrador." o "Tu cuenta
 *     esta desactivada..."). Ese texto se muestra TAL CUAL — el frontend no
 *     reescribe la decision del servidor (A1).
 *  2. **Credenciales invalidas / validacion** (motor better-auth): llegan con un
 *     `code` en ingles (p. ej. `INVALID_USERNAME_OR_PASSWORD`) que se traduce
 *     aqui a un mensaje claro en espanol.
 */

/** Error tal como lo entrega el cliente de better-auth. */
export interface ErrorAuth {
  code?: string | undefined;
  message?: string | undefined;
  status?: number | undefined;
}

/** Codigos nativos de better-auth (ingles) -> mensaje en espanol. */
const MENSAJES_AUTH: Record<string, string> = {
  INVALID_USERNAME_OR_PASSWORD: 'Usuario o contraseña incorrectos.',
  INVALID_EMAIL_OR_PASSWORD: 'Usuario o contraseña incorrectos.',
  INVALID_USERNAME: 'El usuario solo puede llevar letras, números, punto y guion bajo.',
  USERNAME_TOO_SHORT: 'El usuario es demasiado corto.',
  USERNAME_TOO_LONG: 'El usuario es demasiado largo.',
  FAILED_TO_CREATE_SESSION: 'No se pudo iniciar la sesión. Intenta de nuevo.',
};

/** Mensaje de respaldo cuando el error no se reconoce (incluye red caida). */
export const MENSAJE_AUTH_DESCONOCIDO =
  'No se pudo iniciar sesión. Verifica tus datos e intenta de nuevo.';

/**
 * Traduce el error de una llamada del `authClient` a un mensaje claro en espanol.
 *
 * Orden de decision:
 *  1. Un 403 con `message` viene del servidor (bloqueo o cuenta desactivada): su
 *     texto ya esta en espanol -> se muestra tal cual.
 *  2. Si el `code` esta en la tabla de codigos nativos -> su traduccion.
 *  3. En cualquier otro caso -> mensaje de respaldo.
 */
export function traducirErrorAuth(error: ErrorAuth | null): string {
  if (error?.status === 403 && error.message) {
    return error.message;
  }
  const traduccion = error?.code ? MENSAJES_AUTH[error.code] : undefined;
  if (traduccion) {
    return traduccion;
  }
  return MENSAJE_AUTH_DESCONOCIDO;
}
