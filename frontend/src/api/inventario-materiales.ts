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
import type {
  AjusteAvioCrear,
  AjusteTelaCrear,
  ExistenciasAvio,
  ExistenciasAvioQuery,
  ExistenciasTela,
  ExistenciasTelaQuery,
  KardexAvio,
  KardexAvioQuery,
  KardexTela,
  KardexTelaQuery,
  MovimientoAvio,
  MovimientoMaterialCancelar,
  MovimientoTela,
  SalidaTelaCrear,
  TraspasoAvio,
  TraspasoAvioCrear,
  TraspasoTela,
  TraspasoTelaCrear,
} from './tipos';

/**
 * Capa de datos del INVENTARIO de TELAS y AVÍOS por kardex (F4-E1; tela×lote D5, avíos multi-almacén
 * R4) — mismo ESTÁNDAR que el inventario PT (F3-E3): llama al cliente TIPADO del OpenAPI, normaliza
 * (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio (A1): el backend
 * valida (no-negativo, traspaso atómico, inverso de cancelación, ocultamiento de importes) y es la
 * autoridad. La UI solo presenta lo que el backend manda — los costos/importes vienen `null` si la
 * sesión no tiene `telas.ver-totales` (ex-acceso #7).
 */

/** Clave raíz de la caché del inventario de materiales. */
export const CLAVE_INVENTARIO_MATERIALES = ['inventario-materiales'] as const;

// ── Llamadas: TELAS ────────────────────────────────────────────────────────────

async function ajustarTela(cuerpo: AjusteTelaCrear): Promise<MovimientoTela> {
  const { data, error } = await api.POST('/api/inventarios/telas/ajustes', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function salidaTelaAOrden(cuerpo: SalidaTelaCrear): Promise<MovimientoTela> {
  const { data, error } = await api.POST('/api/inventarios/telas/salidas-orden', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function traspasarTela(cuerpo: TraspasoTelaCrear): Promise<TraspasoTela> {
  const { data, error } = await api.POST('/api/inventarios/telas/traspasos', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function cancelarTela(
  id: number,
  cuerpo: MovimientoMaterialCancelar,
): Promise<MovimientoTela> {
  const { data, error } = await api.POST('/api/inventarios/telas/movimientos/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function listarExistenciasTela(query: ExistenciasTelaQuery): Promise<ExistenciasTela> {
  const { data, error } = await api.GET('/api/inventarios/telas/existencias', {
    params: { query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function obtenerKardexTela(query: KardexTelaQuery): Promise<KardexTela> {
  const { data, error } = await api.GET('/api/inventarios/telas/kardex', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

// ── Llamadas: AVÍOS ────────────────────────────────────────────────────────────

async function ajustarAvio(cuerpo: AjusteAvioCrear): Promise<MovimientoAvio> {
  const { data, error } = await api.POST('/api/inventarios/avios/ajustes', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function traspasarAvio(cuerpo: TraspasoAvioCrear): Promise<TraspasoAvio> {
  const { data, error } = await api.POST('/api/inventarios/avios/traspasos', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function cancelarAvio(
  id: number,
  cuerpo: MovimientoMaterialCancelar,
): Promise<MovimientoAvio> {
  const { data, error } = await api.POST('/api/inventarios/avios/movimientos/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function listarExistenciasAvio(query: ExistenciasAvioQuery): Promise<ExistenciasAvio> {
  const { data, error } = await api.GET('/api/inventarios/avios/existencias', {
    params: { query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function obtenerKardexAvio(query: KardexAvioQuery): Promise<KardexAvio> {
  const { data, error } = await api.GET('/api/inventarios/avios/kardex', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** URL de descarga del PDF 'Inventario de telas' (R9). Acepta los mismos filtros de existencias. */
export function urlImpresoInventarioTelas(query: ExistenciasTelaQuery = {}): string {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(query)) {
    if (valor !== undefined && valor !== null && valor !== '') {
      params.set(clave, String(valor));
    }
  }
  const qs = params.toString();
  return `/api/inventarios/telas/impreso${qs.length > 0 ? `?${qs}` : ''}`;
}

// ── Hooks de consulta: TELAS ───────────────────────────────────────────────────

/** Existencias de tela por tela×lote×almacén (con componentes del lote). */
export function useExistenciasTela(
  query: ExistenciasTelaQuery,
): UseQueryResult<ExistenciasTela, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_MATERIALES, 'telas', 'existencias', query],
    queryFn: () => listarExistenciasTela(query),
    placeholderData: keepPreviousData,
  });
}

/** Kardex de una tela (movimientos con saldo corrido). Deshabilitada hasta tener `idTela`. */
export function useKardexTela(
  query: KardexTelaQuery | undefined,
): UseQueryResult<KardexTela, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_MATERIALES, 'telas', 'kardex', query],
    queryFn: () => obtenerKardexTela(query as KardexTelaQuery),
    enabled: query !== undefined,
    placeholderData: keepPreviousData,
  });
}

// ── Hooks de consulta: AVÍOS ───────────────────────────────────────────────────

/** Existencias de avío por avío×almacén (multi-almacén, R4). `habilitado:false` la apaga (p. ej.
 * el constructor de notas antes de elegir almacén). */
export function useExistenciasAvio(
  query: ExistenciasAvioQuery,
  opciones?: { habilitado?: boolean },
): UseQueryResult<ExistenciasAvio, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_MATERIALES, 'avios', 'existencias', query],
    queryFn: () => listarExistenciasAvio(query),
    enabled: opciones?.habilitado ?? true,
    placeholderData: keepPreviousData,
  });
}

/** Kardex de un avío. Deshabilitada hasta tener `idAvio`. */
export function useKardexAvio(
  query: KardexAvioQuery | undefined,
): UseQueryResult<KardexAvio, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_MATERIALES, 'avios', 'kardex', query],
    queryFn: () => obtenerKardexAvio(query as KardexAvioQuery),
    enabled: query !== undefined,
    placeholderData: keepPreviousData,
  });
}

// ── Hooks de mutación: TELAS ───────────────────────────────────────────────────

/** Registra un ajuste de tela e invalida existencias/kardex. */
export function useAjustarTela(): UseMutationResult<MovimientoTela, ErrorDeApi, AjusteTelaCrear> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ajustarTela,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_INVENTARIO_MATERIALES }),
  });
}

/** Registra una salida de tela a orden e invalida existencias/kardex. */
export function useSalidaTelaAOrden(): UseMutationResult<
  MovimientoTela,
  ErrorDeApi,
  SalidaTelaCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: salidaTelaAOrden,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_INVENTARIO_MATERIALES }),
  });
}

