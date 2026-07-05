import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { paths } from './esquema.gen';
import { CLAVE_TELAS } from './telas';
import { api } from './cliente';
import { ErrorDeApi } from './errores';

/**
 * Capa de datos de "Precios por proveedor" de una tela (F8-E1, R17) — sub-recurso REST de la
 * tela (endpoints propios `POST/PATCH/DELETE /api/telas/{idTela}/proveedores`), igual patrón que
 * los campos de referencia del cliente. Cada renglón tela–proveedor lleva su precio base,
 * condiciones y, opcionalmente, un grid de precio por color (`manejaPrecioPorColor`). CERO
 * lógica de negocio (A1): el backend valida proveedores activos, sin repetir, y oculta importes.
 */

// ── Alias de tipo del contrato ────────────────────────────────────────────────

/** Lista de proveedores de una tela (`GET /api/telas/{idTela}/proveedores`). */
export type TelaProveedoresLista =
  paths['/api/telas/{idTela}/proveedores']['get']['responses']['200']['content']['application/json'];
/** Un renglón tela–proveedor con su precio (y grid por color). */
export type TelaProveedor = TelaProveedoresLista['datos'][number];
/** Un renglón del grid de precio por color de un proveedor. */
export type TelaProveedorColor = TelaProveedor['colores'][number];
/** Cuerpo de alta de un proveedor de la tela (`POST`). */
export type TelaProveedorCrear =
  paths['/api/telas/{idTela}/proveedores']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición (`PATCH /api/telas/{idTela}/proveedores/{id}`). */
export type TelaProveedorEditar =
  paths['/api/telas/{idTela}/proveedores/{id}']['patch']['requestBody']['content']['application/json'];
/** Un renglón de precio por color en el cuerpo de alta/edición. */
export type TelaProveedorColorEntrada = NonNullable<TelaProveedorCrear['colores']>[number];

/** Clave de caché de los proveedores de UNA tela. */
function claveProveedores(idTela: number): readonly unknown[] {
  return [...CLAVE_TELAS, 'proveedores', idTela];
}

async function listar(idTela: number): Promise<TelaProveedor[]> {
  const { data, error } = await api.GET('/api/telas/{idTela}/proveedores', {
    params: { path: { idTela } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/**
 * Lista los proveedores (con precio) de una tela. Deshabilitada si no hay id (p. ej. antes de
 * seleccionar una tela). Trae activos e inactivos (el editor los muestra para reactivarlos).
 */
export function useTelaProveedores(
  idTela: number | undefined,
): UseQueryResult<TelaProveedor[], ErrorDeApi> {
  return useQuery({
    queryKey: claveProveedores(idTela ?? 0),
    queryFn: () => listar(idTela as number),
    enabled: idTela !== undefined,
  });
}

/** Refresca los proveedores de la tela y la lista de telas (el precio afecta el detalle). */
function invalidar(queryClient: ReturnType<typeof useQueryClient>, idTela: number): void {
  void queryClient.invalidateQueries({ queryKey: claveProveedores(idTela) });
  void queryClient.invalidateQueries({ queryKey: CLAVE_TELAS });
}

/** Argumentos de la mutación de alta. */
export interface ArgsCrearTelaProveedor {
  idTela: number;
  cuerpo: TelaProveedorCrear;
}

async function crear({ idTela, cuerpo }: ArgsCrearTelaProveedor): Promise<TelaProveedor> {
  const { data, error } = await api.POST('/api/telas/{idTela}/proveedores', {
    params: { path: { idTela } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Asigna un proveedor con precio a la tela e invalida las cachés. */
export function useCrearTelaProveedor(): UseMutationResult<
  TelaProveedor,
  ErrorDeApi,
  ArgsCrearTelaProveedor
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crear,
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.idTela),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarTelaProveedor {
  idTela: number;
  id: number;
  cuerpo: TelaProveedorEditar;
}

async function actualizar({
  idTela,
  id,
  cuerpo,
}: ArgsActualizarTelaProveedor): Promise<TelaProveedor> {
  const { data, error } = await api.PATCH('/api/telas/{idTela}/proveedores/{id}', {
    params: { path: { idTela, id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Edita un proveedor de la tela e invalida las cachés. */
export function useActualizarTelaProveedor(): UseMutationResult<
  TelaProveedor,
  ErrorDeApi,
  ArgsActualizarTelaProveedor
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: actualizar,
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.idTela),
  });
}

/** Argumentos de las mutaciones que solo ubican el renglón. */
export interface ArgsTelaProveedor {
  idTela: number;
  id: number;
}

async function desactivar({ idTela, id }: ArgsTelaProveedor): Promise<TelaProveedor> {
  const { data, error } = await api.DELETE('/api/telas/{idTela}/proveedores/{id}', {
    params: { path: { idTela, id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un proveedor de la tela (borrado suave) e invalida las cachés. */
export function useDesactivarTelaProveedor(): UseMutationResult<
  TelaProveedor,
  ErrorDeApi,
  ArgsTelaProveedor
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivar,
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.idTela),
  });
}

async function reactivar({ idTela, id }: ArgsTelaProveedor): Promise<TelaProveedor> {
  const { data, error } = await api.PATCH('/api/telas/{idTela}/proveedores/{id}', {
    params: { path: { idTela, id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva un proveedor de la tela desactivado e invalida las cachés. */
export function useReactivarTelaProveedor(): UseMutationResult<
  TelaProveedor,
  ErrorDeApi,
  ArgsTelaProveedor
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivar,
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.idTela),
  });
}
