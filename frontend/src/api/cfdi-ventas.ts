import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { CLAVE_CXC } from './cxc';
import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type {
  CfdiVentaImportarEntrada,
  CfdiVentaImportarSalida,
  CfdiVentaPrevisualizacion,
} from './tipos';

/**
 * Capa de datos de la IMPORTACIÓN de CFDI de VENTAS (Módulo 14, F9-E4; R12). Mismo estándar: cliente
 * TIPADO del OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone mutaciones de TanStack Query. CERO
 * lógica de negocio (A1): el backend parsea/valida el XML, concilia y crea el cargo fiscal.
 *
 * La importación es en UN paso: el SERVIDOR sube el XML a R2 (server-side) y crea el cargo fiscal en la
 * misma operación (atómica). El navegador NO sube nada — así un cargo fiscal nunca queda sin su XML.
 */

// ── Previsualización ─────────────────────────────────────────────────────────

async function previsualizar(xml: string): Promise<CfdiVentaPrevisualizacion> {
  const { data, error } = await api.POST('/api/terceros/cfdi-ventas/previsualizar', {
    body: { xml },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Previsualiza un CFDI de venta (parsea + concilia; no escribe). */
export function usePrevisualizarCfdiVenta(): UseMutationResult<
  CfdiVentaPrevisualizacion,
  ErrorDeApi,
  string
> {
  return useMutation({ mutationFn: previsualizar });
}

// ── Importación (el servidor crea el cargo + sube el XML) ─────────────────────

async function importar(entrada: CfdiVentaImportarEntrada): Promise<CfdiVentaImportarSalida> {
  const { data, error } = await api.POST('/api/terceros/cfdi-ventas/importar', { body: entrada });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Importa un CFDI de venta (el backend crea el cargo fiscal y sube el XML) e invalida la caché de CxC. */
export function useImportarCfdiVenta(): UseMutationResult<
  CfdiVentaImportarSalida,
  ErrorDeApi,
  CfdiVentaImportarEntrada
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CXC }),
  });
}
