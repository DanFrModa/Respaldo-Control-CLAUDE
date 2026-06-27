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
  Auditoria,
  AuditoriaContexto,
  AuditoriaCrear,
  AuditoriaReclasificacion,
  AuditoriaResultado,
  Defecto,
  DefectoCrear,
  DefectoEditar,
  DefectosPagina,
  DefectosQuery,
  PlanAql,
  PlanAqlCrear,
  PlanAqlEditar,
  PlanesAqlPagina,
  PlanesAqlQuery,
  ResolverPlan,
  ResolverPlanQuery,
  TipoProducto,
  TipoProductoCrear,
  TipoProductoEditar,
  TiposProductoPagina,
  TiposProductoQuery,
} from './tipos';

/**
 * Capa de datos de Calidad (defectos, tipos de producto y planes AQL). Replica el
 * patron estandar de la capa de datos (almacenes.ts): llama al cliente tipado del
 * OpenAPI, normaliza a ErrorDeApi en fallo y expone hooks de TanStack Query que
 * invalidan la cache de la lista al mutar. CERO logica de negocio (A1).
 */

// ── Claves de cache ──────────────────────────────────────────────────────────

export const CLAVE_DEFECTOS = ['calidad', 'defectos'] as const;
export const CLAVE_TIPOS_PRODUCTO = ['calidad', 'tipos-producto'] as const;
export const CLAVE_PLANES_AQL = ['calidad', 'planes-aql'] as const;
export const CLAVE_AUDITORIAS = ['calidad', 'auditorias'] as const;

// ── Defectos ─────────────────────────────────────────────────────────────────

async function listarDefectos(query: DefectosQuery): Promise<DefectosPagina> {
  const { data, error } = await api.GET('/api/calidad/defectos', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crearDefecto(cuerpo: DefectoCrear): Promise<Defecto> {
  const { data, error } = await api.POST('/api/calidad/defectos', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function actualizarDefecto(id: number, cuerpo: DefectoEditar): Promise<Defecto> {
  const { data, error } = await api.PATCH('/api/calidad/defectos/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function desactivarDefecto(id: number): Promise<Defecto> {
  const { data, error } = await api.DELETE('/api/calidad/defectos/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function reactivarDefecto(id: number): Promise<Defecto> {
  const { data, error } = await api.PATCH('/api/calidad/defectos/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

export function useDefectos(query: DefectosQuery): UseQueryResult<DefectosPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_DEFECTOS, 'lista', query],
    queryFn: () => listarDefectos(query),
    placeholderData: keepPreviousData,
  });
}

export function useCrearDefecto(): UseMutationResult<Defecto, ErrorDeApi, DefectoCrear> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: crearDefecto,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_DEFECTOS }),
  });
}

export interface ArgsActualizarDefecto {
  id: number;
  cuerpo: DefectoEditar;
}

export function useActualizarDefecto(): UseMutationResult<
  Defecto,
  ErrorDeApi,
  ArgsActualizarDefecto
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarDefecto) => actualizarDefecto(id, cuerpo),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_DEFECTOS }),
  });
}

export function useDesactivarDefecto(): UseMutationResult<Defecto, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: desactivarDefecto,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_DEFECTOS }),
  });
}

export function useReactivarDefecto(): UseMutationResult<Defecto, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: reactivarDefecto,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_DEFECTOS }),
  });
}

// ── Tipos de producto ─────────────────────────────────────────────────────────

