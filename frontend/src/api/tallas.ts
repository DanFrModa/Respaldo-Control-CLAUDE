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
  Curva,
  CurvaCrear,
  CurvaEditar,
  CurvasPagina,
  CurvasQuery,
  Talla,
  TallaCrear,
  TallaEditar,
  TallasPagina,
  TallasQuery,
} from './tipos';

/**
 * Capa de datos de Tallas y Curvas (F1-E2, PIEZA B — D4) — replica del ESTANDAR de
 * Cortadores/Proveedores. Cada funcion llama al cliente TIPADO del OpenAPI, normaliza
 * (`data` en exito, `ErrorDeApi` con el mensaje del backend en fallo) y se expone como
 * consulta o mutacion; las mutaciones invalidan la cache. CERO logica de negocio: el
 * backend valida, autoriza y decide (A1).
 *
 * Las curvas son maestro-detalle ORDENADO: el body de crear/editar lleva `items`
 * (ids de talla en orden); la respuesta trae los items con su etiqueta y posicion.
 */

// ════════════════════════════════════════════════════════════════════════════════
//  Tallas
// ════════════════════════════════════════════════════════════════════════════════

/** Clave raiz de la cache de tallas en TanStack Query. */
export const CLAVE_TALLAS = ['tallas'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaTallas(query: TallasQuery): readonly unknown[] {
  return [...CLAVE_TALLAS, 'lista', query];
}

/** Pide una pagina del listado de tallas (busqueda + orden + paginacion en servidor). */
async function listarTallas(query: TallasQuery): Promise<TallasPagina> {
  const { data, error } = await api.GET('/api/tallas', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea una talla (`POST /api/tallas`). */
async function crearTalla(cuerpo: TallaCrear): Promise<Talla> {
  const { data, error } = await api.POST('/api/tallas', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza una talla (`PATCH /api/tallas/{id}`). */
async function actualizarTalla(id: number, cuerpo: TallaEditar): Promise<Talla> {
  const { data, error } = await api.PATCH('/api/tallas/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva una talla (borrado SUAVE, `DELETE /api/tallas/{id}`). */
async function desactivarTalla(id: number): Promise<Talla> {
  const { data, error } = await api.DELETE('/api/tallas/{id}', { params: { path: { id } } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva una talla desactivada (restaura el borrado suave) con `{ activo: true }`. */
async function reactivarTalla(id: number): Promise<Talla> {
  const { data, error } = await api.PATCH('/api/tallas/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Lista tallas con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useTallas(query: TallasQuery): UseQueryResult<TallasPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaTallas(query),
    queryFn: () => listarTallas(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Lista TODAS las tallas activas para el selector del armador de curva (sin paginar:
 * pide un tope alto y ordenadas por `orden`). El armador solo puede usar tallas activas.
 */
export function useTallasActivas(): UseQueryResult<TallasPagina, ErrorDeApi> {
  const query: TallasQuery = { porPagina: 100, ordenarPor: 'orden', direccion: 'asc' };
  return useQuery({
    queryKey: [...CLAVE_TALLAS, 'activas'],
    queryFn: () => listarTallas(query),
  });
}

/** Crea una talla e invalida la lista para reflejarla. */
export function useCrearTalla(): UseMutationResult<Talla, ErrorDeApi, TallaCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearTalla,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TALLAS }),
  });
}

/** Argumentos de la mutacion de edicion de talla. */
export interface ArgsActualizarTalla {
  id: number;
  cuerpo: TallaEditar;
}

/** Edita una talla e invalida la lista. */
export function useActualizarTalla(): UseMutationResult<Talla, ErrorDeApi, ArgsActualizarTalla> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarTalla) => actualizarTalla(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TALLAS }),
  });
}

/** Desactiva una talla (borrado suave) e invalida la lista. */
export function useDesactivarTalla(): UseMutationResult<Talla, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarTalla,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TALLAS }),
  });
}

/** Reactiva una talla desactivada e invalida la lista. */
export function useReactivarTalla(): UseMutationResult<Talla, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarTalla,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TALLAS }),
  });
}

// ════════════════════════════════════════════════════════════════════════════════
//  Curvas (maestro-detalle ordenado)
// ════════════════════════════════════════════════════════════════════════════════

/** Clave raiz de la cache de curvas en TanStack Query. */
export const CLAVE_CURVAS = ['curvas-talla'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaCurvas(query: CurvasQuery): readonly unknown[] {
  return [...CLAVE_CURVAS, 'lista', query];
}

/** Pide una pagina del listado de curvas (cada una con sus items ordenados). */
async function listarCurvas(query: CurvasQuery): Promise<CurvasPagina> {
  const { data, error } = await api.GET('/api/curvas-talla', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea una curva con sus items ordenados (`POST /api/curvas-talla`). */
async function crearCurva(cuerpo: CurvaCrear): Promise<Curva> {
  const { data, error } = await api.POST('/api/curvas-talla', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza una curva (`PATCH /api/curvas-talla/{id}`). */
async function actualizarCurva(id: number, cuerpo: CurvaEditar): Promise<Curva> {
  const { data, error } = await api.PATCH('/api/curvas-talla/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva una curva (borrado SUAVE, `DELETE /api/curvas-talla/{id}`). */
async function desactivarCurva(id: number): Promise<Curva> {
  const { data, error } = await api.DELETE('/api/curvas-talla/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva una curva desactivada (restaura el borrado suave) con `{ activo: true }`. */
async function reactivarCurva(id: number): Promise<Curva> {
  const { data, error } = await api.PATCH('/api/curvas-talla/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Lista curvas con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useCurvas(query: CurvasQuery): UseQueryResult<CurvasPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaCurvas(query),
    queryFn: () => listarCurvas(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea una curva e invalida la lista para reflejarla. */
export function useCrearCurva(): UseMutationResult<Curva, ErrorDeApi, CurvaCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearCurva,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CURVAS }),
  });
}

/** Argumentos de la mutacion de edicion de curva. */
export interface ArgsActualizarCurva {
  id: number;
  cuerpo: CurvaEditar;
}

/** Edita una curva e invalida la lista. */
export function useActualizarCurva(): UseMutationResult<Curva, ErrorDeApi, ArgsActualizarCurva> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarCurva) => actualizarCurva(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CURVAS }),
  });
}

/**
 * Desactiva una curva e invalida AMBAS listas: la de curvas y la de tallas (al
 * desactivar la curva, sus tallas quedan liberadas y podrian volverse desactivables).
 */
export function useDesactivarCurva(): UseMutationResult<Curva, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarCurva,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_CURVAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_TALLAS });
    },
  });
}

/** Reactiva una curva desactivada e invalida la lista de curvas. */
export function useReactivarCurva(): UseMutationResult<Curva, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarCurva,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CURVAS }),
  });
}
