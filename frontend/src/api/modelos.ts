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
import { subirArchivoPrefirmado } from './subida-archivo';

/**
 * Capa de datos del Módulo 2 — Modelos (F1-E4): catálogo de productos, receta/BOM
 * (telas/avíos) y fotos en R2. El ARTE del modelo vive en `api/artes.ts` (V1-E3d: CRUD renglón
 * por renglón, porque tiene foto). Llama al cliente TIPADO del OpenAPI,
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
/**
 * ⭐ V1-E3v (§Post-F9.90) — la sugerencia de avíos FAVORITOS para la receta del modelo, tal como la
 * calcula el servidor (A1: la pantalla no decide quién es favorito ni con cuánta cantidad).
 */
export type AviosFavoritosSugerencia =
  paths['/api/modelos/{id}/bom/avios/favoritos']['get']['responses']['200']['content']['application/json'];
/** Un avío favorito sugerido (con su `cantidadSugerida` = `Avio.cantFav` del catálogo). */
export type AvioFavoritoSugerido = AviosFavoritosSugerencia['sugeridos'][number];
/** Resultado de ACEPTAR los favoritos de un acto. */
export type AviosFavoritosAceptados =
  paths['/api/modelos/{id}/bom/avios/favoritos']['post']['responses']['200']['content']['application/json'];
/** Un ARTE del modelo, tal como viene embebido en la ficha (su CRUD vive en `api/artes.ts`). */
export type ModeloArte = ModeloFicha['artes'][number];
/** ⭐ V1-E7d — cómo quedó la REVISIÓN de una versión tras firmarla (§Post-F9.110). */
export type RevisionModelo =
  paths['/api/modelos/{id}/revision/aprobar']['post']['responses']['200']['content']['application/json'];
/** Cuerpo de «rechazar revisión» (el motivo es obligatorio). */
export type RevisionRechazarCuerpo =
  paths['/api/modelos/{id}/revision/rechazar']['post']['requestBody']['content']['application/json'];

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

/** Propuesta de nº de producción de un modelo (`GET /api/modelos/{id}/propuesta-produccion`). */
export type PropuestaProduccion =
  paths['/api/modelos/{id}/propuesta-produccion']['get']['responses']['200']['content']['application/json'];
/** Cuerpo de «crear versión» (`POST /api/modelos/{id}/version`, V1-E7b). */
export type ModeloVersionCuerpo =
  paths['/api/modelos/{id}/version']['post']['requestBody']['content']['application/json'];
/** El modelo NUEVO que devuelve «crear versión». */
export type ModeloVersionCreada =
  paths['/api/modelos/{id}/version']['post']['responses']['201']['content']['application/json'];

/** Cuerpo de «pasar a producción» (`POST /api/modelos/{id}/pasar-a-produccion`). */
export type PasarAProduccionCuerpo =
  paths['/api/modelos/{id}/pasar-a-produccion']['post']['requestBody']['content']['application/json'];
/** Resultado de «pasar a producción». */
export type PasarAProduccionResultado =
  paths['/api/modelos/{id}/pasar-a-produccion']['post']['responses']['200']['content']['application/json'];

/**
 * ⭐ V1-E3r (§Post-F9.81 punto 3) — curvas que las ÓRDENES del modelo sugieren, para llenar el
 * hueco cuando el modelo no tiene ninguna.
 */
export type CurvasSugeridas =
  paths['/api/modelos/{id}/curvas-sugeridas']['get']['responses']['200']['content']['application/json'];
/** Una curva candidata (con cuántas OP la usan). */
export type CurvaSugerida = CurvasSugeridas['sugerencias'][number];
/** Resultado de asignar la curva confirmada. */
export type CurvaAsignada =
  paths['/api/modelos/{id}/curva-desde-ordenes']['post']['responses']['200']['content']['application/json'];

/** Un género del catálogo selector (`GET /api/generos`). */
export type GenerosLista =
  paths['/api/generos']['get']['responses']['200']['content']['application/json'];
export type Genero = GenerosLista[number];

// ── Llaves de cache ───────────────────────────────────────────────────────────

/** Clave raíz de la cache de modelos en TanStack Query. */
export const CLAVE_MODELOS = ['modelos'] as const;

/**
 * Clave de la caché de la bandeja «Recetas por revisar» (V1-E8r, §Post-F9.140). Vive aquí arriba,
 * junto a `CLAVE_MODELOS`, porque las DOS firmas de la revisión la invalidan: firmar desde la ficha
 * tiene que sacar esa versión de la bandeja, o la cola enseñaría trabajo ya hecho.
 */
