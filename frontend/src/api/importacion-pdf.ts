import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import { CLAVE_ORDENES } from './ordenes';
import { CLAVE_ORDENES_CENTRO } from './ordenes-centro';
import { CLAVE_PEDIDOS } from './pedidos';
import type {
  AnalizarPdf,
  AnalizarPdfCuerpo,
  ConfirmarPdf,
  ConfirmarPdfCuerpo,
  PlantillaImportacionVigente,
} from './tipos';

/**
 * Capa de datos del IMPORTADOR de OC del cliente por PDF (petición Daniel — plantilla C&A): analizar N
 * PDFs (vista previa, un renglón por PDF con su liga sugerida) y confirmar (crea el pedido interno + una
 * OP por PDF con matriz + RC + adjunto, y aprende las ligas). Mismo ESTÁNDAR que `api/importacion-pedido.ts`:
 * cliente TIPADO del OpenAPI, normalización (`data`/`ErrorDeApi`), mutaciones que invalidan la cache.
 * CERO lógica de negocio (A1): el parseo del PDF, el reconocimiento y la transacción de alta son del backend.
 */

/**
 * Mensaje para cuando la petición **no llega a tener respuesta**: el `fetch` revienta a nivel
 * de red y no hay `{ codigo, mensaje }` que mostrar. En cualquier otra pantalla eso es raro;
 * aquí es el modo de fallo típico, porque el cuerpo va cargado de PDFs en base64 y basta con
 * que un intermediario (nginx, el proxy de Railway) lo corte por tamaño para que la conexión
 * se cierre **sin** un 413 legible: el navegador sólo dice «Failed to fetch», que fue
 * exactamente lo que vio Daniel.
 *
 * El texto NO afirma la causa —no la sabemos desde aquí— pero sí da la salida que funciona,
 * que es mandar menos archivos. Mentir con seguridad («los archivos pesan demasiado») sería
 * peor que el mensaje del navegador: mandaría a buscar un problema que puede no existir
 * cuando lo que se cayó fue el internet.
 */
const MENSAJE_ENVIO_FALLIDO =
  'No se pudo enviar la petición al servidor. Si cargaste varios PDFs, prueba con menos ' +
  'archivos a la vez; si el problema sigue con uno solo, revisa tu conexión.';

/**
 * Corre una llamada del importador y traduce un fallo **de red** a un `ErrorDeApi` con un
 * mensaje que se pueda enseñar. Los errores que SÍ traen respuesta del servidor pasan
 * intactos: el mensaje del backend siempre gana (A1 — la pantalla no razona reglas).
 */
async function conEnvioLegible<T>(llamada: () => Promise<T>): Promise<T> {
  try {
    return await llamada();
  } catch (error) {
    if (error instanceof ErrorDeApi) throw error;
    throw new ErrorDeApi({ codigo: 'ENVIO_FALLIDO', mensaje: MENSAJE_ENVIO_FALLIDO });
  }
}

/** Analiza los PDFs del cliente (un renglón por PDF: campos + liga sugerida + advertencias). */
async function analizar(cuerpo: AnalizarPdfCuerpo): Promise<AnalizarPdf> {
  return conEnvioLegible(async () => {
    const { data, error } = await api.POST('/api/pedidos/importacion-pdf/analizar', {
      body: cuerpo,
    });
    if (!data) throw new ErrorDeApi(error);
    return data;
  });
}

/** Analiza los PDFs de C&A: vista previa por PDF con su liga aprendida y sus advertencias. */
export function useAnalizarPdf(): UseMutationResult<AnalizarPdf, ErrorDeApi, AnalizarPdfCuerpo> {
  return useMutation({ mutationFn: analizar });
}

/**
 * Plantilla de importación VIGENTE de un cliente (para pre-cargar el % adicional guardado). Sólo corre
 * con un cliente elegido. Reusa el endpoint del importador Excel (`pedidos.ver`).
 */
export function usePlantillaVigente(
  idCliente: number | null,
): UseQueryResult<PlantillaImportacionVigente, ErrorDeApi> {
  return useQuery({
    queryKey: ['plantilla-importacion-vigente', idCliente],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/pedidos/importacion/plantillas/{idCliente}', {
        params: { path: { idCliente: idCliente as number } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    enabled: idCliente !== null,
  });
}

/** Confirma la importación por PDF (crea pedido + OPs con matriz + RC + adjuntos). */
async function confirmar(cuerpo: ConfirmarPdfCuerpo): Promise<ConfirmarPdf> {
  return conEnvioLegible(async () => {
    const { data, error } = await api.POST('/api/pedidos/importacion-pdf/confirmar', {
      body: cuerpo,
    });
    if (!data) throw new ErrorDeApi(error);
    return data;
  });
}

/**
 * Confirma la importación por PDF: crea el pedido interno + las OPs con su matriz + su RC + su adjunto
 * (reusa `salidaAProduccion`). Invalida pedidos (la consulta por mes muestra el pedido nuevo) y órdenes
 * (el centro de comando lista las OPs nacidas).
 */
export function useConfirmarPdf(): UseMutationResult<ConfirmarPdf, ErrorDeApi, ConfirmarPdfCuerpo> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: confirmar,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_PEDIDOS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES_CENTRO });
    },
  });
}
