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
  Almacen,
  AlmacenCrear,
  AlmacenEditar,
  AlmacenesPagina,
  AlmacenesQuery,
} from './tipos';

/**
 * Capa de datos de Almacenes — el ESTANDAR de consumo del API en el frontend (se
 * replica en cada CRUD del ERP). Cada funcion:
 *  1. Llama al cliente TIPADO del OpenAPI (`api.GET/POST/PATCH/DELETE`).
 *  2. Normaliza el resultado: `data` en exito; `ErrorDeApi` (con el mensaje en
 *     español del backend) en fallo.
 *  3. Se expone como hook de TanStack Query (consulta) o mutacion (escritura),
 *     que invalida la cache de la lista al terminar.
 *
 * CERO logica de negocio: solo pide y normaliza. La autorizacion, validacion y
 * reglas viven en el backend (A1).
 */

/** Clave raiz de la cache de almacenes en TanStack Query. */
export const CLAVE_ALMACENES = ['almacenes'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaAlmacenes(query: AlmacenesQuery): readonly unknown[] {
  return [...CLAVE_ALMACENES, 'lista', query];
}

/** Pide una pagina del listado de almacenes (busqueda + orden + paginacion en servidor). */
async function listarAlmacenes(query: AlmacenesQuery): Promise<AlmacenesPagina> {
  const { data, error } = await api.GET('/api/almacenes', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un almacen (`POST /api/almacenes`). */
async function crearAlmacen(cuerpo: AlmacenCrear): Promise<Almacen> {
  const { data, error } = await api.POST('/api/almacenes', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un almacen (`PATCH /api/almacenes/{id}`). */
async function actualizarAlmacen(id: number, cuerpo: AlmacenEditar): Promise<Almacen> {
  const { data, error } = await api.PATCH('/api/almacenes/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un almacen (borrado SUAVE, `DELETE /api/almacenes/{id}`). */
async function desactivarAlmacen(id: number): Promise<Almacen> {
  const { data, error } = await api.DELETE('/api/almacenes/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Reactiva un almacen desactivado (restaura el borrado suave): es un
 * `PATCH /api/almacenes/{id}` con `{ activo: true }`. El backend re-verifica que
 * el nombre siga libre y audita la reactivacion.
 */
async function reactivarAlmacen(id: number): Promise<Almacen> {
  const { data, error } = await api.PATCH('/api/almacenes/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Lista almacenes con los filtros dados. `placeholderData: keepPreviousData`
 * mantiene en pantalla la pagina anterior mientras llega la nueva (al paginar o
 * buscar): sin parpadeo a vacio.
 */
export function useAlmacenes(query: AlmacenesQuery): UseQueryResult<AlmacenesPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaAlmacenes(query),
    queryFn: () => listarAlmacenes(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un almacen e invalida la lista para reflejarlo. */
export function useCrearAlmacen(): UseMutationResult<Almacen, ErrorDeApi, AlmacenCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearAlmacen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ALMACENES }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarAlmacen {
  id: number;
  cuerpo: AlmacenEditar;
}

/** Edita un almacen e invalida la lista. */
export function useActualizarAlmacen(): UseMutationResult<
  Almacen,
  ErrorDeApi,
  ArgsActualizarAlmacen
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarAlmacen) => actualizarAlmacen(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ALMACENES }),
  });
}

/** Desactiva un almacen (borrado suave) e invalida la lista. */
export function useDesactivarAlmacen(): UseMutationResult<Almacen, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarAlmacen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ALMACENES }),
  });
}

/** Reactiva un almacen desactivado (restaura el borrado suave) e invalida la lista. */
export function useReactivarAlmacen(): UseMutationResult<Almacen, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarAlmacen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ALMACENES }),
  });
}