/** Registra un traspaso de tela e invalida existencias/kardex. */
export function useTraspasarTela(): UseMutationResult<TraspasoTela, ErrorDeApi, TraspasoTelaCrear> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: traspasarTela,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_INVENTARIO_MATERIALES }),
  });
}

/** Argumentos de una cancelación de movimiento de material. */
export interface ArgsCancelarMaterial {
  id: number;
  cuerpo: MovimientoMaterialCancelar;
}

/** Cancela un movimiento de tela (inverso) e invalida existencias/kardex. */
export function useCancelarTela(): UseMutationResult<
  MovimientoTela,
  ErrorDeApi,
  ArgsCancelarMaterial
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarMaterial) => cancelarTela(id, cuerpo),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_INVENTARIO_MATERIALES }),
  });
}

// ── Hooks de mutación: AVÍOS ───────────────────────────────────────────────────

/** Registra un ajuste de avío e invalida existencias/kardex. */
export function useAjustarAvio(): UseMutationResult<MovimientoAvio, ErrorDeApi, AjusteAvioCrear> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ajustarAvio,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_INVENTARIO_MATERIALES }),
  });
}

/** Registra un traspaso de avío e invalida existencias/kardex. */
export function useTraspasarAvio(): UseMutationResult<TraspasoAvio, ErrorDeApi, TraspasoAvioCrear> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: traspasarAvio,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_INVENTARIO_MATERIALES }),
  });
}

/** Cancela un movimiento de avío (inverso) e invalida existencias/kardex. */
export function useCancelarAvio(): UseMutationResult<
  MovimientoAvio,
  ErrorDeApi,
  ArgsCancelarMaterial
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarMaterial) => cancelarAvio(id, cuerpo),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_INVENTARIO_MATERIALES }),
  });
}
