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
  EdrCalculado,
  EdrEncabezadoCuerpo,
  EdrGenerar,
  EdrLinea,
  EdrLineaAjustar,
  EdrLineaManual,
  EdrLineas,
  EdrLineasQuery,
  EdrPorAnio,
  EdrPorMes,
} from './tipos';

/**
 * Capa de datos del EDR (Módulo 6, F7-E2). Cliente TIPADO del OpenAPI, normaliza (`data`/`ErrorDeApi`)
 * y expone hooks de TanStack Query. CERO lógica de negocio (A1): el backend genera, reconcilia, valúa a
 * costo actual y arma los cortes. El EDR es CONSOLIDADO (no depende de la empresa activa).
 */

/** Clave raíz de la caché del EDR. */
export const CLAVE_EDR = ['edr'] as const;

// ── Consultas ─────────────────────────────────────────────────────────────────

async function obtenerPorMes(anio: number, mes: number): Promise<EdrPorMes> {
  const { data, error } = await api.GET('/api/edr/por-mes', { params: { query: { anio, mes } } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** EDR de un mes (o existe:false si aún no se genera). */
export function useEdrPorMes(
  anio: number | null,
  mes: number | null,
): UseQueryResult<EdrPorMes, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_EDR, 'por-mes', anio, mes],
    queryFn: () => obtenerPorMes(anio as number, mes as number),
    enabled: anio !== null && mes !== null,
    placeholderData: keepPreviousData,
  });
}

async function obtenerPorAnio(anio: number): Promise<EdrPorAnio> {
  const { data, error } = await api.GET('/api/edr/por-anio', { params: { query: { anio } } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Comparativo mensual del EDR de un año (con corte por empresa). */
export function useEdrPorAnio(anio: number | null): UseQueryResult<EdrPorAnio, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_EDR, 'por-anio', anio],
    queryFn: () => obtenerPorAnio(anio as number),
    enabled: anio !== null,
    placeholderData: keepPreviousData,
  });
}

async function obtenerLineas(idEdr: number, query: EdrLineasQuery): Promise<EdrLineas> {
  const { data, error } = await api.GET('/api/edr/{id}/lineas', {
    params: { path: { id: idEdr }, query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Conciliación de líneas del EDR (a costo actual, filtrable). */
export function useEdrLineas(
  idEdr: number | null,
  query: EdrLineasQuery,
): UseQueryResult<EdrLineas, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_EDR, 'lineas', idEdr, query],
    queryFn: () => obtenerLineas(idEdr as number, query),
    enabled: idEdr !== null,
    placeholderData: keepPreviousData,
  });
}

// ── Mutaciones ──────────────────────────────────────────────────────────────────

async function generarEdr(cuerpo: EdrGenerar): Promise<EdrCalculado> {
  const { data, error } = await api.POST('/api/edr/generar', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Genera/reconcilia el EDR de un mes; invalida toda la caché del EDR. */
export function useGenerarEdr(): UseMutationResult<EdrCalculado, ErrorDeApi, EdrGenerar> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cuerpo: EdrGenerar) => generarEdr(cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_EDR }),
  });
}

/** Argumentos para actualizar el encabezado del mes. */
export interface ArgsEncabezado {
  idEdr: number;
  cuerpo: EdrEncabezadoCuerpo;
}

async function actualizarEncabezado(
  idEdr: number,
  cuerpo: EdrEncabezadoCuerpo,
): Promise<EdrCalculado> {
  const { data, error } = await api.PUT('/api/edr/{id}', {
    params: { path: { id: idEdr } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Actualiza el encabezado global del mes; invalida la caché del EDR. */
export function useActualizarEncabezado(): UseMutationResult<
  EdrCalculado,
  ErrorDeApi,
  ArgsEncabezado
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idEdr, cuerpo }: ArgsEncabezado) => actualizarEncabezado(idEdr, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_EDR }),
  });
}

/** Argumentos para ajustar una línea. */
export interface ArgsAjustar {
  idLinea: number;
  cuerpo: EdrLineaAjustar;
}

async function ajustarLinea(idLinea: number, cuerpo: EdrLineaAjustar): Promise<EdrLinea> {
  const { data, error } = await api.PUT('/api/edr/lineas/{idLinea}', {
    params: { path: { idLinea } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Ajusta la cantidad/precio de una línea; invalida la caché del EDR. */
export function useAjustarLinea(): UseMutationResult<EdrLinea, ErrorDeApi, ArgsAjustar> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idLinea, cuerpo }: ArgsAjustar) => ajustarLinea(idLinea, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_EDR }),
  });
}

/** Argumentos para agregar una línea manual. */
export interface ArgsLineaManual {
  idEdr: number;
  cuerpo: EdrLineaManual;
}

async function agregarLineaManual(idEdr: number, cuerpo: EdrLineaManual): Promise<EdrLinea> {
  const { data, error } = await api.POST('/api/edr/{id}/lineas', {
    params: { path: { id: idEdr } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Agrega una línea manual; invalida la caché del EDR. */
export function useAgregarLineaManual(): UseMutationResult<EdrLinea, ErrorDeApi, ArgsLineaManual> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idEdr, cuerpo }: ArgsLineaManual) => agregarLineaManual(idEdr, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_EDR }),
  });
}

async function eliminarLinea(idLinea: number): Promise<void> {
  const { error } = await api.DELETE('/api/edr/lineas/{idLinea}', {
    params: { path: { idLinea } },
  });
  if (error) throw new ErrorDeApi(error);
}

/** Elimina una línea manual; invalida la caché del EDR. */
export function useEliminarLinea(): UseMutationResult<void, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idLinea: number) => eliminarLinea(idLinea),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_EDR }),
  });
}

// ── Impresos (PDF/Excel binario; auth por cookie de sesión, mismo origen) ──────

/** Abre el EDR mensual en PDF (R9) en una pestaña nueva. */
export function imprimirEdrMensual(idEdr: number): void {
  window.open(`/api/edr/${idEdr}/impreso`, '_blank', 'noopener');
}

/** Descarga el EDR mensual en Excel (.xlsx). */
export function descargarExcelEdr(idEdr: number): void {
  window.open(`/api/edr/${idEdr}/excel`, '_blank', 'noopener');
}

/** Abre el EDR anual en PDF (R9) en una pestaña nueva. */
export function imprimirEdrAnual(anio: number): void {
  window.open(`/api/edr/por-anio/impreso?anio=${anio}`, '_blank', 'noopener');
}
