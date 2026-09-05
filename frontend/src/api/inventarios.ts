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
  ExistenciasPt,
  ExistenciasPtQuery,
  KardexPt,
  KardexPtQuery,
  MovimientoPt,
  MovimientoPtCancelar,
  MovimientoPtCrear,
  TiposMovimientoLista,
  TraspasoPt,
  TraspasoPtCrear,
} from './tipos';

/**
 * Capa de datos del INVENTARIO de PRODUCTO TERMINADO (F3-E3: movimientos, traspasos, existencias y
 * kardex) — mismo ESTÁNDAR que Etapas/Almacenes: llama al cliente TIPADO del OpenAPI, normaliza
 * (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio (A1): el backend
 * valida (no-negativo, traspaso atómico, inverso de cancelación) y es la autoridad.
 */

/** Clave raíz de la caché del inventario PT. */
export const CLAVE_INVENTARIO_PT = ['inventario-pt'] as const;

// ── Llamadas ─────────────────────────────────────────────────────────────────

async function crearMovimiento(cuerpo: MovimientoPtCrear): Promise<MovimientoPt> {
  const { data, error } = await api.POST('/api/inventarios/pt/movimientos', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crearTraspaso(cuerpo: TraspasoPtCrear): Promise<TraspasoPt> {
  const { data, error } = await api.POST('/api/inventarios/pt/traspasos', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function cancelarMovimiento(id: number, cuerpo: MovimientoPtCancelar): Promise<MovimientoPt> {
  const { data, error } = await api.POST('/api/inventarios/pt/movimientos/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarTiposMovimiento(): Promise<TiposMovimientoLista> {
  const { data, error } = await api.GET('/api/tipos-movimiento', {});
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarExistencias(query: ExistenciasPtQuery): Promise<ExistenciasPt> {
  const { data, error } = await api.GET('/api/inventarios/pt/existencias', {
    params: { query },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerKardex(query: KardexPtQuery): Promise<KardexPt> {
  const { data, error } = await api.GET('/api/inventarios/pt/kardex', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerMovimientoPorFolio(folio: number): Promise<MovimientoPt> {
  const { data, error } = await api.GET('/api/inventarios/pt/kardex/folio/{folio}', {
    params: { path: { folio } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * URL del PDF de la HOJA DE TRASPASO de PT (fila 0.100, §Post-F9.193 decisión 2): el papel que
 * acompaña las prendas que salen a otro almacén. NO es un folio nuevo — imprime el traspaso que ya
 * existe, por el id de CUALQUIERA de sus dos patas. Un traspaso cancelado no se imprime: el backend
 * lo rechaza.
 *
 * Tiene DOS llamadores, y son las dos puertas del papel: `TraspasosPtPagina` (la barra que aparece
 * al guardar) y `KardexPtPagina` en modo «Por folio» (la REIMPRESIÓN — se busca el folio y se
 * vuelve a sacar). Sin la segunda, una impresora atascada o una pestaña cerrada perderían la hoja.
 */
export function urlImpresoTraspasoPt(idMovimiento: number): string {
  return `/api/inventarios/pt/traspasos/${String(idMovimiento)}/impreso`;
}

// ── Hooks de consulta ─────────────────────────────────────────────────────────

/** Catálogo de tipos de movimiento de inventario (para el dropdown de movimientos manuales). */
export function useTiposMovimiento(): UseQueryResult<TiposMovimientoLista, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_PT, 'tipos-movimiento'],
    queryFn: listarTiposMovimiento,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Existencias de PT por modelo×color×talla×almacén con los filtros dados. `habilitado` corta la query
 * (p. ej. mientras no haya un `idModelo` válido), para no disparar un GET que el backend rechazaría.
 */
export function useExistenciasPt(
  query: ExistenciasPtQuery,
  habilitado = true,
): UseQueryResult<ExistenciasPt, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_PT, 'existencias', query],
    queryFn: () => listarExistencias(query),
    enabled: habilitado,
    placeholderData: keepPreviousData,
  });
}

/** Kardex de un modelo (movimientos con saldo corrido). `habilitado` corta la query sin modelo. */
export function useKardexPt(
  query: KardexPtQuery | undefined,
  habilitado = true,
): UseQueryResult<KardexPt, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_PT, 'kardex', query],
    queryFn: () => obtenerKardex(query as KardexPtQuery),
    enabled: habilitado && query !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Un movimiento PT por su folio (deshabilitada si no hay folio). */
export function useMovimientoPtPorFolio(
  folio: number | undefined,
): UseQueryResult<MovimientoPt, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_PT, 'folio', folio],
    queryFn: () => obtenerMovimientoPorFolio(folio as number),
    enabled: folio !== undefined,
  });
}

// ── Hooks de mutación ─────────────────────────────────────────────────────────

/** Registra un movimiento manual e invalida existencias/kardex. */
export function useCrearMovimientoPt(): UseMutationResult<
  MovimientoPt,
  ErrorDeApi,
  MovimientoPtCrear
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearMovimiento,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_INVENTARIO_PT }),
  });
}

/** Registra un traspaso e invalida existencias/kardex. */
export function useCrearTraspasoPt(): UseMutationResult<TraspasoPt, ErrorDeApi, TraspasoPtCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearTraspaso,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_INVENTARIO_PT }),
  });
}

/** Argumentos de una cancelación de movimiento. */
export interface ArgsCancelarMovimientoPt {
  id: number;
  cuerpo: MovimientoPtCancelar;
}

/** Cancela un movimiento (genera el inverso) e invalida existencias/kardex. */
export function useCancelarMovimientoPt(): UseMutationResult<
  MovimientoPt,
  ErrorDeApi,
  ArgsCancelarMovimientoPt
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarMovimientoPt) => cancelarMovimiento(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_INVENTARIO_PT }),
  });
}
