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
import type {
  AjustarRutaCuerpo,
  AlertasRcConteo,
  BandejaRcPagina,
  BandejaRcQuery,
  ConcentradoRcPagina,
  ConcentradoRcQuery,
  ProgramarRcCuerpo,
  RutaOrden,
} from './tipos';

/**
 * Capa de datos del MOTOR de la Ruta Crítica por orden (F5-E5): programación de la ruta de una
 * orden, bandeja de "mis tareas", captura de cumplimiento/checklist y conteo de alertas. Mismo
 * ESTÁNDAR que `ruta-critica.ts`: invoca el cliente tipado del OpenAPI, normaliza (`data`/
 * `ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio (A1): el semáforo, el
 * estado de cada proceso, los días de atraso y el conteo los DERIVA el backend; aquí solo se
 * disparan las mutaciones y se invalida la caché.
 */

/** Clave raíz de la caché del motor RC por orden. */
export const CLAVE_RC_RUTA = ['ruta-critica', 'ruta'] as const;
/** Clave raíz de la caché de la bandeja de tareas. */
export const CLAVE_RC_BANDEJA = ['ruta-critica', 'bandeja'] as const;
/** Clave raíz de la caché del concentrado "planeado vs real". */
export const CLAVE_RC_CONCENTRADO = ['ruta-critica', 'concentrado'] as const;
/** Clave raíz de la caché del conteo de alertas (badge del header). */
export const CLAVE_RC_ALERTAS = ['ruta-critica', 'alertas'] as const;

/** Claves a invalidar tras una captura: la ruta de la orden, la bandeja y las alertas. */
function clavesACapturar(): readonly unknown[][] {
  return [[...CLAVE_RC_RUTA], [...CLAVE_RC_BANDEJA], [...CLAVE_RC_ALERTAS]];
}

// ── Ruta viva por orden (GET / programar / ajustar) ──────────────────────────

async function obtenerRuta(idOrden: number): Promise<RutaOrden> {
  const { data, error } = await api.GET('/api/ruta-critica/ordenes/{id}/ruta', {
    params: { path: { id: idOrden } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/**
 * Lee la ruta viva de una orden. `pollearMientrasRecalcula` activa un sondeo mientras el CPM no
 * termina (`estadoRecalculo === 'recalculando'`): cuando pasa a 'calculado'/'sin-ruta' se detiene
 * solo. `habilitado` permite no consultar (p. ej. sin orden seleccionada).
 */
export function useRutaOrden(
  idOrden: number | undefined,
  opciones: { habilitado?: boolean; pollearMientrasRecalcula?: boolean } = {},
): UseQueryResult<RutaOrden, ErrorDeApi> {
  const { habilitado = true, pollearMientrasRecalcula = false } = opciones;
  return useQuery({
    queryKey: [...CLAVE_RC_RUTA, idOrden],
    queryFn: () => obtenerRuta(idOrden as number),
    enabled: habilitado && idOrden !== undefined,
    refetchInterval: pollearMientrasRecalcula
      ? (consulta) => (consulta.state.data?.estadoRecalculo === 'recalculando' ? 2000 : false)
      : false,
  });
}

/** Argumentos de programar la RC de una orden. */
export interface ArgsProgramarRc {
  idOrden: number;
  cuerpo: ProgramarRcCuerpo;
}

/** Programa (genera/re-genera) la RC de una orden e invalida su ruta + bandeja + alertas. */
export function useProgramarRc(): UseMutationResult<RutaOrden, ErrorDeApi, ArgsProgramarRc> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, cuerpo }: ArgsProgramarRc) => {
      const { data, error } = await api.POST('/api/ruta-critica/ordenes/{id}/programar', {
        params: { path: { id: idOrden } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: [...CLAVE_RC_RUTA, vars.idOrden] });
      void qc.invalidateQueries({ queryKey: CLAVE_RC_BANDEJA });
      void qc.invalidateQueries({ queryKey: CLAVE_RC_ALERTAS });
    },
  });
}

/** Argumentos de ajustar la ruta de una orden. */
export interface ArgsAjustarRuta {
  idOrden: number;
  cuerpo: AjustarRutaCuerpo;
}

/** Ajusta la ruta de UNA orden (agregar/quitar procesos, dependencias; NO toca la plantilla, D10). */
export function useAjustarRuta(): UseMutationResult<RutaOrden, ErrorDeApi, ArgsAjustarRuta> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, cuerpo }: ArgsAjustarRuta) => {
      const { data, error } = await api.PATCH('/api/ruta-critica/ordenes/{id}/ruta', {
        params: { path: { id: idOrden } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: [...CLAVE_RC_RUTA, vars.idOrden] });
      void qc.invalidateQueries({ queryKey: CLAVE_RC_BANDEJA });
      void qc.invalidateQueries({ queryKey: CLAVE_RC_ALERTAS });
    },
  });
}

// ── Bandeja de tareas + conteo de alertas ────────────────────────────────────

