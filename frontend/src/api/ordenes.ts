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
  Orden,
  OrdenCancelar,
  OrdenComentarioCrear,
  OrdenCopiarMatriz,
  OrdenCrear,
  OrdenEditar,
  OrdenesPagina,
  OrdenesQuery,
  OrdenMatriz,
  OrdenReferencias,
} from './tipos';

/**
 * Capa de datos del módulo ÓRDENES de producción (F2-E3) — réplica del ESTÁNDAR de Pedidos
 * (`api/pedidos.ts`). Cada función llama al cliente TIPADO del OpenAPI, normaliza (`data` en éxito,
 * `ErrorDeApi` con el mensaje del backend en fallo) y se expone como consulta o mutación (las
 * mutaciones invalidan la cache de órdenes y el detalle). CERO lógica de negocio: el backend valida,
 * autoriza y decide (A1) — incluida la derivación del estado (capturada/completa/cancelada) y los
 * folios atómicos.
 */

/** Clave raíz de la cache de órdenes en TanStack Query. */
export const CLAVE_ORDENES = ['ordenes'] as const;

/** Clave de cache de una página concreta del listado (depende de los filtros). */
function claveListaOrdenes(query: OrdenesQuery): readonly unknown[] {
  return [...CLAVE_ORDENES, 'lista', query];
}

