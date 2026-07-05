import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { paths } from './esquema.gen';
import { api } from './cliente';
import { ErrorDeApi } from './errores';

/**
 * Capa de datos de Estados de lista de precios (F8-E1, catálogo global de Desarrollo) — mismo
 * ESTÁNDAR que Tipos de proceso. La bandera `esCierre` marca los estados que bloquean nuevas
 * rondas/ediciones de renglón (la usa el flujo de negociación de E2+). CERO lógica de negocio
 * (A1): la autorización (admin-only) vive en el backend.
 */

// ── Alias de tipo del contrato ────────────────────────────────────────────────

/** Página de estados de lista (`GET /api/estados-lista`). */
export type EstadosListaPagina =
  paths['/api/estados-lista']['get']['responses']['200']['content']['application/json'];
/** Un estado de lista tal como lo devuelve el API. */
export type EstadoLista = EstadosListaPagina['datos'][number];
/** Parámetros de consulta del listado (querystring). */
export type EstadosListaQuery = NonNullable<
  paths['/api/estados-lista']['get']['parameters']['query']
>;
/** Cuerpo de alta (`POST /api/estados-lista`). */
export type EstadoListaCrear =
  paths['/api/estados-lista']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición (`PATCH /api/estados-lista/{id}`). */
export type EstadoListaEditar =
  paths['/api/estados-lista/{id}']['patch']['requestBody']['content']['application/json'];

/** Clave raíz de la caché de estados de lista. */
export const CLAVE_ESTADOS_LISTA = ['estados-lista'] as const;

function claveLista(query: EstadosListaQuery): readonly unknown[] {
  return [...CLAVE_ESTADOS_LISTA, 'lista', query];
}

async function listar(query: EstadosListaQuery): Promise<EstadosListaPagina> {
  const { data, error } = await api.GET('/api/estados-lista', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crear(cuerpo: EstadoListaCrear): Promise<EstadoLista> {
  const { data, error } = await api.POST('/api/estados-lista', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function actualizar(id: number, cuerpo: EstadoListaEditar): Promise<EstadoLista> {
  const { data, error } = await api.PATCH('/api/estados-lista/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function desactivar(id: number): Promise<EstadoLista> {
  const { data, error } = await api.DELETE('/api/estados-lista/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function reactivar(id: number): Promise<EstadoLista> {
  const { data, error } = await api.PATCH('/api/estados-lista/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista estados de lista con los filtros dados (sin parpadeo al paginar/buscar). */
export function useEstadosLista(
  query: EstadosListaQuery,
): UseQueryResult<EstadosListaPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveLista(query),
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un estado de lista e invalida la lista. */
export function useCrearEstadoLista(): UseMutationResult<
  EstadoLista,
  ErrorDeApi,
  EstadoListaCrear
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crear,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ESTADOS_LISTA }),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarEstadoLista {
  id: number;
  cuerpo: EstadoListaEditar;
}

/** Edita un estado de lista e invalida la lista. */
export function useActualizarEstadoLista(): UseMutationResult<
  EstadoLista,
  ErrorDeApi,
  ArgsActualizarEstadoLista
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarEstadoLista) => actualizar(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ESTADOS_LISTA }),
  });
}

/** Desactiva un estado de lista (borrado suave) e invalida la lista. */
export function useDesactivarEstadoLista(): UseMutationResult<EstadoLista, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ESTADOS_LISTA }),
  });
}

/** Reactiva un estado de lista desactivado e invalida la lista. */
export function useReactivarEstadoLista(): UseMutationResult<EstadoLista, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ESTADOS_LISTA }),
  });
}
