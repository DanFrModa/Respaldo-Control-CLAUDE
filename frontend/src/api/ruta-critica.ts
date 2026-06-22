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
  ProcesoRc,
  ProcesoRcChecklist,
  ProcesoRcCrear,
  ProcesoRcDependencias,
  ProcesoRcEditar,
  ProcesoRcRoles,
  ProcesosRcPagina,
  ProcesosRcQuery,
} from './tipos';

/**
 * Capa de datos del catálogo configurable de la Ruta Crítica (F5-E1) — mismo ESTÁNDAR que los
 * catálogos: llama al cliente tipado del OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone hooks
 * de TanStack Query. CERO lógica de negocio (A1): el rechazo de ciclos y la autorización viven en
 * el backend; aquí solo se invocan los endpoints y se invalida la caché.
 */

/** Clave raíz de la caché de procesos de la RC. */
export const CLAVE_PROCESOS_RC = ['ruta-critica', 'procesos'] as const;

function claveLista(query: ProcesosRcQuery): readonly unknown[] {
  return [...CLAVE_PROCESOS_RC, 'lista', query];
}

async function listar(query: ProcesosRcQuery): Promise<ProcesosRcPagina> {
  const { data, error } = await api.GET('/api/ruta-critica/procesos', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crear(cuerpo: ProcesoRcCrear): Promise<ProcesoRc> {
  const { data, error } = await api.POST('/api/ruta-critica/procesos', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function actualizar(id: number, cuerpo: ProcesoRcEditar): Promise<ProcesoRc> {
  const { data, error } = await api.PATCH('/api/ruta-critica/procesos/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function desactivar(id: number): Promise<ProcesoRc> {
  const { data, error } = await api.DELETE('/api/ruta-critica/procesos/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function reactivar(id: number): Promise<ProcesoRc> {
  const { data, error } = await api.PATCH('/api/ruta-critica/procesos/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function fijarRoles(id: number, cuerpo: ProcesoRcRoles): Promise<ProcesoRc> {
  const { data, error } = await api.PUT('/api/ruta-critica/procesos/{id}/roles', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function fijarDependencias(id: number, cuerpo: ProcesoRcDependencias): Promise<ProcesoRc> {
  const { data, error } = await api.PUT('/api/ruta-critica/procesos/{id}/dependencias', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function fijarChecklist(id: number, cuerpo: ProcesoRcChecklist): Promise<ProcesoRc> {
  const { data, error } = await api.PUT('/api/ruta-critica/procesos/{id}/checklist', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista procesos de la RC con los filtros dados (sin parpadeo al paginar/buscar). */
export function useProcesosRc(
  query: ProcesosRcQuery,
): UseQueryResult<ProcesosRcPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveLista(query),
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un proceso e invalida la lista. */
export function useCrearProcesoRc(): UseMutationResult<ProcesoRc, ErrorDeApi, ProcesoRcCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crear,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROCESOS_RC }),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarProcesoRc {
  id: number;
  cuerpo: ProcesoRcEditar;
}

/** Edita un proceso e invalida la lista. */
export function useActualizarProcesoRc(): UseMutationResult<
  ProcesoRc,
  ErrorDeApi,
  ArgsActualizarProcesoRc
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarProcesoRc) => actualizar(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROCESOS_RC }),
  });
}

/** Desactiva un proceso (borrado suave) e invalida la lista. */
export function useDesactivarProcesoRc(): UseMutationResult<ProcesoRc, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROCESOS_RC }),
  });
}

/** Reactiva un proceso desactivado e invalida la lista. */
export function useReactivarProcesoRc(): UseMutationResult<ProcesoRc, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROCESOS_RC }),
  });
}

/** Argumentos de los sub-recursos (roles/dependencias/checklist). */
export interface ArgsFijarRoles {
  id: number;
  cuerpo: ProcesoRcRoles;
}
/** Fija el set de roles responsables e invalida la lista. */
export function useFijarRolesProcesoRc(): UseMutationResult<ProcesoRc, ErrorDeApi, ArgsFijarRoles> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsFijarRoles) => fijarRoles(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROCESOS_RC }),
  });
}

/** Argumentos de fijar dependencias. */
export interface ArgsFijarDependencias {
  id: number;
  cuerpo: ProcesoRcDependencias;
}
/** Fija el set de antecesores (DAG; el backend rechaza ciclos) e invalida la lista. */
export function useFijarDependenciasProcesoRc(): UseMutationResult<
  ProcesoRc,
  ErrorDeApi,
  ArgsFijarDependencias
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsFijarDependencias) => fijarDependencias(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROCESOS_RC }),
  });
}

/** Argumentos de fijar checklist. */
export interface ArgsFijarChecklist {
  id: number;
  cuerpo: ProcesoRcChecklist;
}
/** Fija el set del checklist e invalida la lista. */
export function useFijarChecklistProcesoRc(): UseMutationResult<
  ProcesoRc,
  ErrorDeApi,
  ArgsFijarChecklist
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsFijarChecklist) => fijarChecklist(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROCESOS_RC }),
  });
}
