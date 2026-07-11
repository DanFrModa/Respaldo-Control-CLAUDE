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
  EsMaConceptoRevisable,
  EsMaConciliacion,
  EsMaConciliacionQuery,
  EsMaDesglosado,
  EsMaEstadoCuenta,
  EsMaEstadoCuentaQuery,
  EsMaMaquileros,
  EsMaMaquilerosQuery,
  EsMaMovimiento,
  EsMaMovimientoCrear,
  EsMaMovimientosLista,
  EsMaPago,
  EsMaPagoCrear,
  EsMaPagosSemanales,
  EsMaPagosSemanalesQuery,
  EsMaRecibosSemanales,
  EsMaRecibosSemanalesQuery,
  EsMaRevision,
  EsMaSaldo,
  EsMaSaldoQuery,
  EsMaSaldosTodos,
  EsMaSaldosTodosQuery,
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

// ── F6-E5: estado de cuenta, desglosado, saldos de todos, semanales, selector, revisión ──

/** Filtro de periodo + facturación de las consultas del estado de cuenta. */
type FiltroPeriodo = { desde?: string; hasta?: string; conFactura?: 'con' | 'sin' };

/** Arma la query string de un filtro de periodo (para los enlaces de descarga de PDF/Excel). */
function comoQueryString(filtro: FiltroPeriodo): string {
  const p = new URLSearchParams();
  if (filtro.desde !== undefined) p.set('desde', filtro.desde);
  if (filtro.hasta !== undefined) p.set('hasta', filtro.hasta);
  if (filtro.conFactura !== undefined) p.set('conFactura', filtro.conFactura);
  const s = p.toString();
  return s === '' ? '' : `?${s}`;
}

async function obtenerEstadoCuenta(
  idMaquilero: number,
  query: EsMaEstadoCuentaQuery,
): Promise<EsMaEstadoCuenta> {
  const { data, error } = await api.GET('/api/esma/maquileros/{id}/estado-cuenta', {
    params: { path: { id: idMaquilero }, query },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerDesglosado(
  idMaquilero: number,
  query: EsMaEstadoCuentaQuery,
): Promise<EsMaDesglosado> {
  const { data, error } = await api.GET('/api/esma/maquileros/{id}/desglosado', {
    params: { path: { id: idMaquilero }, query },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerSaldosTodos(query: EsMaSaldosTodosQuery): Promise<EsMaSaldosTodos> {
  const { data, error } = await api.GET('/api/esma/saldos', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerPagosSemanales(query: EsMaPagosSemanalesQuery): Promise<EsMaPagosSemanales> {
  const { data, error } = await api.GET('/api/esma/pagos-semanales', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerRecibosSemanales(
  query: EsMaRecibosSemanalesQuery,
): Promise<EsMaRecibosSemanales> {
  const { data, error } = await api.GET('/api/esma/recibos-semanales', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerMaquileros(query: EsMaMaquilerosQuery): Promise<EsMaMaquileros> {
  const { data, error } = await api.GET('/api/esma/maquileros', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function revisarPartida(concepto: EsMaConceptoRevisable, id: number): Promise<EsMaRevision> {
  const { data, error } = await api.POST('/api/esma/movimientos/{concepto}/{id}/revisar', {
    params: { path: { concepto, id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Estado de cuenta unificado de un maquilero (deshabilitado sin maquilero). */
export function useEstadoCuenta(
  idMaquilero: number | undefined,
  query: EsMaEstadoCuentaQuery = {},
): UseQueryResult<EsMaEstadoCuenta, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CUENTA_ESMA, 'estado-cuenta', idMaquilero, query],
    queryFn: () => obtenerEstadoCuenta(idMaquilero as number, query),
    enabled: idMaquilero !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Estado de cuenta desglosado de un maquilero (deshabilitado sin maquilero). */
export function useDesglosado(
  idMaquilero: number | undefined,
  query: EsMaEstadoCuentaQuery = {},
): UseQueryResult<EsMaDesglosado, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CUENTA_ESMA, 'desglosado', idMaquilero, query],
    queryFn: () => obtenerDesglosado(idMaquilero as number, query),
    enabled: idMaquilero !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Saldos de todos los maquileros con saldo ≠ 0 (drill-down). */
export function useSaldosTodos(
  query: EsMaSaldosTodosQuery = {},
): UseQueryResult<EsMaSaldosTodos, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CUENTA_ESMA, 'saldos-todos', query],
    queryFn: () => obtenerSaldosTodos(query),
    placeholderData: keepPreviousData,
  });
}

/** Pagos del periodo (consulta semanal). */
export function usePagosSemanales(
  query: EsMaPagosSemanalesQuery = {},
): UseQueryResult<EsMaPagosSemanales, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CUENTA_ESMA, 'pagos-semanales', query],
    queryFn: () => obtenerPagosSemanales(query),
    placeholderData: keepPreviousData,
  });
}

/** Recibos de maquila del periodo (consulta semanal EsMa). */
export function useRecibosSemanalesEsMa(
  query: EsMaRecibosSemanalesQuery = {},
): UseQueryResult<EsMaRecibosSemanales, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CUENTA_ESMA, 'recibos-semanales', query],
    queryFn: () => obtenerRecibosSemanales(query),
    placeholderData: keepPreviousData,
  });
}

/** Selector de maquileros activos (por tipo costura/estampado). */
export function useMaquilerosEsMa(
  query: EsMaMaquilerosQuery = {},
): UseQueryResult<EsMaMaquileros, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CUENTA_ESMA, 'maquileros', query],
    queryFn: () => obtenerMaquileros(query),
    placeholderData: keepPreviousData,
  });
}

/** Argumentos de la revisión de una partida. */
export interface ArgsRevisar {
  concepto: EsMaConceptoRevisable;
  id: number;
}

/** Revisa (autoriza) una partida capturada → revisada e invalida la cuenta. */
export function useRevisarMovimiento(): UseMutationResult<EsMaRevision, ErrorDeApi, ArgsRevisar> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ concepto, id }: ArgsRevisar) => revisarPartida(concepto, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CUENTA_ESMA }),
  });
}

/**
 * Abre el impreso PDF (R9) del estado de cuenta de un maquilero por periodo en una pestaña nueva. La
 * auth viaja por la cookie de sesión (mismo origen), así que basta `window.open`.
 */
export function imprimirEstadoCuenta(idMaquilero: number, filtro: FiltroPeriodo = {}): void {
  window.open(
    `/api/esma/maquileros/${String(idMaquilero)}/desglosado/impreso${comoQueryString(filtro)}`,
    '_blank',
    'noopener',
  );
}

/** Descarga el Excel (.xlsx) del estado de cuenta desglosado de un maquilero por periodo. */
export function descargarExcelEstadoCuenta(idMaquilero: number, filtro: FiltroPeriodo = {}): void {
  window.open(
    `/api/esma/maquileros/${String(idMaquilero)}/desglosado/excel${comoQueryString(filtro)}`,
    '_blank',
    'noopener',
  );
}
