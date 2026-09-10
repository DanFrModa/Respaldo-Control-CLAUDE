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
 * Capa de datos de las FOTOS DEL MODELO OCULTAS EN UNA ORDEN (§Post-F9.169(b), DANIEL: *"la foto
 * debería de ser de la OP no del desarrollo… también la opción de quitarlas de la OP"*).
 *
 * 🔴 **OCULTAR NO ES BORRAR (D3).** Estas tres llamadas NO borran ninguna foto ni tocan R2: ponen y
 * quitan una MARCA por *(orden, foto)*. La foto sigue en la galería del modelo y otra orden del
 * mismo modelo la sigue viendo. Compárese con `api/adjuntos-orden.ts`, que sí sube y borra archivos.
 *
 * Mismo ESTÁNDAR que el resto de la casa: cliente TIPADO del OpenAPI, normalización
 * (`data`/`ErrorDeApi`) y mutaciones que invalidan la lista. CERO lógica de negocio (A1).
 */

// ── Alias de tipos del contrato ────────────────────────────────────────────────
/** Lista de fotos ocultas de una orden (`GET /api/ordenes/{idOrden}/fotos-ocultas`). */
export type OrdenFotosOcultasLista =
  paths['/api/ordenes/{idOrden}/fotos-ocultas']['get']['responses']['200']['content']['application/json'];
/** Una foto del modelo oculta en la orden. */
export type OrdenFotoOculta = OrdenFotosOcultasLista['datos'][number];

/** Clave de cache de las fotos ocultas de UNA orden. */
function claveFotosOcultas(idOrden: number): readonly unknown[] {
  return ['orden-fotos-ocultas', idOrden];
}

/** Lista las fotos del modelo que esta orden no enseña. */
async function listar(idOrden: number): Promise<OrdenFotoOculta[]> {
  const { data, error } = await api.GET('/api/ordenes/{idOrden}/fotos-ocultas', {
    params: { path: { idOrden } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

/** Lista las fotos ocultas de una orden (deshabilitada si no hay id). */
export function useFotosOcultasOrden(
  idOrden: number | undefined,
): UseQueryResult<OrdenFotoOculta[], ErrorDeApi> {
  return useQuery({
    queryKey: claveFotosOcultas(idOrden ?? 0),
    queryFn: () => listar(idOrden as number),
    enabled: idOrden !== undefined,
  });
}

/** Argumentos de las dos mutaciones (ocultar y volver a mostrar). */
export interface ArgsFotoOcultaOrden {
  idOrden: number;
  /** Id de la foto del MODELO (`ModeloFoto.id`), no de un archivo de la orden. */
  idModeloFoto: number;
}

/** Oculta en esta orden una foto heredada del modelo (la del modelo NO se toca). */
async function ocultar({ idOrden, idModeloFoto }: ArgsFotoOcultaOrden): Promise<void> {
  const { data, error } = await api.POST('/api/ordenes/{idOrden}/fotos-ocultas', {
    params: { path: { idOrden } },
    body: { idModeloFoto },
  });
  if (!data) throw new ErrorDeApi(error);
}

/** Vuelve a mostrar en esta orden una foto del modelo que estaba oculta. */
async function mostrar({ idOrden, idModeloFoto }: ArgsFotoOcultaOrden): Promise<void> {
  const { data, error } = await api.DELETE('/api/ordenes/{idOrden}/fotos-ocultas/{idModeloFoto}', {
    params: { path: { idOrden, idModeloFoto } },
  });
  if (!data) throw new ErrorDeApi(error);
}

/**
 * Quita de ESTA orden una foto heredada del modelo e invalida la lista. Es reversible:
 * {@link useMostrarFotoModeloOrden} la trae de vuelta.
 */
export function useOcultarFotoModeloOrden(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsFotoOcultaOrden
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ocultar,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveFotosOcultas(variables.idOrden) }),
  });
}

/** Vuelve a mostrar en esta orden una foto que se había quitado, e invalida la lista. */
export function useMostrarFotoModeloOrden(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsFotoOcultaOrden
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mostrar,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveFotosOcultas(variables.idOrden) }),
  });
}
