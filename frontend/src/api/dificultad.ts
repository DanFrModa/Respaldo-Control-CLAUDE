import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { paths } from './esquema.gen';

/**
 * Capa de datos del resolvedor de DIFICULTAD por # de operaciones (rediseño R5, B7). El editor de
 * desarrollo la usa para mostrar EN VIVO "34 ops → Muy complejo → costura ≈ 20 d". La derivación vive
 * en el backend (A1); aquí sólo se llama al endpoint tipado y se cachea por `ops`.
 */

/** La dificultad resuelta (el rango que casó, o null). */
export type DificultadResuelta =
  paths['/api/desarrollos/dificultad']['get']['responses']['200']['content']['application/json'];

/** Clave raíz de la cache de dificultad. */
export const CLAVE_DIFICULTAD = ['dificultad'] as const;

async function resolverDificultad(ops: number): Promise<DificultadResuelta> {
  const { data, error } = await api.GET('/api/desarrollos/dificultad', {
    params: { query: { ops } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/**
 * Resuelve la dificultad de un # de operaciones. Deshabilitada cuando `ops` es null (sin capturar).
 * `keepPreviousData` NO se usa: el valor cambia con cada # y queremos el correcto, cacheado por ops.
 */
export function useDificultad(ops: number | null): UseQueryResult<DificultadResuelta, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_DIFICULTAD, ops],
    queryFn: () => resolverDificultad(ops as number),
    enabled: ops !== null,
    staleTime: 60_000,
  });
}
