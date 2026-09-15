import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { CLAVE_CXP } from './cxp';
import { ErrorDeApi } from './errores';
import { CLAVE_CORRIDAS } from './pagos';
import type {
  BandejaCotejo,
  BandejaCotejoQuery,
  CotejoAplicarCuerpo,
  CotejoAtenderCuerpo,
  DocumentosEmitidos,
} from './tipos';

/**
 * Capa de datos del COTEJO de la factura contra el documento que emitimos (fila 0.117). Cliente
 * TIPADO del OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica
 * de negocio (A1): el veredicto, la tolerancia de un peso y lo que frena un pago los decide el
 * servidor; la pantalla sólo pinta lo que le llega.
 */

/** Clave raíz de la caché del cotejo (cuelga de CxP: comparten bandeja e invalidación). */
export const CLAVE_COTEJO = [...CLAVE_CXP, 'cotejo'] as const;

/**
 * ⭐ Las DOS raíces que el cotejo mueve, no una.
 *
 * La bandeja y el estado de cuenta cuelgan de `['cxp']`, pero **la corrida semanal NO**: vive en
 * `['pagos','corridas']` (`api/pagos.ts`), y es justo la pantalla que pinta `bloqueosEjecucion` y
 * habilita o no el botón de pagar. Invalidar sólo CxP dejaba a la corrida enseñando un bloqueo que
 * acababa de resolverse —y el botón apagado— hasta que alguien recargara. Se invalidan las dos.
 */
function invalidarLoQueDependeDelCotejo(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: CLAVE_CXP });
  void queryClient.invalidateQueries({ queryKey: CLAVE_CORRIDAS });
}

async function obtenerBandeja(query: BandejaCotejoQuery): Promise<BandejaCotejo> {
  const { data, error } = await api.GET('/api/cxp/cotejo', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Las facturas sujetas a cotejo (por omisión, sólo las que frenan un pago). */
export function useBandejaCotejo(
  query: BandejaCotejoQuery,
): UseQueryResult<BandejaCotejo, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_COTEJO, 'bandeja', query],
    queryFn: () => obtenerBandeja(query),
    placeholderData: keepPreviousData,
  });
}

async function obtenerDocumentos(idProveedor: number): Promise<DocumentosEmitidos> {
  const { data, error } = await api.GET('/api/cxp/cotejo/documentos/{idProveedor}', {
    params: { path: { idProveedor } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Los documentos que le emitimos a un proveedor (habilitado sólo con un proveedor elegido). */
export function useDocumentosEmitidos(
  idProveedor: number | null,
): UseQueryResult<DocumentosEmitidos, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_COTEJO, 'documentos', idProveedor],
    queryFn: () => obtenerDocumentos(idProveedor as number),
    enabled: idProveedor !== null,
  });
}

async function aplicar(idMovimiento: number, cuerpo: CotejoAplicarCuerpo): Promise<BandejaCotejo> {
  const { data, error } = await api.PUT('/api/cxp/cotejo/{id}/documentos', {
    params: { path: { id: idMovimiento } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Argumentos de la aplicación de documentos a una factura. */
export interface ArgsAplicarCotejo {
  idMovimiento: number;
  cuerpo: CotejoAplicarCuerpo;
}

/** Dice qué documentos cubre una factura (reemplaza las ligas) e invalida CxP entero. */
export function useAplicarCotejo(): UseMutationResult<
  BandejaCotejo,
  ErrorDeApi,
  ArgsAplicarCotejo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idMovimiento, cuerpo }: ArgsAplicarCotejo) => aplicar(idMovimiento, cuerpo),
    onSuccess: () => invalidarLoQueDependeDelCotejo(queryClient),
  });
}

async function atender(idMovimiento: number, cuerpo: CotejoAtenderCuerpo): Promise<BandejaCotejo> {
  const { data, error } = await api.POST('/api/cxp/cotejo/{id}/atender', {
    params: { path: { id: idMovimiento } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Argumentos de atender un descuadre. */
export interface ArgsAtenderCotejo {
  idMovimiento: number;
  cuerpo: CotejoAtenderCuerpo;
}

/** Atiende el descuadre de una factura (sigue marcada, deja de frenar el pago). */
export function useAtenderCotejo(): UseMutationResult<
  BandejaCotejo,
  ErrorDeApi,
  ArgsAtenderCotejo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idMovimiento, cuerpo }: ArgsAtenderCotejo) => atender(idMovimiento, cuerpo),
    onSuccess: () => invalidarLoQueDependeDelCotejo(queryClient),
  });
}
