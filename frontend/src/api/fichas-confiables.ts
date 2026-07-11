import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type {
  FichaOrden,
  FichasConfiables,
  FichasConfiablesQuery,
  VerificarFichaOrden,
} from './tipos';

/**
 * Capa de datos de FICHAS CONFIABLES (Módulo Indicadores, F7-E4). Cliente TIPADO del OpenAPI; CERO
 * lógica de negocio (A1): el backend guarda el checklist por filas (A6) y agrega el % en SQL.
 */
export const CLAVE_FICHAS = ['fichas-confiables'] as const;

async function obtenerFichaOrden(idOrden: number): Promise<FichaOrden> {
  const { data, error } = await api.GET('/api/indicadores/fichas/ordenes/{idOrden}', {
    params: { path: { idOrden } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useFichaOrden(idOrden: number | null): UseQueryResult<FichaOrden, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_FICHAS, 'orden', idOrden],
    queryFn: () => obtenerFichaOrden(idOrden as number),
    enabled: idOrden !== null,
  });
}

export function useVerificarFichaOrden(): UseMutationResult<
  FichaOrden,
  ErrorDeApi,
  { idOrden: number; cuerpo: VerificarFichaOrden }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, cuerpo }) => {
      const { data, error } = await api.PUT('/api/indicadores/fichas/ordenes/{idOrden}', {
        params: { path: { idOrden } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_FICHAS }),
  });
}

async function obtenerConfiables(query: FichasConfiablesQuery): Promise<FichasConfiables> {
  const { data, error } = await api.GET('/api/indicadores/fichas/confiables', {
    params: { query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useFichasConfiables(
  query: FichasConfiablesQuery,
): UseQueryResult<FichasConfiables, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_FICHAS, 'confiables', query],
    queryFn: () => obtenerConfiables(query),
    placeholderData: keepPreviousData,
  });
}
