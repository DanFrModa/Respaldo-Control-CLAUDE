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
  ActividadCrear,
  ActividadEditar,
  ActividadPagina,
  ActividadProductividad,
  ActividadQuery,
  PersonalArea,
  PersonalCrear,
  PersonalEditar,
  PersonalPagina,
  PersonalQuery,
  RegistroProductividad,
  RegistroProductividadCrear,
  RegistrosProductividadPagina,
  RegistrosProductividadQuery,
  TableroProductividad,
  TableroProductividadQuery,
} from './tipos';

/**
 * Capa de datos de PRODUCTIVIDAD unificada IP/Almacén (Módulo Indicadores, F7-E4). Cliente TIPADO del
 * OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio
 * (A1): el backend calcula los índices (fórmulas por área) y agrega el tablero en el servidor.
 */
export const CLAVE_PRODUCTIVIDAD = ['productividad'] as const;

// ── Personal ─────────────────────────────────────────────────────────────────
async function listarPersonal(query: PersonalQuery): Promise<PersonalPagina> {
  const { data, error } = await api.GET('/api/indicadores/productividad/personal', {
    params: { query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function usePersonal(query: PersonalQuery): UseQueryResult<PersonalPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_PRODUCTIVIDAD, 'personal', query],
    queryFn: () => listarPersonal(query),
    placeholderData: keepPreviousData,
  });
}

export function useCrearPersonal(): UseMutationResult<PersonalArea, ErrorDeApi, PersonalCrear> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PersonalCrear) => {
      const { data, error } = await api.POST('/api/indicadores/productividad/personal', { body });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...CLAVE_PRODUCTIVIDAD, 'personal'] }),
  });
}

export function useActualizarPersonal(): UseMutationResult<
  PersonalArea,
  ErrorDeApi,
  { id: number; cambios: PersonalEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cambios }) => {
      const { data, error } = await api.PATCH('/api/indicadores/productividad/personal/{id}', {
        params: { path: { id } },
        body: cambios,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...CLAVE_PRODUCTIVIDAD, 'personal'] }),
  });
}

// ── Actividades ──────────────────────────────────────────────────────────────
async function listarActividades(query: ActividadQuery): Promise<ActividadPagina> {
  const { data, error } = await api.GET('/api/indicadores/productividad/actividades', {
    params: { query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useActividades(query: ActividadQuery): UseQueryResult<ActividadPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_PRODUCTIVIDAD, 'actividades', query],
    queryFn: () => listarActividades(query),
    placeholderData: keepPreviousData,
  });
}

export function useCrearActividad(): UseMutationResult<
  ActividadProductividad,
  ErrorDeApi,
  ActividadCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ActividadCrear) => {
      const { data, error } = await api.POST('/api/indicadores/productividad/actividades', {
        body,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...CLAVE_PRODUCTIVIDAD, 'actividades'] }),
  });
}

export function useActualizarActividad(): UseMutationResult<
  ActividadProductividad,
  ErrorDeApi,
  { id: number; cambios: ActividadEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cambios }) => {
      const { data, error } = await api.PATCH('/api/indicadores/productividad/actividades/{id}', {
        params: { path: { id } },
        body: cambios,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...CLAVE_PRODUCTIVIDAD, 'actividades'] }),
  });
}

// ── Registros ────────────────────────────────────────────────────────────────
async function listarRegistros(
  query: RegistrosProductividadQuery,
): Promise<RegistrosProductividadPagina> {
  const { data, error } = await api.GET('/api/indicadores/productividad/registros', {
    params: { query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useRegistrosProductividad(
  query: RegistrosProductividadQuery,
): UseQueryResult<RegistrosProductividadPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_PRODUCTIVIDAD, 'registros', query],
    queryFn: () => listarRegistros(query),
    placeholderData: keepPreviousData,
  });
}

export function useRegistrarProductividad(): UseMutationResult<
  RegistroProductividad,
  ErrorDeApi,
  RegistroProductividadCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RegistroProductividadCrear) => {
      const { data, error } = await api.POST('/api/indicadores/productividad/registros', { body });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_PRODUCTIVIDAD }),
  });
}

export function useCancelarRegistroProductividad(): UseMutationResult<
  RegistroProductividad,
  ErrorDeApi,
  { id: number; motivo: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }) => {
      const { data, error } = await api.POST(
        '/api/indicadores/productividad/registros/{id}/cancelar',
        { params: { path: { id } }, body: { motivo } },
      );
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_PRODUCTIVIDAD }),
  });
}

// ── Tablero ──────────────────────────────────────────────────────────────────
async function obtenerTablero(query: TableroProductividadQuery): Promise<TableroProductividad> {
  const { data, error } = await api.GET('/api/indicadores/productividad/tablero', {
    params: { query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useTableroProductividad(
  query: TableroProductividadQuery,
): UseQueryResult<TableroProductividad, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_PRODUCTIVIDAD, 'tablero', query],
    queryFn: () => obtenerTablero(query),
    placeholderData: keepPreviousData,
  });
}
