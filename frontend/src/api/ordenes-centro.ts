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
import { CLAVE_ORDENES } from './ordenes';
import type {
  OrdenesCentroPagina,
  OrdenesCentroQuery,
  OrdenPrecioEventos,
  OrdenPrecios,
  OrdenPreciosPatch,
} from './tipos';

/**
 * Capa de datos del CENTRO DE COMANDO de órdenes + PRECIOS con rastro (rediseño R2, §4.2/§4.4.3)
 * — mismo ESTÁNDAR que `api/ordenes-consulta.ts`: cliente TIPADO del OpenAPI, normalización
 * (`data`/`ErrorDeApi`) y hooks de TanStack Query. CERO lógica de negocio (A1): las 13 columnas
 * vienen AGREGADAS del servidor y el gateo de montos reales lo decide el backend.
 */

/** Clave raíz de la cache del centro de comando. */
export const CLAVE_ORDENES_CENTRO = ['ordenes-centro'] as const;

// ── Llamadas ─────────────────────────────────────────────────────────────────

async function listarCentro(query: OrdenesCentroQuery): Promise<OrdenesCentroPagina> {
  const { data, error } = await api.GET('/api/ordenes/centro', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerPrecios(idOrden: number): Promise<OrdenPrecios> {
  const { data, error } = await api.GET('/api/ordenes/{id}/precios', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function capturarPrecio(idOrden: number, cuerpo: OrdenPreciosPatch): Promise<OrdenPrecios> {
  const { data, error } = await api.PATCH('/api/ordenes/{id}/precios', {
    params: { path: { id: idOrden } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarEventosPrecio(idOrden: number): Promise<OrdenPrecioEventos> {
  const { data, error } = await api.GET('/api/ordenes/{id}/precios/eventos', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Página del centro de comando (mantiene la previa al filtrar/paginar). */
export function useOrdenesCentro(
  query: OrdenesCentroQuery,
): UseQueryResult<OrdenesCentroPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ORDENES_CENTRO, 'lista', query],
    queryFn: () => listarCentro(query),
    placeholderData: keepPreviousData,
  });
}

/** Resumen de precios de una orden (montos reales null sin permiso; lo decide el backend). */
export function usePreciosOrden(
  idOrden: number | undefined,
): UseQueryResult<OrdenPrecios, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ORDENES_CENTRO, 'precios', idOrden],
    queryFn: () => obtenerPrecios(idOrden as number),
    enabled: idOrden !== undefined,
  });
}

/** Historial inmutable de eventos de precio (exige `ordenes.ver-precio-real-maquila`). */
export function useEventosPrecioOrden(
  idOrden: number | undefined,
  habilitado = true,
): UseQueryResult<OrdenPrecioEventos, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ORDENES_CENTRO, 'precios-eventos', idOrden],
    queryFn: () => listarEventosPrecio(idOrden as number),
    enabled: habilitado && idOrden !== undefined,
  });
}

/** Argumentos de la captura de un precio real. */
export interface ArgsCapturarPrecio {
  idOrden: number;
  cuerpo: OrdenPreciosPatch;
}

/** Captura el precio real negociado e invalida precios + centro + detalle de la orden. */
export function useCapturarPrecio(): UseMutationResult<
  OrdenPrecios,
  ErrorDeApi,
  ArgsCapturarPrecio
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idOrden, cuerpo }: ArgsCapturarPrecio) => capturarPrecio(idOrden, cuerpo),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES_CENTRO }),
        queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES }),
      ]);
    },
  });
}
