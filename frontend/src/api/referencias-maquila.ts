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
import { CLAVE_ORDENES_CENTRO } from './ordenes-centro';
import { CLAVE_RECETA_ORDEN } from './receta-orden';
import type {
  ReferenciaMaquilaPatch,
  ReferenciasCambiosLista,
  ReferenciasCambiosQuery,
  ReferenciasMaquilaOrden,
} from './tipos';

/**
 * Capa de datos de las REFERENCIAS DE PRECIO DE MAQUILA de la orden (fila 0.242): el tope por proceso
 * de lo que se le paga al taller y la consulta de referencias cambiadas. CERO lógica de negocio (A1):
 * el tope, quién ve los montos y quién se puede pasar lo decide el backend.
 */

/** Clave raíz de la cache de referencias. */
export const CLAVE_REFERENCIAS_MAQUILA = ['referencias-maquila'] as const;

async function obtenerReferencias(idOrden: number): Promise<ReferenciasMaquilaOrden> {
  const { data, error } = await api.GET('/api/ordenes/{id}/referencias-maquila', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function capturarReferencia(
  idOrden: number,
  cuerpo: ReferenciaMaquilaPatch,
): Promise<ReferenciasMaquilaOrden> {
  const { data, error } = await api.PATCH('/api/ordenes/{id}/referencias-maquila', {
    params: { path: { id: idOrden } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarCambios(query: ReferenciasCambiosQuery): Promise<ReferenciasCambiosLista> {
  const { data, error } = await api.GET('/api/ordenes/referencias-maquila/cambios', {
    params: { query },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Las referencias de una orden (montos null si la sesión no los ve; lo decide el backend). */
export function useReferenciasMaquila(
  idOrden: number | undefined,
): UseQueryResult<ReferenciasMaquilaOrden, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_REFERENCIAS_MAQUILA, 'orden', idOrden],
    queryFn: () => obtenerReferencias(idOrden as number),
    enabled: idOrden !== undefined,
  });
}

/** Argumentos de la captura de una referencia. */
export interface ArgsCapturarReferencia {
  idOrden: number;
  cuerpo: ReferenciaMaquilaPatch;
}

/**
 * Captura una referencia (costura) o el precio de un renglón de arte. Invalida las referencias, los
 * precios de la orden y su receta (el precio de un arte también vive en la receta).
 */
export function useCapturarReferencia(): UseMutationResult<
  ReferenciasMaquilaOrden,
  ErrorDeApi,
  ArgsCapturarReferencia
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idOrden, cuerpo }: ArgsCapturarReferencia) =>
      capturarReferencia(idOrden, cuerpo),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CLAVE_REFERENCIAS_MAQUILA }),
        queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES_CENTRO }),
        queryClient.invalidateQueries({ queryKey: CLAVE_RECETA_ORDEN }),
      ]);
    },
  });
}

/** La consulta de referencias cambiadas y sobreprecios (`ordenes.autorizar-sobreprecio`). */
export function useReferenciasCambiadas(
  query: ReferenciasCambiosQuery,
): UseQueryResult<ReferenciasCambiosLista, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_REFERENCIAS_MAQUILA, 'cambios', query],
    queryFn: () => listarCambios(query),
    placeholderData: keepPreviousData,
  });
}
