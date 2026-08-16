import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { CLAVE_ORDENES } from './ordenes';
import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type {
  RecetaAgregarCuerpo,
  RecetaEditarCuerpo,
  RecetaOrden,
  TipoRenglonReceta,
} from './tipos';

/**
 * Capa de datos de la RECETA CONGELADA DE LA ORDEN (V1-E3d, §Post-F9.43: *"el BOM debe de vivir en
 * la OP"*). Mismo ESTÁNDAR que el resto: invoca el cliente tipado del OpenAPI, normaliza
 * (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. **CERO lógica de negocio (A1)**: la
 * desalineación contra el BOM del modelo la calcula el servidor al vuelo, y la puerta de compra la
 * decide el backend.
 *
 * Toda mutación devuelve la receta COMPLETA, así que se escribe directo en la caché (`setQueryData`)
 * en vez de invalidar y re-pedir. Además se invalida la ORDEN, porque el semáforo de "orden
 * completa" depende ahora de la receta (liberada + arte).
 */

/** Clave raíz de la caché de la receta por orden. */
export const CLAVE_RECETA_ORDEN = ['ordenes', 'receta'] as const;

/** Clave de la receta de UNA orden. */
function claveDe(idOrden: number): readonly unknown[] {
  return [...CLAVE_RECETA_ORDEN, idOrden];
}

/** Lee la receta congelada de una orden. `habilitado` permite no consultar (sin orden abierta). */
export function useRecetaOrden(
  idOrden: number | undefined,
  opciones: { habilitado?: boolean } = {},
): UseQueryResult<RecetaOrden, ErrorDeApi> {
  const { habilitado = true } = opciones;
  return useQuery({
    queryKey: claveDe(idOrden ?? 0),
    queryFn: async () => {
      const { data, error } = await api.GET('/api/ordenes/{id}/receta', {
        params: { path: { id: idOrden as number } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    enabled: habilitado && idOrden !== undefined,
  });
}

/** Deja la receta recién devuelta en la caché e invalida la orden (su semáforo depende de ella). */
function trasMutar(
  qc: ReturnType<typeof useQueryClient>,
  idOrden: number,
  receta: RecetaOrden,
): void {
  qc.setQueryData(claveDe(idOrden), receta);
  void qc.invalidateQueries({ queryKey: CLAVE_ORDENES });
}

/** Argumentos de agregar un renglón a la receta. */
export interface ArgsAgregarRenglonReceta {
  idOrden: number;
  cuerpo: RecetaAgregarCuerpo;
}

/** Agrega un renglón (nace `ajustado` + `agregadoAMano`: ningún cambio del modelo lo pisa). */
export function useAgregarRenglonReceta(): UseMutationResult<
  RecetaOrden,
  ErrorDeApi,
  ArgsAgregarRenglonReceta
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, cuerpo }: ArgsAgregarRenglonReceta) => {
      const { data, error } = await api.POST('/api/ordenes/{id}/receta/renglones', {
        params: { path: { id: idOrden } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (receta, { idOrden }) => {
      trasMutar(qc, idOrden, receta);
    },
  });
}

/** Argumentos de editar un renglón. */
export interface ArgsEditarRenglonReceta {
  idOrden: number;
  tipo: TipoRenglonReceta;
  idRenglon: number;
  cuerpo: RecetaEditarCuerpo;
}

/** Edita un renglón. Cualquier cambio lo deja `ajustado` (el modelo ya no lo pisa). */
export function useEditarRenglonReceta(): UseMutationResult<
  RecetaOrden,
  ErrorDeApi,
  ArgsEditarRenglonReceta
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, tipo, idRenglon, cuerpo }: ArgsEditarRenglonReceta) => {
      const { data, error } = await api.PATCH(
        '/api/ordenes/{id}/receta/renglones/{tipo}/{idRenglon}',
        { params: { path: { id: idOrden, tipo, idRenglon } }, body: cuerpo },
      );
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (receta, { idOrden }) => {
      trasMutar(qc, idOrden, receta);
    },
  });
}

/** Argumentos de quitar un renglón. */
export interface ArgsQuitarRenglonReceta {
  idOrden: number;
  tipo: TipoRenglonReceta;
  idRenglon: number;
  motivo?: string;
}

/**
 * Quita un renglón de ESTA orden (el caso de la jareta). El backend decide si lo EXCLUYE (vino del
 * modelo: queda como lápida, tachado) o lo borra (se había agregado a mano) — aquí no se replica
 * esa regla (A1).
 */
export function useQuitarRenglonReceta(): UseMutationResult<
  RecetaOrden,
  ErrorDeApi,
  ArgsQuitarRenglonReceta
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, tipo, idRenglon, motivo }: ArgsQuitarRenglonReceta) => {
      const { data, error } = await api.DELETE(
        '/api/ordenes/{id}/receta/renglones/{tipo}/{idRenglon}',
        {
          params: { path: { id: idOrden, tipo, idRenglon } },
          body: motivo === undefined ? {} : { motivo },
        },
      );
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (receta, { idOrden }) => {
      trasMutar(qc, idOrden, receta);
    },
  });
}

/** Argumentos de restaurar un renglón al BOM del modelo. */
export interface ArgsRestaurarRenglonReceta {
  idOrden: number;
  tipo: TipoRenglonReceta;
  idRenglon: number;
}

/** Trae el renglón de vuelta a lo que dice HOY el BOM del modelo (§Post-F9.43(f), "a mano"). */
export function useRestaurarRenglonReceta(): UseMutationResult<
  RecetaOrden,
  ErrorDeApi,
  ArgsRestaurarRenglonReceta
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, tipo, idRenglon }: ArgsRestaurarRenglonReceta) => {
      const { data, error } = await api.POST(
        '/api/ordenes/{id}/receta/renglones/{tipo}/{idRenglon}/restaurar',
        { params: { path: { id: idOrden, tipo, idRenglon } } },
      );
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (receta, { idOrden }) => {
      trasMutar(qc, idOrden, receta);
    },
  });
}

/** Marca TODA la receta como revisada (el botón que evita los 8 clics por OP). */
export function useMarcarRecetaRevisada(): UseMutationResult<RecetaOrden, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (idOrden: number) => {
      const { data, error } = await api.POST('/api/ordenes/{id}/receta/revisar', {
        params: { path: { id: idOrden } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (receta, idOrden) => {
      trasMutar(qc, idOrden, receta);
    },
  });
}

/** LIBERA la receta: abre la puerta al MRP y a las órdenes de compra (§Post-F9.43(c)). */
export function useLiberarReceta(): UseMutationResult<RecetaOrden, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (idOrden: number) => {
      const { data, error } = await api.POST('/api/ordenes/{id}/receta/liberar', {
        params: { path: { id: idOrden } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (receta, idOrden) => {
      trasMutar(qc, idOrden, receta);
    },
  });
}
