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
import { CLAVE_ETAPAS } from './etapas';
import { CLAVE_INVENTARIO_PT } from './inventarios';
import { CLAVE_WIP } from './wip';
import type {
  EntregaCliente,
  EntregaClienteCancelar,
  EntregaClienteCrear,
  EntregasOrden,
  SeguimientoEntrega,
  SeguimientoEntregaQuery,
} from './tipos';

/**
 * Capa de datos de la ENTREGA a cliente (F3-E5) — mismo ESTÁNDAR que Recibos/Etapas: llama al
 * cliente TIPADO del OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO
 * lógica de negocio (A1): el backend valida (no-negativo estricto, salida de PT, seguimiento
 * derivado, cancelación con inverso) y es la autoridad.
 */

/** Clave raíz de la caché de entregas a cliente. */
export const CLAVE_ENTREGAS = ['produccion-entregas'] as const;

// ── Llamadas ─────────────────────────────────────────────────────────────────

async function crearEntrega(cuerpo: EntregaClienteCrear): Promise<EntregaCliente> {
  const { data, error } = await api.POST('/api/produccion/entregas-cliente', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function cancelarEntrega(
  id: number,
  cuerpo: EntregaClienteCancelar,
): Promise<EntregaCliente> {
  const { data, error } = await api.POST('/api/produccion/entregas-cliente/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarEntregasOrden(idOrden: number): Promise<EntregasOrden> {
  const { data, error } = await api.GET('/api/produccion/ordenes/{id}/entregas', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerSeguimiento(
  idOrden: number,
  query: SeguimientoEntregaQuery,
): Promise<SeguimientoEntrega> {
  const { data, error } = await api.GET('/api/produccion/ordenes/{id}/seguimiento-entrega', {
    params: { path: { id: idOrden }, query },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Seguimiento derivado del pedido de una orden (pedido − entregado + disponible). `habilitado` corta. */
export function useSeguimientoEntrega(
  idOrden: number | undefined,
  query: SeguimientoEntregaQuery = {},
  habilitado = true,
): UseQueryResult<SeguimientoEntrega, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ENTREGAS, 'seguimiento', idOrden, query],
    queryFn: () => obtenerSeguimiento(idOrden as number, query),
    enabled: habilitado && idOrden !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Historial de entregas (vivas y canceladas) de una orden. `habilitado` corta la query. */
export function useEntregasOrden(
  idOrden: number | undefined,
  habilitado = true,
): UseQueryResult<EntregasOrden, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ENTREGAS, 'historial', idOrden],
    queryFn: () => listarEntregasOrden(idOrden as number),
    enabled: habilitado && idOrden !== undefined,
    placeholderData: keepPreviousData,
  });
}

/**
 * Registra una entrega e invalida entregas, etapas, WIP y existencias (la entrega saca de PT).
 *
 * ⚠️ `CLAVE_WIP` es indispensable desde V1-E3a: la entrega es una ETAPA del stepper del panel de
 * avance y su avance (`entregado`/`porEntregar`) lo DERIVA el WIP del servidor — sin invalidarlo, el
 * stepper y el tablero seguían mostrando el avance viejo tras entregar.
 */
export function useCrearEntrega(): UseMutationResult<
  EntregaCliente,
  ErrorDeApi,
  EntregaClienteCrear
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearEntrega,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_ENTREGAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_WIP });
      void queryClient.invalidateQueries({ queryKey: CLAVE_INVENTARIO_PT });
    },
  });
}

/** Argumentos de una cancelación de entrega. */
export interface ArgsCancelarEntrega {
  id: number;
  cuerpo: EntregaClienteCancelar;
}

/** Cancela (suave + inverso de kardex) una entrega e invalida entregas, etapas, WIP y existencias. */
export function useCancelarEntrega(): UseMutationResult<
  EntregaCliente,
  ErrorDeApi,
  ArgsCancelarEntrega
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarEntrega) => cancelarEntrega(id, cuerpo),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_ENTREGAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_WIP });
      void queryClient.invalidateQueries({ queryKey: CLAVE_INVENTARIO_PT });
    },
  });
}

/** Construye la URL de descarga del comprobante PDF de una entrega. */
export function urlComprobanteEntrega(idEntrega: number): string {
  return `/api/produccion/entregas-cliente/${idEntrega}/comprobante`;
}
