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
  CargoEsMa,
  CargoEsMaValidar,
  CargosEsMa,
  CargosEsMaQuery,
  EsMaConciliacion,
  EsMaConciliacionQuery,
  EsMaMovimiento,
  EsMaMovimientoCrear,
  EsMaMovimientosLista,
  EsMaPago,
  EsMaPagoCrear,
  EsMaPagosLista,
  EsMaSaldo,
  EsMaSaldoQuery,
} from './tipos';

/**
 * Capa de datos de EsMa (cuenta corriente de maquileros). Mismo ESTÁNDAR: cliente TIPADO del
 * OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio
 * (A1): el backend valida (propuesto→validado, anti-doble-pago, ocultar importes), deriva el saldo y
 * es la autoridad.
 */

/** Clave raíz de la caché de cargos EsMa. */
export const CLAVE_CARGOS_ESMA = ['esma-cargos'] as const;
/** Clave raíz de la caché de movimientos/pagos/saldo/conciliación de EsMa. */
export const CLAVE_CUENTA_ESMA = ['esma-cuenta'] as const;

// ── Llamadas ─────────────────────────────────────────────────────────────────

async function listarCargos(query: CargosEsMaQuery): Promise<CargosEsMa> {
  const { data, error } = await api.GET('/api/esma/cargos', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function validarCargo(id: number, cuerpo: CargoEsMaValidar): Promise<CargoEsMa> {
  const { data, error } = await api.POST('/api/esma/cargos/{id}/validar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Cola de cargos EsMa por estado (default propuesto). `enabled:false` la deja en espera. */
export function useCargosEsMa(
  query: CargosEsMaQuery = {},
  opciones: { enabled?: boolean } = {},
): UseQueryResult<CargosEsMa, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CARGOS_ESMA, query],
    queryFn: () => listarCargos(query),
    placeholderData: keepPreviousData,
    enabled: opciones.enabled ?? true,
  });
}

/** Argumentos de la validación de un cargo. */
export interface ArgsValidarCargo {
  id: number;
  cuerpo: CargoEsMaValidar;
}

/** Valida (o ajusta cantidad/precio) un cargo e invalida la cola. */
export function useValidarCargoEsMa(): UseMutationResult<CargoEsMa, ErrorDeApi, ArgsValidarCargo> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsValidarCargo) => validarCargo(id, cuerpo),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_CARGOS_ESMA });
      void queryClient.invalidateQueries({ queryKey: CLAVE_CUENTA_ESMA });
    },
  });
}

// ── Corazón contable (F6-E4): abonos/descuentos/pagos, saldo y conciliación ──

async function crearMovimiento(
  concepto: 'abonos' | 'descuentos',
  cuerpo: EsMaMovimientoCrear,
): Promise<EsMaMovimiento> {
  const { data, error } =
    concepto === 'abonos'
      ? await api.POST('/api/esma/abonos', { body: cuerpo })
      : await api.POST('/api/esma/descuentos', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarAbonos(idMaquilero: number): Promise<EsMaMovimientosLista> {
  const { data, error } = await api.GET('/api/esma/maquileros/{id}/abonos', {
    params: { path: { id: idMaquilero } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarDescuentos(idMaquilero: number): Promise<EsMaMovimientosLista> {
  const { data, error } = await api.GET('/api/esma/maquileros/{id}/descuentos', {
    params: { path: { id: idMaquilero } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarPagos(idMaquilero: number): Promise<EsMaPagosLista> {
  const { data, error } = await api.GET('/api/esma/maquileros/{id}/pagos', {
    params: { path: { id: idMaquilero } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crearPago(cuerpo: EsMaPagoCrear): Promise<EsMaPago> {
  const { data, error } = await api.POST('/api/esma/pagos', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerSaldo(idMaquilero: number, query: EsMaSaldoQuery): Promise<EsMaSaldo> {
  const { data, error } = await api.GET('/api/esma/maquileros/{id}/saldo', {
    params: { path: { id: idMaquilero }, query },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerConciliacion(query: EsMaConciliacionQuery): Promise<EsMaConciliacion> {
  const { data, error } = await api.GET('/api/esma/conciliacion', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Argumentos de la captura de un abono/descuento. */
export interface ArgsCrearMovimiento {
  concepto: 'abonos' | 'descuentos';
  cuerpo: EsMaMovimientoCrear;
}

/** Captura un abono o un descuento (según `concepto`) e invalida la cuenta del maquilero. */
export function useCrearMovimientoEsMa(): UseMutationResult<
  EsMaMovimiento,
  ErrorDeApi,
  ArgsCrearMovimiento
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ concepto, cuerpo }: ArgsCrearMovimiento) => crearMovimiento(concepto, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CUENTA_ESMA }),
  });
}

/** Lista los abonos de un maquilero (deshabilitada sin maquilero). */
export function useAbonosMaquilero(
  idMaquilero: number | undefined,
): UseQueryResult<EsMaMovimientosLista, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CUENTA_ESMA, 'abonos', idMaquilero],
    queryFn: () => listarAbonos(idMaquilero as number),
    enabled: idMaquilero !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Lista los descuentos de un maquilero (deshabilitada sin maquilero). */
export function useDescuentosMaquilero(
  idMaquilero: number | undefined,
): UseQueryResult<EsMaMovimientosLista, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CUENTA_ESMA, 'descuentos', idMaquilero],
    queryFn: () => listarDescuentos(idMaquilero as number),
    enabled: idMaquilero !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Lista los pagos de un maquilero (deshabilitada sin maquilero). */
export function usePagosMaquilero(
  idMaquilero: number | undefined,
): UseQueryResult<EsMaPagosLista, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CUENTA_ESMA, 'pagos', idMaquilero],
    queryFn: () => listarPagos(idMaquilero as number),
    enabled: idMaquilero !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Captura un pago ligado a cargos (anti-doble-pago en el backend) e invalida cargos + cuenta. */
export function useCrearPagoEsMa(): UseMutationResult<EsMaPago, ErrorDeApi, EsMaPagoCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearPago,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_CARGOS_ESMA });
      void queryClient.invalidateQueries({ queryKey: CLAVE_CUENTA_ESMA });
    },
  });
}

/** Saldo derivado de un maquilero (segmentable con/sin factura). Deshabilitada sin maquilero. */
export function useSaldoMaquilero(
  idMaquilero: number | undefined,
  query: EsMaSaldoQuery = {},
): UseQueryResult<EsMaSaldo, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CUENTA_ESMA, 'saldo', idMaquilero, query],
    queryFn: () => obtenerSaldo(idMaquilero as number, query),
    enabled: idMaquilero !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Conciliación EsMa vs recibos del periodo (faltantes por cargar + cargos sin recibo). */
export function useConciliacionEsMa(
  query: EsMaConciliacionQuery = {},
): UseQueryResult<EsMaConciliacion, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CUENTA_ESMA, 'conciliacion', query],
    queryFn: () => obtenerConciliacion(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Abre el RECIBO DE PAGO de un pago EsMa en una pestaña nueva
 * (`GET /api/esma/pagos/{id}/impreso`, PDF, R9). Server-side como el resto de impresos: la auth viaja
 * por la cookie de sesión (mismo origen), así que basta `window.open`.
 */
export function imprimirPagoEsMa(id: number): void {
  window.open(`/api/esma/pagos/${String(id)}/impreso`, '_blank', 'noopener');
}
