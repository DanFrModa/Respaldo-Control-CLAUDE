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
  Cliente,
  ClienteCampo,
  ClienteCampoCrear,
  ClienteCampoEditar,
  ClienteCrear,
  ClienteEditar,
  ClientesPagina,
  ClientesQuery,
} from './tipos';

/**
 * Capa de datos de Clientes (F1-E2, PIEZA C — D7) — replica del ESTANDAR de
 * Proveedores (`api/proveedores.ts`). Cada funcion llama al cliente TIPADO del
 * OpenAPI, normaliza (`data` en exito, `ErrorDeApi` con el mensaje del backend en
 * fallo) y se expone como consulta o mutacion (las mutaciones invalidan la cache).
 * CERO logica de negocio: el backend valida, autoriza y decide (A1).
 *
 * Como el cliente trae sus campos de referencia EMBEBIDOS (el backend los incluye en
 * la lista y al obtener uno), toda mutacion de campos invalida tambien la lista de
 * clientes para refrescar el detalle.
 */

/** Clave raiz de la cache de clientes en TanStack Query. */
export const CLAVE_CLIENTES = ['clientes'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaClientes(query: ClientesQuery): readonly unknown[] {
  return [...CLAVE_CLIENTES, 'lista', query];
}

/** Pide una pagina del listado de clientes (busqueda + orden + paginacion en servidor). */
async function listarClientes(query: ClientesQuery): Promise<ClientesPagina> {
  const { data, error } = await api.GET('/api/clientes', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un cliente (`POST /api/clientes`). */
async function crearCliente(cuerpo: ClienteCrear): Promise<Cliente> {
  const { data, error } = await api.POST('/api/clientes', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un cliente (`PATCH /api/clientes/{id}`). */
async function actualizarCliente(id: number, cuerpo: ClienteEditar): Promise<Cliente> {
  const { data, error } = await api.PATCH('/api/clientes/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un cliente (borrado SUAVE, `DELETE /api/clientes/{id}`). */
async function desactivarCliente(id: number): Promise<Cliente> {
  const { data, error } = await api.DELETE('/api/clientes/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Reactiva un cliente desactivado (restaura el borrado suave): es un
 * `PATCH /api/clientes/{id}` con `{ activo: true }`. El backend re-verifica que el
 * nombre siga libre y audita la reactivacion.
 */
async function reactivarCliente(id: number): Promise<Cliente> {
  const { data, error } = await api.PATCH('/api/clientes/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks de cliente ──────────────────────────────────────────────────────────

/** Lista clientes con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useClientes(query: ClientesQuery): UseQueryResult<ClientesPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaClientes(query),
    queryFn: () => listarClientes(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un cliente e invalida la lista para reflejarlo. */
export function useCrearCliente(): UseMutationResult<Cliente, ErrorDeApi, ClienteCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearCliente,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CLIENTES }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarCliente {
  id: number;
  cuerpo: ClienteEditar;
}

/** Edita un cliente e invalida la lista. */
export function useActualizarCliente(): UseMutationResult<
  Cliente,
  ErrorDeApi,
  ArgsActualizarCliente
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarCliente) => actualizarCliente(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CLIENTES }),
  });
}

/** Desactiva un cliente (borrado suave) e invalida la lista. */
export function useDesactivarCliente(): UseMutationResult<Cliente, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarCliente,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CLIENTES }),
  });
}

/** Reactiva un cliente desactivado (restaura el borrado suave) e invalida la lista. */
export function useReactivarCliente(): UseMutationResult<Cliente, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarCliente,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CLIENTES }),
  });
}

// ── Campos de referencia del cliente (D7) ───────────────────────────────────────

/** Clave de cache de los campos de UN cliente. */
function claveCampos(idCliente: number): readonly unknown[] {
  return [...CLAVE_CLIENTES, 'campos', idCliente];
}

