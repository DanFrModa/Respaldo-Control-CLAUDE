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
  CorteCrear,
  CorteSemanal,
  CorteSemanalQuery,
  EmpaqueCrear,
  EnvioCrear,
  Etapa,
  EtapaCancelar,
  EtapasOrden,
  PendientesOrden,
  SugerenciaCaptura,
} from './tipos';

/**
 * Capa de datos de las ETAPAS de producción (F3-E2: corte + envío a maquila) — mismo ESTÁNDAR que
 * Almacenes/Tipos de proceso: llama al cliente TIPADO del OpenAPI, normaliza (`data`/`ErrorDeApi`)
 * y expone hooks de TanStack Query. CERO lógica de negocio (A1): el backend valida (sobre-corte
 * libre, sobre-envío estricto, mapeo proceso→rol, concurrencia) y es la autoridad.
 */

/** Clave raíz de la caché de etapas/WIP. */
export const CLAVE_ETAPAS = ['produccion-etapas'] as const;

// ── Llamadas ─────────────────────────────────────────────────────────────────

async function crearCorte(cuerpo: CorteCrear): Promise<Etapa> {
  const { data, error } = await api.POST('/api/produccion/cortes', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crearEmpaque(cuerpo: EmpaqueCrear): Promise<Etapa> {
  const { data, error } = await api.POST('/api/produccion/empaques', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crearEnvio(cuerpo: EnvioCrear): Promise<Etapa> {
  const { data, error } = await api.POST('/api/produccion/envios', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function cancelarCorte(id: number, cuerpo: EtapaCancelar): Promise<Etapa> {
  const { data, error } = await api.POST('/api/produccion/cortes/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function cancelarEmpaque(id: number, cuerpo: EtapaCancelar): Promise<Etapa> {
  const { data, error } = await api.POST('/api/produccion/empaques/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function cancelarEnvio(id: number, cuerpo: EtapaCancelar): Promise<Etapa> {
  const { data, error } = await api.POST('/api/produccion/envios/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarPendientes(idOrden: number): Promise<PendientesOrden> {
  const { data, error } = await api.GET('/api/produccion/ordenes/{id}/pendientes', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Qué precargar en la captura (V1-E8i). `idTipoProceso` = base ENVÍO a ese proceso; sin él, base
 * CORTE. El CÁLCULO es del servidor (A1): aquí no se resta nada — «cuánto se puede enviar todavía»
 * es la regla (g) y vive en el dominio.
 */
async function obtenerSugerenciaCaptura(
  idOrden: number,
  idTipoProceso: number | undefined,
): Promise<SugerenciaCaptura> {
  const { data, error } = await api.GET('/api/produccion/ordenes/{id}/sugerencia-captura', {
    params: {
      path: { id: idOrden },
      query: idTipoProceso === undefined ? {} : { idTipoProceso },
    },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarEtapas(idOrden: number, incluirRecibos: boolean): Promise<EtapasOrden> {
  const { data, error } = await api.GET('/api/produccion/ordenes/{id}/etapas', {
    params: {
      path: { id: idOrden },
      query: { incluirRecibos: incluirRecibos ? 'true' : 'false' },
    },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function listarCorteSemanal(query: CorteSemanalQuery): Promise<CorteSemanal> {
  const { data, error } = await api.GET('/api/produccion/corte-semanal', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Pendientes derivados de una orden (por cortar / cortado por enviar). `habilitado` corta la query. */
export function usePendientesOrden(
  idOrden: number | undefined,
  habilitado = true,
): UseQueryResult<PendientesOrden, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ETAPAS, 'pendientes', idOrden],
    queryFn: () => listarPendientes(idOrden as number),
    enabled: habilitado && idOrden !== undefined,
    placeholderData: keepPreviousData,
  });
}

/**
 * Qué precargar en la captura de una etapa (V1-E8i): lo que falta por cortar, o lo cortado que
 * falta por enviar a un proceso. `habilitado` corta la query (p. ej. en el recibo, que no precarga).
 */
export function useSugerenciaCaptura(
  idOrden: number | undefined,
  idTipoProceso: number | undefined,
  habilitado = true,
): UseQueryResult<SugerenciaCaptura, ErrorDeApi> {
  return useQuery({
    // ⚠️ H9 — la BASE va en la clave (`'corte'`, no `null`). Con `?? null`, la sugerencia del CORTE y
    // la del «envío sin proceso elegido» compartían entrada de caché, y una query deshabilitada
    // SIGUE sirviendo el `data` guardado: el botón del envío se encendía con la cifra del corte. El
    // candado de verdad es el gate de la pantalla (`consultaSugerencia` en `AvanceProduccion`); esto
    // es la red de abajo, para que las dos preguntas no compartan entrada NUNCA.
    queryKey: [...CLAVE_ETAPAS, 'sugerencia-captura', idOrden, idTipoProceso ?? 'corte'],
    queryFn: () => obtenerSugerenciaCaptura(idOrden as number, idTipoProceso),
    enabled: habilitado && idOrden !== undefined,
  });
}

/**
 * Historial de etapas (cortes/envíos, vivos y cancelados) de una orden. `habilitado` corta la
 * query; `incluirRecibos` suma los recibos de maquila (Avance de producción, R2).
 */
export function useEtapasOrden(
  idOrden: number | undefined,
  habilitado = true,
  incluirRecibos = false,
): UseQueryResult<EtapasOrden, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ETAPAS, 'etapas', idOrden, incluirRecibos],
    queryFn: () => listarEtapas(idOrden as number, incluirRecibos),
    enabled: habilitado && idOrden !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Corte semanal por cortador (consulta agrupada). */
export function useCorteSemanal(
  query: CorteSemanalQuery,
): UseQueryResult<CorteSemanal, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ETAPAS, 'corte-semanal', query],
    queryFn: () => listarCorteSemanal(query),
    placeholderData: keepPreviousData,
  });
}

/** Registra un corte e invalida los pendientes y el corte semanal. */
export function useCrearCorte(): UseMutationResult<Etapa, ErrorDeApi, CorteCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearCorte,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS }),
  });
}

/**
 * Registra un EMPAQUE (0.114) e invalida los pendientes. El empaque es un servicio sobre la orden
 * —no toca inventario y su cantidad es propia—, pero para la caché es una etapa más de la orden.
 */
export function useCrearEmpaque(): UseMutationResult<Etapa, ErrorDeApi, EmpaqueCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearEmpaque,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS }),
  });
}

