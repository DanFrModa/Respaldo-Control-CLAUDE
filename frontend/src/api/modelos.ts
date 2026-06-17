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
import type { paths } from './esquema.gen';

/**
 * Capa de datos del Módulo 2 — Modelos (F1-E4): catálogo de productos, receta/BOM
 * (telas/avíos/bordados) y fotos en R2. Replica el ESTÁNDAR de Almacenes/Bordados
 * (`api/bordados.ts`) + el flujo de archivos presigned. Llama al cliente TIPADO del OpenAPI,
 * normaliza (`data` en éxito, `ErrorDeApi` con el mensaje del backend en fallo) y expone
 * consultas/mutaciones; las mutaciones invalidan la cache. CERO lógica de negocio: el backend
 * valida, autoriza y decide (A1).
 */

// ── Alias de tipos del contrato (derivados del OpenAPI generado) ──────────────

/** Página de modelos (`GET /api/modelos`). */
export type ModelosPagina =
  paths['/api/modelos']['get']['responses']['200']['content']['application/json'];
/** Un modelo (listado) tal como lo devuelve el API. */
export type Modelo = ModelosPagina['datos'][number];
/** Parámetros de consulta del listado de modelos (querystring). */
export type ModelosQuery = NonNullable<paths['/api/modelos']['get']['parameters']['query']>;
/** Ficha de un modelo (datos + BOM completo, `GET /api/modelos/{id}`). */
export type ModeloFicha =
  paths['/api/modelos/{id}']['get']['responses']['200']['content']['application/json'];
