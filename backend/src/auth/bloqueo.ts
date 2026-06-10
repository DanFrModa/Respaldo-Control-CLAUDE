/**
 * Orquestación del bloqueo por intentos, desacoplada de better-auth.
 *
 * Los hooks de `src/auth/config.ts` extraen del contexto de better-auth los
 * datos primitivos (el `username` intentado y si el intento tuvo éxito) y los
 * pasan aquí; estas funciones llaman al dominio (`dominio/auth/login`, donde
 * vive la regla, A1). Mantener esta capa sobre VALORES (no sobre el contexto
 * interno de better-auth) la hace probable con pruebas unitarias y evita acoplar
 * el código al tipo interno del middleware.
 */
import { ErrorBloqueado } from '../comun/errores.js';
import type { EvaluacionPrevia, ResultadoIntentoFallido } from '../dominio/auth/login.js';

/** Firma de `evaluarAccesoPrevio` (inyectada para poder probar el bloqueo aislado). */
export type EvaluarAccesoPrevio = (username: string) => Promise<EvaluacionPrevia>;

/** Servicios del dominio que consume el cierre del login (post-intento). */
export interface ServiciosBloqueo {
  registrarAccesoExitoso: (idUsuario: string) => Promise<void>;
  registrarIntentoFallido: (username: string) => Promise<ResultadoIntentoFallido | null>;
}

/** `username` válido extraído del cuerpo del login, o `null` si no vino utilizable. */
export function usernameDelCuerpo(cuerpo: unknown): string | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return null;
  }
  const valor = (cuerpo as Record<string, unknown>).username;
  if (typeof valor !== 'string') {
    return null;
  }
  // El plugin username normaliza a minúsculas al guardar; se compara igual.
  const normalizado = valor.trim().toLowerCase();
  return normalizado.length > 0 ? normalizado : null;
}

/**
 * ANTES del login: si la cuenta está desactivada o bloqueada, `evaluarAccesoPrevio`
 * lanza `ErrorBloqueado` y aquí se relanza como `APIError` 403 para que better-auth
 * corte el flujo SIN verificar la contraseña (orden del sistema viejo, doc 00 §1.1).
 * Si el usuario no existe no se hace nada: se deja que el motor conteste el genérico
 * "credenciales inválidas" (no se revela qué usuarios existen).
 *
 * `lanzarBloqueo` traduce a la excepción del motor (better-auth `APIError`); se
 * inyecta para no acoplar esta capa a better-auth (el config pasa el real).
 */
export async function aplicarBloqueoAntesDeLogin(
  cuerpo: unknown,
  evaluarAccesoPrevio: EvaluarAccesoPrevio,
  lanzarBloqueo: (mensaje: string) => never,
): Promise<void> {
  const username = usernameDelCuerpo(cuerpo);
  if (username === null) {
    return;
  }
  try {
    await evaluarAccesoPrevio(username);
  } catch (error) {
    if (error instanceof ErrorBloqueado) {
      lanzarBloqueo(error.message);
    }
    throw error;
  }
}

/**
 * DESPUÉS del login: si tuvo éxito, reinicia el contador y registra el acceso;
 * si falló (contraseña incorrecta), suma un intento y bloquea al 5º.
 *
 * @param exito      `true` si el motor creó sesión (login válido).
 * @param idUsuario  id del usuario autenticado (solo presente cuando `exito`).
 */
export async function aplicarBloqueoDespuesDeLogin(
  cuerpo: unknown,
  exito: boolean,
  idUsuario: string | undefined,
  servicios: ServiciosBloqueo,
): Promise<void> {
  if (exito) {
    if (idUsuario !== undefined) {
      await servicios.registrarAccesoExitoso(idUsuario);
    }
    return;
  }
  const username = usernameDelCuerpo(cuerpo);
  if (username !== null) {
    await servicios.registrarIntentoFallido(username);
  }
}
