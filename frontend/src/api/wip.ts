import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type {
  ExistenciaMaquilero,
  ExistenciaMaquileroQuery,
  TableroWip,
  TableroWipQuery,
  WipOrden,
} from './tipos';

/**
 * Capa de datos del TABLERO WIP + existencias en poder del maquilero (F3-E5) — mismo ESTÁNDAR que
 * Etapas/Inventario: llama al cliente TIPADO del OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone
 * hooks de TanStack Query. Son SOLO consultas (lectura): no hay mutaciones. CERO lógica de negocio
 * (A1): el backend DERIVA el avance (suma directa de etapas) y es la autoridad.
 */

/** Clave raíz de la caché del WIP. */
export const CLAVE_WIP = ['produccion-wip'] as const;

// ── Llamadas ─────────────────────────────────────────────────────────────────

async function obtenerTablero(query: TableroWipQuery): Promise<TableroWip> {
  const { data, error } = await api.GET('/api/produccion/wip', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerWipOrden(idOrden: number): Promise<WipOrden> {
  const { data, error } = await api.GET('/api/produccion/wip/ordenes/{id}', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerExistenciaMaquilero(
  query: ExistenciaMaquileroQuery,
): Promise<ExistenciaMaquilero> {
  const { data, error } = await api.GET('/api/produccion/existencias-maquilero', {
    params: { query },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Tablero WIP: órdenes con su avance agregado por etapa (paginado, con filtros). */
export function useTableroWip(query: TableroWipQuery): UseQueryResult<TableroWip, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_WIP, 'tablero', query],
    queryFn: () => obtenerTablero(query),
    placeholderData: keepPreviousData,
  });
}

/** Drill-down del avance de una orden (pendientes por etapa, color×talla). `habilitado` corta la query. */
export function useWipOrden(
  idOrden: number | undefined,
  habilitado = true,
): UseQueryResult<WipOrden, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_WIP, 'orden', idOrden],
    queryFn: () => obtenerWipOrden(idOrden as number),
    enabled: habilitado && idOrden !== undefined,
    placeholderData: keepPreviousData,
  });
}

/**
 * Existencias en poder del maquilero (`enviado − recibido − incompletas − faltantes saldados`), con
 * filtros opcionales.
 */
export function useExistenciaMaquilero(
  query: ExistenciaMaquileroQuery,
): UseQueryResult<ExistenciaMaquilero, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_WIP, 'existencia-maquilero', query],
    queryFn: () => obtenerExistenciaMaquilero(query),
    placeholderData: keepPreviousData,
  });
}