async function listarTiposProducto(query: TiposProductoQuery): Promise<TiposProductoPagina> {
  const { data, error } = await api.GET('/api/calidad/tipos-producto', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crearTipoProducto(cuerpo: TipoProductoCrear): Promise<TipoProducto> {
  const { data, error } = await api.POST('/api/calidad/tipos-producto', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function actualizarTipoProducto(
  id: number,
  cuerpo: TipoProductoEditar,
): Promise<TipoProducto> {
  const { data, error } = await api.PATCH('/api/calidad/tipos-producto/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function desactivarTipoProducto(id: number): Promise<TipoProducto> {
  const { data, error } = await api.DELETE('/api/calidad/tipos-producto/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function reactivarTipoProducto(id: number): Promise<TipoProducto> {
  const { data, error } = await api.PATCH('/api/calidad/tipos-producto/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

export function useTiposProducto(
  query: TiposProductoQuery,
): UseQueryResult<TiposProductoPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_TIPOS_PRODUCTO, 'lista', query],
    queryFn: () => listarTiposProducto(query),
    placeholderData: keepPreviousData,
  });
}

/** Lista los tipos de producto ACTIVOS para selectores de catalogo (porPagina: 100). */
export function useTiposProductoActivos(): UseQueryResult<TiposProductoPagina, ErrorDeApi> {
  return useTiposProducto({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
  });
}

export function useCrearTipoProducto(): UseMutationResult<
  TipoProducto,
  ErrorDeApi,
  TipoProductoCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: crearTipoProducto,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_TIPOS_PRODUCTO }),
  });
}

export interface ArgsActualizarTipoProducto {
  id: number;
  cuerpo: TipoProductoEditar;
}

export function useActualizarTipoProducto(): UseMutationResult<
  TipoProducto,
  ErrorDeApi,
  ArgsActualizarTipoProducto
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarTipoProducto) => actualizarTipoProducto(id, cuerpo),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_TIPOS_PRODUCTO }),
  });
}

export function useDesactivarTipoProducto(): UseMutationResult<TipoProducto, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: desactivarTipoProducto,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_TIPOS_PRODUCTO }),
  });
}

export function useReactivarTipoProducto(): UseMutationResult<TipoProducto, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: reactivarTipoProducto,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_TIPOS_PRODUCTO }),
  });
}

// ── Planes AQL ───────────────────────────────────────────────────────────────

async function listarPlanesAql(query: PlanesAqlQuery): Promise<PlanesAqlPagina> {
  const { data, error } = await api.GET('/api/calidad/planes-aql', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerPlanAql(id: number): Promise<PlanAql> {
  const { data, error } = await api.GET('/api/calidad/planes-aql/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crearPlanAql(cuerpo: PlanAqlCrear): Promise<PlanAql> {
  const { data, error } = await api.POST('/api/calidad/planes-aql', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function actualizarPlanAql(id: number, cuerpo: PlanAqlEditar): Promise<PlanAql> {
  const { data, error } = await api.PATCH('/api/calidad/planes-aql/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function desactivarPlanAql(id: number): Promise<PlanAql> {
  const { data, error } = await api.DELETE('/api/calidad/planes-aql/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function reactivarPlanAql(id: number): Promise<PlanAql> {
  const { data, error } = await api.PATCH('/api/calidad/planes-aql/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function resolverPlan(query: ResolverPlanQuery): Promise<ResolverPlan> {
  const { data, error } = await api.GET('/api/calidad/planes-aql/resolver', {
    params: { query },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

export function usePlanesAql(query: PlanesAqlQuery): UseQueryResult<PlanesAqlPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_PLANES_AQL, 'lista', query],
    queryFn: () => listarPlanesAql(query),
    placeholderData: keepPreviousData,
  });
}

export function usePlanAql(id: number): UseQueryResult<PlanAql, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_PLANES_AQL, 'detalle', id],
    queryFn: () => obtenerPlanAql(id),
  });
}

export function useCrearPlanAql(): UseMutationResult<PlanAql, ErrorDeApi, PlanAqlCrear> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: crearPlanAql,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_PLANES_AQL }),
  });
}

export interface ArgsActualizarPlanAql {
  id: number;
  cuerpo: PlanAqlEditar;
}

export function useActualizarPlanAql(): UseMutationResult<
  PlanAql,
  ErrorDeApi,
  ArgsActualizarPlanAql
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarPlanAql) => actualizarPlanAql(id, cuerpo),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_PLANES_AQL }),
  });
}

