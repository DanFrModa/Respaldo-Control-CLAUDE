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
import { CLAVE_MODELOS } from './modelos';
import { subirArchivoPrefirmado } from './subida-archivo';

/**
 * Capa de datos del ARTE de los modelos (V1-E3d, §Post-F9.35).
 *
 * El arte dejó de ser un catálogo global y vive DENTRO del modelo, así que todo cuelga de
 * `/api/modelos/{id}/artes*` — CRUD renglón por renglón (tiene foto, no cabe en un PUT de
 * conjunto como telas/avíos) + «copiar arte de otro modelo» + la foto presigned. La GALERÍA
 * (`/api/artes`) es lo único global: se arma desde los modelos y cada celda dice de qué modelo es.
 *
 * Llama al cliente TIPADO del OpenAPI, normaliza (`data` en éxito, `ErrorDeApi` con el mensaje del
 * backend en fallo) y expone consultas/mutaciones; las mutaciones invalidan la caché del arte del
 * modelo, la de la galería y la del propio modelo (su ficha embebe el arte). CERO lógica de
 * negocio: el backend valida, autoriza y decide (A1).
 */

// ── Alias de tipos del contrato (derivados del OpenAPI generado) ──────────────

/** Lista del arte de un modelo (`GET /api/modelos/{id}/artes`). */
export type ArtesLista =
  paths['/api/modelos/{id}/artes']['get']['responses']['200']['content']['application/json'];
/** Un arte del modelo tal como lo devuelve el API. */
export type Arte = ArtesLista['datos'][number];
/** Una foto del arte tal como viaja embebida en el arte (sin URL). */
export type ArteFotoResumen = Arte['fotos'][number];
/** Cuerpo de alta de un arte (`POST /api/modelos/{id}/artes`). */
export type ArteCrear =
  paths['/api/modelos/{id}/artes']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de un arte (`PATCH /api/modelos/{id}/artes/{idArte}`). */
