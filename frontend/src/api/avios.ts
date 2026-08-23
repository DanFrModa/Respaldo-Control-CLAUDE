import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { paths } from './esquema.gen';
import { api } from './cliente';
import { ErrorDeApi } from './errores';

/**
 * Capa de datos de Avíos (F1-E3, R1) — replica del ESTANDAR de Maquileros/Proveedores
 * (`api/maquileros.ts`). Cada funcion llama al cliente TIPADO del OpenAPI, normaliza
 * (`data` en exito, `ErrorDeApi` con el mensaje del backend en fallo) y se expone como
 * consulta o mutacion (las mutaciones invalidan la cache de la lista). CERO logica de
 * negocio: el backend valida, autoriza y decide (A1).
 *
 * Los `proveedores` de un avio (N:N CON datos propios — precio/condiciones, R1) viajan
 * INLINE en el cuerpo de crear/editar; el selector de proveedores usa `/api/proveedores`
 * (preexistente). El precio por proveedor se consulta en `/api/avios/{id}/proveedores`.
 *
 * NOTA (integración): los tipos de avio se derivan de `esquema.gen.ts`, que AÚN no incluye
 * los paths `/api/avios*` (se regenera en integración). Hasta entonces estos alias y los
 * hooks marcan deuda esperada de typecheck del frontend (NO se tapa con `any`); el cliente
 * `api` ya está tipado y las llamadas quedan correctas para cuando el contrato se regenere.
 */

// ── Alias de tipo del contrato (propios de avíos; NO en `api/tipos.ts`) ────────

/** Pagina de avios (`GET /api/avios`). */
export type AviosPagina =
  paths['/api/avios']['get']['responses']['200']['content']['application/json'];
/** Un avio tal como lo devuelve el API (con sus proveedores). */
export type Avio = AviosPagina['datos'][number];
/** Un proveedor de un avio (renglon del puente: precio/condiciones, R1). */
export type AvioProveedor = Avio['proveedores'][number];
/** Parametros de consulta del listado de avios (querystring; incluye `esGenerico`). */
export type AviosQuery = NonNullable<paths['/api/avios']['get']['parameters']['query']>;
/** Cuerpo de alta de avio (`POST /api/avios`). */
export type AvioCrear = paths['/api/avios']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de avio (`PATCH /api/avios/{id}`). */
export type AvioEditar =
  paths['/api/avios/{id}']['patch']['requestBody']['content']['application/json'];
/** Un renglon de proveedor en el cuerpo de crear/editar (idProveedor + precio/condiciones). */
export type AvioProveedorEntrada = NonNullable<AvioCrear['proveedores']>[number];

/** Clave raiz de la cache de avios en TanStack Query. */
export const CLAVE_AVIOS = ['avios'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaAvios(query: AviosQuery): readonly unknown[] {
  return [...CLAVE_AVIOS, 'lista', query];
}

/** Pide una pagina del listado de avios (busqueda + esGenerico + orden + paginacion en servidor). */
async function listarAvios(query: AviosQuery): Promise<AviosPagina> {
  const { data, error } = await api.GET('/api/avios', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un avio (`POST /api/avios`). */
async function crearAvio(cuerpo: AvioCrear): Promise<Avio> {
  const { data, error } = await api.POST('/api/avios', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un avio (`PATCH /api/avios/{id}`). */
async function actualizarAvio(id: number, cuerpo: AvioEditar): Promise<Avio> {
  const { data, error } = await api.PATCH('/api/avios/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un avio (borrado SUAVE, `DELETE /api/avios/{id}`). */
async function desactivarAvio(id: number): Promise<Avio> {
  const { data, error } = await api.DELETE('/api/avios/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Reactiva un avio desactivado (restaura el borrado suave): es un
 * `PATCH /api/avios/{id}` con `{ activo: true }`. El backend re-verifica que la `clave`
 * siga libre y audita la reactivacion.
 */
async function reactivarAvio(id: number): Promise<Avio> {
  const { data, error } = await api.PATCH('/api/avios/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Lee los proveedores (con precio y condiciones) que surten UN avío. */
async function listarProveedoresDeAvio(idAvio: number): Promise<AvioProveedor[]> {
  const { data, error } = await api.GET('/api/avios/{id}/proveedores', {
    params: { path: { id: idAvio } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Proveedores (con precio) de UN avío — las opciones del AMARRE de precio del renglón del BOM
 * (R17). Deshabilitada sin id o mientras el panel que la necesita esté cerrado, para no pegarle
 * al API una vez por renglón de la receta.
 */
export function useProveedoresDeAvio(
  idAvio: number | undefined,
  habilitado = true,
): UseQueryResult<AvioProveedor[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_AVIOS, 'proveedores', idAvio ?? 0],
    queryFn: () => listarProveedoresDeAvio(idAvio as number),
    enabled: habilitado && idAvio !== undefined,
  });
}

/** Lista avios con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useAvios(query: AviosQuery): UseQueryResult<AviosPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaAvios(query),
    queryFn: () => listarAvios(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un avio e invalida la lista para reflejarlo. */
export function useCrearAvio(): UseMutationResult<Avio, ErrorDeApi, AvioCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearAvio,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_AVIOS }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarAvio {
  id: number;
  cuerpo: AvioEditar;
}

/** Edita un avio e invalida la lista. */
export function useActualizarAvio(): UseMutationResult<Avio, ErrorDeApi, ArgsActualizarAvio> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarAvio) => actualizarAvio(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_AVIOS }),
  });
}

/** Desactiva un avio (borrado suave) e invalida la lista. */
export function useDesactivarAvio(): UseMutationResult<Avio, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarAvio,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_AVIOS }),
  });
}

/** Reactiva un avio desactivado (restaura el borrado suave) e invalida la lista. */
export function useReactivarAvio(): UseMutationResult<Avio, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarAvio,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_AVIOS }),
  });
}