export function useDesactivarPlanAql(): UseMutationResult<PlanAql, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: desactivarPlanAql,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_PLANES_AQL }),
  });
}

export function useReactivarPlanAql(): UseMutationResult<PlanAql, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: reactivarPlanAql,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_PLANES_AQL }),
  });
}

// ── Auditorías (F6-E2) ─────────────────────────────────────────────────────────

async function obtenerContextoOrden(idOrden: number): Promise<AuditoriaContexto> {
  const { data, error } = await api.GET('/api/calidad/auditorias/orden/{idOrden}/contexto', {
    params: { path: { idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerAuditoria(id: number): Promise<Auditoria> {
  const { data, error } = await api.GET('/api/calidad/auditorias/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crearAuditoria(cuerpo: AuditoriaCrear): Promise<Auditoria> {
  const { data, error } = await api.POST('/api/calidad/auditorias', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function capturarResultado(id: number, cuerpo: AuditoriaResultado): Promise<Auditoria> {
  const { data, error } = await api.PATCH('/api/calidad/auditorias/{id}/resultado', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function reclasificar(id: number, cuerpo: AuditoriaReclasificacion): Promise<Auditoria> {
  const { data, error } = await api.POST('/api/calidad/auditorias/{id}/reclasificacion', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Contexto de una orden para dar de alta su auditoría (cantidad, maquileros, muestra). Solo se
 * ejecuta cuando hay una orden elegida (`enabled`).
 */
export function useContextoOrden(
  idOrden: number | undefined,
): UseQueryResult<AuditoriaContexto, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_AUDITORIAS, 'contexto', idOrden],
    queryFn: () => obtenerContextoOrden(idOrden as number),
    enabled: idOrden !== undefined,
  });
}

/** Detalle de una auditoría (con sus renglones y la sugerencia AQL). */
export function useAuditoria(id: number | undefined): UseQueryResult<Auditoria, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_AUDITORIAS, 'detalle', id],
    queryFn: () => obtenerAuditoria(id as number),
    enabled: id !== undefined,
  });
}

export function useCrearAuditoria(): UseMutationResult<Auditoria, ErrorDeApi, AuditoriaCrear> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: crearAuditoria,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_AUDITORIAS }),
  });
}

export interface ArgsCapturarResultado {
  id: number;
  cuerpo: AuditoriaResultado;
}

export function useCapturarResultado(): UseMutationResult<
  Auditoria,
  ErrorDeApi,
  ArgsCapturarResultado
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCapturarResultado) => capturarResultado(id, cuerpo),
    onSuccess: (auditoria) => {
      void qc.invalidateQueries({ queryKey: CLAVE_AUDITORIAS });
      qc.setQueryData([...CLAVE_AUDITORIAS, 'detalle', auditoria.id], auditoria);
    },
  });
}

export interface ArgsReclasificar {
  id: number;
  cuerpo: AuditoriaReclasificacion;
}

export function useReclasificar(): UseMutationResult<Auditoria, ErrorDeApi, ArgsReclasificar> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsReclasificar) => reclasificar(id, cuerpo),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_AUDITORIAS }),
  });
}

/**
 * Resuelve el plan AQL (tamano de muestra y limites) para un lote y un nivel dados.
 * Solo se ejecuta cuando ambos parametros estan presentes (`enabled`).
 */
export function useResolverPlan(
  query: Partial<ResolverPlanQuery>,
): UseQueryResult<ResolverPlan, ErrorDeApi> {
  const habilitado =
    query.tamanoLote !== undefined &&
    query.tamanoLote !== null &&
    query.nivelAQL !== undefined &&
    query.nivelAQL !== null;
  return useQuery({
    queryKey: [...CLAVE_PLANES_AQL, 'resolver', query],
    queryFn: () => resolverPlan(query as ResolverPlanQuery),
    enabled: habilitado,
  });
}
