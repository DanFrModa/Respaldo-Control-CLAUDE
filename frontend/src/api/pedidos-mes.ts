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
import { CLAVE_ORDENES } from './ordenes';
import { CLAVE_ORDENES_CENTRO } from './ordenes-centro';
import { CLAVE_PEDIDOS } from './pedidos';
import type {
  CandidatoDesarrollo,
  PedidosPorMes,
  PedidosPorMesQuery,
  SalidaProduccion,
  SalidaProduccionCuerpo,
} from './tipos';

/**
 * Capa de datos del FLUJO NUEVO de pedidos (rediseño R3, B4/B6 — proto §4.1): la consulta de
 * pedidos POR MES (pantalla nueva), los CANDIDATOS de desarrollo del constructor y la SALIDA A
 * PRODUCCIÓN ("Generar OP"). Mismo ESTÁNDAR que `api/pedidos.ts`: cliente TIPADO del OpenAPI,
 * normalización (`data`/`ErrorDeApi`), mutaciones que invalidan la cache. CERO lógica de negocio
 * (A1): agregados, minteo, liga y RC automática son del backend.
 */

/** Clave de cache de una página de la consulta por mes (depende de los filtros). */
function claveConsultaMes(query: PedidosPorMesQuery): readonly unknown[] {
  return [...CLAVE_PEDIDOS, 'por-mes', query];
}

/** Pide una página de la consulta de pedidos por mes (agrupada + totales en servidor). */
async function consultarPorMes(query: PedidosPorMesQuery): Promise<PedidosPorMes> {
  const { data, error } = await api.GET('/api/pedidos/por-mes', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Consulta de pedidos por mes (mantiene la página previa mientras carga la nueva). */
export function usePedidosPorMes(
  query: PedidosPorMesQuery,
): UseQueryResult<PedidosPorMes, ErrorDeApi> {
  return useQuery({
    queryKey: claveConsultaMes(query),
    queryFn: () => consultarPorMes(query),
    placeholderData: keepPreviousData,
  });
}

/** Busca desarrollos candidatos para un renglón del pedido (typeahead server-side sin acentos). */
async function buscarCandidatos(
  busqueda: string,
  idCliente: number | undefined,
): Promise<CandidatoDesarrollo[]> {
  const { data, error } = await api.GET('/api/pedidos/candidatos-desarrollo', {
    params: {
      query: {
        ...(busqueda === '' ? {} : { busqueda }),
        ...(idCliente === undefined ? {} : { idCliente }),
      },
    },
  });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

/** Candidatos de desarrollo para el ComboboxBuscable del constructor. */
export function useCandidatosDesarrollo(
  busqueda: string,
  idCliente?: number,
): UseQueryResult<CandidatoDesarrollo[], ErrorDeApi> {
  return useQuery({
    queryKey: ['candidatos-desarrollo', busqueda, idCliente ?? null],
    queryFn: () => buscarCandidatos(busqueda, idCliente),
    placeholderData: keepPreviousData,
  });
}

/** Argumentos de la mutación de salida a producción (Generar OP). */
export interface ArgsSalidaProduccion {
  idLinea: number;
  cuerpo: SalidaProduccionCuerpo;
}

/** Genera la OP de un renglón (`POST /api/pedidos/lineas/{idLinea}/salida-produccion`). */
async function generarOp({ idLinea, cuerpo }: ArgsSalidaProduccion): Promise<SalidaProduccion> {
  const { data, error } = await api.POST('/api/pedidos/lineas/{idLinea}/salida-produccion', {
    params: { path: { idLinea } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/**
 * Salida a producción de un renglón: crea la OP (matriz + snapshot OC + liga al desarrollo +
 * nº de producción + RC automática). Invalida pedidos (la consulta por mes muestra el No. orden
 * nuevo) y órdenes (el centro de comando la lista).
 */
export function useSalidaProduccion(): UseMutationResult<
  SalidaProduccion,
  ErrorDeApi,
  ArgsSalidaProduccion
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generarOp,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_PEDIDOS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES_CENTRO });
    },
  });
}