async function listarBandeja(query: BandejaRcQuery): Promise<BandejaRcPagina> {
  const { data, error } = await api.GET('/api/ruta-critica/bandeja', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Lista MIS tareas activas (ya ordenadas por urgencia por el backend), sin parpadeo al paginar. */
export function useBandejaRc(query: BandejaRcQuery): UseQueryResult<BandejaRcPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_RC_BANDEJA, query],
    queryFn: () => listarBandeja(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Conteo de alertas (atrasados / en riesgo) para el badge del header. `habilitado` lo apaga para
 * usuarios sin `rc.ruta-ver`. Se refresca solo cada `intervaloMs` (por defecto 60 s).
 */
export function useConteoAlertasRc(
  opciones: { habilitado?: boolean; intervaloMs?: number } = {},
): UseQueryResult<AlertasRcConteo, ErrorDeApi> {
  const { habilitado = true, intervaloMs = 60_000 } = opciones;
  return useQuery({
    queryKey: [...CLAVE_RC_ALERTAS, 'conteo'],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/ruta-critica/alertas/conteo');
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    enabled: habilitado,
    refetchInterval: intervaloMs,
  });
}

// ── Concentrado "planeado vs real" (tablero gerencial + export Excel) ─────────

async function listarConcentrado(query: ConcentradoRcQuery): Promise<ConcentradoRcPagina> {
  const { data, error } = await api.GET('/api/ruta-critica/concentrado', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/**
 * Concentrado "planeado vs real" de la RC (todas las órdenes con RC viva × sus procesos, con
 * semáforo/atraso), paginado/filtrable/ordenable por el backend (la agregación es del servidor, A1).
 * Sin parpadeo al paginar/filtrar.
 */
export function useConcentradoRc(
  query: ConcentradoRcQuery,
): UseQueryResult<ConcentradoRcPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_RC_CONCENTRADO, query],
    queryFn: () => listarConcentrado(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * URL del export a Excel del concentrado (`GET /api/ruta-critica/concentrado/excel`), con los MISMOS
 * filtros del tablero en la querystring. Binario server-side (igual que los impresos PDF): la auth
 * viaja por la cookie de sesión (mismo origen), así que basta abrirla con `window.open`.
 */
export function urlConcentradoExcel(query: ConcentradoRcQuery): string {
  const qs = new URLSearchParams();
  for (const [clave, valor] of Object.entries(query)) {
    if (valor !== undefined && valor !== '') {
      qs.set(clave, String(valor));
    }
  }
  const cadena = qs.toString();
  return `/api/ruta-critica/concentrado/excel${cadena === '' ? '' : `?${cadena}`}`;
}

// ── Captura de cumplimiento + checklist ──────────────────────────────────────

/** Argumentos de capturar/revertir el cumplimiento de un proceso. */
export interface ArgsCumplimiento {
  /** Id del renglón de ruta (RutaOrden.id = Tarea.idRutaOrden). */
  idRuta: number;
  /** Marcar (true) o revertir (false) el cumplimiento. */
  cumplido: boolean;
  /** Fecha real (YYYY-MM-DD); por defecto el backend usa hoy. Ignorada al revertir. */
  fechaReal?: string;
}

/** Captura (o revierte) el cumplimiento de un proceso e invalida ruta + bandeja + alertas. */
export function useCapturarCumplimientoRc(): UseMutationResult<
  RutaOrden,
  ErrorDeApi,
  ArgsCumplimiento
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idRuta, cumplido, fechaReal }: ArgsCumplimiento) => {
      const { data, error } = await api.PUT('/api/ruta-critica/procesos/{idRuta}/cumplimiento', {
        params: { path: { idRuta } },
        body: { cumplido, ...(fechaReal !== undefined ? { fechaReal } : {}) },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => {
      for (const clave of clavesACapturar()) {
        void qc.invalidateQueries({ queryKey: clave });
      }
    },
  });
}

/** Argumentos de marcar/desmarcar un ítem de checklist. */
export interface ArgsChecklist {
  /** Id del ítem de checklist de la ruta viva. */
  idItem: number;
  /** Nuevo valor del ítem. */
  hecho: boolean;
}

/** Marca o desmarca un ítem de checklist de un proceso e invalida ruta + bandeja + alertas. */
export function useMarcarChecklistRc(): UseMutationResult<RutaOrden, ErrorDeApi, ArgsChecklist> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idItem, hecho }: ArgsChecklist) => {
      const { data, error } = await api.PUT('/api/ruta-critica/checklist/{idItem}', {
        params: { path: { idItem } },
        body: { hecho },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => {
      for (const clave of clavesACapturar()) {
        void qc.invalidateQueries({ queryKey: clave });
      }
    },
  });
}

// ── Impreso del plan de la RC por orden (PDF binario) ────────────────────────

/**
 * URL del PDF "Plan de la RC por orden" (`GET /api/ruta-critica/ordenes/{id}/plan-impreso`). El
 * impreso es SERVER-SIDE (igual que el resto de impresos del proyecto, p. ej. el recibo de maquila o
 * la orden de compra): la auth viaja por la cookie de sesión (mismo origen), así que basta abrirla
 * con `window.open`. No entra al cliente tipado porque la respuesta es binaria (no JSON).
 */
export function urlPlanImpresoRc(idOrden: number): string {
  return `/api/ruta-critica/ordenes/${idOrden}/plan-impreso`;
}
