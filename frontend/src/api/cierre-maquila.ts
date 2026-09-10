import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import { CLAVE_ETAPAS } from './etapas';
import { CLAVE_ORDENES_CENTRO } from './ordenes-centro';
import { CLAVE_RECIBOS } from './recibos';
import { CLAVE_WIP } from './wip';
import type {
  CierreMaquila,
  CierreMaquilaCrear,
  CierreMaquilaDeshacer,
  CierresMaquila,
} from './tipos';

/**
 * Capa de datos del CIERRE DE ORDEN CON UN MAQUILERO (V1, fila 0.109) — mismo ESTÁNDAR que
 * Recibos/Etapas: llama al cliente TIPADO del OpenAPI, normaliza (`data`/`ErrorDeApi`) y expone
 * hooks de TanStack Query. CERO lógica de negocio (A1): **cuántas piezas se saldan y cuánto se
 * propone cobrar los decide el servidor**, bajo bloqueo; aquí sólo se pide y se muestra.
 */

/** Clave raíz de la caché de cierres de maquila. */
export const CLAVE_CIERRES_MAQUILA = ['produccion-cierres-maquila'] as const;

// ── Llamadas ─────────────────────────────────────────────────────────────────

async function listarCierres(idOrden: number): Promise<CierresMaquila> {
  const { data, error } = await api.GET('/api/produccion/ordenes/{id}/cierres-maquila', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function cerrarOrden(idOrden: number, cuerpo: CierreMaquilaCrear): Promise<CierreMaquila> {
  const { data, error } = await api.POST('/api/produccion/ordenes/{id}/cierre-maquila', {
    params: { path: { id: idOrden } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

async function deshacerCierre(
  idCierre: number,
  cuerpo: CierreMaquilaDeshacer,
): Promise<CierreMaquila> {
  const { data, error } = await api.POST('/api/produccion/cierres-maquila/{id}/deshacer', {
    params: { path: { id: idCierre } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Los cierres de una orden (vivos primero). `habilitado` corta la query. */
export function useCierresMaquila(
  idOrden: number | undefined,
  habilitado = true,
): UseQueryResult<CierresMaquila, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CIERRES_MAQUILA, idOrden],
    queryFn: () => listarCierres(idOrden as number),
    enabled: habilitado && idOrden !== undefined,
  });
}

/** Argumentos de un cierre. */
export interface ArgsCerrarOrden {
  idOrden: number;
  cuerpo: CierreMaquilaCrear;
}

/**
 * Cierra la orden con un maquilero e invalida TODO lo que acaba de cambiar de significado.
 *
 * 🔴 `CLAVE_WIP` NO ES OPCIONAL, y es el error que hubo aquí: el panel de avance —el que tiene el
 * botón— lee `porMaquilero`, `totalPendiente`, `faltantesSaldables`, el precio y el importe de
 * `useWipOrden`, o sea de `CLAVE_WIP`. Invalidando sólo cierres/recibos/etapas, después de cerrar la
 * pantalla seguía ofreciendo «Cerrar la orden» con las mismas piezas, el maquilero seguía en el
 * selector de recibo y el segundo clic cosechaba un 409. Es la MISMA lista que invalida
 * `refrescarTodo` en `AvanceProduccion.tsx` tras capturar un movimiento.
 */
export function useCerrarOrdenMaquila(): UseMutationResult<
  CierreMaquila,
  ErrorDeApi,
  ArgsCerrarOrden
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idOrden, cuerpo }: ArgsCerrarOrden) => cerrarOrden(idOrden, cuerpo),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_CIERRES_MAQUILA });
      void queryClient.invalidateQueries({ queryKey: CLAVE_RECIBOS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_WIP });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES_CENTRO });
    },
  });
}

/** Argumentos del deshacer de un cierre. */
export interface ArgsDeshacerCierre {
  id: number;
  cuerpo: CierreMaquilaDeshacer;
}

/**
 * Deshace un cierre (acto inverso auditado). Invalida EXACTAMENTE lo mismo que cerrar, por la misma
 * razón y en el sentido contrario: las piezas vuelven al pendiente, así que el botón, el selector de
 * maquileros y los totales del WIP tienen que volver a aparecer.
 */
export function useDeshacerCierreMaquila(): UseMutationResult<
  CierreMaquila,
  ErrorDeApi,
  ArgsDeshacerCierre
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsDeshacerCierre) => deshacerCierre(id, cuerpo),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_CIERRES_MAQUILA });
      void queryClient.invalidateQueries({ queryKey: CLAVE_RECIBOS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_WIP });
      void queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES_CENTRO });
    },
  });
}
