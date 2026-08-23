import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { ResumenOperativo } from './tipos';

/**
 * Capa de datos del RESUMEN OPERATIVO de la portada (rediseño R9, proto `vResumen`) — mismo
 * ESTÁNDAR que WIP/Etapas: cliente TIPADO del OpenAPI, normalización (`data`/`ErrorDeApi`) y un
 * hook de TanStack Query. Solo consulta (lectura). CERO lógica de negocio (A1): TODOS los números
 * (conteos, sumas por semana, % a tiempo, semáforos) los deriva el backend; cada bloque llega
 * `null` si la sesión no tiene el permiso de su dominio (A4) y la UI solo oculta la tarjeta.
 */

/** Clave raíz de la caché del resumen. */
export const CLAVE_RESUMEN = ['resumen-operativo'] as const;

async function obtenerResumen(): Promise<ResumenOperativo> {
  const { data, error } = await api.GET('/api/resumen');
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Resumen operativo de la portada. `habilitado` corta la query cuando la sesión no tiene NINGÚN
 * permiso de los bloques (el backend contestaría 403). Se refresca al re-enfocar para que el
 * "actualizado hace X min" no envejezca de más.
 */
export function useResumenOperativo(opciones: {
  habilitado: boolean;
}): UseQueryResult<ResumenOperativo, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_RESUMEN],
    queryFn: obtenerResumen,
    enabled: opciones.habilitado,
  });
}
