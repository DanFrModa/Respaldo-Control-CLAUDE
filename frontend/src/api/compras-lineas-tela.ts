import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { paths } from './esquema.gen';

/**
 * Renglones de TELA pendientes de recibir de las OCs abiertas de un proveedor (§Post-F9.14).
 *
 * Es la ayuda de captura que hace usable la liga factura ↔ orden de compra: sin ella habría que
 * abrir la OC en otra pantalla y copiar el renglón a mano. El servidor calcula el pendiente
 * (pedido − recibido en recepciones activas) con el MISMO criterio que el estatus de la OC.
 */

/** Respuesta del endpoint (forma del contrato). */
type LineasTelaPendientesRespuesta =
  paths['/api/compras/lineas-tela-pendientes']['get']['responses']['200']['content']['application/json'];

/** Un renglón de OC pendiente de recibir. */
export type LineaTelaPendiente = LineasTelaPendientesRespuesta['datos'][number];

/** Clave raíz de la caché. */
export const CLAVE_LINEAS_TELA_PENDIENTES = ['compras', 'lineas-tela-pendientes'] as const;

async function listar(idProveedor: number): Promise<LineaTelaPendiente[]> {
  const { data, error } = await api.GET('/api/compras/lineas-tela-pendientes', {
    params: { query: { idProveedor } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/**
 * Lista los renglones de tela pendientes del proveedor dado. Sin proveedor (`undefined`) la
 * consulta queda DESHABILITADA: no hay universo que consultar hasta que se elige a quién le
 * compramos, y pedir "todos" traería renglones que no puede surtir esta factura.
 */
export function useLineasTelaPendientes(
  idProveedor: number | undefined,
): UseQueryResult<LineaTelaPendiente[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_LINEAS_TELA_PENDIENTES, idProveedor ?? 0],
    queryFn: () => listar(idProveedor as number),
    enabled: idProveedor !== undefined,
  });
}
