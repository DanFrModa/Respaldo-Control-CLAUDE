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
  OrdenCompra,
  OrdenCompraCancelar,
  OrdenCompraCrear,
  OrdenCompraEditar,
  OrdenesCompraPagina,
  OrdenesCompraQuery,
} from './tipos';

/**
 * Capa de datos del módulo ÓRDENES DE COMPRA (F4-E2) — réplica del ESTÁNDAR de Órdenes de producción
 * (`api/ordenes.ts`). Cada función llama al cliente TIPADO del OpenAPI, normaliza (`data` en éxito,
 * `ErrorDeApi` con el mensaje del backend en fallo) y se expone como consulta o mutación (las
 * mutaciones invalidan la cache de OC y el detalle). CERO lógica de negocio: el backend valida,
 * autoriza y decide (A1) — incluida la derivación del estatus, el total y los folios atómicos.
 */

/** Clave raíz de la cache de órdenes de compra en TanStack Query. */
export const CLAVE_OC = ['ordenes-compra'] as const;

/** Clave de cache de una página concreta del listado (depende de los filtros). */
function claveListaOc(query: OrdenesCompraQuery): readonly unknown[] {
  return [...CLAVE_OC, 'lista', query];
}

/** Clave de cache de UNA orden de compra (su detalle). */
function claveOc(id: number): readonly unknown[] {
  return [...CLAVE_OC, 'detalle', id];
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/** Pide una página del listado de OC (búsqueda + filtros + orden + paginación en servidor). */
async function listarOc(query: OrdenesCompraQuery): Promise<OrdenesCompraPagina> {
  const { data, error } = await api.GET('/api/ordenes-compra', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Obtiene una OC por id (encabezado + líneas + matriz + órdenes ligadas + total). */
async function obtenerOc(id: number): Promise<OrdenCompra> {
  const { data, error } = await api.GET('/api/ordenes-compra/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Escrituras ──────────────────────────────────────────────────────────────────

/** Crea una OC en borrador (`POST /api/ordenes-compra`). */
async function crearOc(cuerpo: OrdenCompraCrear): Promise<OrdenCompra> {
  const { data, error } = await api.POST('/api/ordenes-compra', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza una OC (`PATCH /api/ordenes-compra/{id}`; las líneas reemplazan al set actual). */
async function actualizarOc(id: number, cuerpo: OrdenCompraEditar): Promise<OrdenCompra> {
  const { data, error } = await api.PATCH('/api/ordenes-compra/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Autoriza una OC (`POST /api/ordenes-compra/{id}/autorizar`, sin cuerpo). */
async function autorizarOc(id: number): Promise<OrdenCompra> {
  const { data, error } = await api.POST('/api/ordenes-compra/{id}/autorizar', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Cancela una OC (cancelación suave, exige motivo, `POST /api/ordenes-compra/{id}/cancelar`). */
async function cancelarOc(id: number, cuerpo: OrdenCompraCancelar): Promise<OrdenCompra> {
  const { data, error } = await api.POST('/api/ordenes-compra/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Duplica una OC a un borrador nuevo (`POST /api/ordenes-compra/{id}/duplicar`, sin cuerpo). */
async function duplicarOc(id: number): Promise<OrdenCompra> {
  const { data, error } = await api.POST('/api/ordenes-compra/{id}/duplicar', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks de lectura ────────────────────────────────────────────────────────────

/** Lista OC con los filtros dados (mantiene la página previa al paginar/filtrar). */
export function useOrdenesCompra(
  query: OrdenesCompraQuery,
): UseQueryResult<OrdenesCompraPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaOc(query),
    queryFn: () => listarOc(query),
    placeholderData: keepPreviousData,
  });
}

/** Obtiene el detalle de una OC (deshabilitada si no hay id). */
export function useOrdenCompra(id: number | undefined): UseQueryResult<OrdenCompra, ErrorDeApi> {
  return useQuery({
    queryKey: claveOc(id ?? 0),
    queryFn: () => obtenerOc(id as number),
    enabled: id !== undefined,
  });
}

// ── Hooks de escritura ────────────────────────────────────────────────────────────

/** Invalida la lista de OC y, si se da, el detalle de UNA OC. */
function invalidar(queryClient: ReturnType<typeof useQueryClient>, id?: number): void {
  void queryClient.invalidateQueries({ queryKey: CLAVE_OC });
  if (id !== undefined) {
    void queryClient.invalidateQueries({ queryKey: claveOc(id) });
  }
}

/** Crea una OC e invalida la lista. */
export function useCrearOc(): UseMutationResult<OrdenCompra, ErrorDeApi, OrdenCompraCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearOc,
    onSuccess: () => invalidar(queryClient),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarOc {
  id: number;
  cuerpo: OrdenCompraEditar;
}

/** Edita una OC e invalida la lista y su detalle. */
export function useActualizarOc(): UseMutationResult<OrdenCompra, ErrorDeApi, ArgsActualizarOc> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarOc) => actualizarOc(id, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.id),
  });
}

/** Autoriza una OC e invalida la lista y su detalle. */
export function useAutorizarOc(): UseMutationResult<OrdenCompra, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: autorizarOc,
    onSuccess: (_resultado, id) => invalidar(queryClient, id),
  });
}

/** Argumentos de la mutación de cancelar. */
export interface ArgsCancelarOc {
  id: number;
  cuerpo: OrdenCompraCancelar;
}

/** Cancela una OC (suave) e invalida la lista y su detalle. */
export function useCancelarOc(): UseMutationResult<OrdenCompra, ErrorDeApi, ArgsCancelarOc> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarOc) => cancelarOc(id, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.id),
  });
}

/** Duplica una OC a un borrador nuevo e invalida la lista. */
export function useDuplicarOc(): UseMutationResult<OrdenCompra, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: duplicarOc,
    onSuccess: () => invalidar(queryClient),
  });
}

// ── Impreso (PDF binario; servidor, fuera del cliente tipado) ──────────────────────────

/**
 * Abre el PDF de UNA orden de compra en una pestaña nueva (`GET /api/ordenes-compra/{id}/impreso`).
 * El impreso es SERVER-SIDE (igual que el resto de impresos del proyecto, p. ej. la orden de
 * producción): la auth viaja por la cookie de sesión (mismo origen), así que basta `window.open`.
 */
export function imprimirOc(id: number): void {
  window.open(`/api/ordenes-compra/${String(id)}/impreso`, '_blank', 'noopener');
}