export type ArteEditar =
  paths['/api/modelos/{id}/artes/{idArte}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo de «copiar arte de otro modelo» (`POST /api/modelos/{id}/artes/copiar`). */
export type ArteCopiar =
  paths['/api/modelos/{id}/artes/copiar']['post']['requestBody']['content']['application/json'];
/** Fotos de un arte con su URL de descarga (`GET /api/modelos/{id}/artes/{idArte}/fotos`). */
export type ArteFotosLista =
  paths['/api/modelos/{id}/artes/{idArte}/fotos']['get']['responses']['200']['content']['application/json'];
/** Una foto de un arte, con su URL prefirmada. */
export type ArteFoto = ArteFotosLista['datos'][number];
/** Página de la galería de arte (`GET /api/artes`). */
export type GaleriaArtePagina =
  paths['/api/artes']['get']['responses']['200']['content']['application/json'];
/** Una celda de la galería (el arte + su modelo). */
export type GaleriaArteItem = GaleriaArtePagina['datos'][number];
/** Parámetros de consulta de la galería (querystring). */
export type GaleriaArteQuery = NonNullable<paths['/api/artes']['get']['parameters']['query']>;

// ── Llaves de caché ───────────────────────────────────────────────────────────

/** Clave raíz de la caché del arte en TanStack Query. */
export const CLAVE_ARTES = ['artes'] as const;

/** Clave de caché del arte de UN modelo. */
function claveArtesModelo(idModelo: number): readonly unknown[] {
  return [...CLAVE_ARTES, 'modelo', idModelo];
}

/** Clave de caché de las FOTOS de UN arte (plurales desde V1-E3f). */
function claveFotos(idModelo: number, idArte: number): readonly unknown[] {
  return [...CLAVE_ARTES, 'fotos', idModelo, idArte];
}

/** Clave de caché de una página de la galería (depende de los filtros). */
function claveGaleria(query: GaleriaArteQuery): readonly unknown[] {
  return [...CLAVE_ARTES, 'galeria', query];
}

/** Invalida todo lo que muestra arte: el del modelo, la galería y la ficha del modelo. */
function invalidarArte(queryClient: ReturnType<typeof useQueryClient>, idModelo: number): void {
  void queryClient.invalidateQueries({ queryKey: claveArtesModelo(idModelo) });
  void queryClient.invalidateQueries({ queryKey: [...CLAVE_ARTES, 'galeria'] });
  void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
}

// ── Llamadas al API (normalizadas) ────────────────────────────────────────────

/** Lista el arte de un modelo (ya ordenado: el principal primero). */
async function listarArtes(idModelo: number): Promise<ArtesLista> {
  const { data, error } = await api.GET('/api/modelos/{id}/artes', {
    params: { path: { id: idModelo } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Agrega un arte al modelo. */
async function crearArte(idModelo: number, cuerpo: ArteCrear): Promise<Arte> {
  const { data, error } = await api.POST('/api/modelos/{id}/artes', {
    params: { path: { id: idModelo } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Edita un arte del modelo. */
async function actualizarArte(idModelo: number, idArte: number, cuerpo: ArteEditar): Promise<Arte> {
  const { data, error } = await api.PATCH('/api/modelos/{id}/artes/{idArte}', {
    params: { path: { id: idModelo, idArte } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Quita un arte del modelo (es un renglón de la receta, no un catálogo con borrado suave). */
async function eliminarArte(idModelo: number, idArte: number): Promise<void> {
  const { error, response } = await api.DELETE('/api/modelos/{id}/artes/{idArte}', {
    params: { path: { id: idModelo, idArte } },
  });
  if (!response.ok) {
    throw new ErrorDeApi(error);
  }
}

/** Marca un arte como el PRINCIPAL del modelo (lo mueve al primer lugar). */
async function marcarPrincipal(idModelo: number, idArte: number): Promise<ArtesLista> {
  const { data, error } = await api.POST('/api/modelos/{id}/artes/{idArte}/principal', {
    params: { path: { id: idModelo, idArte } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Copia a este modelo un arte que ya existe en OTRO (trae todo lleno para ajustarlo). */
async function copiarArte(idModelo: number, cuerpo: ArteCopiar): Promise<Arte> {
  const { data, error } = await api.POST('/api/modelos/{id}/artes/copiar', {
    params: { path: { id: idModelo } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Pide una página de la galería de arte (todos los modelos). */
async function listarGaleria(query: GaleriaArteQuery): Promise<GaleriaArtePagina> {
  const { data, error } = await api.GET('/api/artes', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Pide las fotos de un arte (cada una con su URL de descarga). */
async function obtenerFotos(idModelo: number, idArte: number): Promise<ArteFotosLista> {
  const { data, error } = await api.GET('/api/modelos/{id}/artes/{idArte}/fotos', {
    params: { path: { id: idModelo, idArte } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks de CRUD ─────────────────────────────────────────────────────────────

/** Lee el arte de un modelo (deshabilitado si aún no hay id, p. ej. en el alta). */
export function useArtesModelo(
  idModelo: number | undefined,
): UseQueryResult<ArtesLista, ErrorDeApi> {
  return useQuery({
    queryKey: claveArtesModelo(idModelo ?? 0),
    queryFn: () => listarArtes(idModelo as number),
    enabled: idModelo !== undefined,
  });
}

/** Argumentos de la mutación de alta. */
export interface ArgsCrearArte {
  idModelo: number;
  cuerpo: ArteCrear;
}

/** Agrega un arte al modelo e invalida lo que lo muestra. */
export function useCrearArte(): UseMutationResult<Arte, ErrorDeApi, ArgsCrearArte> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idModelo, cuerpo }: ArgsCrearArte) => crearArte(idModelo, cuerpo),
    onSuccess: (_resultado, variables) => invalidarArte(queryClient, variables.idModelo),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarArte {
  idModelo: number;
  idArte: number;
  cuerpo: ArteEditar;
}

/** Edita un arte del modelo e invalida lo que lo muestra. */
export function useActualizarArte(): UseMutationResult<Arte, ErrorDeApi, ArgsActualizarArte> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idModelo, idArte, cuerpo }: ArgsActualizarArte) =>
      actualizarArte(idModelo, idArte, cuerpo),
    onSuccess: (_resultado, variables) => invalidarArte(queryClient, variables.idModelo),
  });
}

/** Argumentos de las mutaciones que solo necesitan identificar el arte. */
export interface ArgsArte {
  idModelo: number;
  idArte: number;
}

/** Quita un arte del modelo e invalida lo que lo muestra. */
export function useEliminarArte(): UseMutationResult<void, ErrorDeApi, ArgsArte> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idModelo, idArte }: ArgsArte) => eliminarArte(idModelo, idArte),
    onSuccess: (_resultado, variables) => invalidarArte(queryClient, variables.idModelo),
  });
}

/** Marca un arte como el principal del modelo e invalida lo que lo muestra. */
export function useMarcarArtePrincipal(): UseMutationResult<ArtesLista, ErrorDeApi, ArgsArte> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idModelo, idArte }: ArgsArte) => marcarPrincipal(idModelo, idArte),
    onSuccess: (_resultado, variables) => invalidarArte(queryClient, variables.idModelo),
  });
}

/** Argumentos de la mutación de copia. */
export interface ArgsCopiarArte {
  idModelo: number;
  cuerpo: ArteCopiar;
}

/** Copia a este modelo un arte de otro modelo e invalida lo que lo muestra. */
export function useCopiarArte(): UseMutationResult<Arte, ErrorDeApi, ArgsCopiarArte> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idModelo, cuerpo }: ArgsCopiarArte) => copiarArte(idModelo, cuerpo),
    onSuccess: (_resultado, variables) => invalidarArte(queryClient, variables.idModelo),
  });
}

/** Galería de arte de TODOS los modelos (mantiene la página previa al paginar/buscar). */
export function useGaleriaArte(
  query: GaleriaArteQuery,
): UseQueryResult<GaleriaArtePagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveGaleria(query),
    queryFn: () => listarGaleria(query),
    placeholderData: keepPreviousData,
  });
}

// ── Foto del arte (presigned: POST metadatos → PUT directo a R2) ──────────────

/** Lee las FOTOS de un arte (deshabilitada si aún no hay arte). */
export function useFotosArte(
  idModelo: number | undefined,
  idArte: number | undefined,
): UseQueryResult<ArteFotosLista, ErrorDeApi> {
  return useQuery({
    queryKey: claveFotos(idModelo ?? 0, idArte ?? 0),
    queryFn: () => obtenerFotos(idModelo as number, idArte as number),
    enabled: idModelo !== undefined && idArte !== undefined,
  });
}

/** Argumentos de la mutación de subida de la foto. */
export interface ArgsSubirFotoArte extends ArgsArte {
  /** La imagen elegida por el usuario. */
  archivo: File;
}

/**
 * Sube UNA foto de un arte a R2 en DOS pasos (flujo presigned de F0):
 *   1) `POST /api/modelos/{id}/artes/{idArte}/fotos` con los metadatos → el backend registra el
 *      `Archivo`, crea el renglón de foto y devuelve una URL PUT prefirmada.
 *   2) El navegador hace `PUT` de la imagen DIRECTO a esa URL (R2) con su `Content-Type`. La URL
 *      prefirmada NO firma content-type/content-length (el navegador los maneja como headers
 *      especiales y romperían el SigV4), así que el PUT cuadra y R2 lo acepta.
 *
 * Si el PUT a R2 falla, se QUITA el renglón que el paso 1 creó (si no, el arte queda apuntando a
 * una imagen que nunca llegó). Desde V1-E3f la limpieza usa el `idFoto` de ESTA subida, así que
 * es exacta por construcción: nunca puede tocar la foto que otro usuario subió mientras tanto (con
 * la foto única había que acotar el borrado a mano para evitar esa pérdida silenciosa).
 */
async function subirFoto({ idModelo, idArte, archivo }: ArgsSubirFotoArte): Promise<void> {
  const { data, error } = await api.POST('/api/modelos/{id}/artes/{idArte}/fotos', {
    params: { path: { id: idModelo, idArte } },
    body: {
      nombreOriginal: archivo.name,
      tipoMime: archivo.type,
      tamanoBytes: archivo.size,
    },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }

  await subirArchivoPrefirmado({
    urlSubida: data.urlSubida,
    archivo,
    tipoMime: archivo.type,
    sustantivo: 'la imagen',
    limpiar: () => quitarFoto(idModelo, idArte, data.idFoto),
  });
}

/** Sube una foto (presigned PUT) e invalida las fotos y el arte del modelo. */
export function useSubirFotoArte(): UseMutationResult<void, ErrorDeApi, ArgsSubirFotoArte> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subirFoto,
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({
        queryKey: claveFotos(variables.idModelo, variables.idArte),
      });
      invalidarArte(queryClient, variables.idModelo);
    },
  });
}

