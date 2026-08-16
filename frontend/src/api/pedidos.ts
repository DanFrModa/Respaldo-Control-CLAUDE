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
  Pedido,
  PedidoCopiar,
  PedidoCrear,
  PedidoEditar,
  PedidoReal,
  PedidoCancelarCuerpo,
  PedidoRealCancelarCuerpo,
  PedidoRealCrear,
  PedidoRealEditar,
  PedidoRealSeguimiento,
  PedidosPagina,
  PedidosQuery,
} from './tipos';

/**
 * Capa de datos del Módulo PEDIDOS (F2-E1) — réplica del ESTÁNDAR de Clientes/Modelos
 * (`api/clientes.ts`). Cada función llama al cliente TIPADO del OpenAPI, normaliza (`data` en
 * éxito, `ErrorDeApi` con el mensaje del backend en fallo) y se expone como consulta o mutación
 * (las mutaciones invalidan la cache). CERO lógica de negocio: el backend valida, autoriza y
 * decide (A1) — incluido el ocultamiento de importes (precio/total vienen ya en `null` si la
 * sesión no puede verlos).
 */

/** Clave raíz de la cache de pedidos en TanStack Query. */
export const CLAVE_PEDIDOS = ['pedidos'] as const;

/** Clave de cache de una página concreta del listado (depende de los filtros). */
function claveListaPedidos(query: PedidosQuery): readonly unknown[] {
  return [...CLAVE_PEDIDOS, 'lista', query];
}

/** Clave de cache de los pedidos reales de UN pedido. */
function claveReales(idPedido: number): readonly unknown[] {
  return [...CLAVE_PEDIDOS, 'reales', idPedido];
}

// ── Pedidos internos ────────────────────────────────────────────────────────

/** Pide una página del listado de pedidos (búsqueda + filtro + orden + paginación en servidor). */
async function listarPedidos(query: PedidosQuery): Promise<PedidosPagina> {
  const { data, error } = await api.GET('/api/pedidos', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Crea un pedido (`POST /api/pedidos`). */
async function crearPedido(cuerpo: PedidoCrear): Promise<Pedido> {
  const { data, error } = await api.POST('/api/pedidos', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Actualiza un pedido (`PATCH /api/pedidos/{id}`). */
async function actualizarPedido(id: number, cuerpo: PedidoEditar): Promise<Pedido> {
  const { data, error } = await api.PATCH('/api/pedidos/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Copia un pedido en uno nuevo (`POST /api/pedidos/{id}/copiar`). */
async function copiarPedido(id: number, cuerpo: PedidoCopiar): Promise<Pedido> {
  const { data, error } = await api.POST('/api/pedidos/{id}/copiar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/**
 * Cancela un pedido (cancelación suave, `POST /api/pedidos/{id}/cancelar`).
 *
 * V1-E4 (punto 5): el cuerpo lleva `cancelarOrdenes` + `motivo`. Sin él, el backend RECHAZA el
 * pedido que tiene OPs vivas en vez de fingir que las detiene.
 */
async function cancelarPedido({
  id,
  cuerpo,
}: {
  id: number;
  cuerpo: PedidoCancelarCuerpo;
}): Promise<Pedido> {
  const { data, error } = await api.POST('/api/pedidos/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Lista pedidos con los filtros dados (mantiene la página previa al paginar/buscar). */
export function usePedidos(query: PedidosQuery): UseQueryResult<PedidosPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaPedidos(query),
    queryFn: () => listarPedidos(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un pedido e invalida la lista. */
export function useCrearPedido(): UseMutationResult<Pedido, ErrorDeApi, PedidoCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearPedido,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PEDIDOS }),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarPedido {
  id: number;
  cuerpo: PedidoEditar;
}

/** Edita un pedido e invalida la lista y su detalle. */
export function useActualizarPedido(): UseMutationResult<Pedido, ErrorDeApi, ArgsActualizarPedido> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarPedido) => actualizarPedido(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PEDIDOS }),
  });
}

/** Argumentos de la mutación de copiar. */
export interface ArgsCopiarPedido {
  id: number;
  cuerpo: PedidoCopiar;
}

/** Copia un pedido e invalida la lista. */
export function useCopiarPedido(): UseMutationResult<Pedido, ErrorDeApi, ArgsCopiarPedido> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCopiarPedido) => copiarPedido(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PEDIDOS }),
  });
}

/** Cancela un pedido (suave) e invalida la lista. */
export function useCancelarPedido(): UseMutationResult<
  Pedido,
  ErrorDeApi,
  { id: number; cuerpo: PedidoCancelarCuerpo }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelarPedido,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PEDIDOS }),
  });
}

// ── Pedidos reales ──────────────────────────────────────────────────────────

