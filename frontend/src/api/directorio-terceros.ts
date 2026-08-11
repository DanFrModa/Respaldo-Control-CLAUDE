import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { DirectorioTercerosPagina, DirectorioTercerosQuery } from './tipos';

/**
 * Capa de datos del DIRECTORIO HISTÓRICO DE TERCEROS (§Post-F9.28).
 *
 * SOLO LECTURA: no hay mutaciones y no las va a haber — tampoco un "convertir en proveedor". Si un
 * taller vuelve, se da de alta limpio en el catálogo copiando de aquí lo que sirva.
 */
export const CLAVE_DIRECTORIO_TERCEROS = ['directorio-terceros'] as const;

async function listar(query: DirectorioTercerosQuery): Promise<DirectorioTercerosPagina> {
  const { data, error } = await api.GET('/api/directorio-terceros', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

export function useDirectorioTerceros(
  query: DirectorioTercerosQuery,
): UseQueryResult<DirectorioTercerosPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_DIRECTORIO_TERCEROS, 'lista', query],
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}