/** Un renglón de tela del BOM. */
export type ModeloTela = ModeloFicha['telas'][number];
/** Un renglón de avío del BOM. */
export type ModeloAvio = ModeloFicha['avios'][number];
/** Un renglón de bordado del BOM. */
export type ModeloBordado = ModeloFicha['bordados'][number];
/** Cuerpo de alta de modelo (`POST /api/modelos`). */
export type ModeloCrear =
  paths['/api/modelos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de modelo (`PATCH /api/modelos/{id}`). */
export type ModeloEditar =
  paths['/api/modelos/{id}']['patch']['requestBody']['content']['application/json'];

/** Cuerpo para reemplazar las telas del BOM (`PUT /api/modelos/{id}/bom/telas`). */
export type BomTelasCuerpo =
  paths['/api/modelos/{id}/bom/telas']['put']['requestBody']['content']['application/json'];
/** Un renglón de tela de entrada del BOM (idTela + consumo + banderas). */
export type BomTelaEntrada = BomTelasCuerpo['telas'][number];
/** Cuerpo para reemplazar los avíos del BOM. */
export type BomAviosCuerpo =
  paths['/api/modelos/{id}/bom/avios']['put']['requestBody']['content']['application/json'];
/** Un renglón de avío de entrada del BOM. */
export type BomAvioEntrada = BomAviosCuerpo['avios'][number];
/** Cuerpo para reemplazar los bordados del BOM. */
export type BomBordadosCuerpo =
  paths['/api/modelos/{id}/bom/bordados']['put']['requestBody']['content']['application/json'];
/** Un renglón de bordado de entrada del BOM. */
export type BomBordadoEntrada = BomBordadosCuerpo['bordados'][number];
/** Cuerpo de copiar BOM (`POST /api/modelos/{id}/copiar-bom`). */
export type CopiarBomCuerpo =
  paths['/api/modelos/{id}/copiar-bom']['post']['requestBody']['content']['application/json'];

/** Una foto de un modelo con su URL de descarga (`GET /api/modelos/{id}/fotos`). */
export type ModeloFotosLista =
  paths['/api/modelos/{id}/fotos']['get']['responses']['200']['content']['application/json'];
export type ModeloFoto = ModeloFotosLista['datos'][number];
/** Tipo de foto (FRENTE/ESPALDA/OTRO). */
export type TipoFotoModelo = ModeloFoto['tipo'];
/** Cuerpo del PATCH de metadatos de una foto (`PATCH /api/modelos/{id}/fotos/{idFoto}`). */
export type ModeloFotoEditar =
  paths['/api/modelos/{id}/fotos/{idFoto}']['patch']['requestBody']['content']['application/json'];

/** Un género del catálogo selector (`GET /api/generos`). */
export type GenerosLista =
  paths['/api/generos']['get']['responses']['200']['content']['application/json'];
export type Genero = GenerosLista[number];

// ── Llaves de cache ───────────────────────────────────────────────────────────

/** Clave raíz de la cache de modelos en TanStack Query. */
export const CLAVE_MODELOS = ['modelos'] as const;

function claveListaModelos(query: ModelosQuery): readonly unknown[] {
  return [...CLAVE_MODELOS, 'lista', query];
}
function claveFicha(id: number): readonly unknown[] {
  return [...CLAVE_MODELOS, 'ficha', id];
}
function claveFotos(id: number): readonly unknown[] {
  return [...CLAVE_MODELOS, 'fotos', id];
}

// ── Modelos (CRUD) ──────────────────────────────────────────────────────────────

async function listarModelos(query: ModelosQuery): Promise<ModelosPagina> {
  const { data, error } = await api.GET('/api/modelos', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function obtenerFicha(id: number): Promise<ModeloFicha> {
  const { data, error } = await api.GET('/api/modelos/{id}', { params: { path: { id } } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function crearModelo(cuerpo: ModeloCrear): Promise<Modelo> {
  const { data, error } = await api.POST('/api/modelos', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function actualizarModelo(id: number, cuerpo: ModeloEditar): Promise<Modelo> {
  const { data, error } = await api.PATCH('/api/modelos/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function descontinuarModelo(id: number): Promise<Modelo> {
  const { data, error } = await api.DELETE('/api/modelos/{id}', { params: { path: { id } } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function reactivarModelo(id: number): Promise<Modelo> {
  const { data, error } = await api.PATCH('/api/modelos/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Lista modelos con los filtros dados (mantiene la página previa al paginar/buscar). */
export function useModelos(query: ModelosQuery): UseQueryResult<ModelosPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaModelos(query),
    queryFn: () => listarModelos(query),
    placeholderData: keepPreviousData,
  });
}

/** Lee la ficha (datos + BOM) de un modelo (deshabilitada si no hay id). */
export function useFichaModelo(id: number | undefined): UseQueryResult<ModeloFicha, ErrorDeApi> {
  return useQuery({
    queryKey: claveFicha(id ?? 0),
    queryFn: () => obtenerFicha(id as number),
    enabled: id !== undefined,
  });
}

/** Crea un modelo e invalida la lista para reflejarlo. */
export function useCrearModelo(): UseMutationResult<Modelo, ErrorDeApi, ModeloCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearModelo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS }),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarModelo {
  id: number;
  cuerpo: ModeloEditar;
}

/** Edita un modelo e invalida la lista y su ficha. */
export function useActualizarModelo(): UseMutationResult<Modelo, ErrorDeApi, ArgsActualizarModelo> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarModelo) => actualizarModelo(id, cuerpo),
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
      void queryClient.invalidateQueries({ queryKey: claveFicha(variables.id) });
    },
  });
}

/** Descontinúa un modelo (borrado suave) e invalida la lista. */
export function useDescontinuarModelo(): UseMutationResult<Modelo, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: descontinuarModelo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS }),
  });
}

/** Reactiva un modelo descontinuado e invalida la lista. */
export function useReactivarModelo(): UseMutationResult<Modelo, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarModelo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS }),
  });
}

// ── Géneros (selector) ──────────────────────────────────────────────────────────

