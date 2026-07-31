import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { CLAVE_CXP } from './cxp';
import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { CfdiImportarEntrada, CfdiImportarSalida, CfdiPrevisualizacion } from './tipos';

/**
 * Capa de datos de la IMPORTACIÓN de CFDI de proveedores (Módulo 14, F9-E3; R11). Mismo estándar:
 * cliente TIPADO del OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone mutaciones de TanStack Query.
 * CERO lógica de negocio (A1): el backend parsea/valida el XML, concilia y crea el cargo fiscal.
 *
 * La importación es en UN paso: el SERVIDOR sube el XML a R2 (server-side) y crea el cargo fiscal en la
 * misma operación (atómica). El navegador NO sube nada — así un cargo fiscal nunca queda sin su XML.
 */

// ── Previsualización ─────────────────────────────────────────────────────────

async function previsualizar(xml: string): Promise<CfdiPrevisualizacion> {
  const { data, error } = await api.POST('/api/terceros/cfdi/previsualizar', { body: { xml } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Previsualiza un CFDI (parsea + concilia; no escribe). */
export function usePrevisualizarCfdi(): UseMutationResult<
  CfdiPrevisualizacion,
  ErrorDeApi,
  string
> {
  return useMutation({ mutationFn: previsualizar });
}

// ── Importación (el servidor crea el cargo + sube el XML) ─────────────────────

async function importar(entrada: CfdiImportarEntrada): Promise<CfdiImportarSalida> {
  const { data, error } = await api.POST('/api/terceros/cfdi/importar', { body: entrada });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Importa un CFDI (el backend crea el cargo fiscal y sube el XML) e invalida la caché de CxP. */
export function useImportarCfdi(): UseMutationResult<
  CfdiImportarSalida,
  ErrorDeApi,
  CfdiImportarEntrada
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CXP }),
  });
}
