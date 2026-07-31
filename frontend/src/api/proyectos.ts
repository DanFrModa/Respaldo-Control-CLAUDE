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
import type { paths } from './esquema.gen';

/**
 * Capa de datos de PROYECTOS de desarrollo (F8-E2) — mismo ESTÁNDAR que Pedidos (`api/pedidos.ts`):
 * cada función llama al cliente TIPADO del OpenAPI, normaliza (`data` en éxito, `ErrorDeApi` con el
 * mensaje del backend en fallo) y se expone como consulta o mutación (las mutaciones invalidan la
 * cache). CERO lógica de negocio (A1): el backend valida, autoriza y calcula el estado derivado.
 */

// ── Alias de tipos del contrato ────────────────────────────────────────────────
/** Página de proyectos (`GET /api/proyectos`). */
export type ProyectosPagina =
  paths['/api/proyectos']['get']['responses']['200']['content']['application/json'];
/** Un proyecto en la lista (con conteos, sin el arreglo de desarrollos). */
export type Proyecto = ProyectosPagina['datos'][number];
/** Detalle de un proyecto (con sus desarrollos), `GET /api/proyectos/{id}`. */
export type ProyectoDetalle =
  paths['/api/proyectos/{id}']['get']['responses']['200']['content']['application/json'];
/** Parámetros de consulta del listado (querystring). */
export type ProyectosQuery = NonNullable<paths['/api/proyectos']['get']['parameters']['query']>;
/** Cuerpo de alta de proyecto (`POST /api/proyectos`). */
export type ProyectoCrear =
  paths['/api/proyectos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de proyecto (`PATCH /api/proyectos/{id}`). */
export type ProyectoEditar =
  paths['/api/proyectos/{id}']['patch']['requestBody']['content']['application/json'];

/** Clave raíz de la cache de proyectos en TanStack Query. */
export const CLAVE_PROYECTOS = ['proyectos'] as const;

function claveLista(query: ProyectosQuery): readonly unknown[] {
  return [...CLAVE_PROYECTOS, 'lista', query];
}
function claveDetalle(id: number): readonly unknown[] {
  return [...CLAVE_PROYECTOS, 'detalle', id];
}

// ── Funciones del API ──────────────────────────────────────────────────────────

async function listar(query: ProyectosQuery): Promise<ProyectosPagina> {
  const { data, error } = await api.GET('/api/proyectos', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function obtener(id: number): Promise<ProyectoDetalle> {
  const { data, error } = await api.GET('/api/proyectos/{id}', { params: { path: { id } } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function crear(cuerpo: ProyectoCrear): Promise<ProyectoDetalle> {
  const { data, error } = await api.POST('/api/proyectos', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function actualizar(id: number, cuerpo: ProyectoEditar): Promise<ProyectoDetalle> {
  const { data, error } = await api.PATCH('/api/proyectos/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function archivar(id: number): Promise<ProyectoDetalle> {
  const { data, error } = await api.POST('/api/proyectos/{id}/archivar', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function desarchivar(id: number): Promise<ProyectoDetalle> {
  const { data, error } = await api.POST('/api/proyectos/{id}/desarchivar', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista proyectos con los filtros dados (mantiene la página previa al paginar/buscar). */
export function useProyectos(query: ProyectosQuery): UseQueryResult<ProyectosPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveLista(query),
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}

/** Obtiene el detalle de un proyecto (con sus desarrollos); deshabilitada si no hay id. */
export function useProyecto(id: number | undefined): UseQueryResult<ProyectoDetalle, ErrorDeApi> {
  return useQuery({
    queryKey: claveDetalle(id ?? 0),
    queryFn: () => obtener(id as number),
    enabled: id !== undefined,
  });
}

/** Crea un proyecto e invalida la lista. */
export function useCrearProyecto(): UseMutationResult<ProyectoDetalle, ErrorDeApi, ProyectoCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crear,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS }),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarProyecto {
  id: number;
  cuerpo: ProyectoEditar;
}

/** Edita un proyecto e invalida la lista y su detalle. */
export function useActualizarProyecto(): UseMutationResult<
  ProyectoDetalle,
  ErrorDeApi,
  ArgsActualizarProyecto
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarProyecto) => actualizar(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS }),
  });
}

/** Archiva un proyecto (borrado suave) e invalida la lista. */
export function useArchivarProyecto(): UseMutationResult<ProyectoDetalle, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS }),
  });
}

/** Desarchiva un proyecto e invalida la lista. */
export function useDesarchivarProyecto(): UseMutationResult<ProyectoDetalle, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desarchivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS }),
  });
}