/** Quita UNA foto de un arte (`DELETE /api/modelos/{id}/artes/{idArte}/fotos/{idFoto}`). */
async function quitarFoto(idModelo: number, idArte: number, idFoto: number): Promise<void> {
  const { error, response } = await api.DELETE('/api/modelos/{id}/artes/{idArte}/fotos/{idFoto}', {
    params: { path: { id: idModelo, idArte, idFoto } },
  });
  // 204 No Content: éxito sin cuerpo; cualquier !ok es error.
  if (!response.ok) {
    throw new ErrorDeApi(error);
  }
}

/** Argumentos de la mutación que quita UNA foto. */
export interface ArgsQuitarFotoArte extends ArgsArte {
  idFoto: number;
}

/**
 * Quita una foto e invalida las fotos y el arte del modelo.
 *
 * El `mutationFn` va ENVUELTO en una flecha de UN argumento a propósito (mismo patrón que
 * `useQuitarFotoModelo` en `api/modelos.ts`): TanStack Query llama al `mutationFn` con DOS
 * argumentos (`variables` y un contexto `{ client, meta, mutationKey }`), así que pasar la
 * referencia pelada le metería ese contexto en el tercer parámetro.
 */
export function useQuitarFotoArte(): UseMutationResult<void, ErrorDeApi, ArgsQuitarFotoArte> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idModelo, idArte, idFoto }: ArgsQuitarFotoArte) =>
      quitarFoto(idModelo, idArte, idFoto),
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({
        queryKey: claveFotos(variables.idModelo, variables.idArte),
      });
      invalidarArte(queryClient, variables.idModelo);
    },
  });
}
