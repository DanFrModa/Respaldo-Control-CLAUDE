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
  CxpBandeja,
  CxpBandejaQuery,
  CxpEstadoCuenta,
  CxpEstadoCuentaQuery,
  CxpMovimientoCrear,
  CxpMovimientoCancelar,
  CxpMovimientoSalida,
} from './tipos';

/**
 * Capa de datos de CxP — cuentas por pagar (Módulo 14, F9-E2). Mismo estándar: cliente TIPADO del
 * OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio
 * (A1): el backend calcula el aging, el saldo (D3), el resumen y oculta los importes.
 */

/** Clave raíz de la caché de CxP. */
export const CLAVE_CXP = ['cxp'] as const;

// ── Bandeja "por pagar" ──────────────────────────────────────────────────────

async function obtenerBandeja(query: CxpBandejaQuery): Promise<CxpBandeja> {
  const { data, error } = await api.GET('/api/cxp/por-pagar', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Bandeja de proveedores por pagar con aging + resumen (mantiene la página previa al filtrar). */
export function useBandejaPorPagar(query: CxpBandejaQuery): UseQueryResult<CxpBandeja, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CXP, 'bandeja', query],
    queryFn: () => obtenerBandeja(query),
    placeholderData: keepPreviousData,
  });
}

// ── Estado de cuenta de un proveedor ─────────────────────────────────────────

async function obtenerEstadoCuenta(
  idProveedor: number,
  query: CxpEstadoCuentaQuery,
): Promise<CxpEstadoCuenta> {
  const { data, error } = await api.GET('/api/cxp/proveedores/{id}/estado-cuenta', {
    params: { path: { id: idProveedor }, query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Estado de cuenta de un proveedor (habilitado solo con un proveedor elegido). */
export function useEstadoCuentaProveedor(
  idProveedor: number | null,
  query: CxpEstadoCuentaQuery,
): UseQueryResult<CxpEstadoCuenta, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CXP, 'estado-cuenta', idProveedor, query],
    queryFn: () => obtenerEstadoCuenta(idProveedor as number, query),
    enabled: idProveedor !== null,
    placeholderData: keepPreviousData,
  });
}

// ── Captura de un movimiento ─────────────────────────────────────────────────

async function crearMovimiento(
  idProveedor: number,
  cuerpo: CxpMovimientoCrear,
): Promise<CxpMovimientoSalida> {
  const { data, error } = await api.POST('/api/cxp/proveedores/{id}/movimientos', {
    params: { path: { id: idProveedor } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Argumentos del alta de un movimiento de CxP. */
export interface ArgsCrearMovimientoCxp {
  idProveedor: number;
  cuerpo: CxpMovimientoCrear;
}

/** Captura un movimiento de CxP e invalida la bandeja + el estado de cuenta. */
export function useRegistrarMovimientoCxp(): UseMutationResult<
  CxpMovimientoSalida,
  ErrorDeApi,
  ArgsCrearMovimientoCxp
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idProveedor, cuerpo }: ArgsCrearMovimientoCxp) =>
      crearMovimiento(idProveedor, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CXP }),
  });
}

// ── Cancelación ──────────────────────────────────────────────────────────────

async function cancelarMovimiento(
  idMovimiento: number,
  cuerpo: CxpMovimientoCancelar,
): Promise<CxpMovimientoSalida> {
  const { data, error } = await api.POST('/api/cxp/movimientos/{id}/cancelar', {
    params: { path: { id: idMovimiento } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Argumentos de la cancelación de un movimiento de CxP. */
export interface ArgsCancelarMovimientoCxp {
  idMovimiento: number;
  cuerpo: CxpMovimientoCancelar;
}

/** Cancela (inverso auditado) un movimiento de CxP e invalida la bandeja + el estado de cuenta. */
export function useCancelarMovimientoCxp(): UseMutationResult<
  CxpMovimientoSalida,
  ErrorDeApi,
  ArgsCancelarMovimientoCxp
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idMovimiento, cuerpo }: ArgsCancelarMovimientoCxp) =>
      cancelarMovimiento(idMovimiento, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CXP }),
  });
}

// ── Impreso PDF (auth por cookie de sesión, mismo origen) ────────────────────

/** Arma una query string a partir de un objeto de filtros (ignora vacíos/undefined). */
function comoQueryString(filtro: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtro)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s === '' ? '' : `?${s}`;
}

/** Abre el ESTADO DE CUENTA del proveedor en PDF (R9) en una pestaña nueva. */
export function imprimirEstadoCuentaCxp(
  idProveedor: number,
  query: CxpEstadoCuentaQuery = {},
): void {
  window.open(
    `/api/cxp/proveedores/${String(idProveedor)}/estado-cuenta/impreso${comoQueryString(query)}`,
    '_blank',
    'noopener',
  );
}
