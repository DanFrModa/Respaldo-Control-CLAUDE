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
  Proveedor,
  ProveedorCrear,
  ProveedorEditar,
  ProveedoresPagina,
  ProveedoresQuery,
} from './tipos';

/**
 * Capa de datos de Proveedores — replica del ESTANDAR de Almacenes (`api/almacenes.ts`).
 * Cada funcion llama al cliente TIPADO del OpenAPI, normaliza (`data` en exito,
 * `ErrorDeApi` con el mensaje del backend en fallo) y se expone como consulta o
 * mutacion (las mutaciones invalidan la cache de la lista). CERO logica de
 * negocio: el backend valida, autoriza y decide (A1).
 */

/** Clave raiz de la cache de proveedores en TanStack Query. */
export const CLAVE_PROVEEDORES = ['proveedores'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaProveedores(query: ProveedoresQuery): readonly unknown[] {
  return [...CLAVE_PROVEEDORES, 'lista', query];
}

/** Pide una pagina del listado de proveedores (busqueda + tipo + orden + paginacion en servidor). */
async function listarProveedores(query: ProveedoresQuery): Promise<ProveedoresPagina> {
  const { data, error } = await api.GET('/api/proveedores', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un proveedor (`POST /api/proveedores`). */
async function crearProveedor(cuerpo: ProveedorCrear): Promise<Proveedor> {
  const { data, error } = await api.POST('/api/proveedores', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un proveedor (`PATCH /api/proveedores/{id}`). */
async function actualizarProveedor(id: number, cuerpo: ProveedorEditar): Promise<Proveedor> {
  const { data, error } = await api.PATCH('/api/proveedores/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un proveedor (borrado SUAVE, `DELETE /api/proveedores/{id}`). */
async function desactivarProveedor(id: number): Promise<Proveedor> {
  const { data, error } = await api.DELETE('/api/proveedores/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Reactiva un proveedor desactivado (restaura el borrado suave): es un
 * `PATCH /api/proveedores/{id}` con `{ activo: true }`. El backend re-verifica que
 * el nombre siga libre y audita la reactivacion.
 */
async function reactivarProveedor(id: number): Promise<Proveedor> {
  const { data, error } = await api.PATCH('/api/proveedores/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista proveedores con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useProveedores(
  query: ProveedoresQuery,
): UseQueryResult<ProveedoresPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaProveedores(query),
    queryFn: () => listarProveedores(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un proveedor e invalida la lista para reflejarlo. */
export function useCrearProveedor(): UseMutationResult<Proveedor, ErrorDeApi, ProveedorCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearProveedor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarProveedor {
  id: number;
  cuerpo: ProveedorEditar;
}

/** Edita un proveedor e invalida la lista. */
export function useActualizarProveedor(): UseMutationResult<
  Proveedor,
  ErrorDeApi,
  ArgsActualizarProveedor
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarProveedor) => actualizarProveedor(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES }),
  });
}

/** Desactiva un proveedor (borrado suave) e invalida la lista. */
export function useDesactivarProveedor(): UseMutationResult<Proveedor, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarProveedor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES }),
  });
}

/** Reactiva un proveedor desactivado (restaura el borrado suave) e invalida la lista. */
export function useReactivarProveedor(): UseMutationResult<Proveedor, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarProveedor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES }),
  });
}
