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
import type { Color, ColorCrear, ColorEditar, ColoresPagina, ColoresQuery } from './tipos';

/**
 * Capa de datos de Colores — replica del ESTANDAR de Almacenes (`api/almacenes.ts`).
 * Llama al cliente tipado, normaliza el resultado y expone consultas/mutaciones;
 * las mutaciones invalidan la cache de la lista. El backend valida (incluida la
 * normalizacion del nombre) y decide (A1).
 */

/** Clave raiz de la cache de colores en TanStack Query. */
export const CLAVE_COLORES = ['colores'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaColores(query: ColoresQuery): readonly unknown[] {
  return [...CLAVE_COLORES, 'lista', query];
}

/** Pide una pagina del listado de colores (busqueda + orden + paginacion en servidor). */
async function listarColores(query: ColoresQuery): Promise<ColoresPagina> {
  const { data, error } = await api.GET('/api/colores', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un color (`POST /api/colores`). */
async function crearColor(cuerpo: ColorCrear): Promise<Color> {
  const { data, error } = await api.POST('/api/colores', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un color (`PATCH /api/colores/{id}`). */
async function actualizarColor(id: number, cuerpo: ColorEditar): Promise<Color> {
  const { data, error } = await api.PATCH('/api/colores/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un color (borrado SUAVE, `DELETE /api/colores/{id}`). */
async function desactivarColor(id: number): Promise<Color> {
  const { data, error } = await api.DELETE('/api/colores/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva un color desactivado (restaura el borrado suave) con `{ activo: true }`. */
async function reactivarColor(id: number): Promise<Color> {
  const { data, error } = await api.PATCH('/api/colores/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista colores con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useColores(query: ColoresQuery): UseQueryResult<ColoresPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaColores(query),
    queryFn: () => listarColores(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un color e invalida la lista para reflejarlo. */
export function useCrearColor(): UseMutationResult<Color, ErrorDeApi, ColorCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearColor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_COLORES }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarColor {
  id: number;
  cuerpo: ColorEditar;
}

/** Edita un color e invalida la lista. */
export function useActualizarColor(): UseMutationResult<Color, ErrorDeApi, ArgsActualizarColor> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarColor) => actualizarColor(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_COLORES }),
  });
}

/** Desactiva un color (borrado suave) e invalida la lista. */
export function useDesactivarColor(): UseMutationResult<Color, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarColor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_COLORES }),
  });
}

/** Reactiva un color desactivado (restaura el borrado suave) e invalida la lista. */
export function useReactivarColor(): UseMutationResult<Color, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarColor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_COLORES }),
  });
}
