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
 * Capa de datos del PRECOSTO PERSISTIDO por desarrollo (F8-E3). Mismo ESTÁNDAR que el resto: cliente
 * TIPADO del OpenAPI, normalización (`data`/`ErrorDeApi`) y hooks de TanStack Query. CERO lógica de
 * negocio (A1): el backend valúa desde el BOM con los precios amarrados, agrupa por concepto, oculta
 * los importes y hace inmutables las versiones congeladas.
 *
 * Las mutaciones invalidan (a) la cache de PRECOSTOS del desarrollo (historial + editor) y (b) la de
 * PROYECTOS: al congelar la v1, el estado DERIVADO del desarrollo pasa a "cotizado" (se ve en el
 * detalle del proyecto).
 */

// ── Alias de tipos del contrato ────────────────────────────────────────────────
/** Un precosto completo con sus renglones. */
export type Precosto =
  paths['/api/precostos/{id}']['get']['responses']['200']['content']['application/json'];
/** Un renglón de precosto. */
export type PrecostoLinea = Precosto['lineas'][number];
/** Un resumen de versión (historial). */
export type PrecostoResumen =
  paths['/api/desarrollos/{idDesarrollo}/precostos']['get']['responses']['200']['content']['application/json'][number];
/** Cuerpo de alta de un renglón manual. */
export type LineaManualCrear =
  paths['/api/precostos/{id}/lineas']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de un renglón. */
export type LineaEditar =
  paths['/api/precostos/{id}/lineas/{idLinea}']['patch']['requestBody']['content']['application/json'];

/** Clave raíz de la cache de precostos. */
export const CLAVE_PRECOSTOS = ['precostos'] as const;

// ── Lecturas ───────────────────────────────────────────────────────────────────

async function obtenerHistorial(idDesarrollo: number): Promise<PrecostoResumen[]> {
  const { data, error } = await api.GET('/api/desarrollos/{idDesarrollo}/precostos', {
    params: { path: { idDesarrollo } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Historial de versiones de precosto de un desarrollo (más nuevo primero). */
export function usePrecostosDesarrollo(
  idDesarrollo: number | null,
): UseQueryResult<PrecostoResumen[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_PRECOSTOS, 'desarrollo', idDesarrollo],
    queryFn: () => obtenerHistorial(idDesarrollo as number),
    enabled: idDesarrollo !== null,
  });
}

async function obtenerPrecosto(id: number): Promise<Precosto> {
  const { data, error } = await api.GET('/api/precostos/{id}', { params: { path: { id } } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Un precosto completo (con renglones). */
export function usePrecosto(id: number | null): UseQueryResult<Precosto, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_PRECOSTOS, 'precosto', id],
    queryFn: () => obtenerPrecosto(id as number),
    enabled: id !== null,
  });
}

// ── Mutaciones ───────────────────────────────────────────────────────────────

async function generar(idDesarrollo: number): Promise<Precosto> {
  const { data, error } = await api.POST('/api/desarrollos/{idDesarrollo}/precostos', {
    params: { path: { idDesarrollo } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function recalcular(id: number): Promise<Precosto> {
  const { data, error } = await api.POST('/api/precostos/{id}/recalcular', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function agregarLinea(id: number, cuerpo: LineaManualCrear): Promise<Precosto> {
  const { data, error } = await api.POST('/api/precostos/{id}/lineas', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function editarLinea(id: number, idLinea: number, cuerpo: LineaEditar): Promise<Precosto> {
  const { data, error } = await api.PATCH('/api/precostos/{id}/lineas/{idLinea}', {
    params: { path: { id, idLinea } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function eliminarLinea(id: number, idLinea: number): Promise<Precosto> {
  const { data, error } = await api.DELETE('/api/precostos/{id}/lineas/{idLinea}', {
    params: { path: { id, idLinea } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function congelar(id: number): Promise<Precosto> {
  const { data, error } = await api.POST('/api/precostos/{id}/congelar', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Invalida precostos + proyectos (el estado derivado del desarrollo depende del precosto). */
function useInvalidar(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CLAVE_PRECOSTOS });
    void queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS });
  };
}

/** Genera un precosto (borrador vN+1) desde el BOM del desarrollo. */
export function useGenerarPrecosto(): UseMutationResult<Precosto, ErrorDeApi, number> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: generar, onSuccess: invalidar });
}

/** Recalcula los renglones BOM del precosto (respeta los manuales). */
export function useRecalcularPrecosto(): UseMutationResult<Precosto, ErrorDeApi, number> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: recalcular, onSuccess: invalidar });
}

/** Argumentos de alta de un renglón manual. */
export interface ArgsAgregarLinea {
  id: number;
  cuerpo: LineaManualCrear;
}

/** Agrega un renglón manual al precosto. */
export function useAgregarLinea(): UseMutationResult<Precosto, ErrorDeApi, ArgsAgregarLinea> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsAgregarLinea) => agregarLinea(id, cuerpo),
    onSuccess: invalidar,
  });
}

/** Argumentos de edición de un renglón. */
export interface ArgsEditarLinea {
  id: number;
  idLinea: number;
  cuerpo: LineaEditar;
}

/** Edita un renglón manual del precosto (incluida la maquila). */
export function useEditarLinea(): UseMutationResult<Precosto, ErrorDeApi, ArgsEditarLinea> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, idLinea, cuerpo }: ArgsEditarLinea) => editarLinea(id, idLinea, cuerpo),
    onSuccess: invalidar,
  });
}

/** Argumentos de eliminación de un renglón. */
export interface ArgsEliminarLinea {
  id: number;
  idLinea: number;
}

/** Elimina un renglón manual del precosto. */
export function useEliminarLinea(): UseMutationResult<Precosto, ErrorDeApi, ArgsEliminarLinea> {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, idLinea }: ArgsEliminarLinea) => eliminarLinea(id, idLinea),
    onSuccess: invalidar,
  });
}

/** Congela la versión (inmutable). */
export function useCongelarPrecosto(): UseMutationResult<Precosto, ErrorDeApi, number> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: congelar, onSuccess: invalidar });
}
