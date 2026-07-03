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
  KpisCalidad,
  KpisCalidadQuery,
  KpisRc,
  KpisRcQuery,
  KpisWip,
  KpisWipQuery,
} from './tipos';

/**
 * Capa de datos de INDICADORES (Módulo Indicadores, F7-E3). Cliente TIPADO del OpenAPI, normaliza
 * (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio (A1): el backend
 * calcula los KPIs sobre vistas materializadas y agrega en SQL. El botón "Refrescar" solo ENCOLA el
 * job (regresa de inmediato) e invalida la caché para re-consultar.
 */

/** Clave raíz de la caché de indicadores. */
export const CLAVE_INDICADORES = ['indicadores'] as const;

// ── Consultas ─────────────────────────────────────────────────────────────────

async function obtenerRc(query: KpisRcQuery): Promise<KpisRc> {
  const { data, error } = await api.GET('/api/indicadores/rc', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** KPIs de Ruta Crítica (filtrable por periodo/cliente/maquilero/proceso). */
export function useKpisRc(query: KpisRcQuery): UseQueryResult<KpisRc, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INDICADORES, 'rc', query],
    queryFn: () => obtenerRc(query),
    placeholderData: keepPreviousData,
  });
}

async function obtenerCalidad(query: KpisCalidadQuery): Promise<KpisCalidad> {
  const { data, error } = await api.GET('/api/indicadores/calidad-maquileros', {
    params: { query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Calidad por maquilero (filtrable por periodo/maquilero). */
export function useKpisCalidad(query: KpisCalidadQuery): UseQueryResult<KpisCalidad, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INDICADORES, 'calidad', query],
    queryFn: () => obtenerCalidad(query),
    placeholderData: keepPreviousData,
  });
}

async function obtenerWip(query: KpisWipQuery): Promise<KpisWip> {
  const { data, error } = await api.GET('/api/indicadores/wip', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** WIP analítico (filtrable por cliente/modelo/solo pendientes, paginado). */
export function useKpisWip(query: KpisWipQuery): UseQueryResult<KpisWip, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INDICADORES, 'wip', query],
    queryFn: () => obtenerWip(query),
    placeholderData: keepPreviousData,
  });
}

// ── Refresco on-demand ────────────────────────────────────────────────────────

async function refrescar(): Promise<{ encolado: boolean }> {
  const { data, error } = await api.POST('/api/indicadores/refrescar', {});
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/**
 * Encola el refresco de las vistas de KPIs (regresa de inmediato) e invalida la caché de indicadores
 * para que la siguiente consulta traiga los números/sello ya recalculados.
 */
export function useRefrescarKpis(): UseMutationResult<{ encolado: boolean }, ErrorDeApi, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refrescar(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_INDICADORES }),
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

/** Abre el tablero de Ruta Crítica en PDF (R9). */
export function imprimirKpisRc(query: KpisRcQuery = {}): void {
  window.open(`/api/indicadores/rc/impreso${comoQueryString(query)}`, '_blank', 'noopener');
}
/** Descarga el tablero de Ruta Crítica en Excel (.xlsx). */
export function descargarExcelKpisRc(query: KpisRcQuery = {}): void {
  window.open(`/api/indicadores/rc/excel${comoQueryString(query)}`, '_blank', 'noopener');
}
/** Abre el tablero de calidad en PDF (R9). */
export function imprimirKpisCalidad(query: KpisCalidadQuery = {}): void {
  window.open(
    `/api/indicadores/calidad-maquileros/impreso${comoQueryString(query)}`,
    '_blank',
    'noopener',
  );
}
/** Descarga el tablero de calidad en Excel (.xlsx). */
export function descargarExcelKpisCalidad(query: KpisCalidadQuery = {}): void {
  window.open(
    `/api/indicadores/calidad-maquileros/excel${comoQueryString(query)}`,
    '_blank',
    'noopener',
  );
}
/** Abre el tablero WIP en PDF (R9). */
export function imprimirKpisWip(query: KpisWipQuery = {}): void {
  window.open(`/api/indicadores/wip/impreso${comoQueryString(query)}`, '_blank', 'noopener');
}
/** Descarga el tablero WIP en Excel (.xlsx). */
export function descargarExcelKpisWip(query: KpisWipQuery = {}): void {
  window.open(`/api/indicadores/wip/excel${comoQueryString(query)}`, '_blank', 'noopener');
}
