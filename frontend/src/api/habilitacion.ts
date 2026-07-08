import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { HabilitacionOrden } from './tipos';

/**
 * Capa de datos de la HABILITACIÓN / SURTIDO de avíos por orden (rediseño R6, B13 — §4.6). Consulta
 * el tablero "requerido vs. enviado" de una orden (`GET /api/ordenes/{id}/habilitacion`, permiso
 * `ordenes.habilitacion`). CERO lógica: el backend agrega y decide (A1). Lo consumen el PANEL de
 * habilitación (centro de Órdenes R2 / banner de notas) y el botón "Traer avíos de la orden" del
 * constructor de notas (usa el `requerido` de la receta como cantidad sugerida).
 */

/** Clave raíz de la cache de habilitación en TanStack Query (la invalidan las mutaciones de notas). */
export const CLAVE_HABILITACION = ['habilitacion-orden'] as const;

/** Clave de cache de la habilitación de UNA orden. */
function claveHabilitacion(idOrden: number): readonly unknown[] {
  return [...CLAVE_HABILITACION, idOrden];
}

/** Obtiene la habilitación de una orden. */
async function obtenerHabilitacion(idOrden: number): Promise<HabilitacionOrden> {
  const { data, error } = await api.GET('/api/ordenes/{id}/habilitacion', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Habilitación de una orden (deshabilitada si no hay id o `habilitado === false` — p. ej. el panel
 * cerrado). Devuelve requerido/enviado/falta por avío + extras + % global.
 */
export function useHabilitacionOrden(
  idOrden: number | undefined,
  opciones?: { habilitado?: boolean },
): UseQueryResult<HabilitacionOrden, ErrorDeApi> {
  return useQuery({
    queryKey: claveHabilitacion(idOrden ?? 0),
    queryFn: () => obtenerHabilitacion(idOrden as number),
    enabled: idOrden !== undefined && (opciones?.habilitado ?? true),
  });
}
