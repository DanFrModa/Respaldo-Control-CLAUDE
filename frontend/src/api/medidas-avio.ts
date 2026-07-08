import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import { CLAVE_AVIOS } from './avios';
import type { paths } from './esquema.gen';

/**
 * Capa de datos de las MEDIDAS de un avío "por medida" (rediseño R5, B11). El avío se costea con el
 * PROMEDIO de los precios de sus medidas activas (lo calcula el backend, A1); la compra desglosa por
 * medida×talla. Se administran como un SET completo desde la pantalla de Avíos. Cliente TIPADO del
 * OpenAPI + normalización estándar. La mutación invalida las medidas Y la lista de avíos.
 */

/** Medidas de un avío + el promedio del precosto. */
export type MedidasAvio =
  paths['/api/avios/{id}/medidas']['get']['responses']['200']['content']['application/json'];
/** Una medida del avío. */
export type MedidaAvio = MedidasAvio['datos'][number];
/** Cuerpo para reemplazar el set de medidas. */
export type MedidasAvioCuerpo =
  paths['/api/avios/{id}/medidas']['put']['requestBody']['content']['application/json'];

/** Clave de cache de las medidas de UN avío. */
function claveMedidas(idAvio: number): readonly unknown[] {
  return ['avio-medidas', idAvio];
}

async function listar(idAvio: number): Promise<MedidasAvio> {
  const { data, error } = await api.GET('/api/avios/{id}/medidas', {
    params: { path: { id: idAvio } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Lista las medidas de un avío + el promedio del precosto (deshabilitada si no hay id). */
export function useMedidasAvio(
  idAvio: number | undefined,
): UseQueryResult<MedidasAvio, ErrorDeApi> {
  return useQuery({
    queryKey: claveMedidas(idAvio ?? 0),
    queryFn: () => listar(idAvio as number),
    enabled: idAvio !== undefined,
  });
}

/** Argumentos de guardar el set de medidas. */
export interface ArgsGuardarMedidas {
  idAvio: number;
  cuerpo: MedidasAvioCuerpo;
}

async function guardar({ idAvio, cuerpo }: ArgsGuardarMedidas): Promise<MedidasAvio> {
  const { data, error } = await api.PUT('/api/avios/{id}/medidas', {
    params: { path: { id: idAvio } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Reemplaza el set de medidas de un avío e invalida las medidas + la lista de avíos. */
export function useGuardarMedidasAvio(): UseMutationResult<
  MedidasAvio,
  ErrorDeApi,
  ArgsGuardarMedidas
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: guardar,
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: claveMedidas(variables.idAvio) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_AVIOS });
    },
  });
}
