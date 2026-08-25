import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import { CLAVE_LISTAS } from './listas-precios';
import type { paths } from './esquema.gen';

/**
 * Capa de datos de la COTIZACIÓN (V1-E7c, §Post-F9.109) — el DOCUMENTO que se le manda al cliente.
 * Mismo ESTÁNDAR que sus vecinas: cliente TIPADO del OpenAPI, normalización (`data`/`ErrorDeApi`) y
 * hooks de TanStack Query. CERO lógica de negocio (A1).
 *
 * Dos cosas que NO existen aquí, a propósito:
 *  • **editar**: la cotización es inmutable (otra vuelta = otra cotización, con TODOS los modelos).
 *  • **elegir renglones**: emitir manda sólo `idLista`; el backend mete todos los de la lista.
 *
 * Emitir/cancelar invalidan también la cache de LISTAS: el detalle de la lista muestra el bloque de
 * cotizaciones emitidas, y un renglón ya cotizado deja de poderse quitar.
 */

// ── Alias de tipos del contrato ────────────────────────────────────────────────
/** Un resumen de cotización (listado). */
export type CotizacionResumen =
  paths['/api/cotizaciones']['get']['responses']['200']['content']['application/json']['datos'][number];
/** Una cotización completa con sus renglones congelados. */
export type CotizacionDetalle =
  paths['/api/cotizaciones/{id}']['get']['responses']['200']['content']['application/json'];
/** Un renglón congelado de la cotización. */
export type CotizacionLinea = CotizacionDetalle['lineas'][number];
/** Filtros del listado. */
export type CotizacionesQuery = NonNullable<
  paths['/api/cotizaciones']['get']['parameters']['query']
>;
/** Cuerpo de la emisión. */
export type CotizacionEmitir =
  paths['/api/cotizaciones']['post']['requestBody']['content']['application/json'];
/** Cuerpo de la cancelación (motivo obligatorio). */
export type CotizacionCancelar =
  paths['/api/cotizaciones/{id}/cancelar']['post']['requestBody']['content']['application/json'];

/** Clave raíz de la cache de cotizaciones. */
export const CLAVE_COTIZACIONES = ['cotizaciones'] as const;

function claveLista(query: CotizacionesQuery): readonly unknown[] {
  return [...CLAVE_COTIZACIONES, 'lista', query];
}

// ── Funciones del API ──────────────────────────────────────────────────────────

async function listar(query: CotizacionesQuery): Promise<CotizacionResumen[]> {
  const { data, error } = await api.GET('/api/cotizaciones', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

async function emitir(cuerpo: CotizacionEmitir): Promise<CotizacionDetalle> {
  const { data, error } = await api.POST('/api/cotizaciones', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function cancelar(id: number, cuerpo: CotizacionCancelar): Promise<CotizacionDetalle> {
  const { data, error } = await api.POST('/api/cotizaciones/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Cotizaciones emitidas (filtrables). Deshabilitada mientras no haya filtro de lista, si se pide. */
export function useCotizaciones(
  query: CotizacionesQuery,
  habilitada = true,
): UseQueryResult<CotizacionResumen[], ErrorDeApi> {
  return useQuery({
    queryKey: claveLista(query),
    queryFn: () => listar(query),
    enabled: habilitada,
  });
}

/** Invalida cotizaciones + listas (el detalle de la lista muestra sus cotizaciones emitidas). */
function useInvalidar(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CLAVE_COTIZACIONES });
    void queryClient.invalidateQueries({ queryKey: CLAVE_LISTAS });
  };
}

/** Emite la cotización de una lista (con TODOS sus modelos, congelados). */
export function useEmitirCotizacion(): UseMutationResult<
  CotizacionDetalle,
  ErrorDeApi,
  CotizacionEmitir
> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: emitir, onSuccess: invalidar });
}

/** Argumentos de la cancelación. */
export interface ArgsCancelarCotizacion {
  id: number;
  cuerpo: CotizacionCancelar;
}

/** Cancela una cotización con motivo (el documento se conserva íntegro). */
export function useCancelarCotizacion(): UseMutationResult<
  CotizacionDetalle,
  ErrorDeApi,
  ArgsCancelarCotizacion
> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarCotizacion) => cancelar(id, cuerpo),
    onSuccess: invalidar,
  });
}

// ── Impreso (binario; la sesión viaja por cookie, así window.open basta) ────────

/** Abre el PDF de la cotización en una pestaña nueva (exige `consultas.ver-importes`). */
export function imprimirCotizacionPdf(id: number): void {
  window.open(`/api/cotizaciones/${String(id)}/pdf`, '_blank', 'noopener');
}
