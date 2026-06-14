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
  Maquilero,
  MaquileroCrear,
  MaquileroEditar,
  MaquilerosPagina,
  MaquilerosQuery,
  TipoProceso,
} from './tipos';

/**
 * Capa de datos de Maquileros (F1-E2, maquila unificada) — replica del ESTANDAR de
 * Proveedores/Cortadores (`api/proveedores.ts`). Cada funcion llama al cliente TIPADO
 * del OpenAPI, normaliza (`data` en exito, `ErrorDeApi` con el mensaje del backend en
 * fallo) y se expone como consulta o mutacion (las mutaciones invalidan la cache de la
 * lista). CERO logica de negocio: el backend valida, autoriza y decide (A1). Los `tipos`
 * de proceso (capacidades, N:N) viajan INLINE en el cuerpo de crear/editar.
 */

/** Clave raiz de la cache de maquileros en TanStack Query. */
export const CLAVE_MAQUILEROS = ['maquileros'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaMaquileros(query: MaquilerosQuery): readonly unknown[] {
  return [...CLAVE_MAQUILEROS, 'lista', query];
}

/** Pide una pagina del listado de maquileros (busqueda + tipoProceso + orden + paginacion en servidor). */
async function listarMaquileros(query: MaquilerosQuery): Promise<MaquilerosPagina> {
  const { data, error } = await api.GET('/api/maquileros', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un maquilero (`POST /api/maquileros`). */
async function crearMaquilero(cuerpo: MaquileroCrear): Promise<Maquilero> {
  const { data, error } = await api.POST('/api/maquileros', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un maquilero (`PATCH /api/maquileros/{id}`). */
async function actualizarMaquilero(id: number, cuerpo: MaquileroEditar): Promise<Maquilero> {
  const { data, error } = await api.PATCH('/api/maquileros/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un maquilero (borrado SUAVE, `DELETE /api/maquileros/{id}`). */
async function desactivarMaquilero(id: number): Promise<Maquilero> {
  const { data, error } = await api.DELETE('/api/maquileros/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Reactiva un maquilero desactivado (restaura el borrado suave): es un
 * `PATCH /api/maquileros/{id}` con `{ activo: true }`. El backend re-verifica que el
 * `corto` siga libre y audita la reactivacion.
 */
async function reactivarMaquilero(id: number): Promise<Maquilero> {
  const { data, error } = await api.PATCH('/api/maquileros/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista maquileros con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useMaquileros(
  query: MaquilerosQuery,
): UseQueryResult<MaquilerosPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaMaquileros(query),
    queryFn: () => listarMaquileros(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un maquilero e invalida la lista para reflejarlo. */
export function useCrearMaquilero(): UseMutationResult<Maquilero, ErrorDeApi, MaquileroCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearMaquilero,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_MAQUILEROS }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarMaquilero {
  id: number;
  cuerpo: MaquileroEditar;
}

/** Edita un maquilero e invalida la lista. */
export function useActualizarMaquilero(): UseMutationResult<
  Maquilero,
  ErrorDeApi,
  ArgsActualizarMaquilero
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarMaquilero) => actualizarMaquilero(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_MAQUILEROS }),
  });
}

/** Desactiva un maquilero (borrado suave) e invalida la lista. */
export function useDesactivarMaquilero(): UseMutationResult<Maquilero, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarMaquilero,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_MAQUILEROS }),
  });
}

/** Reactiva un maquilero desactivado (restaura el borrado suave) e invalida la lista. */
export function useReactivarMaquilero(): UseMutationResult<Maquilero, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarMaquilero,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_MAQUILEROS }),
  });
}

// ── Tipos de proceso (F1-E2, catalogo selector de capacidades) ────────────────

/** Clave de cache del catalogo de tipos de proceso. */
export const CLAVE_TIPOS_PROCESO = ['tipos-proceso'] as const;

/** Pide el catalogo de tipos de proceso (array plano, sin paginacion). */
async function listarTiposProceso(): Promise<TipoProceso[]> {
  const { data, error } = await api.GET('/api/tipos-proceso');
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Lista los tipos de proceso activos (para el selector multiple y el filtro). */
export function useTiposProceso(): UseQueryResult<TipoProceso[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_TIPOS_PROCESO, 'lista'],
    queryFn: listarTiposProceso,
  });
}
