import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { HistoricoOrdenDetalle, HistoricoOrdenesPagina, HistoricoOrdenesQuery } from './tipos';

/**
 * Capa de datos del ARCHIVO HISTÓRICO DE ÓRDENES del sistema viejo (§Post-F9.26).
 *
 * SOLO LECTURA: aquí no hay ni habrá mutaciones. El archivo se llena una vez con el ETL y desde la
 * aplicación solo se consulta — por eso no se invalida cache ni se exporta `useMutation`.
 */

/** Clave raíz de la cache del archivo histórico. */
export const CLAVE_HISTORICO_ORDENES = ['historico-ordenes'] as const;

async function listar(query: HistoricoOrdenesQuery): Promise<HistoricoOrdenesPagina> {
  const { data, error } = await api.GET('/api/historico-ordenes', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtener(id: number): Promise<HistoricoOrdenDetalle> {
  const { data, error } = await api.GET('/api/historico-ordenes/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Busca en el archivo. `keepPreviousData` a propósito: al teclear en el buscador la tabla se queda
 * con el resultado anterior en vez de parpadear en vacío entre letra y letra.
 */
export function useHistoricoOrdenes(
  query: HistoricoOrdenesQuery,
): UseQueryResult<HistoricoOrdenesPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_HISTORICO_ORDENES, 'lista', query],
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}

/** Ficha de una orden histórica. Solo se pide cuando hay una seleccionada. */
export function useHistoricoOrden(
  id: number | null,
): UseQueryResult<HistoricoOrdenDetalle, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_HISTORICO_ORDENES, 'detalle', id],
    queryFn: () => obtener(id as number),
    enabled: id !== null,
  });
}
