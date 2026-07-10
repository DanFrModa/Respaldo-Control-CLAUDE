import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { ReporteFiscal, ReporteFiscalQuery, SaludFiscal } from './tipos';

/**
 * Capa de datos de REPORTES FISCALES para el contador (Módulo 14, F9-E5). Cliente TIPADO del OpenAPI,
 * normaliza (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio (A1): el
 * backend calcula la vista fiscal, los totales, la salud y oculta los importes. Los exports (Excel/PDF)
 * se abren por `window.open` con la cookie de sesión (mismo origen), como el resto de impresos.
 */

/** Clave raíz de la caché de reportes fiscales. */
export const CLAVE_REPORTES_FISCALES = ['reportes-fiscales'] as const;

// ── Reporte fiscal (movimientos fiscales paginados + totales) ────────────────

async function obtenerReporte(query: ReporteFiscalQuery): Promise<ReporteFiscal> {
  const { data, error } = await api.GET('/api/reportes-fiscales', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Reporte fiscal del periodo (mantiene la página previa al filtrar). */
export function useReporteFiscal(
  query: ReporteFiscalQuery,
): UseQueryResult<ReporteFiscal, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_REPORTES_FISCALES, 'reporte', query],
    queryFn: () => obtenerReporte(query),
    placeholderData: keepPreviousData,
  });
}

// ── Tablero de salud fiscal ──────────────────────────────────────────────────

async function obtenerSalud(query: { desde?: string; hasta?: string }): Promise<SaludFiscal> {
  const { data, error } = await api.GET('/api/reportes-fiscales/salud', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Tablero de salud fiscal (conciliación consolidada + saldos por tercero). */
export function useSaludFiscal(query: {
  desde?: string;
  hasta?: string;
}): UseQueryResult<SaludFiscal, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_REPORTES_FISCALES, 'salud', query],
    queryFn: () => obtenerSalud(query),
    placeholderData: keepPreviousData,
  });
}

// ── Exports (auth por cookie de sesión, mismo origen) ────────────────────────

/** Arma una query string a partir de un objeto de filtros (ignora vacíos/undefined). */
function comoQueryString(filtro: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtro)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s === '' ? '' : `?${s}`;
}

/** Descarga el reporte fiscal en Excel (.xlsx) con los filtros actuales. */
export function exportarReporteFiscalExcel(query: ReporteFiscalQuery): void {
  window.open(`/api/reportes-fiscales/excel${comoQueryString(query)}`, '_blank', 'noopener');
}

/** Abre el reporte fiscal en PDF (R9) con los filtros actuales. */
export function imprimirReporteFiscal(query: ReporteFiscalQuery): void {
  window.open(`/api/reportes-fiscales/impreso${comoQueryString(query)}`, '_blank', 'noopener');
}
