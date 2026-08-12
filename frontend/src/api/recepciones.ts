import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { paths } from './esquema.gen';
import { CLAVE_OC } from './ordenes-compra';
import type { Recepcion, RecepcionCrear, RecepcionReversar, RecepcionesLista } from './tipos';

/**
 * Capa de datos del módulo RECEPCIÓN de compras (F4-E3) — réplica del ESTÁNDAR de Órdenes de compra
 * (`api/ordenes-compra.ts`). Llama al cliente TIPADO del OpenAPI, normaliza (`data` / `ErrorDeApi`)
 * y expone consultas/mutaciones. CERO lógica de negocio: el backend valida la regla (b) (solo se
 * recibe contra una OC autorizada/recibida_parcial), convierte a unidad de consumo (R1), crea el
 * lote (D5) y mueve el kardex (A1). Las mutaciones invalidan la cache de recepciones Y la de OC (su
 * estatus cambia al recibir/reversar).
 */

/** Clave raíz de la cache de recepciones. */
export const CLAVE_RECEPCIONES = ['recepciones'] as const;

/** Clave de cache de las recepciones de UNA orden de compra. */
function claveRecepcionesDeOc(idOrdenCompra: number): readonly unknown[] {
  return [...CLAVE_RECEPCIONES, 'de-oc', idOrdenCompra];
}

/** Clave de cache del pendiente por recibir de los renglones de UNA orden de compra. */
function claveLineasPendientes(idOrdenCompra: number): readonly unknown[] {
  return [...CLAVE_RECEPCIONES, 'lineas-pendientes', idOrdenCompra];
}

/** Respuesta del endpoint de pendientes por renglón (forma del contrato). */
type LineasPendientesRespuesta =
  paths['/api/ordenes-compra/{idOrdenCompra}/lineas-pendientes']['get']['responses']['200']['content']['application/json'];

/** Pendiente por recibir de UN renglón de OC (lo pedido, lo recibido y lo que falta). */
export type LineaPendienteOc = LineasPendientesRespuesta['datos'][number];

// ── Lecturas ──────────────────────────────────────────────────────────────────

/** Lista las recepciones de una OC (orden cronológico). */
async function listarRecepcionesDeOc(idOrdenCompra: number): Promise<RecepcionesLista> {
  const { data, error } = await api.GET('/api/ordenes-compra/{idOrdenCompra}/recepciones', {
    params: { path: { idOrdenCompra } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Pendiente por recibir de cada renglón de una OC (lo calcula el dominio, A1). */
async function listarLineasPendientes(idOrdenCompra: number): Promise<LineaPendienteOc[]> {
  const { data, error } = await api.GET('/api/ordenes-compra/{idOrdenCompra}/lineas-pendientes', {
    params: { path: { idOrdenCompra } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

// ── Escrituras ──────────────────────────────────────────────────────────────────

/** Recibe material contra una OC (`POST /api/ordenes-compra/{idOrdenCompra}/recepciones`). */
async function recibir(idOrdenCompra: number, cuerpo: RecepcionCrear): Promise<Recepcion> {
  const { data, error } = await api.POST('/api/ordenes-compra/{idOrdenCompra}/recepciones', {
    params: { path: { idOrdenCompra } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reversa una recepción (`POST /api/recepciones-compra/{id}/reversar`, motivo obligatorio). */
async function reversar(id: number, cuerpo: RecepcionReversar): Promise<Recepcion> {
  const { data, error } = await api.POST('/api/recepciones-compra/{id}/reversar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

/** Recepciones de una OC (deshabilitada si no hay id). */
export function useRecepcionesDeOc(
  idOrdenCompra: number | undefined,
): UseQueryResult<RecepcionesLista, ErrorDeApi> {
  return useQuery({
    queryKey: claveRecepcionesDeOc(idOrdenCompra ?? 0),
    queryFn: () => listarRecepcionesDeOc(idOrdenCompra as number),
    enabled: idOrdenCompra !== undefined,
  });
}

/**
 * Pendiente por recibir de los renglones de una OC (deshabilitada si no hay id). Es lo que precarga
 * la captura de la recepción: lo que FALTA, nunca lo pedido completo.
 */
export function useLineasPendientesDeOc(
  idOrdenCompra: number | undefined,
): UseQueryResult<LineaPendienteOc[], ErrorDeApi> {
  return useQuery({
    queryKey: claveLineasPendientes(idOrdenCompra ?? 0),
    queryFn: () => listarLineasPendientes(idOrdenCompra as number),
    enabled: idOrdenCompra !== undefined,
  });
}

/** Invalida las recepciones de una OC + su pendiente + la cache de OC (su estatus cambió). */
function invalidar(queryClient: ReturnType<typeof useQueryClient>, idOrdenCompra: number): void {
  void queryClient.invalidateQueries({ queryKey: claveRecepcionesDeOc(idOrdenCompra) });
  void queryClient.invalidateQueries({ queryKey: claveLineasPendientes(idOrdenCompra) });
  void queryClient.invalidateQueries({ queryKey: CLAVE_OC });
}

/** Argumentos de la mutación de recibir. */
export interface ArgsRecibir {
  idOrdenCompra: number;
  cuerpo: RecepcionCrear;
}

/** Recibe material e invalida recepciones + OC. */
export function useRecibir(): UseMutationResult<Recepcion, ErrorDeApi, ArgsRecibir> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idOrdenCompra, cuerpo }: ArgsRecibir) => recibir(idOrdenCompra, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.idOrdenCompra),
  });
}

/** Argumentos de la mutación de reversar. */
export interface ArgsReversar {
  id: number;
  idOrdenCompra: number;
  cuerpo: RecepcionReversar;
}

/** Reversa una recepción e invalida recepciones + OC. */
export function useReversarRecepcion(): UseMutationResult<Recepcion, ErrorDeApi, ArgsReversar> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsReversar) => reversar(id, cuerpo),
    onSuccess: (_resultado, variables) => invalidar(queryClient, variables.idOrdenCompra),
  });
}