/** Clave de cache de UNA orden (su detalle). */
function claveOrden(id: number): readonly unknown[] {
  return [...CLAVE_ORDENES, 'detalle', id];
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/** Pide una página del listado de órdenes (búsqueda + filtros + orden + paginación en servidor). */
async function listarOrdenes(query: OrdenesQuery): Promise<OrdenesPagina> {
  const { data, error } = await api.GET('/api/ordenes', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Obtiene una orden por id (encabezado + matriz + referencias + comentarios). */
async function obtenerOrden(id: number): Promise<Orden> {
  const { data, error } = await api.GET('/api/ordenes/{id}', { params: { path: { id } } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Escrituras ──────────────────────────────────────────────────────────────────

/** Crea una orden desde un renglón de pedido (`POST /api/ordenes`). */
async function crearOrden(cuerpo: OrdenCrear): Promise<Orden> {
  const { data, error } = await api.POST('/api/ordenes', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza el encabezado de una orden (`PATCH /api/ordenes/{id}`). */
async function actualizarOrden(id: number, cuerpo: OrdenEditar): Promise<Orden> {
  const { data, error } = await api.PATCH('/api/ordenes/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Guarda el set COMPLETO de la matriz (`PUT /api/ordenes/{id}/matriz`). */
async function guardarMatriz(id: number, cuerpo: OrdenMatriz): Promise<Orden> {
  const { data, error } = await api.PUT('/api/ordenes/{id}/matriz', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Copia la matriz de otra orden (`POST /api/ordenes/{id}/copiar-matriz`). */
async function copiarMatriz(id: number, cuerpo: OrdenCopiarMatriz): Promise<Orden> {
  const { data, error } = await api.POST('/api/ordenes/{id}/copiar-matriz', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Cancela una orden (cancelación suave, exige motivo, `POST /api/ordenes/{id}/cancelar`). */
async function cancelarOrden(id: number, cuerpo: OrdenCancelar): Promise<Orden> {
  const { data, error } = await api.POST('/api/ordenes/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Guarda el set COMPLETO de referencias D7 (`PUT /api/ordenes/{id}/referencias`). */
async function guardarReferencias(id: number, cuerpo: OrdenReferencias): Promise<Orden> {
  const { data, error } = await api.PUT('/api/ordenes/{id}/referencias', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Agrega un comentario (inmutable, `POST /api/ordenes/{id}/comentarios`). */
async function agregarComentario(id: number, cuerpo: OrdenComentarioCrear): Promise<Orden> {
  const { data, error } = await api.POST('/api/ordenes/{id}/comentarios', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks de lectura ────────────────────────────────────────────────────────────

/** Lista órdenes con los filtros dados (mantiene la página previa al paginar/buscar). */
export function useOrdenes(query: OrdenesQuery): UseQueryResult<OrdenesPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaOrdenes(query),
    queryFn: () => listarOrdenes(query),
    placeholderData: keepPreviousData,
  });
}

/** Obtiene el detalle de una orden (deshabilitada si no hay id). */
export function useOrden(id: number | undefined): UseQueryResult<Orden, ErrorDeApi> {
  return useQuery({
    queryKey: claveOrden(id ?? 0),
    queryFn: () => obtenerOrden(id as number),
    enabled: id !== undefined,
  });
}

// ── Hooks de escritura ────────────────────────────────────────────────────────────

/** Invalida la lista de órdenes y, si se da, el detalle de UNA orden. */
function invalidar(queryClient: ReturnType<typeof useQueryClient>, id?: number): void {
  void queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES });
  if (id !== undefined) {
    void queryClient.invalidateQueries({ queryKey: claveOrden(id) });
  }
}

/** Crea una orden e invalida la lista. */
export function useCrearOrden(): UseMutationResult<Orden, ErrorDeApi, OrdenCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearOrden,
    onSuccess: () => invalidar(queryClient),
  });
}

/** Argumentos de la mutación de edición del encabezado. */
export interface ArgsActualizarOrden {
  id: number;
  cuerpo: OrdenEditar;
}

/** Edita el encabezado de una orden e invalida la lista y su detalle. */
export function useActualizarOrden(): UseMutationResult<Orden, ErrorDeApi, ArgsActualizarOrden> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarOrden) => actualizarOrden(id, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.id),
  });
}

/** Argumentos de la mutación de guardar matriz. */
export interface ArgsGuardarMatriz {
  id: number;
  cuerpo: OrdenMatriz;
}

/** Guarda la matriz (set completo) e invalida la lista y su detalle. */
export function useGuardarMatriz(): UseMutationResult<Orden, ErrorDeApi, ArgsGuardarMatriz> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsGuardarMatriz) => guardarMatriz(id, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.id),
  });
}

/** Argumentos de la mutación de copiar matriz. */
export interface ArgsCopiarMatriz {
  id: number;
  cuerpo: OrdenCopiarMatriz;
}

/** Copia la matriz de otra orden e invalida la lista y su detalle. */
export function useCopiarMatriz(): UseMutationResult<Orden, ErrorDeApi, ArgsCopiarMatriz> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCopiarMatriz) => copiarMatriz(id, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.id),
  });
}

/** Argumentos de la mutación de cancelar. */
export interface ArgsCancelarOrden {
  id: number;
  cuerpo: OrdenCancelar;
}

/** Cancela una orden (suave) e invalida la lista y su detalle. */
export function useCancelarOrden(): UseMutationResult<Orden, ErrorDeApi, ArgsCancelarOrden> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarOrden) => cancelarOrden(id, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.id),
  });
}

/** Argumentos de la mutación de guardar referencias. */
export interface ArgsGuardarReferencias {
  id: number;
  cuerpo: OrdenReferencias;
}

/** Guarda las referencias D7 (set completo) e invalida la lista y su detalle. */
export function useGuardarReferencias(): UseMutationResult<
  Orden,
  ErrorDeApi,
  ArgsGuardarReferencias
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsGuardarReferencias) => guardarReferencias(id, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.id),
  });
}

/** Argumentos de la mutación de agregar comentario. */
export interface ArgsAgregarComentario {
  id: number;
  cuerpo: OrdenComentarioCrear;
}

/** Agrega un comentario e invalida la lista y su detalle. */
export function useAgregarComentario(): UseMutationResult<
  Orden,
  ErrorDeApi,
  ArgsAgregarComentario
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsAgregarComentario) => agregarComentario(id, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.id),
  });
}
