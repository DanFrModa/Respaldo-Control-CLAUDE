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

/**
 * Capa de datos del TECH PACK / ADJUNTOS del DESARROLLO (rediseño R5, B16) — PDFs de referencia y
 * fotos de muestra en R2 vía el flujo presigned de F0. Espejo EXACTO de `api/adjuntos-orden.ts`: el
 * cliente TIPADO del OpenAPI, normalización (`data`/`ErrorDeApi`) y mutaciones que invalidan la lista.
 * CERO lógica de negocio (A1).
 */

/** Lista de adjuntos de un desarrollo (`GET /api/desarrollos/{idDesarrollo}/adjuntos`). */
export type DesarrolloAdjuntosLista =
  paths['/api/desarrollos/{idDesarrollo}/adjuntos']['get']['responses']['200']['content']['application/json'];
/** Un adjunto del desarrollo con su URL de descarga. */
export type DesarrolloAdjunto = DesarrolloAdjuntosLista['datos'][number];

/** Clave de cache de los adjuntos de UN desarrollo. */
function claveAdjuntos(idDesarrollo: number): readonly unknown[] {
  return ['desarrollo-adjuntos', idDesarrollo];
}

async function listar(idDesarrollo: number): Promise<DesarrolloAdjunto[]> {
  const { data, error } = await api.GET('/api/desarrollos/{idDesarrollo}/adjuntos', {
    params: { path: { idDesarrollo } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

/** Lista los adjuntos de un desarrollo (deshabilitada si no hay id). */
export function useAdjuntosDesarrollo(
  idDesarrollo: number | undefined,
): UseQueryResult<DesarrolloAdjunto[], ErrorDeApi> {
  return useQuery({
    queryKey: claveAdjuntos(idDesarrollo ?? 0),
    queryFn: () => listar(idDesarrollo as number),
    enabled: idDesarrollo !== undefined,
  });
}

/** Argumentos de la mutación de subida de un adjunto. */
export interface ArgsSubirAdjuntoDesarrollo {
  idDesarrollo: number;
  archivo: File;
}

/**
 * Sube un adjunto a R2 en DOS pasos (flujo presigned de F0): POST con metadatos → URL PUT prefirmada,
 * luego PUT directo del archivo a R2 con `Content-Type`/`Content-Length` exactos.
 */
async function subir({ idDesarrollo, archivo }: ArgsSubirAdjuntoDesarrollo): Promise<void> {
  const { data, error } = await api.POST('/api/desarrollos/{idDesarrollo}/adjuntos', {
    params: { path: { idDesarrollo } },
    body: {
      nombreOriginal: archivo.name,
      tipoMime: archivo.type || 'application/octet-stream',
      tamanoBytes: archivo.size,
    },
  });
  if (!data) throw new ErrorDeApi(error);

  let respuesta: Response;
  try {
    respuesta = await fetch(data.urlSubida, {
      method: 'PUT',
      headers: {
        'Content-Type': archivo.type || 'application/octet-stream',
        'Content-Length': String(archivo.size),
      },
      body: archivo,
    });
  } catch {
    throw new ErrorDeApi({
      codigo: 'SUBIDA',
      mensaje: 'No se pudo subir el archivo. Verifica tu conexión e intenta de nuevo.',
    });
  }
  if (!respuesta.ok) {
    throw new ErrorDeApi({
      codigo: 'SUBIDA',
      mensaje: 'El almacenamiento rechazó el archivo. Intenta de nuevo.',
    });
  }
}

/** Sube un adjunto (presigned PUT) e invalida la lista de adjuntos del desarrollo. */
export function useSubirAdjuntoDesarrollo(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsSubirAdjuntoDesarrollo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subir,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveAdjuntos(variables.idDesarrollo) }),
  });
}

/** Argumentos de la mutación de quitar un adjunto. */
export interface ArgsQuitarAdjuntoDesarrollo {
  idDesarrollo: number;
  idArchivo: string;
}

async function quitar({ idDesarrollo, idArchivo }: ArgsQuitarAdjuntoDesarrollo): Promise<void> {
  const { error, response } = await api.DELETE(
    '/api/desarrollos/{idDesarrollo}/adjuntos/{idArchivo}',
    { params: { path: { idDesarrollo, idArchivo } } },
  );
  if (!response.ok) throw new ErrorDeApi(error);
}

/** Quita un adjunto e invalida la lista de adjuntos del desarrollo. */
export function useQuitarAdjuntoDesarrollo(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsQuitarAdjuntoDesarrollo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: quitar,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveAdjuntos(variables.idDesarrollo) }),
  });
}
