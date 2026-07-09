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
  Auditor,
  AuditorCrear,
  AuditorEditar,
  AuditoresPagina,
  AuditoresQuery,
} from './tipos';

/**
 * Capa de datos del catálogo de AUDITORES (rediseño R9), calcada del estándar de Almacenes: cada
 * función llama al cliente TIPADO del OpenAPI, normaliza (`data`/`ErrorDeApi`) y se expone como hook
 * de TanStack Query. CERO lógica de negocio (A1): la autorización, validación y el conteo derivado
 * viven en el backend.
 */

/** Clave raíz de la caché de auditores en TanStack Query. */
export const CLAVE_AUDITORES = ['auditores'] as const;

/** Clave de caché de una página concreta del listado (depende de los filtros). */
function claveListaAuditores(query: AuditoresQuery): readonly unknown[] {
  return [...CLAVE_AUDITORES, 'lista', query];
}

/** Pide una página del listado de auditores (búsqueda + orden + paginación en servidor). */
async function listarAuditores(query: AuditoresQuery): Promise<AuditoresPagina> {
  const { data, error } = await api.GET('/api/calidad/auditores', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un auditor (`POST /api/calidad/auditores`). */
async function crearAuditor(cuerpo: AuditorCrear): Promise<Auditor> {
  const { data, error } = await api.POST('/api/calidad/auditores', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un auditor (`PATCH /api/calidad/auditores/{id}`). */
async function actualizarAuditor(id: number, cuerpo: AuditorEditar): Promise<Auditor> {
  const { data, error } = await api.PATCH('/api/calidad/auditores/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un auditor (borrado SUAVE, `DELETE /api/calidad/auditores/{id}`). */
async function desactivarAuditor(id: number): Promise<Auditor> {
  const { data, error } = await api.DELETE('/api/calidad/auditores/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva un auditor desactivado: `PATCH /api/calidad/auditores/{id}` con `{ activo: true }`. */
async function reactivarAuditor(id: number): Promise<Auditor> {
  const { data, error } = await api.PATCH('/api/calidad/auditores/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista auditores con los filtros dados (mantiene la página anterior al paginar/buscar). */
export function useAuditores(query: AuditoresQuery): UseQueryResult<AuditoresPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaAuditores(query),
    queryFn: () => listarAuditores(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un auditor e invalida la lista para reflejarlo. */
export function useCrearAuditor(): UseMutationResult<Auditor, ErrorDeApi, AuditorCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearAuditor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_AUDITORES }),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarAuditor {
  id: number;
  cuerpo: AuditorEditar;
}

/** Edita un auditor e invalida la lista. */
export function useActualizarAuditor(): UseMutationResult<
  Auditor,
  ErrorDeApi,
  ArgsActualizarAuditor
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarAuditor) => actualizarAuditor(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_AUDITORES }),
  });
}

/** Desactiva un auditor (borrado suave) e invalida la lista. */
export function useDesactivarAuditor(): UseMutationResult<Auditor, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarAuditor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_AUDITORES }),
  });
}

/** Reactiva un auditor desactivado e invalida la lista. */
export function useReactivarAuditor(): UseMutationResult<Auditor, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarAuditor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_AUDITORES }),
  });
}
