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
  Cortador,
  CortadorCrear,
  CortadorEditar,
  CortadoresPagina,
  CortadoresQuery,
} from './tipos';

/**
 * Capa de datos de Cortadores — replica del ESTANDAR de Almacenes
 * (`api/almacenes.ts`). Llama al cliente tipado, normaliza el resultado y expone
 * consultas/mutaciones; las mutaciones invalidan la cache de la lista. El backend
 * valida y decide (A1).
 */

/** Clave raiz de la cache de cortadores en TanStack Query. */
export const CLAVE_CORTADORES = ['cortadores'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaCortadores(query: CortadoresQuery): readonly unknown[] {
  return [...CLAVE_CORTADORES, 'lista', query];
}

/** Pide una pagina del listado de cortadores (busqueda + orden + paginacion en servidor). */
async function listarCortadores(query: CortadoresQuery): Promise<CortadoresPagina> {
  const { data, error } = await api.GET('/api/cortadores', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un cortador (`POST /api/cortadores`). */
async function crearCortador(cuerpo: CortadorCrear): Promise<Cortador> {
  const { data, error } = await api.POST('/api/cortadores', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un cortador (`PATCH /api/cortadores/{id}`). */
async function actualizarCortador(id: number, cuerpo: CortadorEditar): Promise<Cortador> {
  const { data, error } = await api.PATCH('/api/cortadores/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un cortador (borrado SUAVE, `DELETE /api/cortadores/{id}`). */
async function desactivarCortador(id: number): Promise<Cortador> {
  const { data, error } = await api.DELETE('/api/cortadores/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva un cortador desactivado (restaura el borrado suave) con `{ activo: true }`. */
async function reactivarCortador(id: number): Promise<Cortador> {
  const { data, error } = await api.PATCH('/api/cortadores/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista cortadores con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useCortadores(
  query: CortadoresQuery,
): UseQueryResult<CortadoresPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaCortadores(query),
    queryFn: () => listarCortadores(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un cortador e invalida la lista para reflejarlo. */
export function useCrearCortador(): UseMutationResult<Cortador, ErrorDeApi, CortadorCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearCortador,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CORTADORES }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarCortador {
  id: number;
  cuerpo: CortadorEditar;
}

/** Edita un cortador e invalida la lista. */
export function useActualizarCortador(): UseMutationResult<
  Cortador,
  ErrorDeApi,
  ArgsActualizarCortador
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarCortador) => actualizarCortador(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CORTADORES }),
  });
}

/** Desactiva un cortador (borrado suave) e invalida la lista. */
export function useDesactivarCortador(): UseMutationResult<Cortador, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarCortador,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CORTADORES }),
  });
}

/** Reactiva un cortador desactivado (restaura el borrado suave) e invalida la lista. */
export function useReactivarCortador(): UseMutationResult<Cortador, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarCortador,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CORTADORES }),
  });
}
