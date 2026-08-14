import {
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
 * Capa de datos de los ADJUNTOS de la orden de producción (F8-E6, R6) — archivos de apoyo
 * (Excel/PDF/imágenes) en R2 vía el flujo presigned de F0. Mismo ESTÁNDAR que los adjuntos de
 * proveedor (`api/proveedores.ts`): el cliente TIPADO del OpenAPI, normalización (`data`/`ErrorDeApi`)
 * y mutaciones que invalidan la lista de adjuntos. CERO lógica de negocio (A1).
 */

// ── Alias de tipos del contrato ────────────────────────────────────────────────
/** Lista de adjuntos de una orden (`GET /api/ordenes/{idOrden}/adjuntos`). */
export type OrdenAdjuntosLista =
  paths['/api/ordenes/{idOrden}/adjuntos']['get']['responses']['200']['content']['application/json'];
/** Un adjunto de la orden con su URL de descarga. */
export type OrdenAdjunto = OrdenAdjuntosLista['datos'][number];

/** Clave de cache de los adjuntos de UNA orden. */
function claveAdjuntos(idOrden: number): readonly unknown[] {
  return ['orden-adjuntos', idOrden];
}

/** Lista los adjuntos de una orden. */
async function listar(idOrden: number): Promise<OrdenAdjunto[]> {
  const { data, error } = await api.GET('/api/ordenes/{idOrden}/adjuntos', {
    params: { path: { idOrden } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

/** Lista los adjuntos de una orden (deshabilitada si no hay id). */
export function useAdjuntosOrden(
  idOrden: number | undefined,
): UseQueryResult<OrdenAdjunto[], ErrorDeApi> {
  return useQuery({
    queryKey: claveAdjuntos(idOrden ?? 0),
    queryFn: () => listar(idOrden as number),
    enabled: idOrden !== undefined,
  });
}

/** Argumentos de la mutación de subida de un adjunto. */
export interface ArgsSubirAdjuntoOrden {
  idOrden: number;
  /** El archivo elegido por el usuario (Excel/PDF/imagen). */
  archivo: File;
}

/**
 * Sube un adjunto a R2 en DOS pasos (flujo presigned de F0):
 *   1) `POST /api/ordenes/{idOrden}/adjuntos` con los metadatos → el backend registra el `Archivo`
 *      y devuelve una URL PUT prefirmada.
 *   2) El navegador hace `PUT` del archivo DIRECTO a esa URL (R2) con `Content-Type`/`Content-Length`
 *      exactos (la firma solo acepta esos).
 *
 * Si el PUT a R2 falla, se QUITA el adjunto que el paso 1 ya había registrado (si no, la orden queda
 * listando un archivo que nunca llegó) y se propaga como `ErrorDeApi` para el toast. El detalle del
 * mensaje y de la limpieza vive en `subida-archivo.ts`.
 */
async function subir({ idOrden, archivo }: ArgsSubirAdjuntoOrden): Promise<void> {
  const { data, error } = await api.POST('/api/ordenes/{idOrden}/adjuntos', {
    params: { path: { idOrden } },
    body: {
      nombreOriginal: archivo.name,
      tipoMime: archivo.type || 'application/octet-stream',
      tamanoBytes: archivo.size,
    },
  });
  if (!data) throw new ErrorDeApi(error);

  await subirArchivoPrefirmado({
    urlSubida: data.urlSubida,
    archivo,
    tipoMime: archivo.type || 'application/octet-stream',
    conContentLength: true,
    sustantivo: 'el archivo',
    limpiar: () => quitar({ idOrden, idArchivo: data.idArchivo }),
  });
}

/** Sube un adjunto (presigned PUT) e invalida la lista de adjuntos de la orden. */
export function useSubirAdjuntoOrden(): UseMutationResult<void, ErrorDeApi, ArgsSubirAdjuntoOrden> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subir,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveAdjuntos(variables.idOrden) }),
  });
}

/** Argumentos de la mutación de quitar un adjunto. */
export interface ArgsQuitarAdjuntoOrden {
  idOrden: number;
  idArchivo: string;
}

/** Quita un adjunto (`DELETE /api/ordenes/{idOrden}/adjuntos/{idArchivo}`). */
async function quitar({ idOrden, idArchivo }: ArgsQuitarAdjuntoOrden): Promise<void> {
  const { error, response } = await api.DELETE('/api/ordenes/{idOrden}/adjuntos/{idArchivo}', {
    params: { path: { idOrden, idArchivo } },
  });
  // 204 No Content: éxito sin cuerpo; cualquier !ok es error.
  if (!response.ok) throw new ErrorDeApi(error);
}

/** Quita un adjunto e invalida la lista de adjuntos de la orden. */
export function useQuitarAdjuntoOrden(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsQuitarAdjuntoOrden
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: quitar,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveAdjuntos(variables.idOrden) }),
  });
}
