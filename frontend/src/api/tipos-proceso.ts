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
  TipoProceso,
  TipoProcesoCrear,
  TipoProcesoEditar,
  TiposProcesoPagina,
  TiposProcesoQuery,
} from './tipos';

/**
 * Capa de datos de Tipos de proceso (F3-E1) — mismo ESTÁNDAR que Almacenes: llama al cliente
 * tipado del OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO
 * lógica de negocio (A1): la autorización (incluida la regla de que solo un admin edita
 * `generaEntradaPt`) vive en el backend.
 */

/** Clave raíz de la caché de tipos de proceso. */
export const CLAVE_TIPOS_PROCESO = ['tipos-proceso'] as const;

function claveLista(query: TiposProcesoQuery): readonly unknown[] {
  return [...CLAVE_TIPOS_PROCESO, 'lista', query];
}

async function listar(query: TiposProcesoQuery): Promise<TiposProcesoPagina> {
  const { data, error } = await api.GET('/api/tipos-proceso', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crear(cuerpo: TipoProcesoCrear): Promise<TipoProceso> {
  const { data, error } = await api.POST('/api/tipos-proceso', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function actualizar(id: number, cuerpo: TipoProcesoEditar): Promise<TipoProceso> {
  const { data, error } = await api.PATCH('/api/tipos-proceso/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function desactivar(id: number): Promise<TipoProceso> {
  const { data, error } = await api.DELETE('/api/tipos-proceso/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function reactivar(id: number): Promise<TipoProceso> {
  const { data, error } = await api.PATCH('/api/tipos-proceso/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista tipos de proceso con los filtros dados (sin parpadeo al paginar/buscar). */
export function useTiposProceso(
  query: TiposProcesoQuery,
): UseQueryResult<TiposProcesoPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveLista(query),
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un tipo de proceso e invalida la lista. */
export function useCrearTipoProceso(): UseMutationResult<
  TipoProceso,
  ErrorDeApi,
  TipoProcesoCrear
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crear,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TIPOS_PROCESO }),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarTipoProceso {
  id: number;
  cuerpo: TipoProcesoEditar;
}

/** Edita un tipo de proceso e invalida la lista. */
export function useActualizarTipoProceso(): UseMutationResult<
  TipoProceso,
  ErrorDeApi,
  ArgsActualizarTipoProceso
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarTipoProceso) => actualizar(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TIPOS_PROCESO }),
  });
}

/** Desactiva un tipo de proceso (borrado suave) e invalida la lista. */
export function useDesactivarTipoProceso(): UseMutationResult<TipoProceso, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TIPOS_PROCESO }),
  });
}

/** Reactiva un tipo de proceso desactivado e invalida la lista. */
export function useReactivarTipoProceso(): UseMutationResult<TipoProceso, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TIPOS_PROCESO }),
  });
}

/**
 * Lista los TIPOS DE ARTE: los tipos de proceso marcados `esArte` en el catálogo ÚNICO (V1-E3f,
 * §Post-F9.58 — Daniel: *"De acuerdo. Y un solo catálogo."*). Los consume todo lo que captura arte
 * (la ficha del modelo y la receta de la orden) para llenar el selector de tipo, saber si toca
 * mostrar las PUNTADAS (`usaPuntadas`) y con qué ROL acotar el selector de proveedores
 * (`codigoRolProveedor`).
 *
 * Va por el MISMO endpoint del catálogo (`tipos-proceso.ver`, un permiso que ningún rol del seed
 * corta) en vez de estrenar uno propio: es la misma lista, y duplicar endpoints es cómo se
 * desincronizan dos vistas de lo mismo.
 */
export function useTiposArte(): UseQueryResult<TiposProcesoPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveLista(QUERY_TIPOS_ARTE),
    queryFn: () => listar(QUERY_TIPOS_ARTE),
    // El catálogo cambia poquísimo y lo piden varias pantallas: no re-consultar en cada foco.
    staleTime: 5 * 60_000,
  });
}

/** Filtros fijos de {@link useTiposArte} (constante para que la clave de caché sea estable). */
const QUERY_TIPOS_ARTE: TiposProcesoQuery = {
  pagina: 1,
  porPagina: 100,
  soloArte: 'true',
  incluirInactivos: 'false',
  ordenarPor: 'nombre',
  direccion: 'asc',
};