export const CLAVE_RECETAS_POR_REVISAR = ['recetas-por-revisar'] as const;

function claveListaModelos(query: ModelosQuery): readonly unknown[] {
  return [...CLAVE_MODELOS, 'lista', query];
}
function claveFicha(id: number): readonly unknown[] {
  return [...CLAVE_MODELOS, 'ficha', id];
}
/** Clave de la SUGERENCIA de avíos favoritos de un modelo (V1-E3v). */
function claveFavoritosBom(id: number): readonly unknown[] {
  return [...CLAVE_MODELOS, 'bom-avios-favoritos', id];
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

// ── Pasar a producción (§Post-F9.34 / §Post-F9.46) ─────────────────────────────

async function obtenerPropuestaProduccion(id: number): Promise<PropuestaProduccion> {
  const { data, error } = await api.GET('/api/modelos/{id}/propuesta-produccion', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Lee el nº de producción que el sistema PROPONE para un modelo, con sus avisos. La pantalla lo
 * usa para llegar con el campo ya lleno (§Post-F9.46); el usuario lo puede cambiar.
 */
export function usePropuestaProduccion(
  id: number | undefined,
): UseQueryResult<PropuestaProduccion, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_MODELOS, 'propuesta-produccion', id ?? 0],
    queryFn: () => obtenerPropuestaProduccion(id as number),
    enabled: id !== undefined,
    // La ocupación de la serie cambia con cada promoción: no se cachea entre aperturas.
    staleTime: 0,
    gcTime: 0,
  });
}

/** Argumentos de «pasar a producción». */
export interface ArgsPasarAProduccion {
  id: number;
  cuerpo: PasarAProduccionCuerpo;
}

async function pasarAProduccion(
  id: number,
  cuerpo: PasarAProduccionCuerpo,
): Promise<PasarAProduccionResultado> {
  const { data, error } = await api.POST('/api/modelos/{id}/pasar-a-produccion', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Pasa un modelo de desarrollo a producción e invalida la lista y su ficha. */
export function usePasarAProduccion(): UseMutationResult<
  PasarAProduccionResultado,
  ErrorDeApi,
  ArgsPasarAProduccion
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsPasarAProduccion) => pasarAProduccion(id, cuerpo),
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
      void queryClient.invalidateQueries({ queryKey: claveFicha(variables.id) });
    },
  });
}

// ── ⭐ V1-E7b: la VERSIÓN de un modelo (§Post-F9.110) ───────────────────────────

/** Argumentos de «crear versión». */
export interface ArgsCrearVersion {
  id: number;
  cuerpo?: ModeloVersionCuerpo;
}

async function crearVersionModelo(
  id: number,
  cuerpo: ModeloVersionCuerpo,
): Promise<ModeloVersionCreada> {
  const { data, error } = await api.POST('/api/modelos/{id}/version', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Crea la VERSIÓN de un modelo: nace `CYA-26-71-001-01` con la MISMA receta y el modelo original
 * queda igual (§Post-F9.110). Invalida la lista y la ficha del padre — la del hijo no existía
 * antes, así que no hay nada que invalidar de ella.
 */
export function useCrearVersionModelo(): UseMutationResult<
  ModeloVersionCreada,
  ErrorDeApi,
  ArgsCrearVersion
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCrearVersion) => crearVersionModelo(id, cuerpo ?? {}),
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
      void queryClient.invalidateQueries({ queryKey: claveFicha(variables.id) });
    },
  });
}

// ── ⭐ V1-E7d: LA REVISIÓN antes de mandar a producir (§Post-F9.110) ────────────

async function firmarRevision(
  id: number,
  accion: 'aprobar' | 'rechazar',
  cuerpo: Record<string, unknown>,
): Promise<RevisionModelo> {
  const { data, error } =
    accion === 'aprobar'
      ? await api.POST('/api/modelos/{id}/revision/aprobar', {
          params: { path: { id } },
          body: cuerpo,
        })
      : await api.POST('/api/modelos/{id}/revision/rechazar', {
          params: { path: { id } },
          body: cuerpo as RevisionRechazarCuerpo,
        });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Argumentos de las dos firmas de revisión. */
export interface ArgsRevisionModelo {
  id: number;
  /** Motivo del rechazo (obligatorio al rechazar) o nota opcional de la aprobación. */
  texto?: string;
}

/**
 * APRUEBA la revisión de la receta de una versión: la firma que la habilita para producción
 * (§Post-F9.110). La pantalla NO decide nada — el backend valida que sea una versión, que no esté
 * ya aprobada y que quien firma tenga `modelos.aprobar-receta` (A1).
 */
export function useAprobarRevisionModelo(): UseMutationResult<
  RevisionModelo,
  ErrorDeApi,
  ArgsRevisionModelo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, texto }: ArgsRevisionModelo) =>
      firmarRevision(id, 'aprobar', texto === undefined || texto === '' ? {} : { nota: texto }),
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
      void queryClient.invalidateQueries({ queryKey: claveFicha(variables.id) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_RECETAS_POR_REVISAR });
    },
  });
}

