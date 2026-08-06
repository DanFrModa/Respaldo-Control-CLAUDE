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
 * Capa de datos de la ENTRADA DE TELA por FACTURA/REMISIÓN sin orden de compra (etapa B1 — Daniel
 * §Post-F9.9 punto 7). Mismo ESTÁNDAR que el resto: llama al cliente TIPADO del OpenAPI, normaliza
 * (`data` / `ErrorDeApi`) y expone hooks de TanStack Query; las mutaciones invalidan la caché.
 * CERO lógica de negocio (A1): el backend valida (folio, partidas, kardex, no-negativo, inverso de
 * cancelación) y decide qué precios se ven (ex-acceso #7 `telas.ver-totales`).
 *
 * Incluye los ADJUNTOS del documento (el PDF de la factura) con el flujo presigned de F0: registrar
 * metadatos → `PUT` directo a R2.
 */

/** Clave raíz de la caché de entradas de tela. */
export const CLAVE_ENTRADAS_TELA = ['entradas-tela'] as const;

// ── Alias de tipos del contrato ────────────────────────────────────────────────

/** Página de entradas de tela (`GET /api/inventarios/telas/entradas`). */
export type EntradasTelaPagina =
  paths['/api/inventarios/telas/entradas']['get']['responses']['200']['content']['application/json'];
/** Un documento de entrada de tela tal como lo devuelve el API. */
export type EntradaTela = EntradasTelaPagina['datos'][number];
/** Un renglón (partida) del documento. */
export type EntradaTelaLinea = EntradaTela['lineas'][number];
/** Parámetros del listado (querystring). */
export type EntradasTelaQuery = NonNullable<
  paths['/api/inventarios/telas/entradas']['get']['parameters']['query']
>;
/** Cuerpo de alta de una entrada de tela. */
export type EntradaTelaCrear =
  paths['/api/inventarios/telas/entradas']['post']['requestBody']['content']['application/json'];
/** Un renglón de captura del documento. */
export type EntradaTelaLineaEntrada = NonNullable<EntradaTelaCrear['lineas']>[number];
/** Cuerpo de la cancelación (motivo obligatorio). */
export type EntradaTelaCancelar =
  paths['/api/inventarios/telas/entradas/{id}/cancelar']['post']['requestBody']['content']['application/json'];
/** Lista de adjuntos del documento. */
export type EntradaTelaAdjuntosLista =
  paths['/api/inventarios/telas/entradas/{id}/adjuntos']['get']['responses']['200']['content']['application/json'];
/** Un adjunto del documento (con su URL de descarga). */
export type EntradaTelaAdjunto = EntradaTelaAdjuntosLista['datos'][number];

// ── Llamadas ───────────────────────────────────────────────────────────────────

async function listar(query: EntradasTelaQuery): Promise<EntradasTelaPagina> {
  const { data, error } = await api.GET('/api/inventarios/telas/entradas', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function obtener(id: number): Promise<EntradaTela> {
  const { data, error } = await api.GET('/api/inventarios/telas/entradas/{id}', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function crear(cuerpo: EntradaTelaCrear): Promise<EntradaTela> {
  const { data, error } = await api.POST('/api/inventarios/telas/entradas', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Argumentos de la edición del borrador. */
export interface ArgsActualizarEntradaTela {
  id: number;
  cuerpo: EntradaTelaCrear;
}

async function actualizar({ id, cuerpo }: ArgsActualizarEntradaTela): Promise<EntradaTela> {
  const { data, error } = await api.PUT('/api/inventarios/telas/entradas/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function confirmar(id: number): Promise<EntradaTela> {
  const { data, error } = await api.POST('/api/inventarios/telas/entradas/{id}/confirmar', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Argumentos de la cancelación (motivo obligatorio). */
export interface ArgsCancelarEntradaTela {
  id: number;
  cuerpo: EntradaTelaCancelar;
}

async function cancelar({ id, cuerpo }: ArgsCancelarEntradaTela): Promise<EntradaTela> {
  const { data, error } = await api.POST('/api/inventarios/telas/entradas/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

// ── Consultas ──────────────────────────────────────────────────────────────────

/** Listado paginado de documentos de entrada de tela. */
export function useEntradasTela(
  query: EntradasTelaQuery,
): UseQueryResult<EntradasTelaPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ENTRADAS_TELA, 'lista', query],
    queryFn: () => listar(query),
    placeholderData: keepPreviousData,
  });
}

/** Detalle de un documento (apagada sin id). */
export function useEntradaTela(id: number | undefined): UseQueryResult<EntradaTela, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ENTRADAS_TELA, 'detalle', id],
    queryFn: () => obtener(id as number),
    enabled: id !== undefined,
  });
}

// ── Mutaciones ─────────────────────────────────────────────────────────────────

/** Invalida TODA la caché de entradas de tela + la del inventario (la existencia cambió). */
function useInvalidar(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CLAVE_ENTRADAS_TELA });
    void queryClient.invalidateQueries({ queryKey: ['inventario-materiales'] });
  };
}

/** Captura un documento nuevo (queda en borrador). */
export function useCrearEntradaTela(): UseMutationResult<
  EntradaTela,
  ErrorDeApi,
  EntradaTelaCrear
> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: crear, onSuccess: invalidar });
}

