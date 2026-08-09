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
 * Capa de datos de Telas (F1-E3, telas unificadas) — replica del ESTANDAR de Maquileros
 * (`api/maquileros.ts`). Cada funcion llama al cliente TIPADO del OpenAPI, normaliza
 * (`data` en exito, `ErrorDeApi` con el mensaje del backend en fallo) y se expone como
 * consulta o mutacion (las mutaciones invalidan la cache de la lista). CERO logica de
 * negocio: el backend valida, autoriza y decide (A1). Los `colores` (grid con precio, N:N
 * a Color) viajan INLINE en el cuerpo de crear/editar.
 *
 * NOTA (integracion F1-E3): los endpoints `/api/telas*` aun NO existen en `esquema.gen.ts`
 * (se regenera del OpenAPI en la fase de integracion). Hasta entonces, los alias de tipo de
 * abajo y las llamadas `api.GET('/api/telas'...)` son DEUDA ESPERADA que cierra la
 * integracion al regenerar el cliente; no se tapa con `any` (regla de la tarea).
 */

// ── Alias de tipos del contrato (locales a Telas; NO en api/tipos.ts compartido) ──

/** Pagina de telas (`GET /api/telas`). */
export type TelasPagina =
  paths['/api/telas']['get']['responses']['200']['content']['application/json'];
/** Una tela tal como la devuelve el API (con su categoria y colores). */
export type Tela = TelasPagina['datos'][number];
/** Un renglon de color de una tela (color + precio). */
export type TelaColor = Tela['colores'][number];

/** Unidad en que se compra y se consume una tela: `KG` (kilos) o `M` (metros). */
export type UnidadTela = Tela['unidadMedida'];
/** Parametros de consulta del listado de telas (querystring; incluye `idCategoria`). */
export type TelasQuery = NonNullable<paths['/api/telas']['get']['parameters']['query']>;
/** Cuerpo de alta de tela (`POST /api/telas`). */
export type TelaCrear = paths['/api/telas']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de tela (`PATCH /api/telas/{id}`). */
export type TelaEditar =
  paths['/api/telas/{id}']['patch']['requestBody']['content']['application/json'];
/** Un renglon del grid de colores en el cuerpo de crear/editar (idColor + precio?). */
export type TelaColorEntrada = NonNullable<TelaCrear['colores']>[number];

/** Pagina de composiciones de tela (`GET /api/composiciones-tela`, §Post-F9.11). */
export type ComposicionesTelaPagina =
  paths['/api/composiciones-tela']['get']['responses']['200']['content']['application/json'];
/** Una composicion de tela ("50% Algodon, 50% Poliester") tal como la devuelve el API. */
export type ComposicionTela = ComposicionesTelaPagina['datos'][number];
/** Parametros de consulta del listado de composiciones de tela (querystring). */
export type ComposicionesTelaQuery = NonNullable<
  paths['/api/composiciones-tela']['get']['parameters']['query']
>;
/** Cuerpo de alta de composicion de tela (`POST /api/composiciones-tela`). */
export type ComposicionTelaCrear =
  paths['/api/composiciones-tela']['post']['requestBody']['content']['application/json'];

/** Pagina de categorias de tela (`GET /api/telas-categorias`). */
export type TelasCategoriasPagina =
  paths['/api/telas-categorias']['get']['responses']['200']['content']['application/json'];
/** Una categoria de tela tal como la devuelve el API. */
export type TelaCategoria = TelasCategoriasPagina['datos'][number];
/** Parametros de consulta del listado de categorias de tela (querystring). */
export type TelasCategoriasQuery = NonNullable<
  paths['/api/telas-categorias']['get']['parameters']['query']
>;
/** Cuerpo de alta de categoria de tela (`POST /api/telas-categorias`). */
export type TelaCategoriaCrear =
  paths['/api/telas-categorias']['post']['requestBody']['content']['application/json'];

// ════════════════════════════════════════════════════════════════════════════════
//  Telas
// ════════════════════════════════════════════════════════════════════════════════

