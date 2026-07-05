import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { paths } from './esquema.gen';
import { api } from './cliente';
import { ErrorDeApi } from './errores';

/**
 * Capa de datos de Conceptos de costo (F8-E1, catálogo global de Desarrollo) — mismo ESTÁNDAR
 * que Tipos de proceso: llama al cliente tipado del OpenAPI, normaliza (`data`/`ErrorDeApi`) y
 * expone hooks de TanStack Query. CERO lógica de negocio (A1): la autorización (admin-only) y la
 * regla de que un concepto `fijo` (tela/avíos/maquila) no se desactiva viven en el backend.
 */

// ── Alias de tipo del contrato ────────────────────────────────────────────────

/** Página de conceptos de costo (`GET /api/conceptos-costo`). */
export type ConceptosCostoPagina =
  paths['/api/conceptos-costo']['get']['responses']['200']['content']['application/json'];
/** Un concepto de costo tal como lo devuelve el API. */
export type ConceptoCosto = ConceptosCostoPagina['datos'][number];
/** Parámetros de consulta del listado (querystring). */
export type ConceptosCostoQuery = NonNullable<
  paths['/api/conceptos-costo']['get']['parameters']['query']
>;
/** Cuerpo de alta (`POST /api/conceptos-costo`). */
export type ConceptoCostoCrear =
  paths['/api/conceptos-costo']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición (`PATCH /api/conceptos-costo/{id}`). */
export type ConceptoCostoEditar =
  paths['/api/conceptos-costo/{id}']['patch']['requestBody']['content']['application/json'];

/** Clave raíz de la caché de conceptos de costo. */
export const CLAVE_CONCEPTOS_COSTO = ['conceptos-costo'] as const;

function claveLista(query: ConceptosCostoQuery): readonly unknown[] {
  return [...CLAVE_CONCEPTOS_COSTO, 'lista', query];
}

async function listar(query: ConceptosCostoQuery): Promise<ConceptosCostoPagina> {
  const { data, error } = await api.GET('/api/conceptos-costo', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crear(cuerpo: ConceptoCostoCrear): Promise<ConceptoCosto> {
  const { data, error } = await api.POST('/api/conceptos-costo', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function actualizar(id: number, cuerpo: ConceptoCostoEditar): Promise<ConceptoCosto> {
  const { data, error } = await api.PATCH('/api/conceptos-costo/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function desactivar(id: number): Promise<ConceptoCosto> {
  const { data, error } = await api.DELETE('/api/conceptos-costo/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function reactivar(id: number): Promise<ConceptoCosto> {
  const { data, error } = await api.PATCH('/api/conceptos-costo/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista conceptos de costo con los filtros dados (sin parpadeo al paginar/buscar). */
export function useConceptosCosto(
  query: ConceptosCostoQuery,
): UseQueryResult<ConceptosCostoPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveLista(query),
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un concepto de costo e invalida la lista. */
export function useCrearConceptoCosto(): UseMutationResult<
  ConceptoCosto,
  ErrorDeApi,
  ConceptoCostoCrear
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crear,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CONCEPTOS_COSTO }),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarConceptoCosto {
  id: number;
  cuerpo: ConceptoCostoEditar;
}

/** Edita un concepto de costo e invalida la lista. */
export function useActualizarConceptoCosto(): UseMutationResult<
  ConceptoCosto,
  ErrorDeApi,
  ArgsActualizarConceptoCosto
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarConceptoCosto) => actualizar(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CONCEPTOS_COSTO }),
  });
}

/** Desactiva un concepto de costo (borrado suave) e invalida la lista. */
export function useDesactivarConceptoCosto(): UseMutationResult<ConceptoCosto, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CONCEPTOS_COSTO }),
  });
}

/** Reactiva un concepto de costo desactivado e invalida la lista. */
export function useReactivarConceptoCosto(): UseMutationResult<ConceptoCosto, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CONCEPTOS_COSTO }),
  });
}
