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
  Temporada,
  TemporadaCrear,
  TemporadaEditar,
  TemporadasPagina,
  TemporadasQuery,
} from './tipos';

/**
 * Capa de datos de Temporadas — replica del ESTANDAR de Almacenes
 * (`api/almacenes.ts`). Llama al cliente tipado, normaliza el resultado y expone
 * consultas/mutaciones; las mutaciones invalidan la cache de la lista. El backend
 * valida y decide (A1).
 */

/** Clave raiz de la cache de temporadas en TanStack Query. */
export const CLAVE_TEMPORADAS = ['temporadas'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaTemporadas(query: TemporadasQuery): readonly unknown[] {
  return [...CLAVE_TEMPORADAS, 'lista', query];
}

/** Pide una pagina del listado de temporadas (busqueda + orden + paginacion en servidor). */
async function listarTemporadas(query: TemporadasQuery): Promise<TemporadasPagina> {
  const { data, error } = await api.GET('/api/temporadas', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea una temporada (`POST /api/temporadas`). */
async function crearTemporada(cuerpo: TemporadaCrear): Promise<Temporada> {
  const { data, error } = await api.POST('/api/temporadas', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza una temporada (`PATCH /api/temporadas/{id}`). */
async function actualizarTemporada(id: number, cuerpo: TemporadaEditar): Promise<Temporada> {
  const { data, error } = await api.PATCH('/api/temporadas/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva una temporada (borrado SUAVE, `DELETE /api/temporadas/{id}`). */
async function desactivarTemporada(id: number): Promise<Temporada> {
  const { data, error } = await api.DELETE('/api/temporadas/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva una temporada desactivada (restaura el borrado suave) con `{ activo: true }`. */
async function reactivarTemporada(id: number): Promise<Temporada> {
  const { data, error } = await api.PATCH('/api/temporadas/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista temporadas con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useTemporadas(
  query: TemporadasQuery,
): UseQueryResult<TemporadasPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaTemporadas(query),
    queryFn: () => listarTemporadas(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea una temporada e invalida la lista para reflejarla. */
export function useCrearTemporada(): UseMutationResult<Temporada, ErrorDeApi, TemporadaCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearTemporada,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TEMPORADAS }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarTemporada {
  id: number;
  cuerpo: TemporadaEditar;
}

/** Edita una temporada e invalida la lista. */
export function useActualizarTemporada(): UseMutationResult<
  Temporada,
  ErrorDeApi,
  ArgsActualizarTemporada
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarTemporada) => actualizarTemporada(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TEMPORADAS }),
  });
}

/** Desactiva una temporada (borrado suave) e invalida la lista. */
export function useDesactivarTemporada(): UseMutationResult<Temporada, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarTemporada,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TEMPORADAS }),
  });
}

/** Reactiva una temporada desactivada (restaura el borrado suave) e invalida la lista. */
export function useReactivarTemporada(): UseMutationResult<Temporada, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarTemporada,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TEMPORADAS }),
  });
}
