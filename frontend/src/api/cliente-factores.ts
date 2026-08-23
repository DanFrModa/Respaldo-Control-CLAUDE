import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { paths } from './esquema.gen';

/**
 * Capa de datos de los FACTORES del cliente para la lista de precios (F8-E4). Mismo ESTÁNDAR que el
 * resto: cliente TIPADO del OpenAPI, normalización (`data`/`ErrorDeApi`) y hooks de TanStack Query.
 * CERO lógica de negocio (A1): el backend valida los porcentajes, oculta importes sin
 * `consultas.ver-importes` y hace el upsert por [cliente, departamento].
 */

/** Un renglón de factores (default o de un departamento). */
export type ClienteFactores =
  paths['/api/clientes/{idCliente}/factores']['get']['responses']['200']['content']['application/json']['datos'][number];
/** Cuerpo de guardar (upsert) factores. */
export type ClienteFactoresGuardar =
  paths['/api/clientes/{idCliente}/factores']['put']['requestBody']['content']['application/json'];

/** Clave raíz de la cache de factores. */
export const CLAVE_FACTORES = ['cliente-factores'] as const;

function claveFactores(idCliente: number): readonly unknown[] {
  return [...CLAVE_FACTORES, idCliente];
}

async function listar(idCliente: number): Promise<ClienteFactores[]> {
  const { data, error } = await api.GET('/api/clientes/{idCliente}/factores', {
    params: { path: { idCliente } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

async function guardar(
  idCliente: number,
  cuerpo: ClienteFactoresGuardar,
): Promise<ClienteFactores> {
  const { data, error } = await api.PUT('/api/clientes/{idCliente}/factores', {
    params: { path: { idCliente } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Lista los factores de un cliente (default + overrides). Deshabilitada si no hay id. */
export function useFactoresCliente(
  idCliente: number | undefined,
): UseQueryResult<ClienteFactores[], ErrorDeApi> {
  return useQuery({
    queryKey: claveFactores(idCliente ?? 0),
    queryFn: () => listar(idCliente as number),
    enabled: idCliente !== undefined,
  });
}

/** Argumentos de la mutación de guardado. */
export interface ArgsGuardarFactores {
  idCliente: number;
  cuerpo: ClienteFactoresGuardar;
}

/** Guarda (upsert) los factores de un cliente/departamento e invalida su cache. */
export function useGuardarFactoresCliente(): UseMutationResult<
  ClienteFactores,
  ErrorDeApi,
  ArgsGuardarFactores
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idCliente, cuerpo }: ArgsGuardarFactores) => guardar(idCliente, cuerpo),
    onSuccess: (_resultado, variables) =>
      queryClient.invalidateQueries({ queryKey: claveFactores(variables.idCliente) }),
  });
}
