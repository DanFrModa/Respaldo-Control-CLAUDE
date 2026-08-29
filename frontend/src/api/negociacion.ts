import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import { CLAVE_LISTAS, type ListaDetalle } from './listas-precios';
import { CLAVE_PRECOSTOS } from './precostos';
import { CLAVE_PROYECTOS } from './proyectos';
import type { paths } from './esquema.gen';

/**
 * Capa de datos de la NEGOCIACIÓN por versiones (F8-E5). Mismo ESTÁNDAR: cliente TIPADO del OpenAPI,
 * normalización (`data`/`ErrorDeApi`) y hooks de TanStack Query. CERO lógica de negocio (A1): el
 * backend re-apunta el renglón a la versión nueva, recalcula el precio, resetea el aprobado, registra
 * el evento inmutable, aplica el guard `esCierre` y oculta importes.
 *
 * Las mutaciones (ronda/acuerdo/estado) invalidan (a) la cache de LISTAS (listado + detalle), (b) la de
 * EVENTOS del renglón, (c) la de PRECOSTOS (la ronda re-apunta a otra versión) y (d) la de PROYECTOS
 * (el estado derivado del desarrollo depende de la lista).
 */

// ── Alias de tipos del contrato ────────────────────────────────────────────────
/** Un evento de negociación de un renglón. */
export type NegociacionEvento =
  paths['/api/listas-precios/lineas/{idLinea}/eventos']['get']['responses']['200']['content']['application/json']['datos'][number];
/** Cuerpo de una ronda. */
export type RondaCuerpo =
  paths['/api/listas-precios/lineas/{idLinea}/rondas']['post']['requestBody']['content']['application/json'];
/** Cuerpo de un acuerdo. */
export type AcuerdoCuerpo =
  paths['/api/listas-precios/lineas/{idLinea}/acuerdos']['post']['requestBody']['content']['application/json'];
/** Cuerpo del cambio de estado. */
export type CambiarEstadoCuerpo =
  paths['/api/listas-precios/{id}/estado']['patch']['requestBody']['content']['application/json'];
/** Resultado de la calculadora de negociación (costo/neto/margen). */
export type SimulacionNegociacion =
  paths['/api/listas-precios/lineas/{idLinea}/simular']['get']['responses']['200']['content']['application/json'];
/** Cuerpo del negociador en vivo: el renglón de costos + el precio de la mesa (§Post-F9.138). */
export type MesaCuerpo =
  paths['/api/listas-precios/lineas/{idLinea}/simular-mesa']['post']['requestBody']['content']['application/json'];
/** Un renglón de la mesa: etiqueta LIBRE + importe LIBRE (§Post-F9.139: no es una referencia a nada). */
export type RenglonMesa = MesaCuerpo['renglones'][number];
/** Resultado del negociador en vivo: las dos direcciones (margen del precio + precio del costo). */
export type SimulacionMesa =
  paths['/api/listas-precios/lineas/{idLinea}/simular-mesa']['post']['responses']['200']['content']['application/json'];

/** Clave raíz de la cache de eventos de negociación. */
export const CLAVE_EVENTOS = ['negociacion-eventos'] as const;

function claveEventos(idLinea: number): readonly unknown[] {
  return [...CLAVE_EVENTOS, idLinea];
}

/** Clave raíz de la cache de la calculadora de negociación (§4.8). */
export const CLAVE_SIMULACION = ['negociacion-simular'] as const;

/** Clave raíz de la cache del NEGOCIADOR EN VIVO de la mesa (§Post-F9.138). */
export const CLAVE_MESA = ['negociacion-mesa'] as const;

// ── Funciones del API ──────────────────────────────────────────────────────────

