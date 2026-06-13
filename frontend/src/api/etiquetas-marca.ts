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
  EtiquetaMarca,
  EtiquetaMarcaCrear,
  EtiquetaMarcaEditar,
  EtiquetasMarcaPagina,
  EtiquetasMarcaQuery,
} from './tipos';

/**
 * Capa de datos de Etiquetas de marca — replica del ESTANDAR de Almacenes
 * (`api/almacenes.ts`). Llama al cliente tipado, normaliza el resultado y expone
 * consultas/mutaciones; las mutaciones invalidan la cache de la lista. El backend
 * valida (incluido el rango 0–100 de `regalias`) y decide (A1).
 */

/** Clave raiz de la cache de etiquetas de marca en TanStack Query. */
export const CLAVE_ETIQUETAS_MARCA = ['etiquetas-marca'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaEtiquetasMarca(query: EtiquetasMarcaQuery): readonly unknown[] {
  return [...CLAVE_ETIQUETAS_MARCA, 'lista', query];
}

/** Pide una pagina del listado de etiquetas de marca (busqueda + orden + paginacion en servidor). */
async function listarEtiquetasMarca(query: EtiquetasMarcaQuery): Promise<EtiquetasMarcaPagina> {
  const { data, error } = await api.GET('/api/etiquetas-marca', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea una etiqueta de marca (`POST /api/etiquetas-marca`). */
async function crearEtiquetaMarca(cuerpo: EtiquetaMarcaCrear): Promise<EtiquetaMarca> {
  const { data, error } = await api.POST('/api/etiquetas-marca', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza una etiqueta de marca (`PATCH /api/etiquetas-marca/{id}`). */
async function actualizarEtiquetaMarca(
  id: number,
  cuerpo: EtiquetaMarcaEditar,
): Promise<EtiquetaMarca> {
  const { data, error } = await api.PATCH('/api/etiquetas-marca/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva una etiqueta de marca (borrado SUAVE, `DELETE /api/etiquetas-marca/{id}`). */
async function desactivarEtiquetaMarca(id: number): Promise<EtiquetaMarca> {
  const { data, error } = await api.DELETE('/api/etiquetas-marca/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva una etiqueta de marca desactivada (restaura el borrado suave) con `{ activo: true }`. */
async function reactivarEtiquetaMarca(id: number): Promise<EtiquetaMarca> {
  const { data, error } = await api.PATCH('/api/etiquetas-marca/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista etiquetas de marca con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useEtiquetasMarca(
  query: EtiquetasMarcaQuery,
): UseQueryResult<EtiquetasMarcaPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaEtiquetasMarca(query),
    queryFn: () => listarEtiquetasMarca(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea una etiqueta de marca e invalida la lista para reflejarla. */
export function useCrearEtiquetaMarca(): UseMutationResult<
  EtiquetaMarca,
  ErrorDeApi,
  EtiquetaMarcaCrear
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearEtiquetaMarca,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ETIQUETAS_MARCA }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarEtiquetaMarca {
  id: number;
  cuerpo: EtiquetaMarcaEditar;
}

/** Edita una etiqueta de marca e invalida la lista. */
export function useActualizarEtiquetaMarca(): UseMutationResult<
  EtiquetaMarca,
  ErrorDeApi,
  ArgsActualizarEtiquetaMarca
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarEtiquetaMarca) =>
      actualizarEtiquetaMarca(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ETIQUETAS_MARCA }),
  });
}

/** Desactiva una etiqueta de marca (borrado suave) e invalida la lista. */
export function useDesactivarEtiquetaMarca(): UseMutationResult<EtiquetaMarca, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarEtiquetaMarca,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ETIQUETAS_MARCA }),
  });
}

/** Reactiva una etiqueta de marca desactivada (restaura el borrado suave) e invalida la lista. */
export function useReactivarEtiquetaMarca(): UseMutationResult<EtiquetaMarca, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarEtiquetaMarca,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ETIQUETAS_MARCA }),
  });
}