/**
 * RECHAZA la revisión con motivo: la versión sigue existiendo y editándose, pero no puede mandarse
 * a producir. El motivo es obligatorio y el backend lo vuelve a exigir.
 */
export function useRechazarRevisionModelo(): UseMutationResult<
  RevisionModelo,
  ErrorDeApi,
  ArgsRevisionModelo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, texto }: ArgsRevisionModelo) =>
      firmarRevision(id, 'rechazar', { motivo: texto ?? '' }),
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
      void queryClient.invalidateQueries({ queryKey: claveFicha(variables.id) });
      // Rechazar NO la saca de la bandeja (sigue sin poder producirse): la ACTUALIZA, para que el
      // renglón enseñe ya el motivo que se acaba de escribir.
      void queryClient.invalidateQueries({ queryKey: CLAVE_RECETAS_POR_REVISAR });
    },
  });
}

// ── Curva jalada de las órdenes (V1-E3r, §Post-F9.81) ───────────────────────────

async function obtenerCurvasSugeridas(id: number): Promise<CurvasSugeridas> {
  const { data, error } = await api.GET('/api/modelos/{id}/curvas-sugeridas', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Lee las curvas que las órdenes del modelo sugieren. Se PROPONEN: la asignación la confirma una
 * persona (escribe el catálogo y lo hereda todo lo posterior, D3).
 *
 * `staleTime: 0` a propósito: entre que se abre la propuesta y se confirma pudo entrar otra OP, y
 * el servidor re-valida contra lo que haya en ese momento — enseñar una lista rancia sólo
 * produciría un rechazo que el usuario no entiende.
 */
export function useCurvasSugeridas(
  id: number | undefined,
  habilitado = true,
): UseQueryResult<CurvasSugeridas, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_MODELOS, 'curvas-sugeridas', id ?? 0],
    queryFn: () => obtenerCurvasSugeridas(id as number),
    enabled: habilitado && id !== undefined,
    staleTime: 0,
    gcTime: 0,
  });
}

/** Argumentos de la confirmación del jalón de la curva. */
export interface ArgsAsignarCurva {
  id: number;
  idsTalla: number[];
}

async function asignarCurvaDesdeOrdenes(id: number, idsTalla: number[]): Promise<CurvaAsignada> {
  const { data, error } = await api.POST('/api/modelos/{id}/curva-desde-ordenes', {
    params: { path: { id } },
    body: { idsTalla },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Asigna al modelo la curva confirmada e invalida su ficha (la matriz de abajo cambia con ella). */
export function useAsignarCurvaDesdeOrdenes(): UseMutationResult<
  CurvaAsignada,
  ErrorDeApi,
  ArgsAsignarCurva
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, idsTalla }: ArgsAsignarCurva) => asignarCurvaDesdeOrdenes(id, idsTalla),
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
      void queryClient.invalidateQueries({ queryKey: claveFicha(variables.id) });
    },
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

