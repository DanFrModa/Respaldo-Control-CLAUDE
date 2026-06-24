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
  EnvioCrear,
  Etapa,
  EtapaCancelar,
  EtapasOrden,
  PendientesOrden,
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

async function listarEtapas(idOrden: number): Promise<EtapasOrden> {
  const { data, error } = await api.GET('/api/produccion/ordenes/{id}/etapas', {
    params: { path: { id: idOrden } },
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

/** Historial de etapas (cortes/envíos, vivos y cancelados) de una orden. `habilitado` corta la query. */
export function useEtapasOrden(
  idOrden: number | undefined,
  habilitado = true,
): UseQueryResult<EtapasOrden, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ETAPAS, 'etapas', idOrden],
    queryFn: () => listarEtapas(idOrden as number),
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
