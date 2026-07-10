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
import { CLAVE_HABILITACION } from './habilitacion';
import type {
  NotaSalida,
  NotaSalidaCancelar,
  NotaSalidaCrear,
  NotaSalidaEditar,
  NotasSalidaPagina,
  NotasSalidaQuery,
  ResumenNotas,
  ResumenNotasQuery,
} from './tipos';

/**
 * Capa de datos del módulo NOTAS DE SALIDA (F4-E5) — réplica del ESTÁNDAR de Órdenes de compra
 * (`api/ordenes-compra.ts`). Cada función llama al cliente TIPADO del OpenAPI, normaliza (`data` en
 * éxito, `ErrorDeApi` con el mensaje del backend en fallo) y se expone como consulta o mutación (las
 * mutaciones invalidan la cache de notas y el detalle). CERO lógica de negocio: el backend valida,
 * autoriza y decide (A1) — incluido el descuento de avíos al confirmar, el reverso al cancelar y el
 * folio atómico.
 */

/** Clave raíz de la cache de notas de salida en TanStack Query. */
export const CLAVE_NOTAS = ['notas-salida'] as const;

/** Clave de cache de una página concreta del listado (depende de los filtros). */
function claveLista(query: NotasSalidaQuery): readonly unknown[] {
  return [...CLAVE_NOTAS, 'lista', query];
}

/** Clave de cache de UNA nota (su detalle). */
function claveNota(id: number): readonly unknown[] {
  return [...CLAVE_NOTAS, 'detalle', id];
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/** Pide una página del listado de notas (búsqueda + filtros + orden + paginación en servidor). */
async function listarNotas(query: NotasSalidaQuery): Promise<NotasSalidaPagina> {
  const { data, error } = await api.GET('/api/notas-salida', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Resumen de cabecera: conteos por estatus + órdenes surtidas del universo filtrado (KPIs). */
async function resumenNotas(query: ResumenNotasQuery): Promise<ResumenNotas> {
  const { data, error } = await api.GET('/api/notas-salida/resumen', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Obtiene una nota por id (encabezado + renglones + trazas a kardex). */
async function obtenerNota(id: number): Promise<NotaSalida> {
  const { data, error } = await api.GET('/api/notas-salida/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Escrituras ──────────────────────────────────────────────────────────────────

/** Crea una nota en borrador (`POST /api/notas-salida`). */
async function crearNota(cuerpo: NotaSalidaCrear): Promise<NotaSalida> {
  const { data, error } = await api.POST('/api/notas-salida', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza una nota en borrador (`PATCH /api/notas-salida/{id}`; las líneas reemplazan al set). */
async function actualizarNota(id: number, cuerpo: NotaSalidaEditar): Promise<NotaSalida> {
  const { data, error } = await api.PATCH('/api/notas-salida/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Confirma una nota (descuenta los avíos del kardex, `POST /api/notas-salida/{id}/confirmar`). */
async function confirmarNota(id: number): Promise<NotaSalida> {
  const { data, error } = await api.POST('/api/notas-salida/{id}/confirmar', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Cancela una nota (cancelación suave, exige motivo, `POST /api/notas-salida/{id}/cancelar`). */
async function cancelarNota(id: number, cuerpo: NotaSalidaCancelar): Promise<NotaSalida> {
  const { data, error } = await api.POST('/api/notas-salida/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks de lectura ────────────────────────────────────────────────────────────

/** Lista notas con los filtros dados (mantiene la página previa al paginar/filtrar). */
export function useNotasSalida(
  query: NotasSalidaQuery,
): UseQueryResult<NotasSalidaPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveLista(query),
    queryFn: () => listarNotas(query),
    placeholderData: keepPreviousData,
  });
}

/** Resumen de cabecera de notas (KPIs: conteos por estatus + órdenes surtidas) bajo el filtro dado. */
export function useResumenNotas(
  query: ResumenNotasQuery,
): UseQueryResult<ResumenNotas, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_NOTAS, 'resumen', query],
    queryFn: () => resumenNotas(query),
    placeholderData: keepPreviousData,
  });
}

/** Obtiene el detalle de una nota (deshabilitada si no hay id). */
export function useNotaSalida(id: number | undefined): UseQueryResult<NotaSalida, ErrorDeApi> {
  return useQuery({
    queryKey: claveNota(id ?? 0),
    queryFn: () => obtenerNota(id as number),
    enabled: id !== undefined,
  });
}

// ── Hooks de escritura ────────────────────────────────────────────────────────────

/** Invalida la lista de notas y, si se da, el detalle de UNA nota. */
function invalidar(queryClient: ReturnType<typeof useQueryClient>, id?: number): void {
  void queryClient.invalidateQueries({ queryKey: CLAVE_NOTAS });
  // Confirmar/cancelar una nota cambia el "enviado" de la habilitación de sus órdenes (B13, R6).
  void queryClient.invalidateQueries({ queryKey: CLAVE_HABILITACION });
  if (id !== undefined) {
    void queryClient.invalidateQueries({ queryKey: claveNota(id) });
  }
}

/** Crea una nota e invalida la lista. */
export function useCrearNota(): UseMutationResult<NotaSalida, ErrorDeApi, NotaSalidaCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearNota,
    onSuccess: () => invalidar(queryClient),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarNota {
  id: number;
  cuerpo: NotaSalidaEditar;
}

/** Edita una nota e invalida la lista y su detalle. */
export function useActualizarNota(): UseMutationResult<NotaSalida, ErrorDeApi, ArgsActualizarNota> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarNota) => actualizarNota(id, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.id),
  });
}

/** Confirma una nota (descuenta avíos) e invalida la lista y su detalle. */
export function useConfirmarNota(): UseMutationResult<NotaSalida, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: confirmarNota,
    onSuccess: (_resultado, id) => invalidar(queryClient, id),
  });
}

/** Argumentos de la mutación de cancelar. */
export interface ArgsCancelarNota {
  id: number;
  cuerpo: NotaSalidaCancelar;
}

/** Cancela una nota (suave, reverso de avíos) e invalida la lista y su detalle. */
export function useCancelarNota(): UseMutationResult<NotaSalida, ErrorDeApi, ArgsCancelarNota> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarNota) => cancelarNota(id, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.id),
  });
}

// ── Impreso (PDF binario; servidor, fuera del cliente tipado) ──────────────────────────

/**
 * Abre el PDF de UNA nota de salida en una pestaña nueva (`GET /api/notas-salida/{id}/impreso`). El
 * impreso es SERVER-SIDE (igual que el resto de impresos del proyecto, p. ej. la orden de compra): la
 * auth viaja por la cookie de sesión (mismo origen), así que basta `window.open`.
 */
export function imprimirNota(id: number): void {
  window.open(`/api/notas-salida/${String(id)}/impreso`, '_blank', 'noopener');
}