async function listarEventos(idLinea: number): Promise<NegociacionEvento[]> {
  const { data, error } = await api.GET('/api/listas-precios/lineas/{idLinea}/eventos', {
    params: { path: { idLinea } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

async function registrarRonda(idLinea: number, cuerpo: RondaCuerpo): Promise<ListaDetalle> {
  const { data, error } = await api.POST('/api/listas-precios/lineas/{idLinea}/rondas', {
    params: { path: { idLinea } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function registrarAcuerdo(idLinea: number, cuerpo: AcuerdoCuerpo): Promise<ListaDetalle> {
  const { data, error } = await api.POST('/api/listas-precios/lineas/{idLinea}/acuerdos', {
    params: { path: { idLinea } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function cambiarEstado(id: number, cuerpo: CambiarEstadoCuerpo): Promise<ListaDetalle> {
  const { data, error } = await api.PATCH('/api/listas-precios/{id}/estado', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function simular(
  idLinea: number,
  precioObjetivo: number,
  idPrecosto: number | undefined,
): Promise<SimulacionNegociacion> {
  const { data, error } = await api.GET('/api/listas-precios/lineas/{idLinea}/simular', {
    params: {
      path: { idLinea },
      query: { precioObjetivo, ...(idPrecosto === undefined ? {} : { idPrecosto }) },
    },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/**
 * ⭐⭐ El NEGOCIADOR EN VIVO (§Post-F9.138). Es un **POST de sólo lectura**: el renglón de costos es
 * de largo variable y no cabe en un querystring, pero el servidor no escribe NADA (§Post-F9.139) —
 * por eso se consume como `useQuery` y no como mutación, y por eso no invalida ninguna cache.
 */
async function simularMesa(idLinea: number, cuerpo: MesaCuerpo): Promise<SimulacionMesa> {
  const { data, error } = await api.POST('/api/listas-precios/lineas/{idLinea}/simular-mesa', {
    params: { path: { idLinea } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Historial de eventos de negociación de un renglón; deshabilitada si no hay renglón. */
export function useEventosLinea(
  idLinea: number | null,
): UseQueryResult<NegociacionEvento[], ErrorDeApi> {
  return useQuery({
    queryKey: claveEventos(idLinea ?? 0),
    queryFn: () => listarEventos(idLinea as number),
    enabled: idLinea !== null,
  });
}

/**
 * Calculadora de negociación (§4.8): simula el margen de un `precioObjetivo` sobre un renglón (opcional
 * `idPrecosto` para previsualizar el costo de una versión). El llamador pasa el objetivo YA DEBOUNCED y
 * `habilitado` (típicamente `objetivo > 0`), para no golpear el backend en cada tecla. Toda la fórmula
 * vive en el dominio (A1); aquí sólo se consume.
 */
export function useSimularNegociacion(
  idLinea: number | null,
  precioObjetivo: number,
  opciones: { idPrecosto?: number; habilitado?: boolean } = {},
): UseQueryResult<SimulacionNegociacion, ErrorDeApi> {
  const { idPrecosto, habilitado = true } = opciones;
  return useQuery({
    queryKey: [...CLAVE_SIMULACION, idLinea ?? 0, precioObjetivo, idPrecosto ?? null],
    queryFn: () => simular(idLinea as number, precioObjetivo, idPrecosto),
    enabled: idLinea !== null && habilitado && precioObjetivo > 0,
  });
}

/**
 * ⭐⭐ **El NEGOCIADOR EN VIVO de la mesa** (§Post-F9.138): manda el renglón COMPLETO de costos tal
 * como está en pantalla —movidos a mano, con estimados que no existen en ningún catálogo— más el
 * precio que se discute, y recibe **las dos direcciones**: el margen de ese precio y el precio que
 * ese costo pediría. **CERO aritmética aquí** (A1): la fórmula vive en el dominio.
 *
 * El llamador pasa el cuerpo YA DEBOUNCED. La clave de cache incluye el renglón serializado, así que
 * mover un importe pide de nuevo y el margen se mueve solo; `placeholderData` conserva el resultado
 * anterior mientras llega el nuevo, para que el número **no parpadee** con cada tecla (en la mesa,
 * un número que desaparece es peor que uno de hace 300 ms).
 */
export function useSimularMesa(
  idLinea: number | null,
  cuerpo: MesaCuerpo,
  opciones: { habilitado?: boolean } = {},
): UseQueryResult<SimulacionMesa, ErrorDeApi> {
  const { habilitado = true } = opciones;
  return useQuery({
    queryKey: [...CLAVE_MESA, idLinea ?? 0, JSON.stringify(cuerpo)],
    queryFn: () => simularMesa(idLinea as number, cuerpo),
    enabled: idLinea !== null && habilitado && cuerpo.renglones.length > 0,
    placeholderData: (anterior) => anterior,
  });
}

/** Invalida listas + eventos + precostos + proyectos (todo lo que una ronda/acuerdo/estado mueve). */
function useInvalidar(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CLAVE_LISTAS });
    void queryClient.invalidateQueries({ queryKey: CLAVE_EVENTOS });
    void queryClient.invalidateQueries({ queryKey: CLAVE_PRECOSTOS });
    void queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS });
  };
}

/** Argumentos de una ronda. */
export interface ArgsRonda {
  idLinea: number;
  cuerpo: RondaCuerpo;
}

/** Registra una ronda de negociación (re-costeo). */
export function useRegistrarRonda(): UseMutationResult<ListaDetalle, ErrorDeApi, ArgsRonda> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ idLinea, cuerpo }: ArgsRonda) => registrarRonda(idLinea, cuerpo),
    onSuccess: invalidar,
  });
}

/** Argumentos de un acuerdo. */
export interface ArgsAcuerdo {
  idLinea: number;
  cuerpo: AcuerdoCuerpo;
}

/** Registra un acuerdo sin re-costeo. */
export function useRegistrarAcuerdo(): UseMutationResult<ListaDetalle, ErrorDeApi, ArgsAcuerdo> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ idLinea, cuerpo }: ArgsAcuerdo) => registrarAcuerdo(idLinea, cuerpo),
    onSuccess: invalidar,
  });
}

/** Argumentos del cambio de estado. */
export interface ArgsCambiarEstado {
  id: number;
  cuerpo: CambiarEstadoCuerpo;
}

/** Cambia el estado de una lista (incluida la reapertura). */
export function useCambiarEstadoLista(): UseMutationResult<
  ListaDetalle,
  ErrorDeApi,
  ArgsCambiarEstado
> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCambiarEstado) => cambiarEstado(id, cuerpo),
    onSuccess: invalidar,
  });
}