async function listarGeneros(): Promise<GenerosLista> {
  const { data, error } = await api.GET('/api/generos', { params: { query: {} } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Lista los géneros activos para el selector de la ficha. */
export function useGeneros(): UseQueryResult<GenerosLista, ErrorDeApi> {
  return useQuery({ queryKey: ['generos'], queryFn: listarGeneros });
}

// ── BOM (set-completo por sección) ────────────────────────────────────────────

async function reemplazarTelas(id: number, telas: BomTelaEntrada[]): Promise<ModeloTela[]> {
  const { data, error } = await api.PUT('/api/modelos/{id}/bom/telas', {
    params: { path: { id } },
    body: { telas },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

async function reemplazarAvios(id: number, avios: BomAvioEntrada[]): Promise<ModeloAvio[]> {
  const { data, error } = await api.PUT('/api/modelos/{id}/bom/avios', {
    params: { path: { id } },
    body: { avios },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

async function reemplazarBordados(
  id: number,
  bordados: BomBordadoEntrada[],
): Promise<ModeloBordado[]> {
  const { data, error } = await api.PUT('/api/modelos/{id}/bom/bordados', {
    params: { path: { id } },
    body: { bordados },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

async function copiarBom(id: number, cuerpo: CopiarBomCuerpo): Promise<void> {
  const { data, error } = await api.POST('/api/modelos/{id}/copiar-bom', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
}

/** Argumentos de las mutaciones de reemplazo de una sección del BOM. */
export interface ArgsBomTelas {
  id: number;
  telas: BomTelaEntrada[];
}
export interface ArgsBomAvios {
  id: number;
  avios: BomAvioEntrada[];
}
export interface ArgsBomBordados {
  id: number;
  bordados: BomBordadoEntrada[];
}
export interface ArgsCopiarBom {
  id: number;
  cuerpo: CopiarBomCuerpo;
}

/** Invalida la ficha del modelo (su BOM cambió) y el listado (no cambia, pero por consistencia). */
function invalidarFichaYLista(queryClient: ReturnType<typeof useQueryClient>, id: number): void {
  void queryClient.invalidateQueries({ queryKey: claveFicha(id) });
  void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
}

/** Reemplaza el set de telas del BOM e invalida la ficha. */
export function useReemplazarTelasBom(): UseMutationResult<ModeloTela[], ErrorDeApi, ArgsBomTelas> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, telas }: ArgsBomTelas) => reemplazarTelas(id, telas),
    onSuccess: (_r, v) => invalidarFichaYLista(queryClient, v.id),
  });
}

/** Reemplaza el set de avíos del BOM e invalida la ficha. */
export function useReemplazarAviosBom(): UseMutationResult<ModeloAvio[], ErrorDeApi, ArgsBomAvios> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, avios }: ArgsBomAvios) => reemplazarAvios(id, avios),
    onSuccess: (_r, v) => invalidarFichaYLista(queryClient, v.id),
  });
}

/** Reemplaza el set de bordados del BOM e invalida la ficha. */
export function useReemplazarBordadosBom(): UseMutationResult<
  ModeloBordado[],
  ErrorDeApi,
  ArgsBomBordados
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, bordados }: ArgsBomBordados) => reemplazarBordados(id, bordados),
    onSuccess: (_r, v) => invalidarFichaYLista(queryClient, v.id),
  });
}

/** Copia el BOM de otro modelo e invalida la ficha del destino. */
export function useCopiarBom(): UseMutationResult<void, ErrorDeApi, ArgsCopiarBom> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCopiarBom) => copiarBom(id, cuerpo),
    onSuccess: (_r, v) => invalidarFichaYLista(queryClient, v.id),
  });
}

// ── Fotos (presigned: POST metadatos → PUT directo a R2) ──────────────────────