/** Clave raiz de la cache de telas en TanStack Query. */
export const CLAVE_TELAS = ['telas'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaTelas(query: TelasQuery): readonly unknown[] {
  return [...CLAVE_TELAS, 'lista', query];
}

/** Pide una pagina del listado de telas (busqueda + categoria + orden + paginacion en servidor). */
async function listarTelas(query: TelasQuery): Promise<TelasPagina> {
  const { data, error } = await api.GET('/api/telas', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea una tela (`POST /api/telas`). */
async function crearTela(cuerpo: TelaCrear): Promise<Tela> {
  const { data, error } = await api.POST('/api/telas', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza una tela (`PATCH /api/telas/{id}`). */
async function actualizarTela(id: number, cuerpo: TelaEditar): Promise<Tela> {
  const { data, error } = await api.PATCH('/api/telas/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva una tela (borrado SUAVE, `DELETE /api/telas/{id}`). */
async function desactivarTela(id: number): Promise<Tela> {
  const { data, error } = await api.DELETE('/api/telas/{id}', { params: { path: { id } } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva una tela desactivada (restaura el borrado suave) con `{ activo: true }`. */
async function reactivarTela(id: number): Promise<Tela> {
  const { data, error } = await api.PATCH('/api/telas/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Obtiene UNA tela por id (con su categoria y sus colores hijos). */
async function obtenerTela(id: number): Promise<Tela> {
  const { data, error } = await api.GET('/api/telas/{id}', { params: { path: { id } } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Una tela CONCRETA por id (`GET /api/telas/{id}`) con sus colores. Es lo que deben usar las
 * pantallas que ya SABEN de qué tela hablan (p. ej. la recepción de compra: la línea de OC trae
 * `idTela`) — buscar por nombre en el listado paginado NO sirve ahí: con cientos de telas, la
 * página de resultados puede no traer la buscada y el selector de color se quedaría vacío.
 * Apagada mientras no haya id.
 */
export function useTela(id: number | undefined): UseQueryResult<Tela, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_TELAS, 'detalle', id],
    queryFn: () => obtenerTela(id as number),
    enabled: id !== undefined,
  });
}

/** Lista telas con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useTelas(
  query: TelasQuery,
  /**
   * `enabled: false` apaga la consulta mientras el universo no está definido — p. ej. la captura de
   * una OC antes de elegir proveedor: pedir "todas" ofrecería telas que esa OC no puede comprar
   * (§Post-F9.15).
   */
  opciones?: { enabled?: boolean },
): UseQueryResult<TelasPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaTelas(query),
    queryFn: () => listarTelas(query),
    placeholderData: keepPreviousData,
    enabled: opciones?.enabled ?? true,
  });
}

/** Crea una tela e invalida la lista para reflejarla. */
export function useCrearTela(): UseMutationResult<Tela, ErrorDeApi, TelaCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearTela,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TELAS }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarTela {
  id: number;
  cuerpo: TelaEditar;
}

/** Edita una tela e invalida la lista. */
export function useActualizarTela(): UseMutationResult<Tela, ErrorDeApi, ArgsActualizarTela> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarTela) => actualizarTela(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TELAS }),
  });
}

/** Desactiva una tela (borrado suave) e invalida la lista. */
export function useDesactivarTela(): UseMutationResult<Tela, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarTela,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TELAS }),
  });
}

/** Reactiva una tela desactivada (restaura el borrado suave) e invalida la lista. */
export function useReactivarTela(): UseMutationResult<Tela, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarTela,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TELAS }),
  });
}

// ════════════════════════════════════════════════════════════════════════════════
//  Categorias de tela (selector + administracion ligera, bajo telas.*)
// ════════════════════════════════════════════════════════════════════════════════

/** Clave raiz de la cache de categorias de tela. */
export const CLAVE_TELAS_CATEGORIAS = ['telas-categorias'] as const;

/** Clave de cache de una pagina concreta del listado de categorias. */
function claveListaCategorias(query: TelasCategoriasQuery): readonly unknown[] {
  return [...CLAVE_TELAS_CATEGORIAS, 'lista', query];
}

/** Pide una pagina del listado de categorias de tela. */
async function listarCategorias(query: TelasCategoriasQuery): Promise<TelasCategoriasPagina> {
  const { data, error } = await api.GET('/api/telas-categorias', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea una categoria de tela (`POST /api/telas-categorias`). */
async function crearCategoria(cuerpo: TelaCategoriaCrear): Promise<TelaCategoria> {
  const { data, error } = await api.POST('/api/telas-categorias', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Lista las categorias de tela (paginadas). Por defecto la primera pagina de activas, que
 * alimenta el selector del formulario de tela y el filtro del listado. Para administracion
 * fina (incluir inactivas) se pasan los filtros.
 */
export function useTelasCategorias(
  query: TelasCategoriasQuery = {},
): UseQueryResult<TelasCategoriasPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaCategorias(query),
    queryFn: () => listarCategorias(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea una categoria de tela e invalida su lista. */
export function useCrearTelaCategoria(): UseMutationResult<
  TelaCategoria,
  ErrorDeApi,
  TelaCategoriaCrear
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearCategoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_TELAS_CATEGORIAS }),
  });
}

// ════════════════════════════════════════════════════════════════════════════════
//  Composiciones de tela (§Post-F9.11; selector + alta rapida, bajo telas.*)
// ════════════════════════════════════════════════════════════════════════════════

/** Clave raiz de la cache de composiciones de tela. */
export const CLAVE_COMPOSICIONES_TELA = ['composiciones-tela'] as const;

/** Clave de cache de una pagina concreta del listado de composiciones. */
function claveListaComposiciones(query: ComposicionesTelaQuery): readonly unknown[] {
  return [...CLAVE_COMPOSICIONES_TELA, 'lista', query];
}

/** Pide una pagina del listado de composiciones de tela. */
async function listarComposiciones(
  query: ComposicionesTelaQuery,
): Promise<ComposicionesTelaPagina> {
  const { data, error } = await api.GET('/api/composiciones-tela', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea una composicion de tela (`POST /api/composiciones-tela`). */
async function crearComposicion(cuerpo: ComposicionTelaCrear): Promise<ComposicionTela> {
  const { data, error } = await api.POST('/api/composiciones-tela', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Lista las composiciones de tela (paginadas). Por defecto la primera pagina de activas,
 * que alimenta el selector del formulario de tela (mismo trato que las categorias).
 */
export function useComposicionesTela(
  query: ComposicionesTelaQuery = {},
): UseQueryResult<ComposicionesTelaPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaComposiciones(query),
    queryFn: () => listarComposiciones(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea una composicion de tela e invalida su lista. */
export function useCrearComposicionTela(): UseMutationResult<
  ComposicionTela,
  ErrorDeApi,
  ComposicionTelaCrear
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearComposicion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_COMPOSICIONES_TELA }),
  });
}
