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
  CostoOrden,
  CostoOrdenGuardar,
  CostoRealOrden,
  ListaCostos,
  ListaCostosQuery,
  ListaPrecios,
  ListaPreciosQuery,
  Margenes,
  MargenesQuery,
  PreCostoModelo,
} from './tipos';

/**
 * Capa de datos de COSTOS (Módulo 6, F7-E1). Mismo estándar: cliente TIPADO del OpenAPI, normaliza
 * (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio (A1): el backend
 * calcula las fórmulas, decide la base de prorrateo, rechaza `noCostear` y oculta los importes.
 */

/** Clave raíz de la caché de costos. */
export const CLAVE_COSTOS = ['costos'] as const;

// ── Pre-costo por modelo ─────────────────────────────────────────────────────

async function obtenerPreCosto(idModelo: number): Promise<PreCostoModelo> {
  const { data, error } = await api.GET('/api/costos/pre-costo/{idModelo}', {
    params: { path: { idModelo } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Pre-costo de un modelo (habilitado solo con un modelo elegido). */
export function usePreCosto(idModelo: number | null): UseQueryResult<PreCostoModelo, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_COSTOS, 'pre-costo', idModelo],
    queryFn: () => obtenerPreCosto(idModelo as number),
    enabled: idModelo !== null,
  });
}

// ── Lista de precios ─────────────────────────────────────────────────────────

async function obtenerListaPrecios(query: ListaPreciosQuery): Promise<ListaPrecios> {
  const { data, error } = await api.GET('/api/costos/lista-precios', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Lista de precios sugeridos por modelo (filtrable por género y activos/inactivos). */
export function useListaPrecios(
  query: ListaPreciosQuery,
): UseQueryResult<ListaPrecios, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_COSTOS, 'lista-precios', query],
    queryFn: () => obtenerListaPrecios(query),
    placeholderData: keepPreviousData,
  });
}

// ── Costo de una orden ───────────────────────────────────────────────────────

async function obtenerCostoOrden(idOrden: number): Promise<CostoOrden> {
  const { data, error } = await api.GET('/api/costos/ordenes/{idOrden}', {
    params: { path: { idOrden } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Costo de una orden (teórico + guardado + unitario). */
export function useCostoOrden(idOrden: number | null): UseQueryResult<CostoOrden, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_COSTOS, 'orden', idOrden],
    queryFn: () => obtenerCostoOrden(idOrden as number),
    enabled: idOrden !== null,
  });
}

async function obtenerCostoRealOrden(idOrden: number): Promise<CostoRealOrden> {
  const { data, error } = await api.GET('/api/costos/ordenes/{idOrden}/real', {
    params: { path: { idOrden } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/**
 * DESGLOSE del costo REAL de materiales de una orden (qué se compró, a quién, a qué precio y qué se
 * valuó a último precio de compra). Se pide BAJO DEMANDA: solo cuando el usuario abre el desglose.
 */
export function useCostoRealOrden(
  idOrden: number | null,
  habilitado: boolean,
): UseQueryResult<CostoRealOrden, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_COSTOS, 'orden-real', idOrden],
    queryFn: () => obtenerCostoRealOrden(idOrden as number),
    enabled: idOrden !== null && habilitado,
  });
}

async function guardarCostoOrden(idOrden: number, cuerpo: CostoOrdenGuardar): Promise<CostoOrden> {
  const { data, error } = await api.PUT('/api/costos/ordenes/{idOrden}', {
    params: { path: { idOrden } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Argumentos de guardado del costo de una orden. */
export interface ArgsGuardarCosto {
  idOrden: number;
  cuerpo: CostoOrdenGuardar;
}

/** Guarda/ajusta el costo de una orden e invalida su detalle + la lista de costos. */
export function useGuardarCostoOrden(): UseMutationResult<
  CostoOrden,
  ErrorDeApi,
  ArgsGuardarCosto
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idOrden, cuerpo }: ArgsGuardarCosto) => guardarCostoOrden(idOrden, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_COSTOS }),
  });
}

// ── Lista de costos ──────────────────────────────────────────────────────────

async function obtenerListaCostos(query: ListaCostosQuery): Promise<ListaCostos> {
  const { data, error } = await api.GET('/api/costos/ordenes', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Lista de órdenes ya costeadas (paginada, filtrable). */
export function useListaCostos(query: ListaCostosQuery): UseQueryResult<ListaCostos, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_COSTOS, 'lista-costos', query],
    queryFn: () => obtenerListaCostos(query),
    placeholderData: keepPreviousData,
  });
}

// ── Márgenes por pedido ──────────────────────────────────────────────────────

async function obtenerMargenes(query: MargenesQuery): Promise<Margenes> {
  const { data, error } = await api.GET('/api/costos/margenes-por-pedido', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Costos y márgenes por pedido (filtrable por mes/año/cliente). */
export function useMargenes(query: MargenesQuery): UseQueryResult<Margenes, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_COSTOS, 'margenes', query],
    queryFn: () => obtenerMargenes(query),
    placeholderData: keepPreviousData,
  });
}

// ── Impresos (PDF/Excel binario; auth por cookie de sesión, mismo origen) ──────

/** Arma una query string a partir de un objeto de filtros (ignora vacíos/undefined). */
function comoQueryString(filtro: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtro)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s === '' ? '' : `?${s}`;
}

/** Abre la LISTA DE PRECIOS en PDF (R9) en una pestaña nueva. */
export function imprimirListaPrecios(query: ListaPreciosQuery = {}): void {
  window.open(`/api/costos/lista-precios/impreso${comoQueryString(query)}`, '_blank', 'noopener');
}

/** Abre los MÁRGENES POR PEDIDO en PDF (R9) en una pestaña nueva. */
export function imprimirMargenes(query: MargenesQuery = {}): void {
  window.open(
    `/api/costos/margenes-por-pedido/impreso${comoQueryString(query)}`,
    '_blank',
    'noopener',
  );
}

/** Descarga los MÁRGENES POR PEDIDO en Excel (.xlsx). */
export function descargarExcelMargenes(query: MargenesQuery = {}): void {
  window.open(
    `/api/costos/margenes-por-pedido/excel${comoQueryString(query)}`,
    '_blank',
    'noopener',
  );
}
