import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type {
  OrdenesBuscar,
  OrdenesConsultaPagina,
  OrdenesConsultaQuery,
  OrdenesIncompletasPagina,
  OrdenesIncompletasQuery,
  TableroPedidosMes,
  TableroPedidosMesQuery,
} from './tipos';

/**
 * Capa de datos de las CONSULTAS/TABLEROS/BÚSQUEDA + IMPRESOS de Órdenes (F2-E4) — réplica del
 * ESTÁNDAR de `api/ordenes.ts`. Las LECTURAS van por el cliente TIPADO del OpenAPI; los IMPRESOS son
 * binarios `application/pdf` y NO pueden pasar por el cliente tipado (su cuerpo no es JSON), así que
 * usan `fetch` directo (la auth viaja por la cookie de sesión, `credentials: 'include'`). CERO
 * lógica de negocio: el backend valida, autoriza y deriva todo (semáforo, agregados, A1).
 */

/** Clave raíz de la cache de consultas de órdenes (separada de la cache de captura). */
export const CLAVE_ORDENES_CONSULTA = ['ordenes-consulta'] as const;

// ── Lecturas tipadas ──────────────────────────────────────────────────────────────

/** Pide una página de la CONSULTA ligera de órdenes (filtros + paginación en servidor). */
async function consultarOrdenes(query: OrdenesConsultaQuery): Promise<OrdenesConsultaPagina> {
  const { data, error } = await api.GET('/api/ordenes/consulta', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Pide una página de las órdenes INCOMPLETAS (con semáforo derivado). */
async function listarIncompletas(
  query: OrdenesIncompletasQuery,
): Promise<OrdenesIncompletasPagina> {
  const { data, error } = await api.GET('/api/ordenes/incompletas', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Pide el tablero "pedidos por mes" con sus filtros. */
async function obtenerTablero(query: TableroPedidosMesQuery): Promise<TableroPedidosMes> {
  const { data, error } = await api.GET('/api/ordenes/tablero/pedidos-por-mes', {
    params: { query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Buscador global: hits ligeros por folio/modelo/cliente/referencia. */
async function buscarOrdenes(q: string): Promise<OrdenesBuscar> {
  const { data, error } = await api.GET('/api/ordenes/buscar', { params: { query: { q } } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

// ── Hooks de lectura ────────────────────────────────────────────────────────────────

/** Consulta ligera de órdenes (mantiene la página previa al paginar/filtrar). */
export function useConsultaOrdenes(
  query: OrdenesConsultaQuery,
): UseQueryResult<OrdenesConsultaPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ORDENES_CONSULTA, 'consulta', query],
    queryFn: () => consultarOrdenes(query),
    placeholderData: keepPreviousData,
  });
}

/** Órdenes incompletas (con semáforo de antigüedad). */
export function useOrdenesIncompletas(
  query: OrdenesIncompletasQuery,
): UseQueryResult<OrdenesIncompletasPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ORDENES_CONSULTA, 'incompletas', query],
    queryFn: () => listarIncompletas(query),
    placeholderData: keepPreviousData,
  });
}

/** Tablero "pedidos por mes". */
export function useTableroPedidosMes(
  query: TableroPedidosMesQuery,
): UseQueryResult<TableroPedidosMes, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ORDENES_CONSULTA, 'tablero', query],
    queryFn: () => obtenerTablero(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Buscador global del layout. Se habilita solo con al menos 1 carácter (el backend exige `q`
 * no vacío). El llamador ya debe pasar el texto con debounce.
 */
export function useBuscarOrdenes(q: string): UseQueryResult<OrdenesBuscar, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ORDENES_CONSULTA, 'buscar', q],
    queryFn: () => buscarOrdenes(q),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });
}

// ── Impresos (PDF binario; fuera del cliente tipado) ──────────────────────────────────

/**
 * Abre el PDF de UNA orden en una pestaña nueva. La descarga es un GET binario; la auth va por la
 * cookie de sesión (mismo origen). No necesita `fetch`: el navegador lo resuelve con la cookie.
 */
export function imprimirOrden(id: number): void {
  window.open(`/api/ordenes/${id}/impreso`, '_blank', 'noopener');
}

/**
 * Descarga el PDF CONSOLIDADO de un lote de órdenes (`POST /api/ordenes/impresos`). Como es un
 * binario, se hace `fetch` con el body de ids, se toma el `blob` y se dispara la descarga con un
 * objectURL temporal. Lanza `ErrorDeApi` si el servidor responde error (intenta leer su JSON).
 */
export async function imprimirLoteOrdenes(ids: number[]): Promise<void> {
  const respuesta = await fetch('/api/ordenes/impresos', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!respuesta.ok) {
    // El backend responde el error como JSON `{ codigo, mensaje }`; si no, error genérico.
    const cuerpo: unknown = await respuesta.json().catch(() => null);
    throw new ErrorDeApi(cuerpo);
  }
  const blob = await respuesta.blob();
  const url = URL.createObjectURL(blob);
  try {
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `ordenes-${ids.length}.pdf`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
