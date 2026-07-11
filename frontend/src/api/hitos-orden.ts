import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import { CLAVE_RC_ALERTAS, CLAVE_RC_BANDEJA, CLAVE_RC_RUTA } from './ruta-critica-programacion';
import type { HitosOrden, RegistrarHitoCuerpo } from './tipos';

/**
 * Capa de datos de los HITOS de una orden (cierre del hueco de emisores, post-F9). Un hito es un acto
 * puntual capturado en el detalle de la orden (revisión de la OP, autorización de fit/tono/avíos,
 * empaque, arte) que auto-completa su proceso de la Ruta Crítica vía el auto-avance. Mismo ESTÁNDAR que
 * `ruta-critica-programacion.ts`: invoca el cliente tipado del OpenAPI, normaliza (`data`/`ErrorDeApi`)
 * y expone hooks de TanStack Query. CERO lógica de negocio (A1): el efecto en la RC lo deriva el backend.
 */

/** Clave raíz de la caché de los hitos por orden. */
export const CLAVE_HITOS_ORDEN = ['ruta-critica', 'hitos'] as const;

/** Registrar/cancelar un hito toca la RC de la orden: se invalidan hitos + ruta + bandeja + alertas. */
function invalidarTrasHito(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: CLAVE_HITOS_ORDEN });
  void qc.invalidateQueries({ queryKey: [...CLAVE_RC_RUTA] });
  void qc.invalidateQueries({ queryKey: CLAVE_RC_BANDEJA });
  void qc.invalidateQueries({ queryKey: CLAVE_RC_ALERTAS });
}

/**
 * Lee los hitos VIVOS de una orden. `habilitado` permite no consultar (p. ej. sin permiso `rc.ruta-ver`
 * o sin orden seleccionada); el backend re-verifica el permiso con 403.
 */
export function useHitosOrden(
  idOrden: number | undefined,
  opciones: { habilitado?: boolean } = {},
): UseQueryResult<HitosOrden, ErrorDeApi> {
  const { habilitado = true } = opciones;
  return useQuery({
    queryKey: [...CLAVE_HITOS_ORDEN, idOrden],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/ruta-critica/ordenes/{id}/hitos', {
        params: { path: { id: idOrden as number } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    enabled: habilitado && idOrden !== undefined,
  });
}

/** Argumentos de registrar un hito. */
export interface ArgsRegistrarHito {
  idOrden: number;
  cuerpo: RegistrarHitoCuerpo;
}

/** Registra un hito en la orden e invalida los hitos + la ruta + la bandeja + las alertas. */
export function useRegistrarHito(): UseMutationResult<HitosOrden, ErrorDeApi, ArgsRegistrarHito> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, cuerpo }: ArgsRegistrarHito) => {
      const { data, error } = await api.POST('/api/ruta-critica/ordenes/{id}/hitos', {
        params: { path: { id: idOrden } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => {
      invalidarTrasHito(qc);
    },
  });
}

/** Argumentos de cancelar un hito. */
export interface ArgsCancelarHito {
  idOrden: number;
  idHito: number;
  motivo: string;
}

/** Cancela un hito (suave, con motivo) e invalida los hitos + la ruta + la bandeja + las alertas. */
export function useCancelarHito(): UseMutationResult<HitosOrden, ErrorDeApi, ArgsCancelarHito> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, idHito, motivo }: ArgsCancelarHito) => {
      const { data, error } = await api.POST(
        '/api/ruta-critica/ordenes/{id}/hitos/{idHito}/cancelar',
        { params: { path: { id: idOrden, idHito } }, body: { motivo } },
      );
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => {
      invalidarTrasHito(qc);
    },
  });
}
