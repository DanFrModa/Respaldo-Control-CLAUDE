import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { Sesion } from './tipos';

/** Estado posible al resolver la sesion del API. */
export type ResultadoSesion =
  /** Hay sesion valida (200). */
  | { autenticado: true; sesion: Sesion }
  /** No hay sesion (401): el usuario debe iniciar sesion. */
  | { autenticado: false };

/**
 * Pide `GET /api/sesion`. Distingue el 401 (no autenticado, estado NORMAL: no es
 * un fallo) de un error real (red, 5xx), que se relanza como {@link ErrorDeApi}
 * para que la capa de datos lo trate como tal.
 */
export async function obtenerSesion(): Promise<ResultadoSesion> {
  const { data, error, response } = await api.GET('/api/sesion');
  if (data) {
    return { autenticado: true, sesion: data };
  }
  if (response.status === 401) {
    return { autenticado: false };
  }
  throw new ErrorDeApi(error);
}
