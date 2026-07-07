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
 * Capa de datos de los ADJUNTOS del pedido interno (rediseño R3, B3) — el documento ORIGINAL de la
 * OC del cliente (Excel/PDF/imágenes) en R2 vía el flujo presigned de F0. Espejo EXACTO de
 * `api/adjuntos-orden.ts` (F8-E6): cliente TIPADO, normalización, mutaciones que invalidan la
 * lista. CERO lógica de negocio (A1).
 */

// ── Alias de tipos del contrato ────────────────────────────────────────────────
/** Lista de adjuntos de un pedido (`GET /api/pedidos/{idPedido}/adjuntos`). */
export type PedidoAdjuntosLista =
  paths['/api/pedidos/{idPedido}/adjuntos']['get']['responses']['200']['content']['application/json'];
/** Un adjunto del pedido con su URL de descarga. */
export type PedidoAdjunto = PedidoAdjuntosLista['datos'][number];

/** Clave de cache de los adjuntos de UN pedido. */
function claveAdjuntos(idPedido: number): readonly unknown[] {
  return ['pedido-adjuntos', idPedido];
}

/** Lista los adjuntos de un pedido. */
async function listar(idPedido: number): Promise<PedidoAdjunto[]> {
  const { data, error } = await api.GET('/api/pedidos/{idPedido}/adjuntos', {
    params: { path: { idPedido } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

/** Lista los adjuntos de un pedido (deshabilitada si no hay id). */
export function useAdjuntosPedido(
  idPedido: number | undefined,
): UseQueryResult<PedidoAdjunto[], ErrorDeApi> {
  return useQuery({
    queryKey: claveAdjuntos(idPedido ?? 0),
    queryFn: () => listar(idPedido as number),
    enabled: idPedido !== undefined,
  });
}

/** Argumentos de la mutación de subida de un adjunto. */
export interface ArgsSubirAdjuntoPedido {
  idPedido: number;
  /** El archivo elegido por el usuario (el documento de la OC del cliente). */
  archivo: File;
}

/**
 * Sube un adjunto a R2 en DOS pasos (flujo presigned de F0): registra los metadatos y hace `PUT`
 * del archivo DIRECTO a la URL prefirmada (Content-Type/Length exactos — la firma solo acepta esos).
 */
async function subir({ idPedido, archivo }: ArgsSubirAdjuntoPedido): Promise<void> {
  const { data, error } = await api.POST('/api/pedidos/{idPedido}/adjuntos', {
    params: { path: { idPedido } },
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

/** Sube un adjunto (presigned PUT) e invalida la lista de adjuntos del pedido. */
export function useSubirAdjuntoPedido(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsSubirAdjuntoPedido
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subir,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveAdjuntos(variables.idPedido) }),
  });
}

/** Argumentos de la mutación de quitar un adjunto. */
export interface ArgsQuitarAdjuntoPedido {
  idPedido: number;
  idArchivo: string;
}

/** Quita un adjunto (`DELETE /api/pedidos/{idPedido}/adjuntos/{idArchivo}`). */
async function quitar({ idPedido, idArchivo }: ArgsQuitarAdjuntoPedido): Promise<void> {
  const { error, response } = await api.DELETE('/api/pedidos/{idPedido}/adjuntos/{idArchivo}', {
    params: { path: { idPedido, idArchivo } },
  });
  // 204 No Content: éxito sin cuerpo; cualquier !ok es error.
  if (!response.ok) throw new ErrorDeApi(error);
}

/** Quita un adjunto e invalida la lista de adjuntos del pedido. */
export function useQuitarAdjuntoPedido(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsQuitarAdjuntoPedido
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: quitar,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveAdjuntos(variables.idPedido) }),
  });
}
