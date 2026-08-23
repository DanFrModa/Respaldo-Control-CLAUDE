import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import { CLAVE_ORDENES } from './ordenes';
import { CLAVE_ORDENES_CENTRO } from './ordenes-centro';
import { CLAVE_PEDIDOS } from './pedidos';
import type {
  AnalizarImportacion,
  AnalizarImportacionCuerpo,
  ConfirmarImportacion,
  ConfirmarImportacionCuerpo,
  PlantillaImportacion,
  PlantillaImportacionGuardar,
} from './tipos';

/**
 * Capa de datos del IMPORTADOR del pedido del cliente (rediseño R8, B15 — proto §4.1 "Etapa 3"):
 * analizar el Excel, guardar/versionar la plantilla de mapeo del cliente y confirmar (crea el pedido
 * interno + las OPs con matriz + su RC). Mismo ESTÁNDAR que `api/pedidos-mes.ts`: cliente TIPADO del
 * OpenAPI, normalización (`data`/`ErrorDeApi`), mutaciones que invalidan la cache. CERO lógica de
 * negocio (A1): el parseo, el reconocimiento y la transacción de alta son del backend.
 */

/** Analiza el archivo del cliente (encabezados/muestras + plantilla vigente + vista previa). */
async function analizar(cuerpo: AnalizarImportacionCuerpo): Promise<AnalizarImportacion> {
  const { data, error } = await api.POST('/api/pedidos/importacion/analizar', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Analiza el Excel del cliente: columnas para mapear + vista previa de reconocidos/no. */
export function useAnalizarImportacion(): UseMutationResult<
  AnalizarImportacion,
  ErrorDeApi,
  AnalizarImportacionCuerpo
> {
  return useMutation({ mutationFn: analizar });
}

/** Argumentos de guardar plantilla (cliente + mapeo). */
export interface ArgsGuardarPlantilla {
  idCliente: number;
  cuerpo: PlantillaImportacionGuardar;
}

/** Guarda el formato del cliente como versión NUEVA. */
async function guardarPlantilla({
  idCliente,
  cuerpo,
}: ArgsGuardarPlantilla): Promise<PlantillaImportacion> {
  const { data, error } = await api.POST('/api/pedidos/importacion/plantillas/{idCliente}', {
    params: { path: { idCliente } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Guarda/versiona la plantilla de mapeo de un cliente (la anterior deja de ser vigente). */
export function useGuardarPlantilla(): UseMutationResult<
  PlantillaImportacion,
  ErrorDeApi,
  ArgsGuardarPlantilla
> {
  return useMutation({ mutationFn: guardarPlantilla });
}

/** Confirma la importación (crea pedido + OPs + RC). */
async function confirmar(cuerpo: ConfirmarImportacionCuerpo): Promise<ConfirmarImportacion> {
  const { data, error } = await api.POST('/api/pedidos/importacion/confirmar', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/**
 * Confirma la importación: crea el pedido interno + las OPs con su matriz + su RC (reusa
 * `salidaAProduccion`). Invalida pedidos (la consulta por mes muestra el pedido nuevo) y órdenes
 * (el centro de comando lista las OPs nacidas).
 */
export function useConfirmarImportacion(): UseMutationResult<
  ConfirmarImportacion,
  ErrorDeApi,
  ConfirmarImportacionCuerpo
> {
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

/**
 * Lee un `File` como base64 (sin el prefijo `data:`), para mandarlo en el JSON del importador.
 * Devuelve solo la parte base64 (el backend también acepta el prefijo, pero lo quitamos aquí).
 */
export function archivoABase64(archivo: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => {
      const resultado = typeof lector.result === 'string' ? lector.result : '';
      const coma = resultado.indexOf(',');
      resolver(coma >= 0 ? resultado.slice(coma + 1) : resultado);
    };
    lector.onerror = () => rechazar(new Error('No se pudo leer el archivo.'));
    lector.readAsDataURL(archivo);
  });
}
