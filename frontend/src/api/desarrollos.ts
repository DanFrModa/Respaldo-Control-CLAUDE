import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import { CLAVE_PROYECTOS } from './proyectos';
import type { paths } from './esquema.gen';

/**
 * Capa de datos de DESARROLLOS (F8-E2) — un modelo dentro de un proyecto. Mismo ESTÁNDAR que el
 * resto: cliente TIPADO del OpenAPI, normalización (`data`/`ErrorDeApi`) y mutaciones que invalidan
 * la cache de PROYECTOS (los desarrollos viven embebidos en el detalle del proyecto, y sus conteos
 * en la lista). CERO lógica de negocio (A1): el backend valida, autoriza y calcula el estado.
 */

// ── Alias de tipos del contrato ────────────────────────────────────────────────
/** Un desarrollo tal como lo devuelve el API (con su estado derivado). */
export type Desarrollo =
  paths['/api/desarrollos/{id}']['get']['responses']['200']['content']['application/json'];
/** Estado derivado del desarrollo (union de literales del contrato). */
export type EstadoDesarrollo = Desarrollo['estado'];
/** Cuerpo de alta de un desarrollo (`POST /api/proyectos/{idProyecto}/desarrollos`). */
export type DesarrolloCrear =
  paths['/api/proyectos/{idProyecto}/desarrollos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de apagar un desarrollo (`POST /api/desarrollos/{id}/apagar`). */
export type DesarrolloApagar =
  paths['/api/desarrollos/{id}/apagar']['post']['requestBody']['content']['application/json'];

/** Clave raíz de la cache de un desarrollo suelto (por id). */
export const CLAVE_DESARROLLO = ['desarrollo'] as const;

// ── Funciones del API ──────────────────────────────────────────────────────────

async function obtener(id: number): Promise<Desarrollo> {
  const { data, error } = await api.GET('/api/desarrollos/{id}', { params: { path: { id } } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Obtiene un desarrollo por id (para reusar el editor de precosto en la negociación). */
export function useDesarrollo(id: number | null): UseQueryResult<Desarrollo, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_DESARROLLO, id],
    queryFn: () => obtener(id as number),
    enabled: id !== null,
  });
}

async function crear(idProyecto: number, cuerpo: DesarrolloCrear): Promise<Desarrollo> {
  const { data, error } = await api.POST('/api/proyectos/{idProyecto}/desarrollos', {
    params: { path: { idProyecto } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function apagar(id: number, cuerpo: DesarrolloApagar): Promise<Desarrollo> {
  const { data, error } = await api.POST('/api/desarrollos/{id}/apagar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function reactivar(id: number): Promise<Desarrollo> {
  const { data, error } = await api.POST('/api/desarrollos/{id}/reactivar', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

// ── Hooks (toda mutación invalida la cache de proyectos) ──────────────────────

/** Argumentos de la mutación de alta de desarrollo. */
export interface ArgsCrearDesarrollo {
  idProyecto: number;
  cuerpo: DesarrolloCrear;
}

/** Crea un desarrollo e invalida los proyectos (lista + detalle del padre). */
export function useCrearDesarrollo(): UseMutationResult<
  Desarrollo,
  ErrorDeApi,
  ArgsCrearDesarrollo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idProyecto, cuerpo }: ArgsCrearDesarrollo) => crear(idProyecto, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS }),
  });
}

/** Argumentos de la mutación de apagar desarrollo. */
export interface ArgsApagarDesarrollo {
  id: number;
  cuerpo: DesarrolloApagar;
}

/** Apaga un desarrollo (borrado suave con motivo) e invalida los proyectos. */
export function useApagarDesarrollo(): UseMutationResult<
  Desarrollo,
  ErrorDeApi,
  ArgsApagarDesarrollo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsApagarDesarrollo) => apagar(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS }),
  });
}

/** Reactiva un desarrollo apagado e invalida los proyectos. */
export function useReactivarDesarrollo(): UseMutationResult<Desarrollo, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS }),
  });
}
