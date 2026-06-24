import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { BitacoraPagina, BitacoraQuery } from './tipos';

/**
 * Capa de datos de la Bitacora de auditoria (solo lectura). Llama al cliente
 * tipado del OpenAPI y expone un hook de TanStack Query con paginacion de
 * servidor. CERO logica de negocio; CERO mutaciones (la bitacora es inmutable,
 * A1).
 */

export const CLAVE_BITACORA = ['admin', 'bitacora'] as const;

async function listarBitacora(query: BitacoraQuery): Promise<BitacoraPagina> {
  const { data, error } = await api.GET('/api/admin/bitacora', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Lista registros de la bitacora con los filtros dados. `placeholderData:
 * keepPreviousData` mantiene en pantalla la pagina anterior mientras llega la
 * nueva (al paginar o buscar): sin parpadeo a vacio.
 */
export function useBitacora(query: BitacoraQuery): UseQueryResult<BitacoraPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_BITACORA, 'lista', query],
    queryFn: () => listarBitacora(query),
    placeholderData: keepPreviousData,
  });
}
