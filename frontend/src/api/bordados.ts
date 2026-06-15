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
 * Capa de datos de Bordados/estampados (F1-E3) — replica del ESTANDAR de Almacenes
 * (`api/almacenes.ts`) + el flujo de archivos en R2 de los adjuntos del proveedor
 * (`api/proveedores.ts`). Llama al cliente TIPADO del OpenAPI, normaliza (`data` en
 * exito, `ErrorDeApi` con el mensaje del backend en fallo) y expone consultas/
 * mutaciones; las mutaciones invalidan la cache de la lista. CERO logica de negocio:
 * el backend valida, autoriza y decide (A1).
 *
 * Los alias de tipo del contrato viven AQUI (no en `api/tipos.ts` compartido): este
 * modulo es autonomo. Las rutas `/api/bordados*` se incorporan al OpenAPI cuando la
 * integracion regenera el cliente (`npm run gen:api`); hasta entonces, el typecheck del
 * frontend puede señalar que estos paths no existen aun en `paths[...]` — es deuda
 * esperada que cierra la integracion, NO se tapa con `any`.
 */

// ── Alias de tipos del contrato (derivados del OpenAPI generado) ──────────────

/** Pagina de bordados (`GET /api/bordados`). */
export type BordadosPagina =
  paths['/api/bordados']['get']['responses']['200']['content']['application/json'];
/** Un bordado tal como lo devuelve el API. */
export type Bordado = BordadosPagina['datos'][number];
/** Parametros de consulta del listado de bordados (querystring). */
export type BordadosQuery = NonNullable<paths['/api/bordados']['get']['parameters']['query']>;
/** Tipo de bordado (BORDADO/ESTAMPADO). */
export type TipoBordado = Bordado['tipo'];
/** Cuerpo de alta de bordado (`POST /api/bordados`). */
export type BordadoCrear =
  paths['/api/bordados']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de bordado (`PATCH /api/bordados/{id}`). */
export type BordadoEditar =
  paths['/api/bordados/{id}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo para preparar la subida de la foto (`POST /api/bordados/{id}/foto`). */
export type BordadoFotoCrear =
  paths['/api/bordados/{id}/foto']['post']['requestBody']['content']['application/json'];
/** Respuesta al preparar la subida de la foto (registro + URL PUT prefirmada). */
export type BordadoFotoSubida =
  paths['/api/bordados/{id}/foto']['post']['responses']['201']['content']['application/json'];
/** Foto de un bordado con su URL de descarga (`GET /api/bordados/{id}/foto`). */
export type BordadoFoto =
  paths['/api/bordados/{id}/foto']['get']['responses']['200']['content']['application/json'];

// ── Llaves de cache ───────────────────────────────────────────────────────────

/** Clave raiz de la cache de bordados en TanStack Query. */
export const CLAVE_BORDADOS = ['bordados'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaBordados(query: BordadosQuery): readonly unknown[] {
  return [...CLAVE_BORDADOS, 'lista', query];
}

/** Clave de cache de la foto de UN bordado. */
function claveFoto(idBordado: number): readonly unknown[] {
  return [...CLAVE_BORDADOS, 'foto', idBordado];
}

// ── Llamadas al API (normalizadas) ────────────────────────────────────────────

/** Pide una pagina del listado de bordados (busqueda + tipo + orden + paginacion en servidor). */
async function listarBordados(query: BordadosQuery): Promise<BordadosPagina> {
  const { data, error } = await api.GET('/api/bordados', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un bordado (`POST /api/bordados`). */
async function crearBordado(cuerpo: BordadoCrear): Promise<Bordado> {
  const { data, error } = await api.POST('/api/bordados', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un bordado (`PATCH /api/bordados/{id}`). */
async function actualizarBordado(id: number, cuerpo: BordadoEditar): Promise<Bordado> {
  const { data, error } = await api.PATCH('/api/bordados/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un bordado (borrado SUAVE, `DELETE /api/bordados/{id}`). */
async function desactivarBordado(id: number): Promise<Bordado> {
  const { data, error } = await api.DELETE('/api/bordados/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva un bordado desactivado (restaura el borrado suave) con `{ activo: true }`. */
async function reactivarBordado(id: number): Promise<Bordado> {
  const { data, error } = await api.PATCH('/api/bordados/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Pide la foto de un bordado (URL de descarga, o vacío si no tiene). */
async function obtenerFoto(idBordado: number): Promise<BordadoFoto> {
  const { data, error } = await api.GET('/api/bordados/{id}/foto', {
    params: { path: { id: idBordado } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks de CRUD ─────────────────────────────────────────────────────────────

/** Lista bordados con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useBordados(query: BordadosQuery): UseQueryResult<BordadosPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaBordados(query),
    queryFn: () => listarBordados(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un bordado e invalida la lista para reflejarlo. */
export function useCrearBordado(): UseMutationResult<Bordado, ErrorDeApi, BordadoCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearBordado,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_BORDADOS }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarBordado {
  id: number;
  cuerpo: BordadoEditar;
}

/** Edita un bordado e invalida la lista. */
export function useActualizarBordado(): UseMutationResult<
  Bordado,
  ErrorDeApi,
  ArgsActualizarBordado
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarBordado) => actualizarBordado(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_BORDADOS }),
  });
}

/** Desactiva un bordado (borrado suave) e invalida la lista. */
export function useDesactivarBordado(): UseMutationResult<Bordado, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarBordado,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_BORDADOS }),
  });
}

/** Reactiva un bordado desactivado (restaura el borrado suave) e invalida la lista. */
export function useReactivarBordado(): UseMutationResult<Bordado, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarBordado,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_BORDADOS }),
  });
}

