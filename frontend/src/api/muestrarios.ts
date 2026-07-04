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
  Muestrario,
  MuestrarioCrear,
  MuestrarioEntregar,
  MuestrariosCumplimiento,
  MuestrariosPagina,
  MuestrariosQuery,
} from './tipos';

/**
 * Capa de datos de MUESTRARIOS pendientes (Módulo Indicadores, F7-E4). Cliente TIPADO del OpenAPI;
 * CERO lógica de negocio (A1): el backend deriva estado/cumplimiento y agrega el KPI.
 */
export const CLAVE_MUESTRARIOS = ['muestrarios'] as const;

async function listar(query: MuestrariosQuery): Promise<MuestrariosPagina> {
  const { data, error } = await api.GET('/api/indicadores/muestrarios', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useMuestrarios(
  query: MuestrariosQuery,
): UseQueryResult<MuestrariosPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_MUESTRARIOS, 'lista', query],
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}

async function obtenerCumplimiento(): Promise<MuestrariosCumplimiento> {
  const { data, error } = await api.GET('/api/indicadores/muestrarios/cumplimiento', {
    params: { query: {} },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useCumplimientoMuestrarios(): UseQueryResult<MuestrariosCumplimiento, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_MUESTRARIOS, 'cumplimiento'],
    queryFn: obtenerCumplimiento,
  });
}

export function useCrearMuestrario(): UseMutationResult<Muestrario, ErrorDeApi, MuestrarioCrear> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: MuestrarioCrear) => {
      const { data, error } = await api.POST('/api/indicadores/muestrarios', { body });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_MUESTRARIOS }),
  });
}

export function useEntregarMuestrario(): UseMutationResult<
  Muestrario,
  ErrorDeApi,
  { id: number; cuerpo: MuestrarioEntregar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cuerpo }) => {
      const { data, error } = await api.POST('/api/indicadores/muestrarios/{id}/entregar', {
        params: { path: { id } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_MUESTRARIOS }),
  });
}

export function useCancelarMuestrario(): UseMutationResult<
  Muestrario,
  ErrorDeApi,
  { id: number; motivo: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }) => {
      const { data, error } = await api.POST('/api/indicadores/muestrarios/{id}/cancelar', {
        params: { path: { id } },
        body: { motivo },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_MUESTRARIOS }),
  });
}