/** Lista los campos de referencia de un cliente (`GET /api/clientes/{id}/campos`). */
async function listarCamposCliente(idCliente: number): Promise<ClienteCampo[]> {
  const { data, error } = await api.GET('/api/clientes/{id}/campos', {
    params: { path: { id: idCliente }, query: { incluirInactivos: 'true' } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/**
 * Lista los campos de un cliente, incluidos los desactivados (el editor los muestra
 * para poder reactivarlos). Deshabilitada si no hay id (p. ej. en alta, antes de
 * guardar el cliente).
 */
export function useCamposCliente(
  idCliente: number | undefined,
): UseQueryResult<ClienteCampo[], ErrorDeApi> {
  return useQuery({
    queryKey: claveCampos(idCliente ?? 0),
    queryFn: () => listarCamposCliente(idCliente as number),
    enabled: idCliente !== undefined,
  });
}

/** Argumentos de la mutacion de alta de un campo. */
export interface ArgsAgregarCampo {
  idCliente: number;
  cuerpo: ClienteCampoCrear;
}

/** Agrega un campo de referencia (`POST /api/clientes/{id}/campos`). */
async function agregarCampo({ idCliente, cuerpo }: ArgsAgregarCampo): Promise<ClienteCampo> {
  const { data, error } = await api.POST('/api/clientes/{id}/campos', {
    params: { path: { id: idCliente } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Refresca los campos del cliente y la lista (el cliente embebe sus campos). */
function invalidarCampos(queryClient: ReturnType<typeof useQueryClient>, idCliente: number): void {
  void queryClient.invalidateQueries({ queryKey: claveCampos(idCliente) });
  void queryClient.invalidateQueries({ queryKey: CLAVE_CLIENTES });
}

/** Agrega un campo de referencia e invalida los campos del cliente y la lista. */
export function useAgregarCampoCliente(): UseMutationResult<
  ClienteCampo,
  ErrorDeApi,
  ArgsAgregarCampo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: agregarCampo,
    onSuccess: (_resultado, variables) => invalidarCampos(queryClient, variables.idCliente),
  });
}

/** Argumentos de la mutacion de edicion de un campo. */
export interface ArgsActualizarCampo {
  idCliente: number;
  idCampo: number;
  cuerpo: ClienteCampoEditar;
}

/** Actualiza un campo de referencia (`PATCH /api/clientes/{id}/campos/{idCampo}`). */
async function actualizarCampo({
  idCliente,
  idCampo,
  cuerpo,
}: ArgsActualizarCampo): Promise<ClienteCampo> {
  const { data, error } = await api.PATCH('/api/clientes/{id}/campos/{idCampo}', {
    params: { path: { id: idCliente, idCampo } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Edita un campo de referencia e invalida los campos del cliente y la lista. */
export function useActualizarCampoCliente(): UseMutationResult<
  ClienteCampo,
  ErrorDeApi,
  ArgsActualizarCampo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: actualizarCampo,
    onSuccess: (_resultado, variables) => invalidarCampos(queryClient, variables.idCliente),
  });
}

/** Argumentos de las mutaciones que solo necesitan ubicar el campo. */
export interface ArgsCampo {
  idCliente: number;
  idCampo: number;
}

/** Desactiva un campo de referencia (borrado SUAVE, `DELETE /api/clientes/{id}/campos/{idCampo}`). */
async function desactivarCampo({ idCliente, idCampo }: ArgsCampo): Promise<ClienteCampo> {
  const { data, error } = await api.DELETE('/api/clientes/{id}/campos/{idCampo}', {
    params: { path: { id: idCliente, idCampo } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un campo de referencia e invalida los campos del cliente y la lista. */
export function useDesactivarCampoCliente(): UseMutationResult<
  ClienteCampo,
  ErrorDeApi,
  ArgsCampo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarCampo,
    onSuccess: (_resultado, variables) => invalidarCampos(queryClient, variables.idCliente),
  });
}

/**
 * Reactiva un campo de referencia desactivado: es un PATCH con `{ activo: true }`
 * (mismo patron que reactivar un cliente). Invalida los campos del cliente y la lista.
 */
async function reactivarCampo({ idCliente, idCampo }: ArgsCampo): Promise<ClienteCampo> {
  const { data, error } = await api.PATCH('/api/clientes/{id}/campos/{idCampo}', {
    params: { path: { id: idCliente, idCampo } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva un campo de referencia desactivado e invalida los campos del cliente y la lista. */
export function useReactivarCampoCliente(): UseMutationResult<ClienteCampo, ErrorDeApi, ArgsCampo> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarCampo,
    onSuccess: (_resultado, variables) => invalidarCampos(queryClient, variables.idCliente),
  });
}
