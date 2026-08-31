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
import { CLAVE_DESARROLLO } from './desarrollos';
import { CLAVE_MODELOS } from './modelos';
import { CLAVE_PRECOSTOS } from './precostos';
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
/** Cuerpo del TARGET PRICE del cliente en un renglón (§Post-F9.150); `null` lo borra. */
export type PrecioTargetLinea =
  paths['/api/listas-precios/lineas/{idLinea}/precio-target']['patch']['requestBody']['content']['application/json'];
/** ⭐ V1-E8y: cuerpo de AGREGAR modelos a una lista ya creada. */
export type AgregarLineasLista =
  paths['/api/listas-precios/{id}/lineas']['post']['requestBody']['content']['application/json'];
/** ⭐ V1-E8y: cuerpo del encabezado de la cita (lugar + notas). */
export type ListaEncabezadoEditar =
  paths['/api/listas-precios/{id}/encabezado']['patch']['requestBody']['content']['application/json'];
/** ⭐ V1-E8y: cuerpo del alta de un modelo NUEVO desde la mesa (desde cero o copiando). */
export type ModeloNuevoEnLista =
  paths['/api/listas-precios/{id}/modelo-nuevo']['post']['requestBody']['content']['application/json'];
/** ⭐ V1-E8y: lo que devuelve esa alta (el desarrollo y su precosto borrador, listo para estimar). */
export type ModeloNuevoCreado =
  paths['/api/listas-precios/{id}/modelo-nuevo']['post']['responses']['201']['content']['application/json'];
/** ⭐ V1-E8y: un PENDIENTE del modelo (viaja embebido en su renglón). */
export type PendienteLinea = ListaLinea['pendientes'][number];
/** ⭐ V1-E8y: cuerpo del alta de un pendiente. */
export type PendienteCrear =
  paths['/api/listas-precios/lineas/{idLinea}/pendientes']['post']['requestBody']['content']['application/json'];
/** ⭐ V1-E8y: cuerpo de corregir/tachar un pendiente. */
export type PendienteEditar =
  paths['/api/listas-precios/lineas/{idLinea}/pendientes/{idPendiente}']['patch']['requestBody']['content']['application/json'];
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

