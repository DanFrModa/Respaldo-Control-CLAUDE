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

/** Analiza los PDFs del cliente (un renglón por PDF: campos + liga sugerida + advertencias). */
async function analizar(cuerpo: AnalizarPdfCuerpo): Promise<AnalizarPdf> {
  const { data, error } = await api.POST('/api/pedidos/importacion-pdf/analizar', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
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
  const { data, error } = await api.POST('/api/pedidos/importacion-pdf/confirmar', {
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
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
