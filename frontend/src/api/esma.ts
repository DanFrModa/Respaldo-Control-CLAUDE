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
import type { CargoEsMa, CargoEsMaValidar, CargosEsMa, CargosEsMaQuery } from './tipos';

/**
 * Capa de datos de los CARGOS EsMa — cola de validación (F3-E4). Mismo ESTÁNDAR: cliente TIPADO del
 * OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio
 * (A1): el backend valida (propuesto→validado, derivación de la propuesta) y es la autoridad.
 */

/** Clave raíz de la caché de cargos EsMa. */
export const CLAVE_CARGOS_ESMA = ['esma-cargos'] as const;

// ── Llamadas ─────────────────────────────────────────────────────────────────

async function listarCargos(query: CargosEsMaQuery): Promise<CargosEsMa> {
  const { data, error } = await api.GET('/api/esma/cargos', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function validarCargo(id: number, cuerpo: CargoEsMaValidar): Promise<CargoEsMa> {
  const { data, error } = await api.POST('/api/esma/cargos/{id}/validar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Cola de cargos EsMa por estado (default propuesto). */
export function useCargosEsMa(query: CargosEsMaQuery = {}): UseQueryResult<CargosEsMa, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CARGOS_ESMA, query],
    queryFn: () => listarCargos(query),
    placeholderData: keepPreviousData,
  });
}

/** Argumentos de la validación de un cargo. */
export interface ArgsValidarCargo {
  id: number;
  cuerpo: CargoEsMaValidar;
}

/** Valida (o ajusta cantidad/precio) un cargo e invalida la cola. */
export function useValidarCargoEsMa(): UseMutationResult<CargoEsMa, ErrorDeApi, ArgsValidarCargo> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsValidarCargo) => validarCargo(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CARGOS_ESMA }),
  });
}