/** Registra un envío a maquila e invalida los pendientes. */
export function useCrearEnvio(): UseMutationResult<Etapa, ErrorDeApi, EnvioCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearEnvio,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS }),
  });
}

/** Argumentos de una cancelación de etapa. */
export interface ArgsCancelarEtapa {
  id: number;
  cuerpo: EtapaCancelar;
}

/** Cancela (suave) un corte e invalida los pendientes. */
export function useCancelarCorte(): UseMutationResult<Etapa, ErrorDeApi, ArgsCancelarEtapa> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarEtapa) => cancelarCorte(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS }),
  });
}

/** Cancela (suave) un empaque e invalida los pendientes (0.114). */
export function useCancelarEmpaque(): UseMutationResult<Etapa, ErrorDeApi, ArgsCancelarEtapa> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarEtapa) => cancelarEmpaque(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS }),
  });
}

/** Cancela (suave) un envío e invalida los pendientes. */
export function useCancelarEnvio(): UseMutationResult<Etapa, ErrorDeApi, ArgsCancelarEtapa> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarEtapa) => cancelarEnvio(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS }),
  });
}

/** Construye la URL de descarga de un PDF de envío (documento de envío o ficha de estampado). */
export function urlImpresoEnvio(idEnvio: number): string {
  return `/api/produccion/envios/${idEnvio}/impreso`;
}

/** URL de descarga de la ficha de estampado de un envío. */
export function urlFichaEstampado(idEnvio: number): string {
  return `/api/produccion/envios/${idEnvio}/ficha-estampado`;
}
