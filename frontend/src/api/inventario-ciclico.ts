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
  ConteoCiclico,
  ConteoCiclicoCapturar,
  ExactitudCiclico,
  InventarioCiclicoCrear,
  InventarioCiclicoResumen,
  InventariosCiclicosPagina,
  InventariosCiclicosQuery,
} from './tipos';

/**
 * Capa de datos del INVENTARIO CÍCLICO (Módulo Indicadores / Almacén, F7-E5). Cliente TIPADO del
 * OpenAPI; CERO lógica de negocio (A1): el backend congela el teórico (D6), sirve el conteo CIEGO y
 * aplica el ajuste como MOVIMIENTO de kardex (D3).
 */
export const CLAVE_CICLICOS = ['ciclicos'] as const;

async function listar(query: InventariosCiclicosQuery): Promise<InventariosCiclicosPagina> {
  const { data, error } = await api.GET('/api/indicadores/ciclicos', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useInventariosCiclicos(
  query: InventariosCiclicosQuery,
): UseQueryResult<InventariosCiclicosPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CICLICOS, 'lista', query],
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}

async function obtenerConteo(id: number): Promise<ConteoCiclico> {
  const { data, error } = await api.GET('/api/indicadores/ciclicos/{id}/conteo', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useConteoCiclico(id: number | null): UseQueryResult<ConteoCiclico, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CICLICOS, 'conteo', id],
    queryFn: () => obtenerConteo(id as number),
    enabled: id !== null,
  });
}

async function obtenerExactitud(id: number): Promise<ExactitudCiclico> {
  const { data, error } = await api.GET('/api/indicadores/ciclicos/{id}/exactitud', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useExactitudCiclico(
  id: number | null,
): UseQueryResult<ExactitudCiclico, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CICLICOS, 'exactitud', id],
    queryFn: () => obtenerExactitud(id as number),
    enabled: id !== null,
  });
}

export function useCrearCiclico(): UseMutationResult<
  InventarioCiclicoResumen,
  ErrorDeApi,
  InventarioCiclicoCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: InventarioCiclicoCrear) => {
      const { data, error } = await api.POST('/api/indicadores/ciclicos', { body });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CICLICOS }),
  });
}

export function useCapturarConteo(): UseMutationResult<
  ConteoCiclico,
  ErrorDeApi,
  { id: number; cuerpo: ConteoCiclicoCapturar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cuerpo }) => {
      const { data, error } = await api.POST('/api/indicadores/ciclicos/{id}/conteo', {
        params: { path: { id } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CICLICOS }),
  });
}

export function useGenerarAjusteCiclico(): UseMutationResult<ExactitudCiclico, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.POST('/api/indicadores/ciclicos/{id}/ajuste', {
        params: { path: { id } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CICLICOS }),
  });
}

export function useCancelarCiclico(): UseMutationResult<
  InventarioCiclicoResumen,
  ErrorDeApi,
  { id: number; motivo: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }) => {
      const { data, error } = await api.POST('/api/indicadores/ciclicos/{id}/cancelar', {
        params: { path: { id } },
        body: { motivo },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CICLICOS }),
  });
}