async function listarFotos(id: number): Promise<ModeloFoto[]> {
  const { data, error } = await api.GET('/api/modelos/{id}/fotos', { params: { path: { id } } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/** Lee las fotos de un modelo (deshabilitada si no hay id, p. ej. en alta). */
export function useFotosModelo(id: number | undefined): UseQueryResult<ModeloFoto[], ErrorDeApi> {
  return useQuery({
    queryKey: claveFotos(id ?? 0),
    queryFn: () => listarFotos(id as number),
    enabled: id !== undefined,
  });
}

/** Argumentos de la mutación de subida de una foto. */
export interface ArgsSubirFoto {
  idModelo: number;
  /** La imagen elegida por el usuario. */
  archivo: File;
  /** Tipo de foto (frente/espalda/otra). Por defecto OTRO en el backend. */
  tipo?: TipoFotoModelo;
}

/**
 * Sube UNA foto de un modelo a R2 en DOS pasos (flujo presigned de F0):
 *   1) `POST /api/modelos/{id}/fotos` con los metadatos → el backend registra el `Archivo`,
 *      crea el `ModeloFoto` y devuelve una URL PUT prefirmada.
 *   2) El navegador hace `PUT` de la imagen DIRECTO a esa URL (R2) con su `Content-Type`.
 * Si el PUT a R2 falla, se propaga como `ErrorDeApi` para que el toast lo muestre.
 */
async function subirFoto({ idModelo, archivo, tipo }: ArgsSubirFoto): Promise<void> {
  const { data, error } = await api.POST('/api/modelos/{id}/fotos', {
    params: { path: { id: idModelo } },
    body: {
      nombreOriginal: archivo.name,
      tipoMime: archivo.type,
      tamanoBytes: archivo.size,
      ...(tipo === undefined ? {} : { tipo }),
    },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }

  // Paso 2: PUT directo a R2 (solo Content-Type; Content-Length lo fija el navegador).
  let respuesta: Response;
  try {
    respuesta = await fetch(data.urlSubida, {
      method: 'PUT',
      headers: { 'Content-Type': archivo.type },
      body: archivo,
    });
  } catch {
    throw new ErrorDeApi({
      codigo: 'SUBIDA',
      mensaje: 'No se pudo subir la imagen. Verifica tu conexión e intenta de nuevo.',
    });
  }
  if (!respuesta.ok) {
    throw new ErrorDeApi({
      codigo: 'SUBIDA',
      mensaje: 'El almacenamiento rechazó la imagen. Intenta de nuevo.',
    });
  }
}

/** Sube una foto (presigned PUT) e invalida las fotos y la lista (para refrescar el conteo). */
export function useSubirFotoModelo(): UseMutationResult<void, ErrorDeApi, ArgsSubirFoto> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subirFoto,
    onSuccess: (_r, v) => {
      void queryClient.invalidateQueries({ queryKey: claveFotos(v.idModelo) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
      void queryClient.invalidateQueries({ queryKey: claveFicha(v.idModelo) });
    },
  });
}

async function quitarFoto(idModelo: number, idFoto: number): Promise<void> {
  const { error, response } = await api.DELETE('/api/modelos/{id}/fotos/{idFoto}', {
    params: { path: { id: idModelo, idFoto } },
  });
  if (!response.ok) {
    throw new ErrorDeApi(error);
  }
}

/** Argumentos de quitar foto. */
export interface ArgsQuitarFoto {
  idModelo: number;
  idFoto: number;
}

/** Quita una foto e invalida las fotos y la lista (para refrescar el conteo). */
export function useQuitarFotoModelo(): UseMutationResult<void, ErrorDeApi, ArgsQuitarFoto> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idModelo, idFoto }: ArgsQuitarFoto) => quitarFoto(idModelo, idFoto),
    onSuccess: (_r, v) => {
      void queryClient.invalidateQueries({ queryKey: claveFotos(v.idModelo) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
      void queryClient.invalidateQueries({ queryKey: claveFicha(v.idModelo) });
    },
  });
}

async function actualizarFoto(
  idModelo: number,
  idFoto: number,
  cuerpo: ModeloFotoEditar,
): Promise<void> {
  const { error, response } = await api.PATCH('/api/modelos/{id}/fotos/{idFoto}', {
    params: { path: { id: idModelo, idFoto } },
    body: cuerpo,
  });
  // 204 No Content: éxito sin cuerpo; cualquier !ok es error.
  if (!response.ok) {
    throw new ErrorDeApi(error);
  }
}

/** Argumentos de actualizar los metadatos (tipo/orden) de una foto. */
export interface ArgsActualizarFoto {
  idModelo: number;
  idFoto: number;
  cuerpo: ModeloFotoEditar;
}

/** Actualiza el tipo/orden de una foto (`PATCH`) e invalida las fotos del modelo. */
export function useActualizarFotoModelo(): UseMutationResult<void, ErrorDeApi, ArgsActualizarFoto> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idModelo, idFoto, cuerpo }: ArgsActualizarFoto) =>
      actualizarFoto(idModelo, idFoto, cuerpo),
    onSuccess: (_r, v) => {
      void queryClient.invalidateQueries({ queryKey: claveFotos(v.idModelo) });
    },
  });
}