/** Edita un documento en borrador. */
export function useActualizarEntradaTela(): UseMutationResult<
  EntradaTela,
  ErrorDeApi,
  ArgsActualizarEntradaTela
> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: actualizar, onSuccess: invalidar });
}

/** Confirma el documento: crea las partidas y da la entrada al inventario. */
export function useConfirmarEntradaTela(): UseMutationResult<EntradaTela, ErrorDeApi, number> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: confirmar, onSuccess: invalidar });
}

/** Cancela el documento (inverso auditado si ya estaba confirmado). */
export function useCancelarEntradaTela(): UseMutationResult<
  EntradaTela,
  ErrorDeApi,
  ArgsCancelarEntradaTela
> {
  const invalidar = useInvalidar();
  return useMutation({ mutationFn: cancelar, onSuccess: invalidar });
}

// ── Adjuntos (el PDF de la factura) ────────────────────────────────────────────

/** Clave de caché de los adjuntos de UNA entrada. */
function claveAdjuntos(id: number): readonly unknown[] {
  return [...CLAVE_ENTRADAS_TELA, 'adjuntos', id];
}

async function listarAdjuntos(id: number): Promise<EntradaTelaAdjunto[]> {
  const { data, error } = await api.GET('/api/inventarios/telas/entradas/{id}/adjuntos', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

/** Lista los adjuntos de una entrada (apagada sin id). */
export function useAdjuntosEntradaTela(
  id: number | undefined,
): UseQueryResult<EntradaTelaAdjunto[], ErrorDeApi> {
  return useQuery({
    queryKey: claveAdjuntos(id ?? 0),
    queryFn: () => listarAdjuntos(id as number),
    enabled: id !== undefined,
  });
}

/** Argumentos de la subida de un adjunto. */
export interface ArgsSubirAdjuntoEntradaTela {
  id: number;
  /** El archivo elegido (típicamente el PDF de la factura). */
  archivo: File;
}

/**
 * Sube un adjunto a R2 en DOS pasos (flujo presigned de F0): registra los metadatos y hace `PUT`
 * del archivo DIRECTO a la URL prefirmada (Content-Type/Length exactos — la firma sólo acepta esos).
 */
async function subirAdjunto({ id, archivo }: ArgsSubirAdjuntoEntradaTela): Promise<void> {
  const { data, error } = await api.POST('/api/inventarios/telas/entradas/{id}/adjuntos', {
    params: { path: { id } },
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

/** Sube un adjunto (presigned PUT) e invalida la lista de adjuntos. */
export function useSubirAdjuntoEntradaTela(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsSubirAdjuntoEntradaTela
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subirAdjunto,
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: claveAdjuntos(variables.id) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ENTRADAS_TELA });
    },
  });
}

/** Argumentos de quitar un adjunto. */
export interface ArgsQuitarAdjuntoEntradaTela {
  id: number;
  idArchivo: string;
}

async function quitarAdjunto({ id, idArchivo }: ArgsQuitarAdjuntoEntradaTela): Promise<void> {
  const { error, response } = await api.DELETE(
    '/api/inventarios/telas/entradas/{id}/adjuntos/{idArchivo}',
    { params: { path: { id, idArchivo } } },
  );
  // 204 No Content: éxito sin cuerpo; cualquier !ok es error.
  if (!response.ok) throw new ErrorDeApi(error);
}

/** Quita un adjunto e invalida la lista. */
export function useQuitarAdjuntoEntradaTela(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsQuitarAdjuntoEntradaTela
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: quitarAdjunto,
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: claveAdjuntos(variables.id) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ENTRADAS_TELA });
    },
  });
}
