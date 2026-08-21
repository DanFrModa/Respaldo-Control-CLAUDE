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
  AsignarColorTelaCuerpo,
  AsignarProveedorCuerpo,
  AsignarProveedorResultado,
  ColoresDeTela,
  FijarPrecioColorCuerpo,
  FijarPrecioColorResultado,
  EstatusMateriales,
  Explosion,
  GenerarOcCuerpo,
  GenerarOcResultado,
  OrdenesDelPedido,
  PlanCompra,
} from './tipos';

/**
 * Capa de datos del MRP / EXPLOSIÓN (F4-E4) — réplica del ESTÁNDAR de las demás capas de datos
 * (`api/ordenes-compra.ts`). Cada función llama al cliente TIPADO del OpenAPI, normaliza (`data` en
 * éxito, `ErrorDeApi` con el mensaje del backend en fallo) y se expone como consulta o mutación.
 * CERO lógica de negocio: el backend explosiona, netea, genera la OC y cruza R7 (A1).
 */

/** Clave raíz de la cache del MRP en TanStack Query. */
const CLAVE_MRP = ['mrp'] as const;

/**
 * Clave de cache de la explosión de un CONJUNTO de OP (⭐ V1-E3q, §Post-F9.86). Los ids se
 * ORDENAN: elegir [5558, 5560] y [5560, 5558] es la misma compra, y sin normalizar serían dos
 * entradas de cache distintas que se pisarían al invalidar.
 */
function claveExplosion(idsOrden: readonly number[]): readonly unknown[] {
  return [...CLAVE_MRP, 'explosion', [...idsOrden].sort((a, b) => a - b).join(',')];
}

