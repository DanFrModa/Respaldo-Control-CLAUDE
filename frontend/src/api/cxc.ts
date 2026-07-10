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
  CxcBandeja,
  CxcBandejaQuery,
  CxcEstadoCuenta,
  CxcEstadoCuentaQuery,
  CxcMovimientoCrear,
  CxcMovimientoCancelar,
  CxcMovimientoSalida,
} from './tipos';

/**
 * Capa de datos de CxC — cuentas por cobrar (Módulo 14, F9-E4). Mismo estándar: cliente TIPADO del
 * OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio
 * (A1): el backend calcula el aging, el saldo (D3), el resumen y oculta los importes.
 */

/** Clave raíz de la caché de CxC. */
export const CLAVE_CXC = ['cxc'] as const;

// ── Bandeja "por cobrar" ─────────────────────────────────────────────────────

async function obtenerBandeja(query: CxcBandejaQuery): Promise<CxcBandeja> {
  const { data, error } = await api.GET('/api/cxc/por-cobrar', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Bandeja de clientes por cobrar con aging + resumen (mantiene la página previa al filtrar). */
export function useBandejaPorCobrar(
  query: CxcBandejaQuery,
): UseQueryResult<CxcBandeja, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CXC, 'bandeja', query],
    queryFn: () => obtenerBandeja(query),
    placeholderData: keepPreviousData,
  });
}

// ── Estado de cuenta de un cliente ───────────────────────────────────────────

async function obtenerEstadoCuenta(
  idCliente: number,
  query: CxcEstadoCuentaQuery,
): Promise<CxcEstadoCuenta> {
  const { data, error } = await api.GET('/api/cxc/clientes/{id}/estado-cuenta', {
    params: { path: { id: idCliente }, query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Estado de cuenta de un cliente (habilitado solo con un cliente elegido). */
export function useEstadoCuentaCliente(
  idCliente: number | null,
  query: CxcEstadoCuentaQuery,
): UseQueryResult<CxcEstadoCuenta, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CXC, 'estado-cuenta', idCliente, query],
    queryFn: () => obtenerEstadoCuenta(idCliente as number, query),
    enabled: idCliente !== null,
    placeholderData: keepPreviousData,
  });
}

// ── Captura de un movimiento ─────────────────────────────────────────────────

async function crearMovimiento(
  idCliente: number,
  cuerpo: CxcMovimientoCrear,
): Promise<CxcMovimientoSalida> {
  const { data, error } = await api.POST('/api/cxc/clientes/{id}/movimientos', {
    params: { path: { id: idCliente } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Argumentos del alta de un movimiento de CxC. */
export interface ArgsCrearMovimientoCxc {
  idCliente: number;
  cuerpo: CxcMovimientoCrear;
}

/** Captura un movimiento de CxC e invalida la bandeja + el estado de cuenta. */
export function useRegistrarMovimientoCxc(): UseMutationResult<
  CxcMovimientoSalida,
  ErrorDeApi,
  ArgsCrearMovimientoCxc
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idCliente, cuerpo }: ArgsCrearMovimientoCxc) =>
      crearMovimiento(idCliente, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CXC }),
  });
}

// ── Cancelación ──────────────────────────────────────────────────────────────

async function cancelarMovimiento(
  idMovimiento: number,
  cuerpo: CxcMovimientoCancelar,
): Promise<CxcMovimientoSalida> {
  const { data, error } = await api.POST('/api/cxc/movimientos/{id}/cancelar', {
    params: { path: { id: idMovimiento } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Argumentos de la cancelación de un movimiento de CxC. */
export interface ArgsCancelarMovimientoCxc {
  idMovimiento: number;
  cuerpo: CxcMovimientoCancelar;
}

/** Cancela (inverso auditado) un movimiento de CxC e invalida la bandeja + el estado de cuenta. */
export function useCancelarMovimientoCxc(): UseMutationResult<
  CxcMovimientoSalida,
  ErrorDeApi,
  ArgsCancelarMovimientoCxc
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idMovimiento, cuerpo }: ArgsCancelarMovimientoCxc) =>
      cancelarMovimiento(idMovimiento, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CXC }),
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

/** Abre el ESTADO DE CUENTA del cliente en PDF (R9) en una pestaña nueva. */
export function imprimirEstadoCuentaCxc(idCliente: number, query: CxcEstadoCuentaQuery = {}): void {
  window.open(
    `/api/cxc/clientes/${String(idCliente)}/estado-cuenta/impreso${comoQueryString(query)}`,
    '_blank',
    'noopener',
  );
}
