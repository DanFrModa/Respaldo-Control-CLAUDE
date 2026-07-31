import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { Ventas, VentasQuery } from './tipos';

/**
 * Capa de datos de VENTAS (vista comercial de la facturación por modelo sobre el EDR, proto vVentas).
 * Cliente TIPADO del OpenAPI; CERO lógica de negocio (A1): el backend agrega el resumen (importe,
 * unidades, ticket, # líneas) y pagina las líneas. Se protege con `edr.ver` (es data del EDR).
 */

/** Clave raíz de la caché de ventas. */
export const CLAVE_VENTAS = ['ventas'] as const;

async function obtenerVentas(query: VentasQuery): Promise<Ventas> {
  const { data, error } = await api.GET('/api/edr/ventas', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Ventas por período: resumen + página de líneas (filtrable por mes/año/búsqueda). */
export function useVentas(query: VentasQuery): UseQueryResult<Ventas, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_VENTAS, query],
    queryFn: () => obtenerVentas(query),
    placeholderData: keepPreviousData,
  });
}

// ── Excel (binario server-side; auth por cookie de sesión, mismo origen) ────────

/** Arma una query string a partir de un objeto de filtros (ignora vacíos/undefined). */
function comoQueryString(filtro: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtro)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s === '' ? '' : `?${s}`;
}

/**
 * Descarga las ventas del período en Excel (.xlsx) — TODO el filtro, no solo la página. Solo viajan
 * los filtros (año/mes/búsqueda); la paginación no aplica al export.
 */
export function descargarExcelVentas(filtro: {
  anio: number;
  mes?: number;
  busqueda?: string;
}): void {
  window.open(`/api/edr/ventas/excel${comoQueryString(filtro)}`, '_blank', 'noopener');
}
