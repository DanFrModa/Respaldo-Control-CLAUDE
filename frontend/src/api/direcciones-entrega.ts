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
  DireccionEntrega,
  DireccionEntregaCrear,
  DireccionEntregaEditar,
  DireccionesEntregaPagina,
  DireccionesEntregaQuery,
} from './tipos';

/**
 * Capa de datos del catálogo de DIRECCIONES DE ENTREGA (§Post-F9.18) — replica del estándar de
 * `api/temporadas.ts`. La captura de la OC ya no teclea la dirección: la elige de aquí, y la
 * FAVORITA viene primero para preseleccionarla. El backend valida y decide (A1).
 */

/** Clave raíz de la cache de direcciones de entrega. */
export const CLAVE_DIRECCIONES_ENTREGA = ['direcciones-entrega'] as const;

/** Clave de cache de una página concreta del listado. */
function claveLista(query: DireccionesEntregaQuery): readonly unknown[] {
  return [...CLAVE_DIRECCIONES_ENTREGA, 'lista', query];
}

/** Pide una página del listado (búsqueda + orden + paginación en servidor). */
async function listar(query: DireccionesEntregaQuery): Promise<DireccionesEntregaPagina> {
  const { data, error } = await api.GET('/api/compras/direcciones-entrega', {
    params: { query },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea una dirección de entrega. */
async function crear(cuerpo: DireccionEntregaCrear): Promise<DireccionEntrega> {
  const { data, error } = await api.POST('/api/compras/direcciones-entrega', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza una dirección de entrega. */
async function actualizar(id: number, cuerpo: DireccionEntregaEditar): Promise<DireccionEntrega> {
  const { data, error } = await api.PATCH('/api/compras/direcciones-entrega/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva una dirección (borrado SUAVE). */
async function desactivar(id: number): Promise<DireccionEntrega> {
  const { data, error } = await api.DELETE('/api/compras/direcciones-entrega/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva una dirección desactivada. */
async function reactivar(id: number): Promise<DireccionEntrega> {
  const { data, error } = await api.PATCH('/api/compras/direcciones-entrega/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista direcciones de entrega con los filtros dados. */
export function useDireccionesEntrega(
  query: DireccionesEntregaQuery,
): UseQueryResult<DireccionesEntregaPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveLista(query),
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Direcciones ACTIVAS para un selector (la favorita primero, como las ordena el servidor). Es lo
 * que usa la captura de la OC: no hace falta paginar un catálogo de un puñado de direcciones.
 */
export function useDireccionesEntregaActivas(): UseQueryResult<
  DireccionesEntregaPagina,
  ErrorDeApi
> {
  return useDireccionesEntrega({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
  });
}

/** Crea una dirección e invalida la lista. */
export function useCrearDireccionEntrega(): UseMutationResult<
  DireccionEntrega,
  ErrorDeApi,
  DireccionEntregaCrear
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crear,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_DIRECCIONES_ENTREGA }),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarDireccionEntrega {
  id: number;
  cuerpo: DireccionEntregaEditar;
}

/** Edita una dirección e invalida la lista. */
export function useActualizarDireccionEntrega(): UseMutationResult<
  DireccionEntrega,
  ErrorDeApi,
  ArgsActualizarDireccionEntrega
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarDireccionEntrega) => actualizar(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_DIRECCIONES_ENTREGA }),
  });
}

/** Desactiva una dirección (borrado suave) e invalida la lista. */
export function useDesactivarDireccionEntrega(): UseMutationResult<
  DireccionEntrega,
  ErrorDeApi,
  number
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_DIRECCIONES_ENTREGA }),
  });
}

/** Reactiva una dirección desactivada e invalida la lista. */
export function useReactivarDireccionEntrega(): UseMutationResult<
  DireccionEntrega,
  ErrorDeApi,
  number
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_DIRECCIONES_ENTREGA }),
  });
}