/** Lista los pedidos reales de un pedido (`GET /api/pedidos/{id}/reales`). */
async function listarPedidosReales(idPedido: number): Promise<PedidoReal[]> {
  const { data, error } = await api.GET('/api/pedidos/{id}/reales', {
    params: { path: { id: idPedido } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

/** Crea un pedido real desde un pedido (`POST /api/pedidos/{id}/reales`). */
async function crearPedidoReal(idPedido: number, cuerpo: PedidoRealCrear): Promise<PedidoReal> {
  const { data, error } = await api.POST('/api/pedidos/{id}/reales', {
    params: { path: { id: idPedido } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Actualiza el encabezado de un pedido real (`PATCH /api/pedidos-reales/{idReal}`). */
async function actualizarPedidoReal(idReal: number, cuerpo: PedidoRealEditar): Promise<PedidoReal> {
  const { data, error } = await api.PATCH('/api/pedidos-reales/{idReal}', {
    params: { path: { idReal } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Captura el seguimiento por renglón (`PATCH /api/pedidos-reales/{idReal}/seguimiento`). */
async function actualizarSeguimiento(
  idReal: number,
  cuerpo: PedidoRealSeguimiento,
): Promise<PedidoReal> {
  const { data, error } = await api.PATCH('/api/pedidos-reales/{idReal}/seguimiento', {
    params: { path: { idReal } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Lista los pedidos reales de un pedido (deshabilitada sin id). */
export function usePedidosReales(
  idPedido: number | undefined,
): UseQueryResult<PedidoReal[], ErrorDeApi> {
  return useQuery({
    queryKey: claveReales(idPedido ?? 0),
    queryFn: () => listarPedidosReales(idPedido as number),
    enabled: idPedido !== undefined,
  });
}

/** Argumentos de la mutación de alta de pedido real. */
export interface ArgsCrearPedidoReal {
  idPedido: number;
  cuerpo: PedidoRealCrear;
}

/** Invalida los pedidos reales de un pedido (y su detalle). */
function invalidarReales(queryClient: ReturnType<typeof useQueryClient>, idPedido: number): void {
  void queryClient.invalidateQueries({ queryKey: claveReales(idPedido) });
}

/** Crea un pedido real e invalida la lista de reales del pedido. */
export function useCrearPedidoReal(): UseMutationResult<
  PedidoReal,
  ErrorDeApi,
  ArgsCrearPedidoReal
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idPedido, cuerpo }: ArgsCrearPedidoReal) => crearPedidoReal(idPedido, cuerpo),
    onSuccess: (_resultado, variables) => invalidarReales(queryClient, variables.idPedido),
  });
}

/** Argumentos de la mutación de edición del encabezado de un pedido real. */
export interface ArgsActualizarPedidoReal {
  idPedido: number;
  idReal: number;
  cuerpo: PedidoRealEditar;
}

/** Edita el encabezado de un pedido real e invalida la lista de reales. */
export function useActualizarPedidoReal(): UseMutationResult<
  PedidoReal,
  ErrorDeApi,
  ArgsActualizarPedidoReal
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idReal, cuerpo }: ArgsActualizarPedidoReal) =>
      actualizarPedidoReal(idReal, cuerpo),
    onSuccess: (_resultado, variables) => invalidarReales(queryClient, variables.idPedido),
  });
}

/** Argumentos de la mutación de seguimiento. */
export interface ArgsSeguimiento {
  idPedido: number;
  idReal: number;
  cuerpo: PedidoRealSeguimiento;
}

/** Captura el seguimiento por renglón e invalida la lista de reales. */
export function useActualizarSeguimiento(): UseMutationResult<
  PedidoReal,
  ErrorDeApi,
  ArgsSeguimiento
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idReal, cuerpo }: ArgsSeguimiento) => actualizarSeguimiento(idReal, cuerpo),
    onSuccess: (_resultado, variables) => invalidarReales(queryClient, variables.idPedido),
  });
}

/** Cancela un pedido real (suave, con motivo — `POST /api/pedidos-reales/{idReal}/cancelar`). */
async function cancelarPedidoReal(
  idReal: number,
  cuerpo: PedidoRealCancelarCuerpo,
): Promise<PedidoReal> {
  const { data, error } = await api.POST('/api/pedidos-reales/{idReal}/cancelar', {
    params: { path: { idReal } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Argumentos de la mutación de cancelar un pedido real (V1-E4 punto 6). */
export interface ArgsCancelarPedidoReal {
  idPedido: number;
  idReal: number;
  cuerpo: PedidoRealCancelarCuerpo;
}

/** Cancela un pedido real (suave) e invalida la lista de reales del pedido. */
export function useCancelarPedidoReal(): UseMutationResult<
  PedidoReal,
  ErrorDeApi,
  ArgsCancelarPedidoReal
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idReal, cuerpo }: ArgsCancelarPedidoReal) => cancelarPedidoReal(idReal, cuerpo),
    onSuccess: (_resultado, variables) => invalidarReales(queryClient, variables.idPedido),
  });
}
