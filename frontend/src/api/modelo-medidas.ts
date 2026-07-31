import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { paths } from './esquema.gen';
import { CLAVE_MODELOS } from './modelos';
import { api } from './cliente';
import { ErrorDeApi } from './errores';

/**
 * Capa de datos de las medidas por talla de un avío del BOM (F8-E1, R18). Cada avío del BOM
 * puede consumirse "por talla": el GET devuelve la bandera `consumoPorTalla` y las tallas de la
 * CURVA del modelo (etiqueta + consumo); el PUT reemplaza el set completo. CERO lógica de negocio
 * (A1): el backend valida que el avío pertenezca al BOM y que las tallas sean de la curva.
 */

// ── Alias de tipo del contrato ────────────────────────────────────────────────

/** Medidas por talla de un avío del BOM (`GET .../avios/{idAvio}/medidas`). */
export type MedidasAvio =
  paths['/api/modelos/{idModelo}/avios/{idAvio}/medidas']['get']['responses']['200']['content']['application/json'];
/** Una talla de la curva con su consumo. */
export type MedidaTalla = MedidasAvio['tallas'][number];
/** Cuerpo del PUT (set completo de medidas por talla). */
export type MedidasAvioEntrada =
  paths['/api/modelos/{idModelo}/avios/{idAvio}/medidas']['put']['requestBody']['content']['application/json'];

/** Clave de caché de las medidas de UN avío del BOM de un modelo. */
function claveMedidas(idModelo: number, idAvio: number): readonly unknown[] {
  return [...CLAVE_MODELOS, 'ficha', idModelo, 'medidas-avio', idAvio];
}

async function listar(idModelo: number, idAvio: number): Promise<MedidasAvio> {
  const { data, error } = await api.GET('/api/modelos/{idModelo}/avios/{idAvio}/medidas', {
    params: { path: { idModelo, idAvio } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Trae las medidas por talla de un avío del BOM. Deshabilitada (`enabled`) mientras el panel no
 * se haya abierto o falte algún id, para no pegarle al API a cada renglón del BOM de golpe.
 */
export function useMedidasAvio(
  idModelo: number,
  idAvio: number,
  habilitado: boolean,
): UseQueryResult<MedidasAvio, ErrorDeApi> {
  return useQuery({
    queryKey: claveMedidas(idModelo, idAvio),
    queryFn: () => listar(idModelo, idAvio),
    enabled: habilitado,
  });
}

/** Argumentos del PUT de medidas. */
export interface ArgsReemplazarMedidas {
  idModelo: number;
  idAvio: number;
  cuerpo: MedidasAvioEntrada;
}

async function reemplazar({
  idModelo,
  idAvio,
  cuerpo,
}: ArgsReemplazarMedidas): Promise<MedidasAvio> {
  const { data, error } = await api.PUT('/api/modelos/{idModelo}/avios/{idAvio}/medidas', {
    params: { path: { idModelo, idAvio } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reemplaza las medidas por talla de un avío del BOM e invalida su caché. */
export function useReemplazarMedidasAvio(): UseMutationResult<
  MedidasAvio,
  ErrorDeApi,
  ArgsReemplazarMedidas
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reemplazar,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({
        queryKey: claveMedidas(variables.idModelo, variables.idAvio),
      }),
  });
}
