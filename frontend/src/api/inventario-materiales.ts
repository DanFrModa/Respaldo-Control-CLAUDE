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
  AjusteTelaColorCrear,
  ExistenciasAvio,
  ExistenciasAvioQuery,
  ExistenciasTela,
  ExistenciasTelaColor,
  ExistenciasTelaColorQuery,
  ExistenciasTelaQuery,
  KardexAvio,
  KardexAvioQuery,
  KardexTela,
  KardexTelaColor,
  KardexTelaColorQuery,
  KardexTelaQuery,
  MovimientoAvio,
  MovimientoMaterialCancelar,
  MovimientoTela,
  MovimientoTelaColor,
  PartidasTela,
  PartidasTelaQuery,
  SalidaTelaColorCrear,
  SalidaTelaCrear,
  TraspasoAvio,
  TraspasoAvioCrear,
  TraspasoTela,
  TraspasoTelaColor,
  TraspasoTelaColorCrear,
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

// ── Llamadas: TELAS por COLOR (inventario NUEVO, etapa A2) ─────────────────────

async function ajustarTelaColor(cuerpo: AjusteTelaColorCrear): Promise<MovimientoTelaColor> {
  const { data, error } = await api.POST('/api/inventarios/telas/color/ajustes', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function salidaTelaColorAOrden(cuerpo: SalidaTelaColorCrear): Promise<MovimientoTelaColor> {
  const { data, error } = await api.POST('/api/inventarios/telas/color/salidas-orden', {
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function traspasarTelaColor(cuerpo: TraspasoTelaColorCrear): Promise<TraspasoTelaColor> {
  const { data, error } = await api.POST('/api/inventarios/telas/color/traspasos', {
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function cancelarTelaColor(
  id: number,
  cuerpo: MovimientoMaterialCancelar,
): Promise<MovimientoTelaColor> {
  const { data, error } = await api.POST('/api/inventarios/telas/color/movimientos/{id}/cancelar', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function listarExistenciasTelaColor(
  query: ExistenciasTelaColorQuery,
): Promise<ExistenciasTelaColor> {
  const { data, error } = await api.GET('/api/inventarios/telas/color/existencias', {
    params: { query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function obtenerKardexTelaColor(query: KardexTelaColorQuery): Promise<KardexTelaColor> {
  const { data, error } = await api.GET('/api/inventarios/telas/color/kardex', {
    params: { query },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function listarPartidasTela(query: PartidasTelaQuery): Promise<PartidasTela> {
  const { data, error } = await api.GET('/api/inventarios/telas/partidas', { params: { query } });
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

// ── Hooks de consulta: TELAS por COLOR (inventario NUEVO, etapa A2) ────────────

/** Existencias agrupadas TELA PADRE → colores (cuerpo y complemento juntos). */
export function useExistenciasTelaColor(
  query: ExistenciasTelaColorQuery,
): UseQueryResult<ExistenciasTelaColor, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_MATERIALES, 'telas-color', 'existencias', query],
    queryFn: () => listarExistenciasTelaColor(query),
    placeholderData: keepPreviousData,
  });
}

/** Kardex de un color de tela (saldo corrido de ambos componentes). Apagada sin `idTelaColor`. */
export function useKardexTelaColor(
  query: KardexTelaColorQuery | undefined,
): UseQueryResult<KardexTelaColor, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_MATERIALES, 'telas-color', 'kardex', query],
    queryFn: () => obtenerKardexTelaColor(query as KardexTelaColorQuery),
    enabled: query !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Búsqueda de partidas (folio / lote del proveedor / factura). */
export function usePartidasTela(
  query: PartidasTelaQuery,
  opciones?: { habilitado?: boolean },
): UseQueryResult<PartidasTela, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_MATERIALES, 'telas-color', 'partidas', query],
    queryFn: () => listarPartidasTela(query),
    enabled: opciones?.habilitado ?? true,
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

// ── Hooks de mutación: TELAS por COLOR (inventario NUEVO, etapa A2) ────────────

/** Registra un ajuste por color (entrada crea partidas) e invalida existencias/kardex. */
export function useAjustarTelaColor(): UseMutationResult<
  MovimientoTelaColor,
  ErrorDeApi,
  AjusteTelaColorCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ajustarTelaColor,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_INVENTARIO_MATERIALES }),
  });
}

/** Registra una salida por color a orden e invalida existencias/kardex. */
export function useSalidaTelaColorAOrden(): UseMutationResult<
  MovimientoTelaColor,
  ErrorDeApi,
  SalidaTelaColorCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: salidaTelaColorAOrden,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_INVENTARIO_MATERIALES }),
  });
}

/** Registra un traspaso por color e invalida existencias/kardex. */
export function useTraspasarTelaColor(): UseMutationResult<
  TraspasoTelaColor,
  ErrorDeApi,
  TraspasoTelaColorCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: traspasarTelaColor,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_INVENTARIO_MATERIALES }),
  });
}

/** Cancela un movimiento por color (inverso auditado) e invalida existencias/kardex. */
export function useCancelarTelaColor(): UseMutationResult<
  MovimientoTelaColor,
  ErrorDeApi,
  ArgsCancelarMaterial
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCancelarMaterial) => cancelarTelaColor(id, cuerpo),
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
