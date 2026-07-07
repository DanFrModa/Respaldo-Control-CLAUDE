import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import { CLAVE_ORDENES } from './ordenes';
import { CLAVE_PROYECTOS } from './proyectos';
import type { paths } from './esquema.gen';

/**
 * Capa de datos del ENGANCHE Desarrollo ↔ Producción (F8-E6, D13/R16) — la liga entre una orden de
 * producción y su expediente de Desarrollo (proyecto → precosto → lista/precio). Mismo ESTÁNDAR: el
 * cliente TIPADO del OpenAPI, normalización (`data`/`ErrorDeApi`) y mutaciones que invalidan la
 * cache. CERO lógica de negocio (A1): el backend valida coherencia, autoriza y oculta importes.
 */

// ── Alias de tipos del contrato ────────────────────────────────────────────────
/** Sugerencia de liga de una orden (candidato + precio propuesto editable). */
export type SugerenciaLiga =
  paths['/api/ordenes/{idOrden}/desarrollo/sugerencia']['get']['responses']['200']['content']['application/json'];
/** Desarrollo candidato a ligar (o null). */
export type CandidatoLiga = NonNullable<SugerenciaLiga['candidato']>;
/** Expediente 360 de una orden ligada. */
export type ExpedienteOrden =
  paths['/api/ordenes/{idOrden}/expediente']['get']['responses']['200']['content']['application/json'];
/** Confirmación de la liga creada. */
export type LigaOrden =
  paths['/api/ordenes/{idOrden}/desarrollo']['post']['responses']['201']['content']['application/json'];
/** Estado del desarrollo (union de literales del contrato). */
export type EstadoDesarrollo = LigaOrden['estadoDesarrollo'];
/** Tablero de conteos de desarrollos por estado. */
export type TableroDesarrollos =
  paths['/api/desarrollos/tablero']['get']['responses']['200']['content']['application/json'];
/** Filtros del tablero de desarrollos. */
export type TableroDesarrollosQuery = NonNullable<
  paths['/api/desarrollos/tablero']['get']['parameters']['query']
>;

// ── Claves de cache ────────────────────────────────────────────────────────────
/** Clave raíz de la cache del enganche desarrollo↔orden. */
export const CLAVE_LIGA = ['liga-orden'] as const;
/** Sugerencia de liga de UNA orden. */
function claveSugerencia(idOrden: number): readonly unknown[] {
  return [...CLAVE_LIGA, 'sugerencia', idOrden];
}
/** Expediente 360 de UNA orden. */
function claveExpediente(idOrden: number): readonly unknown[] {
  return [...CLAVE_LIGA, 'expediente', idOrden];
}
/** Tablero de desarrollos (depende de los filtros). */
function claveTablero(query: TableroDesarrollosQuery): readonly unknown[] {
  return [...CLAVE_LIGA, 'tablero', query];
}

// ── Lecturas ──────────────────────────────────────────────────────────────────
async function obtenerSugerencia(idOrden: number): Promise<SugerenciaLiga> {
  const { data, error } = await api.GET('/api/ordenes/{idOrden}/desarrollo/sugerencia', {
    params: { path: { idOrden } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function obtenerExpediente(idOrden: number): Promise<ExpedienteOrden> {
  const { data, error } = await api.GET('/api/ordenes/{idOrden}/expediente', {
    params: { path: { idOrden } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function obtenerTablero(query: TableroDesarrollosQuery): Promise<TableroDesarrollos> {
  const { data, error } = await api.GET('/api/desarrollos/tablero', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

// ── Escrituras ──────────────────────────────────────────────────────────────────
async function ligar(idOrden: number, idDesarrollo: number): Promise<LigaOrden> {
  const { data, error } = await api.POST('/api/ordenes/{idOrden}/desarrollo', {
    params: { path: { idOrden } },
    body: { idDesarrollo },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function quitar(idOrden: number): Promise<void> {
  const { error, response } = await api.DELETE('/api/ordenes/{idOrden}/desarrollo', {
    params: { path: { idOrden } },
  });
  if (!response.ok) throw new ErrorDeApi(error);
}

// ── Hooks de lectura ────────────────────────────────────────────────────────────

/** Sugerencia de liga (candidato + precio propuesto) de una orden. `enabled` cuando hay orden. */
export function useSugerenciaLiga(
  idOrden: number | undefined,
): UseQueryResult<SugerenciaLiga, ErrorDeApi> {
  return useQuery({
    queryKey: claveSugerencia(idOrden ?? 0),
    queryFn: () => obtenerSugerencia(idOrden as number),
    enabled: idOrden !== undefined,
  });
}

/** Expediente 360 de una orden ligada. `enabled` cuando la orden está ligada. */
export function useExpedienteOrden(
  idOrden: number | undefined,
  ligada: boolean,
): UseQueryResult<ExpedienteOrden, ErrorDeApi> {
  return useQuery({
    queryKey: claveExpediente(idOrden ?? 0),
    queryFn: () => obtenerExpediente(idOrden as number),
    enabled: idOrden !== undefined && ligada,
  });
}

/** Tablero de conteos de desarrollos por estado (agregado en servidor). */
export function useTableroDesarrollos(
  query: TableroDesarrollosQuery,
): UseQueryResult<TableroDesarrollos, ErrorDeApi> {
  return useQuery({
    queryKey: claveTablero(query),
    queryFn: () => obtenerTablero(query),
  });
}

// ── Hooks de escritura ────────────────────────────────────────────────────────────

/** Invalida todo lo que depende de la liga de una orden (sugerencia, expediente, orden, proyectos, tablero). */
function invalidarLiga(queryClient: ReturnType<typeof useQueryClient>, idOrden: number): void {
  void queryClient.invalidateQueries({ queryKey: claveSugerencia(idOrden) });
  void queryClient.invalidateQueries({ queryKey: claveExpediente(idOrden) });
  void queryClient.invalidateQueries({ queryKey: [...CLAVE_LIGA, 'tablero'] });
  void queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES });
  // El estado del desarrollo pasa a/deja 'ligado-produccion' (afecta la lista/detalle de proyectos).
  void queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS });
}

/** Argumentos de la mutación de ligar. */
export interface ArgsLigar {
  idOrden: number;
  idDesarrollo: number;
}

/** Liga una orden a un desarrollo e invalida la cache afectada. */
export function useLigarOrden(): UseMutationResult<LigaOrden, ErrorDeApi, ArgsLigar> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idOrden, idDesarrollo }: ArgsLigar) => ligar(idOrden, idDesarrollo),
    onSuccess: (_resultado, variables) => invalidarLiga(queryClient, variables.idOrden),
  });
}

/** Quita la liga de una orden e invalida la cache afectada. */
export function useQuitarLiga(): UseMutationResult<void, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: quitar,
    onSuccess: (_resultado, idOrden) => invalidarLiga(queryClient, idOrden),
  });
}