async function copiarBom(id: number, cuerpo: CopiarBomCuerpo): Promise<void> {
  const { data, error } = await api.POST('/api/modelos/{id}/copiar-bom', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
}

// ── ⭐ V1-E3v (§Post-F9.90) — avíos FAVORITOS de la receta ────────────────────
// La lista y la cantidad SIEMPRE vienen del servidor: aquí no hay ni un avío ni un número.

async function leerFavoritosBom(id: number): Promise<AviosFavoritosSugerencia> {
  const { data, error } = await api.GET('/api/modelos/{id}/bom/avios/favoritos', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function aceptarFavoritosBom(id: number): Promise<AviosFavoritosAceptados> {
  const { data, error } = await api.POST('/api/modelos/{id}/bom/avios/favoritos', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Sugerencia de avíos favoritos para la receta de un modelo (deshabilitada sin id, p. ej. en alta). */
export function useAviosFavoritosBom(
  id: number | undefined,
): UseQueryResult<AviosFavoritosSugerencia, ErrorDeApi> {
  return useQuery({
    queryKey: claveFavoritosBom(id ?? 0),
    queryFn: () => leerFavoritosBom(id as number),
    enabled: id !== undefined,
  });
}

/**
 * EL ACTO ÚNICO: acepta todos los favoritos que le faltan a la receta. Invalida la ficha (el BOM
 * cambió) y la propia sugerencia (los aceptados pasan a `yaEnLaReceta`).
 */
export function useAceptarAviosFavoritos(): UseMutationResult<
  AviosFavoritosAceptados,
  ErrorDeApi,
  number
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => aceptarFavoritosBom(id),
    onSuccess: (_r, id) => {
      invalidarFichaYLista(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: claveFavoritosBom(id) });
    },
  });
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
 * Si el PUT a R2 falla, se QUITA la foto que el paso 1 ya había creado (si no, cada intento
 * fallido deja una foto vacía en la galería e infla el conteo) y se propaga como `ErrorDeApi`
 * para que el toast lo muestre. El detalle del mensaje y de la limpieza vive en
 * `subida-archivo.ts` (mismo paso 2 para todos los módulos).
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
  await subirArchivoPrefirmado({
    urlSubida: data.urlSubida,
    archivo,
    tipoMime: archivo.type,
    sustantivo: 'la imagen',
    limpiar: () => quitarFoto(idModelo, data.idFoto),
  });
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

/**
 * Marca una foto como la PRINCIPAL del modelo (jul-2026, Daniel: *"es la más importante"*): el
 * backend la mueve al primer lugar y reindexa el resto. La principal es SIEMPRE la primera de la
 * lista — no hay bandera que pueda contradecir al orden.
 */
async function marcarFotoPrincipal(idModelo: number, idFoto: number): Promise<ModeloFoto[]> {
  const { data, error } = await api.POST('/api/modelos/{id}/fotos/{idFoto}/principal', {
    params: { path: { id: idModelo, idFoto } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/** Argumentos de marcar la foto principal. */
export interface ArgsFotoPrincipal {
  idModelo: number;
  idFoto: number;
}

/**
 * Marca la foto principal del modelo e invalida las fotos + el listado y la ficha (la miniatura
 * del catálogo es justo la principal, `urlFotoPrincipal`).
 */
export function useMarcarFotoPrincipal(): UseMutationResult<
  ModeloFoto[],
  ErrorDeApi,
  ArgsFotoPrincipal
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idModelo, idFoto }: ArgsFotoPrincipal) => marcarFotoPrincipal(idModelo, idFoto),
    onSuccess: (_r, v) => {
      void queryClient.invalidateQueries({ queryKey: claveFotos(v.idModelo) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_MODELOS });
      void queryClient.invalidateQueries({ queryKey: claveFicha(v.idModelo) });
    },
  });
}

// ══ ⭐⭐ V1-E8r — BANDEJA «Recetas por revisar» (§Post-F9.140, DANIEL) ═══════════════════════════

/** Página de la bandeja «Recetas por revisar» (`GET /api/recetas-por-revisar`). */
export type RecetasPorRevisarPagina =
  paths['/api/recetas-por-revisar']['get']['responses']['200']['content']['application/json'];
/** Una versión que espera revisión de receta. */
export type RecetaPorRevisar = RecetasPorRevisarPagina['datos'][number];

/** Filtros de la bandeja (lo que viaja en la URL del endpoint). */
export interface FiltrosRecetasPorRevisar {
  pagina?: number;
  porPagina?: number;
  soloConPedido?: boolean;
  busqueda?: string;
}

/**
 * BANDEJA «Recetas por revisar» (§Post-F9.140): las versiones negociadas a las que la revisión les
 * niega producción. La fecha comprometida, las piezas y la marca de "ya frena dinero" vienen
 * **agregadas del servidor** (A1: aquí no se suma nada). Sólo lectura: firmar es otro endpoint.
 */
export function useRecetasPorRevisar(
  filtros: FiltrosRecetasPorRevisar = {},
): UseQueryResult<RecetasPorRevisarPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_RECETAS_POR_REVISAR, filtros],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/recetas-por-revisar', {
        params: {
          query: {
            pagina: filtros.pagina ?? 1,
            porPagina: filtros.porPagina ?? 20,
            soloConPedido: filtros.soloConPedido === true ? 'true' : 'false',
            ...(filtros.busqueda === undefined || filtros.busqueda === ''
              ? {}
              : { busqueda: filtros.busqueda }),
          },
        },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
  });
}
