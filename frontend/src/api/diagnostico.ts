import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { Diagnostico } from './tipos';

/**
 * Capa de datos del DIAGNÓSTICO de infraestructura (almacenamiento R2 + respaldo).
 * CERO lógica: pide y normaliza (A1). El criterio —qué significa cada resultado— lo pone el backend,
 * que es el único que puede probar R2 de verdad.
 */

/** Clave raíz de la caché del diagnóstico. */
export const CLAVE_DIAGNOSTICO = ['admin', 'diagnostico'] as const;

async function obtenerDiagnostico(): Promise<Diagnostico> {
  const { data, error } = await api.GET('/api/admin/diagnostico', {});
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Corre el diagnóstico. `staleTime: 0` y sin refetch automático: cada corrida escribe y borra un
 * objeto de prueba en R2, así que se dispara cuando la persona lo pide, no cada vez que la ventana
 * recupera el foco.
 */
export function useDiagnostico(): UseQueryResult<Diagnostico, ErrorDeApi> {
  return useQuery({
    queryKey: CLAVE_DIAGNOSTICO,
    queryFn: obtenerDiagnostico,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Resultado de pedir un respaldo manual. */
export interface RespaldoEncolado {
  encolado: boolean;
  mensaje: string;
}

async function pedirRespaldo(): Promise<RespaldoEncolado> {
  const { data, error } = await api.POST('/api/admin/diagnostico/respaldo', {});
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Pide una corrida del respaldo ahora mismo (invalida el diagnóstico para ver la corrida nueva). */
export function usePedirRespaldo(): UseMutationResult<RespaldoEncolado, ErrorDeApi, void> {
  const clienteQuery = useQueryClient();
  return useMutation({
    mutationFn: pedirRespaldo,
    onSuccess: () => {
      void clienteQuery.invalidateQueries({ queryKey: CLAVE_DIAGNOSTICO });
    },
  });
}
