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
import type {
  PendientesRecibir,
  Recibo,
  ReciboCancelar,
  ReciboCrear,
  RecibosSemanales,
  RecibosSemanalesQuery,
} from './tipos';

/**
 * Capa de datos del RECIBO de maquila (F3-E4) — mismo ESTÁNDAR que Etapas/Inventario: llama al
 * cliente TIPADO del OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO
 * lógica de negocio (A1): el backend valida (recibido ≤ enviado, entrada a PT solo en costura, cargo
 * EsMa, cancelación con inverso) y es la autoridad.
 */

/** Clave raíz de la caché de recibos/WIP de recepción. */
export const CLAVE_RECIBOS = ['produccion-recibos'] as const;

// ── Llamadas ─────────────────────────────────────────────────────────────────

async function crearRecibo(cuerpo: ReciboCrear): Promise<Recibo> {
  const { data, error } = await api.POST('/api/produccion/recibos', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function cancelarRecibo(id: number, cuerpo: ReciboCancelar): Promise<Recibo> {
  const { data, error } = await api.POST('/api/produccion/recibos/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarPendientesRecibir(idOrden: number): Promise<PendientesRecibir> {
  const { data, error } = await api.GET('/api/produccion/ordenes/{id}/pendientes-recibir', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarRecibosSemanales(query: RecibosSemanalesQuery): Promise<RecibosSemanales> {
  const { data, error } = await api.GET('/api/produccion/recibos-semanales', {
    params: { query },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Pendientes por recibir de una orden (`enviado − recibido − incompletas − faltantes saldados`).
 * `habilitado` corta la query.
 */
export function usePendientesRecibir(
  idOrden: number | undefined,
  habilitado = true,
): UseQueryResult<PendientesRecibir, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_RECIBOS, 'pendientes-recibir', idOrden],
    queryFn: () => listarPendientesRecibir(idOrden as number),
    enabled: habilitado && idOrden !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Recibos semanales por maquilero (consulta agrupada). */
export function useRecibosSemanales(
  query: RecibosSemanalesQuery,
): UseQueryResult<RecibosSemanales, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_RECIBOS, 'recibos-semanales', query],
    queryFn: () => listarRecibosSemanales(query),
    placeholderData: keepPreviousData,
  });
}

/** Registra un recibo e invalida recibos, etapas/WIP y existencias (un recibo de costura mete a PT). */
export function useCrearRecibo(): UseMutationResult<Recibo, ErrorDeApi, ReciboCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearRecibo,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_RECIBOS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_INVENTARIO_PT });
    },
  });
}

/** Argumentos de una cancelación de recibo. */
export interface ArgsCancelarRecibo {
  id: number;
  cuerpo: ReciboCancelar;
}

/** Cancela (suave + inverso de kardex) un recibo e invalida recibos, etapas/WIP y existencias. */
export function useCancelarRecibo(): UseMutationResult<Recibo, ErrorDeApi, ArgsCancelarRecibo> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarRecibo) => cancelarRecibo(id, cuerpo),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_RECIBOS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_INVENTARIO_PT });
    },
  });
}

/** Construye la URL de descarga del PDF de un recibo. */
export function urlImpresoRecibo(idRecibo: number): string {
  return `/api/produccion/recibos/${idRecibo}/impreso`;
}