async function fijarTarget(idLinea: number, cuerpo: PrecioTargetLinea): Promise<ListaDetalle> {
  const { data, error } = await api.PATCH('/api/listas-precios/lineas/{idLinea}/precio-target', {
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

/** Argumentos del target del cliente. */
export interface ArgsPrecioTarget {
  idLinea: number;
  cuerpo: PrecioTargetLinea;
}

/**
 * ⭐ Fija (o borra) el TARGET PRICE que dio el cliente (§Post-F9.150). Lo captura **Aurora al armar
 * la lista** (`listas.administrar`); en la mesa sólo se LEE. Informa, no bloquea.
 */
export function useFijarPrecioTarget(): UseMutationResult<
  ListaDetalle,
  ErrorDeApi,
  ArgsPrecioTarget
> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ idLinea, cuerpo }: ArgsPrecioTarget) => fijarTarget(idLinea, cuerpo),
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

// ── ⭐⭐ V1-E8y (§Post-F9.152) — LA MESA ABIERTA ───────────────────────────────

/** Agrega modelos ya cotizados a una lista existente (`POST /api/listas-precios/{id}/lineas`). */
async function agregarLineas(id: number, cuerpo: AgregarLineasLista): Promise<ListaDetalle> {
  const { data, error } = await api.POST('/api/listas-precios/{id}/lineas', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Edita el lugar de la cita y las notas (`PATCH /api/listas-precios/{id}/encabezado`). */
async function editarEncabezado(id: number, cuerpo: ListaEncabezadoEditar): Promise<ListaDetalle> {
  const { data, error } = await api.PATCH('/api/listas-precios/{id}/encabezado', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Da de alta un modelo NUEVO desde la mesa (`POST /api/listas-precios/{id}/modelo-nuevo`). */
async function crearModeloEnLista(
  id: number,
  cuerpo: ModeloNuevoEnLista,
): Promise<ModeloNuevoCreado> {
  const { data, error } = await api.POST('/api/listas-precios/{id}/modelo-nuevo', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function crearPendiente(idLinea: number, cuerpo: PendienteCrear): Promise<PendienteLinea> {
  const { data, error } = await api.POST('/api/listas-precios/lineas/{idLinea}/pendientes', {
    params: { path: { idLinea } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function editarPendiente(
  idLinea: number,
  idPendiente: number,
  cuerpo: PendienteEditar,
): Promise<PendienteLinea> {
  const { data, error } = await api.PATCH(
    '/api/listas-precios/lineas/{idLinea}/pendientes/{idPendiente}',
    { params: { path: { idLinea, idPendiente } }, body: cuerpo },
  );
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function eliminarPendiente(idLinea: number, idPendiente: number): Promise<void> {
  const { error } = await api.DELETE(
    '/api/listas-precios/lineas/{idLinea}/pendientes/{idPendiente}',
    { params: { path: { idLinea, idPendiente } } },
  );
  if (error) throw new ErrorDeApi(error);
}

/** Argumentos de agregar renglones. */
export interface ArgsAgregarLineas {
  id: number;
  cuerpo: AgregarLineasLista;
}

/**
 * ⭐⭐ Agrega modelos a una lista YA CREADA. Hasta V1-E8y no se podía: una lista nacía con sus
 * modelos y agregar uno obligaba a borrarla y rehacerla, perdiendo aprobaciones e historial.
 */
export function useAgregarLineasLista(): UseMutationResult<
  ListaDetalle,
  ErrorDeApi,
  ArgsAgregarLineas
> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsAgregarLineas) => agregarLineas(id, cuerpo),
    onSuccess: invalidar,
  });
}

/** Argumentos del encabezado de la cita. */
export interface ArgsEncabezadoLista {
  id: number;
  cuerpo: ListaEncabezadoEditar;
}

/** Guarda el LUGAR de la cita y corrige las notas. */
export function useEditarEncabezadoLista(): UseMutationResult<
  ListaDetalle,
  ErrorDeApi,
  ArgsEncabezadoLista
> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsEncabezadoLista) => editarEncabezado(id, cuerpo),
    onSuccess: invalidar,
  });
}

/** Argumentos del alta de un modelo nuevo desde la mesa. */
export interface ArgsModeloNuevoEnLista {
  id: number;
  cuerpo: ModeloNuevoEnLista;
}

/**
 * ⭐⭐ Da de alta EN LA CITA un modelo que no existe (§Post-F9.152), desde cero o copiando otro.
 *
 * Devuelve el desarrollo con su **precosto borrador** ya generado: NO agrega el renglón a la lista
 * —eso pide un precosto congelado— así que la pantalla lleva al usuario a estimarle los costos y
 * después a «agregar a la lista». Invalida además modelos, desarrollos y precostos: acaban de nacer
 * un modelo, un desarrollo y (a veces) un proyecto.
 */
export function useCrearModeloEnLista(): UseMutationResult<
  ModeloNuevoCreado,
  ErrorDeApi,
  ArgsModeloNuevoEnLista
> {
  const queryClient = useQueryClient();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsModeloNuevoEnLista) => crearModeloEnLista(id, cuerpo),
    onSuccess: () => {
      invalidar();
      void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_DESARROLLO });
      void queryClient.invalidateQueries({ queryKey: CLAVE_PRECOSTOS });
    },
  });
}

/** Argumentos del alta de un pendiente. */
export interface ArgsCrearPendiente {
  idLinea: number;
  cuerpo: PendienteCrear;
}

/** Anota un pendiente sobre un modelo de la lista (los pendientes viajan en el detalle). */
export function useCrearPendiente(): UseMutationResult<
  PendienteLinea,
  ErrorDeApi,
  ArgsCrearPendiente
> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ idLinea, cuerpo }: ArgsCrearPendiente) => crearPendiente(idLinea, cuerpo),
    onSuccess: invalidar,
  });
}

/** Argumentos de corregir/tachar un pendiente. */
export interface ArgsEditarPendiente {
  idLinea: number;
  idPendiente: number;
  cuerpo: PendienteEditar;
}

/** Corrige el texto o TACHA un pendiente. */
export function useEditarPendiente(): UseMutationResult<
  PendienteLinea,
  ErrorDeApi,
  ArgsEditarPendiente
> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ idLinea, idPendiente, cuerpo }: ArgsEditarPendiente) =>
      editarPendiente(idLinea, idPendiente, cuerpo),
    onSuccess: invalidar,
  });
}

/** Argumentos del borrado de un pendiente. */
export interface ArgsEliminarPendiente {
  idLinea: number;
  idPendiente: number;
}

/** Borra un pendiente (queda íntegro en la bitácora). */
export function useEliminarPendiente(): UseMutationResult<void, ErrorDeApi, ArgsEliminarPendiente> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ idLinea, idPendiente }: ArgsEliminarPendiente) =>
      eliminarPendiente(idLinea, idPendiente),
    onSuccess: invalidar,
  });
}
