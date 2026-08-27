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
/** Respuesta del diagnóstico de candidatura: los que SÍ entran, y los que no con su motivo. */
export type DiagnosticoCandidatos =
  paths['/api/listas-precios/candidatos']['get']['responses']['200']['content']['application/json'];
/** Un desarrollo candidato. */
export type CandidatoLista = DiagnosticoCandidatos['datos'][number];
/** Un desarrollo DESCARTADO, con el motivo exacto que lo dejó fuera (V1-E8f). */
export type DescartadoLista = DiagnosticoCandidatos['descartados'][number];
/** Motivo por el que un desarrollo no puede entrar a una lista. */
export type MotivoNoCandidato = DescartadoLista['motivo'];
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
/** Desglose de costo por concepto de un renglón. */
export type DesgloseCostoLinea =
  paths['/api/listas-precios/lineas/{idLinea}/desglose-costo']['get']['responses']['200']['content']['application/json'];

/** Clave raíz de la cache de listas. */
export const CLAVE_LISTAS = ['listas-precios'] as const;

function claveLista(query: ListasQuery): readonly unknown[] {
  return [...CLAVE_LISTAS, 'lista', query];
}
function claveDetalle(id: number): readonly unknown[] {
  return [...CLAVE_LISTAS, 'detalle', id];
}
function claveCandidatos(
  idCliente: number,
  idClienteDepartamento: number,
  idProyecto: number,
): readonly unknown[] {
  return [...CLAVE_LISTAS, 'candidatos', idCliente, idClienteDepartamento, idProyecto];
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
  idProyecto: number | undefined,
): Promise<DiagnosticoCandidatos> {
  const { data, error } = await api.GET('/api/listas-precios/candidatos', {
    params: {
      query: {
        idCliente,
        idClienteDepartamento,
        ...(idProyecto === undefined ? {} : { idProyecto }),
      },
    },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
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

async function obtenerDesglose(idLinea: number): Promise<DesgloseCostoLinea> {
  const { data, error } = await api.GET('/api/listas-precios/lineas/{idLinea}/desglose-costo', {
    params: { path: { idLinea } },
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

/** Desglose de costo por concepto de un renglón (§4.8); deshabilitada hasta que se pida (`idLinea`). */
export function useDesgloseCostoLinea(
  idLinea: number | null,
): UseQueryResult<DesgloseCostoLinea, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_LISTAS, 'desglose', idLinea ?? 0],
    queryFn: () => obtenerDesglose(idLinea as number),
    enabled: idLinea !== null,
  });
}

/**
 * Candidatos de un cliente+departamento; deshabilitada hasta que ambos estén elegidos. Con
 * `idProyecto` (Daniel, ago-2026) el servidor los acota a ESE proyecto — es lo que pide el botón
 * «Generar lista de precios» desde la página del proyecto.
 *
 * ⭐ V1-E8f: devuelve TAMBIÉN los `descartados` con su motivo. Sin ellos, cero candidatos sólo se
 * podía reportar como *"no hay desarrollos disponibles"* — el aviso que dejó a Daniel sin salida.
 */
export function useCandidatosLista(
  idCliente: number | undefined,
  idClienteDepartamento: number | undefined,
  idProyecto?: number,
): UseQueryResult<DiagnosticoCandidatos, ErrorDeApi> {
  return useQuery({
    queryKey: claveCandidatos(idCliente ?? 0, idClienteDepartamento ?? 0, idProyecto ?? 0),
    queryFn: () =>
      obtenerCandidatos(idCliente as number, idClienteDepartamento as number, idProyecto),
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

/**
 * QUITA un renglón de una lista (V1-E4 punto 4). Devuelve la lista ya sin él.
 *
 * No es una comodidad: `lista_precios_linea` tiene `@@unique([idDesarrollo])`, así que un
 * desarrollo metido por error quedaba ATRAPADO —no podía entrar a la lista correcta nunca—.
 */
async function quitarLinea(idLinea: number): Promise<ListaDetalle> {
  const { data, error } = await api.DELETE('/api/listas-precios/lineas/{idLinea}', {
    params: { path: { idLinea } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** BORRA una lista completa (V1-E4 punto 4). 204 sin cuerpo. */
async function eliminarLista(id: number): Promise<void> {
  const { error } = await api.DELETE('/api/listas-precios/{id}', { params: { path: { id } } });
  if (error) throw new ErrorDeApi(error);
}

/** Quita un renglón de la lista e invalida listas + proyectos (el desarrollo vuelve a candidato). */
export function useQuitarLineaLista(): UseMutationResult<ListaDetalle, ErrorDeApi, number> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: quitarLinea, onSuccess: invalidar });
}

/** Borra una lista e invalida listas + proyectos. */
export function useEliminarLista(): UseMutationResult<void, ErrorDeApi, number> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: eliminarLista, onSuccess: invalidar });
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
