import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import { CLAVE_OC } from './ordenes-compra';
import type {
  AsignarProveedorCuerpo,
  AsignarProveedorResultado,
  EstatusMateriales,
  Explosion,
  GenerarOcCuerpo,
  GenerarOcResultado,
} from './tipos';

/**
 * Capa de datos del MRP / EXPLOSIÓN (F4-E4) — réplica del ESTÁNDAR de las demás capas de datos
 * (`api/ordenes-compra.ts`). Cada función llama al cliente TIPADO del OpenAPI, normaliza (`data` en
 * éxito, `ErrorDeApi` con el mensaje del backend en fallo) y se expone como consulta o mutación.
 * CERO lógica de negocio: el backend explosiona, netea, genera la OC y cruza R7 (A1).
 */

/** Clave raíz de la cache del MRP en TanStack Query. */
const CLAVE_MRP = ['mrp'] as const;

/** Clave de cache de la explosión de UNA orden. */
function claveExplosion(idOrden: number): readonly unknown[] {
  return [...CLAVE_MRP, 'explosion', idOrden];
}

/** Clave de cache del estatus de materiales de UNA orden. */
function claveEstatus(idOrden: number): readonly unknown[] {
  return [...CLAVE_MRP, 'estatus', idOrden];
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/** Explosiona (regenera y persiste el snapshot de) una orden. */
async function obtenerExplosion(idOrden: number): Promise<Explosion> {
  const { data, error } = await api.POST('/api/ordenes/{id}/explosion', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Tablero "qué tengo / qué falta" (R7) de una orden. */
async function obtenerEstatus(idOrden: number): Promise<EstatusMateriales> {
  const { data, error } = await api.GET('/api/ordenes/{id}/estatus-materiales', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Escrituras ──────────────────────────────────────────────────────────────────

/** Genera una OC por proveedor desde la explosión (`POST .../explosion/generar-oc`). */
async function generarOc(idOrden: number, cuerpo: GenerarOcCuerpo): Promise<GenerarOcResultado> {
  const { data, error } = await api.POST('/api/ordenes/{id}/explosion/generar-oc', {
    params: { path: { id: idOrden } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * ⭐ V1-E3m (§Post-F9.82) — asigna (o quita, con `idProveedor: null`) el proveedor con el que ESTA
 * orden compra un material. NO toca el catálogo: la asignación vive en la receta de la orden.
 */
async function asignarProveedor(
  idOrden: number,
  cuerpo: AsignarProveedorCuerpo,
): Promise<AsignarProveedorResultado> {
  const { data, error } = await api.PUT('/api/ordenes/{id}/materiales/proveedor', {
    params: { path: { id: idOrden } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks de lectura ────────────────────────────────────────────────────────────

/**
 * Obtiene la explosión de una orden (regenera el snapshot). Usa `useQuery` con `enabled` para que
 * solo dispare cuando hay una orden elegida; al reintentar muestra el diff contra el snapshot previo.
 */
export function useExplosion(idOrden: number | undefined): UseQueryResult<Explosion, ErrorDeApi> {
  return useQuery({
    queryKey: claveExplosion(idOrden ?? 0),
    queryFn: () => obtenerExplosion(idOrden as number),
    enabled: idOrden !== undefined,
  });
}

/** Obtiene el tablero de estatus de materiales (R7) de una orden. */
export function useEstatusMateriales(
  idOrden: number | undefined,
): UseQueryResult<EstatusMateriales, ErrorDeApi> {
  return useQuery({
    queryKey: claveEstatus(idOrden ?? 0),
    queryFn: () => obtenerEstatus(idOrden as number),
    enabled: idOrden !== undefined,
  });
}

// ── Hooks de escritura ────────────────────────────────────────────────────────────

/** Argumentos de la mutación de generar OC. */
export interface ArgsGenerarOc {
  idOrden: number;
  cuerpo: GenerarOcCuerpo;
}

/**
 * Genera OC desde la explosión e invalida la explosión y el estatus de esa orden + el listado de OC
 * (la nueva OC debe aparecer en las pantallas de compras).
 */
export function useGenerarOc(): UseMutationResult<GenerarOcResultado, ErrorDeApi, ArgsGenerarOc> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idOrden, cuerpo }: ArgsGenerarOc) => generarOc(idOrden, cuerpo),
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: claveExplosion(variables.idOrden) });
      void queryClient.invalidateQueries({ queryKey: claveEstatus(variables.idOrden) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_OC });
    },
  });
}

/** Argumentos de la mutación de asignar proveedor. */
export interface ArgsAsignarProveedor {
  idOrden: number;
  cuerpo: AsignarProveedorCuerpo;
}

/**
 * ⭐ V1-E3m — asigna/quita el proveedor de un material EN ESTA ORDEN e invalida la explosión, que se
 * vuelve a calcular con el proveedor nuevo (es el servidor quien decide si esa asignación se usa:
 * va DEBAJO de Desarrollo y del catálogo). También se invalida el estatus R7 por si el cruce cambia.
 */
export function useAsignarProveedor(): UseMutationResult<
  AsignarProveedorResultado,
  ErrorDeApi,
  ArgsAsignarProveedor
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idOrden, cuerpo }: ArgsAsignarProveedor) => asignarProveedor(idOrden, cuerpo),
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: claveExplosion(variables.idOrden) });
      void queryClient.invalidateQueries({ queryKey: claveEstatus(variables.idOrden) });
    },
  });
}

// ── Impresos (PDF binario; servidor, fuera del cliente tipado) ──────────────────────────

/** Abre el PDF de la explosión de una orden en una pestaña nueva. */
export function imprimirExplosion(idOrden: number): void {
  window.open(`/api/ordenes/${String(idOrden)}/explosion/impreso`, '_blank', 'noopener');
}

/** Abre el PDF del estatus de materiales de una orden en una pestaña nueva. */
export function imprimirEstatusMateriales(idOrden: number): void {
  window.open(`/api/ordenes/${String(idOrden)}/estatus-materiales/impreso`, '_blank', 'noopener');
}