// ── Foto del bordado (presigned: POST metadatos → PUT directo a R2) ───────────

/** Lee la foto de un bordado (deshabilitada si no hay id, p. ej. en alta). */
export function useFotoBordado(
  idBordado: number | undefined,
): UseQueryResult<BordadoFoto, ErrorDeApi> {
  return useQuery({
    queryKey: claveFoto(idBordado ?? 0),
    queryFn: () => obtenerFoto(idBordado as number),
    enabled: idBordado !== undefined,
  });
}

/** Argumentos de la mutacion de subida de la foto. */
export interface ArgsSubirFoto {
  idBordado: number;
  /** La imagen elegida por el usuario. */
  archivo: File;
}

/**
 * Sube la FOTO de un bordado a R2 en DOS pasos (flujo presigned de F0):
 *   1) `POST /api/bordados/{id}/foto` con los metadatos → el backend registra el
 *      `Archivo`, liga la foto al bordado y devuelve una URL PUT prefirmada.
 *   2) El navegador hace `PUT` de la imagen DIRECTO a esa URL (R2) con su
 *      `Content-Type`. La URL prefirmada NO firma content-type/content-length (el
 *      navegador los maneja como headers especiales y romperían el SigV4), así que
 *      el PUT cuadra y R2 lo acepta.
 *
 * Si el PUT a R2 falla, se propaga como `ErrorDeApi` para que el toast lo muestre.
 * Al terminar invalida la foto del bordado y la lista (para refrescar `idArchivoFoto`).
 */
async function subirFoto({ idBordado, archivo }: ArgsSubirFoto): Promise<void> {
  const { data, error } = await api.POST('/api/bordados/{id}/foto', {
    params: { path: { id: idBordado } },
    body: {
      nombreOriginal: archivo.name,
      tipoMime: archivo.type,
      tamanoBytes: archivo.size,
    },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }

  // Paso 2: PUT directo a R2 con los headers EXACTOS (tipo y tamaño firmados).
  let respuesta: Response;
  try {
    respuesta = await fetch(data.urlSubida, {
      method: 'PUT',
      // Solo Content-Type (para que R2 etiquete el objeto con su tipo). NO se
      // manda Content-Length: es un "forbidden header" que el navegador fija solo,
      // y la URL prefirmada ya no lo firma (ver backend comun/archivos.ts).
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

/** Sube la foto (presigned PUT) e invalida la foto y la lista de bordados. */
export function useSubirFotoBordado(): UseMutationResult<void, ErrorDeApi, ArgsSubirFoto> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subirFoto,
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: claveFoto(variables.idBordado) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_BORDADOS });
    },
  });
}

/** Quita la foto de un bordado (`DELETE /api/bordados/{id}/foto`). */
async function quitarFoto(idBordado: number): Promise<void> {
  const { error, response } = await api.DELETE('/api/bordados/{id}/foto', {
    params: { path: { id: idBordado } },
  });
  // 204 No Content: éxito sin cuerpo; cualquier !ok es error.
  if (!response.ok) {
    throw new ErrorDeApi(error);
  }
}

/** Quita la foto e invalida la foto y la lista de bordados. */
export function useQuitarFotoBordado(): UseMutationResult<void, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: quitarFoto,
    onSuccess: (_resultado, idBordado) => {
      void queryClient.invalidateQueries({ queryKey: claveFoto(idBordado) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_BORDADOS });
    },
  });
}