/** Clave de cache del estatus de materiales de UNA orden. */
function claveEstatus(idOrden: number): readonly unknown[] {
  return [...CLAVE_MRP, 'estatus', idOrden];
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/** Explosiona (regenera y persiste el snapshot de) un conjunto de OP (⭐ V1-E3q). */
async function obtenerExplosion(idsOrden: readonly number[]): Promise<Explosion> {
  const { data, error } = await api.POST('/api/explosion', {
    body: { idsOrden: [...idsOrden] },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** ⭐ V1-E3q: las OP del mismo pedido interno de una OP (la PRECARGA de §Post-F9.86). */
async function obtenerOrdenesDelPedido(idOrden: number): Promise<OrdenesDelPedido> {
  const { data, error } = await api.GET('/api/ordenes/{id}/del-mismo-pedido', {
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

/** Genera una OC por proveedor desde la explosión (`POST /api/explosion/generar-oc`). */
async function generarOc(cuerpo: GenerarOcCuerpo): Promise<GenerarOcResultado> {
  const { data, error } = await api.POST('/api/explosion/generar-oc', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * ⭐⭐ V1-E3q (§Post-F9.85) — LA REVISIÓN PREVIA. Pide al servidor las OC que saldrían, SIN crear
 * nada. Es `POST` porque lleva cuerpo (la selección completa), no porque escriba: no escribe.
 */
async function previoCompra(cuerpo: GenerarOcCuerpo): Promise<PlanCompra> {
  const { data, error } = await api.POST('/api/explosion/previo', { body: cuerpo });
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
export function useExplosion(idsOrden: readonly number[]): UseQueryResult<Explosion, ErrorDeApi> {
  return useQuery({
    queryKey: claveExplosion(idsOrden),
    queryFn: () => obtenerExplosion(idsOrden),
    enabled: idsOrden.length > 0,
  });
}

/**
 * ⭐ V1-E3q — las OP del mismo pedido interno, para PRECARGAR la explosión (§Post-F9.86). Se
 * consulta al elegir la primera OP; la pantalla las marca todas y el usuario quita las que no.
 */
export function useOrdenesDelPedido(
  idOrden: number | undefined,
): UseQueryResult<OrdenesDelPedido, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_MRP, 'del-mismo-pedido', idOrden ?? 0],
    queryFn: () => obtenerOrdenesDelPedido(idOrden as number),
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

/**
 * ⭐⭐ V1-E3q — LA REVISIÓN PREVIA como MUTACIÓN, no como consulta. Es deliberado: el plan tiene que
 * pedirse cuando el usuario dice *"revisar"*, con la selección y los ajustes de ESE momento — una
 * `useQuery` lo re-pediría sola al recuperar el foco y el usuario vería la pantalla de revisión
 * cambiar bajo sus manos justo cuando está a punto de confirmar.
 */
export function usePrevioCompra(): UseMutationResult<PlanCompra, ErrorDeApi, GenerarOcCuerpo> {
  return useMutation({ mutationFn: (cuerpo: GenerarOcCuerpo) => previoCompra(cuerpo) });
}

/**
 * Genera OC desde la explosión e invalida la explosión y el estatus de TODAS las OP de la compra +
 * el listado de OC (la nueva OC debe aparecer en las pantallas de compras). ⭐ V1-E3q: invalidar la
 * explosión no es cosmético — es lo que hace que el renglón recién comprado se vuelva a pintar YA
 * neteado, en vez de seguir invitando a comprarlo otra vez (§Post-F9.85).
 */
export function useGenerarOc(): UseMutationResult<GenerarOcResultado, ErrorDeApi, GenerarOcCuerpo> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cuerpo: GenerarOcCuerpo) => generarOc(cuerpo),
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: [...CLAVE_MRP, 'explosion'] });
      for (const idOrden of variables.idsOrden) {
        void queryClient.invalidateQueries({ queryKey: claveEstatus(idOrden) });
      }
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
      void queryClient.invalidateQueries({ queryKey: [...CLAVE_MRP, 'explosion'] });
      void queryClient.invalidateQueries({ queryKey: claveEstatus(variables.idOrden) });
    },
  });
}

// ── ⭐⭐ V1-E3u (§Post-F9.89): LA TELA SE COMPRA POR COLOR ─────────────────────────────────

/** Clave de cache del desglose por color de UNA orden. */
function claveColores(idOrden: number): readonly unknown[] {
  return [...CLAVE_MRP, 'colores-tela', idOrden];
}

/** Lee el desglose por color de las telas de una orden (lo amarrado + lo propuesto + lo elegible). */
async function obtenerColoresDeTela(idOrden: number): Promise<ColoresDeTela> {
  const { data, error } = await api.GET('/api/ordenes/{id}/colores-tela', {
    params: { path: { id: idOrden } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Amarra (o quita, con `idTelaColor: null`) el color de tela de un color de la orden. */
async function asignarColorTela(
  idOrden: number,
  cuerpo: AsignarColorTelaCuerpo,
): Promise<ColoresDeTela> {
  const { data, error } = await api.PUT('/api/ordenes/{id}/colores-tela', {
    params: { path: { id: idOrden } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** ⚠️ Corrige el precio de un color **en el CATÁLOGO** (decisión (b) de Daniel): cambia para TODOS. */
async function fijarPrecioColor(
  idTelaColor: number,
  cuerpo: FijarPrecioColorCuerpo,
): Promise<FijarPrecioColorResultado> {
  const { data, error } = await api.PUT('/api/telas-colores/{idTelaColor}/precio', {
    params: { path: { idTelaColor } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desglose por color de las telas de una orden (§Post-F9.89). */
export function useColoresDeTela(
  idOrden: number | undefined,
): UseQueryResult<ColoresDeTela, ErrorDeApi> {
  return useQuery({
    queryKey: claveColores(idOrden ?? 0),
    queryFn: () => obtenerColoresDeTela(idOrden as number),
    enabled: idOrden !== undefined,
  });
}

/** Argumentos de amarrar el color de tela de un color de la orden. */
export interface ArgsAsignarColorTela {
  idOrden: number;
  cuerpo: AsignarColorTelaCuerpo;
}

/**
 * Amarra el color e INVALIDA la explosión: la cantidad de ese color deja de ir en el renglón "sin
 * color" y pasa al suyo, así que la pantalla tiene que volver a pedir el cálculo (A1: el reparto no
 * se recompone en el cliente).
 */
export function useAsignarColorTela(): UseMutationResult<
  ColoresDeTela,
  ErrorDeApi,
  ArgsAsignarColorTela
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idOrden, cuerpo }: ArgsAsignarColorTela) => asignarColorTela(idOrden, cuerpo),
    onSuccess: (datos, variables) => {
      queryClient.setQueryData(claveColores(variables.idOrden), datos);
      void queryClient.invalidateQueries({ queryKey: [...CLAVE_MRP, 'explosion'] });
      void queryClient.invalidateQueries({ queryKey: claveEstatus(variables.idOrden) });
    },
  });
}

/** Argumentos de corregir el precio de un color (con la traza de desde dónde se corrigió). */
export interface ArgsFijarPrecioColor {
  idTelaColor: number;
  idOrden: number;
  cuerpo: FijarPrecioColorCuerpo;
}

/**
 * ⚠️ Corrige el precio del color EN EL CATÁLOGO (§Post-F9.89(b)) e invalida el desglose y la
 * explosión: el precio nuevo es el que va a valuar las líneas de OC que se generen.
 */
export function useFijarPrecioColor(): UseMutationResult<
  FijarPrecioColorResultado,
  ErrorDeApi,
  ArgsFijarPrecioColor
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idTelaColor, cuerpo }: ArgsFijarPrecioColor) =>
      fijarPrecioColor(idTelaColor, cuerpo),
    onSuccess: (_datos, variables) => {
      void queryClient.invalidateQueries({ queryKey: claveColores(variables.idOrden) });
      void queryClient.invalidateQueries({ queryKey: [...CLAVE_MRP, 'explosion'] });
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
