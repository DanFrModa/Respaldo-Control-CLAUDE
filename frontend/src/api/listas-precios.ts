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
import { CLAVE_PROYECTOS } from './proyectos';
import type { paths } from './esquema.gen';

/**
 * Capa de datos de las LISTAS DE PRECIOS por Cliente+Departamento (F8-E4). Mismo ESTÁNDAR: cliente
 * TIPADO del OpenAPI, normalización (`data`/`ErrorDeApi`) y hooks de TanStack Query. CERO lógica de
 * negocio (A1): el backend genera precios desde los precostos congelados + factores, aprueba/teclea y
 * oculta importes sin `consultas.ver-importes`.
 *
 * Las mutaciones invalidan (a) la cache de LISTAS (listado + detalle) y (b) la de PROYECTOS: al meter
 * un desarrollo en una lista su estado DERIVADO pasa a "en-lista".
 */

// ── Alias de tipos del contrato ────────────────────────────────────────────────
/** Un resumen de lista (listado). */
export type ListaResumen =
  paths['/api/listas-precios']['get']['responses']['200']['content']['application/json']['datos'][number];
/** Una lista completa con sus renglones. */
export type ListaDetalle =
  paths['/api/listas-precios/{id}']['get']['responses']['200']['content']['application/json'];
/** Un renglón de lista. */
export type ListaLinea = ListaDetalle['lineas'][number];
/** Un desarrollo candidato. */
export type CandidatoLista =
  paths['/api/listas-precios/candidatos']['get']['responses']['200']['content']['application/json']['datos'][number];
/** Filtros del listado. */
export type ListasQuery = NonNullable<paths['/api/listas-precios']['get']['parameters']['query']>;
/** Cuerpo de alta de lista. */
export type ListaCrear =
  paths['/api/listas-precios']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de factores de la lista. */
export type ListaFactoresEditar =
  paths['/api/listas-precios/{id}/factores']['patch']['requestBody']['content']['application/json'];
/** Cuerpo de teclear precio de un renglón. */
export type AjustarPrecio =
  paths['/api/listas-precios/lineas/{idLinea}/precio']['patch']['requestBody']['content']['application/json'];

/** Clave raíz de la cache de listas. */
export const CLAVE_LISTAS = ['listas-precios'] as const;

function claveLista(query: ListasQuery): readonly unknown[] {
  return [...CLAVE_LISTAS, 'lista', query];
}
function claveDetalle(id: number): readonly unknown[] {
  return [...CLAVE_LISTAS, 'detalle', id];
}
function claveCandidatos(idCliente: number, idClienteDepartamento: number): readonly unknown[] {
  return [...CLAVE_LISTAS, 'candidatos', idCliente, idClienteDepartamento];
}

// ── Funciones del API ──────────────────────────────────────────────────────────

async function listar(query: ListasQuery): Promise<ListaResumen[]> {
  const { data, error } = await api.GET('/api/listas-precios', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

async function obtener(id: number): Promise<ListaDetalle> {
  const { data, error } = await api.GET('/api/listas-precios/{id}', { params: { path: { id } } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function obtenerCandidatos(
  idCliente: number,
  idClienteDepartamento: number,
): Promise<CandidatoLista[]> {
  const { data, error } = await api.GET('/api/listas-precios/candidatos', {
    params: { query: { idCliente, idClienteDepartamento } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

async function crear(cuerpo: ListaCrear): Promise<ListaDetalle> {
  const { data, error } = await api.POST('/api/listas-precios', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function editarFactores(id: number, cuerpo: ListaFactoresEditar): Promise<ListaDetalle> {
  const { data, error } = await api.PATCH('/api/listas-precios/{id}/factores', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function aprobar(idLinea: number): Promise<ListaDetalle> {
  const { data, error } = await api.POST('/api/listas-precios/lineas/{idLinea}/aprobar', {
    params: { path: { idLinea } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function ajustar(idLinea: number, cuerpo: AjustarPrecio): Promise<ListaDetalle> {
  const { data, error } = await api.PATCH('/api/listas-precios/lineas/{idLinea}/precio', {
    params: { path: { idLinea } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista las listas de precios con los filtros dados. */
export function useListasPrecios(query: ListasQuery): UseQueryResult<ListaResumen[], ErrorDeApi> {
  return useQuery({
    queryKey: claveLista(query),
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}

/** Obtiene el detalle de una lista (con renglones); deshabilitada si no hay id. */
export function useListaPrecios(id: number | undefined): UseQueryResult<ListaDetalle, ErrorDeApi> {
  return useQuery({
    queryKey: claveDetalle(id ?? 0),
    queryFn: () => obtener(id as number),
    enabled: id !== undefined,
  });
}

/** Candidatos de un cliente+departamento; deshabilitada hasta que ambos estén elegidos. */
export function useCandidatosLista(
  idCliente: number | undefined,
  idClienteDepartamento: number | undefined,
): UseQueryResult<CandidatoLista[], ErrorDeApi> {
  return useQuery({
    queryKey: claveCandidatos(idCliente ?? 0, idClienteDepartamento ?? 0),
    queryFn: () => obtenerCandidatos(idCliente as number, idClienteDepartamento as number),
    enabled: idCliente !== undefined && idClienteDepartamento !== undefined,
  });
}

/** Invalida listas + proyectos (el estado derivado del desarrollo depende de la lista). */
function useInvalidar(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CLAVE_LISTAS });
    void queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS });
  };
}

/** Crea una lista e invalida listas + proyectos. */
export function useCrearLista(): UseMutationResult<ListaDetalle, ErrorDeApi, ListaCrear> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: crear, onSuccess: invalidar });
}

/** Argumentos de la edición de factores. */
export interface ArgsEditarFactores {
  id: number;
  cuerpo: ListaFactoresEditar;
}

/** Edita los factores de una lista (recalcula precios). */
export function useEditarFactoresLista(): UseMutationResult<
  ListaDetalle,
  ErrorDeApi,
  ArgsEditarFactores
> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsEditarFactores) => editarFactores(id, cuerpo),
    onSuccess: invalidar,
  });
}

/** Aprueba el precio calculado de un renglón. */
export function useAprobarLinea(): UseMutationResult<ListaDetalle, ErrorDeApi, number> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: aprobar, onSuccess: invalidar });
}

/** Argumentos del ajuste de precio. */
export interface ArgsAjustarPrecio {
  idLinea: number;
  cuerpo: AjustarPrecio;
}

/** Teclea el precio aprobado de un renglón. */
export function useAjustarPrecioLinea(): UseMutationResult<
  ListaDetalle,
  ErrorDeApi,
  ArgsAjustarPrecio
> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ idLinea, cuerpo }: ArgsAjustarPrecio) => ajustar(idLinea, cuerpo),
    onSuccess: invalidar,
  });
}

// ── Impresos (binarios; la sesión viaja por cookie, así window.open basta) ──────

/** Abre el PDF de la lista en una pestaña nueva (exige `consultas.ver-importes`). */
export function imprimirListaPdf(id: number): void {
  window.open(`/api/listas-precios/${String(id)}/pdf`, '_blank', 'noopener');
}

/** Descarga la lista en Excel (.xlsx) (exige `consultas.ver-importes`). */
export function descargarListaExcel(id: number): void {
  window.open(`/api/listas-precios/${String(id)}/excel`, '_blank', 'noopener');
}
