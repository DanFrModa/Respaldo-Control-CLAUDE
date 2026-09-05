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
  ConteoTelaColor,
  ConteoTelaColorCrear,
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
  PreviaSalidaTelaColor,
  PreviaSalidaTelaColorCrear,
  SaldosTelaColor,
  SaldosTelaColorQuery,
  SalidaTelaColorCrear,
  SalidaTelaCrear,
  TraspasoAvio,
  TraspasoAvioCrear,
  TraspasoTelaColor,
  TraspasoTelaColorCrear,
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

async function registrarConteoTelaColor(cuerpo: ConteoTelaColorCrear): Promise<ConteoTelaColor> {
  const { data, error } = await api.POST('/api/inventarios/telas/color/conteos', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

async function obtenerSaldosTelaColor(query: SaldosTelaColorQuery): Promise<SaldosTelaColor> {
  const { data, error } = await api.GET('/api/inventarios/telas/color/saldos', {
    params: { query },
  });
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

/**
 * ⭐⭐ PREVIA de la salida por color (fila 0.101): manda LA CAPTURA EN CURSO y trae los DOS avisos
 * ya decididos. Va por POST porque el cuerpo son N renglones, no un filtro de URL — mismo patrón
 * que la vista previa de la fusión de departamentos.
 */
async function previaSalidaTelaColor(
  cuerpo: PreviaSalidaTelaColorCrear,
): Promise<PreviaSalidaTelaColor> {
  const { data, error } = await api.POST('/api/inventarios/telas/color/salidas-orden/previa', {
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

/**
 * URL de descarga del PDF 'Inventario de telas' (R9). Acepta los MISMOS filtros que «Inventario de
 * telas» (existencias por COLOR), que es la pantalla de la que cuelga su botón.
 *
 * ⚠️ Hasta v0.097 recibía los filtros del inventario LEGADO por lote y el backend imprimía ESA
 * consulta —la del inventario legado, no la de esta pantalla—: la hoja salía prácticamente en
 * blanco. El defecto era imprimir OTRA cosa con el nombre de ésta, no que aquélla estuviera muerta.
 */
export function urlImpresoInventarioTelas(query: ExistenciasTelaColorQuery = {}): string {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(query)) {
    if (valor !== undefined && valor !== null && valor !== '') {
      params.set(clave, String(valor));
    }
  }
  const qs = params.toString();
  return `/api/inventarios/telas/impreso${qs.length > 0 ? `?${qs}` : ''}`;
}

/**
 * URL del PDF de la HOJA DE TRASPASO de tela (V1-E3b, §Post-F9.38): el papel que acompaña la tela
 * que sale a otro almacén (p. ej. al cortador). NO es un folio nuevo — imprime el traspaso que ya
 * existe, por el id de CUALQUIERA de sus dos patas (por eso se puede reimprimir desde el kardex).
 * Un traspaso cancelado no se imprime: el backend lo rechaza.
 */
export function urlImpresoTraspasoTela(idMovimiento: number): string {
  return `/api/inventarios/telas/traspasos/${String(idMovimiento)}/impreso`;
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

/**
 * SALDOS del sistema para el CONTEO físico (fila 0.098): TODOS los colores de la pantalla en UNA
 * llamada. El backend los calcula por Σ de movimientos —nunca la vista— con la MISMA aritmética que
 * usa al aplicar la diferencia. Apagado hasta que haya almacén y al menos un color.
 *
 * ⚠️ Antes era un hook POR COLOR (uno por renglón) con `staleTime: 0`: cargar el inventario del
 * arranque eran cientos de GET, cada uno abriendo su transacción y tomando un lock exclusivo, y se
 * re-disparaban al volver el foco. Ahora es UNA consulta, y por eso su `queryKey` lleva la lista
 * completa de colores.
 */
export function useSaldosTelaColor(
  query: SaldosTelaColorQuery | undefined,
): UseQueryResult<SaldosTelaColor, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_MATERIALES, 'telas-color', 'saldos', query],
    queryFn: () => obtenerSaldosTelaColor(query as SaldosTelaColorQuery),
    enabled: query !== undefined,
  });
}

/**
 * ⭐⭐ LOS DOS AVISOS de la salida de tela a orden (fila 0.101 — Daniel §Post-F9.193, dec. 8 y 9).
 *
 * 🔴 La pantalla NO compara nada (A1): manda lo capturado y el SERVIDOR devuelve los veredictos
 * (`sobreSalida` / `riesgoTono`) con los números y las partidas que los sostienen. «Lo que la orden
 * pide» sale del snapshot de la explosión —la MISMA cifra que ve el comprador—, no de una segunda
 * cuenta hecha aquí. Deshabilitada mientras no haya orden, almacén y al menos un renglón: sin eso
 * no hay nada que avisar.
 *
 * ⚠️ Si la consulta falla, la pantalla **no enseña ningún aviso y no interrumpe a nadie**: es una
 * advertencia, no una guarda. Lo que protege el inventario (no-negativo bajo lock, D3) vive en el
 * registro de la salida, que sí falla en voz alta.
 */
export function usePreviaSalidaTelaColor(
  cuerpo: PreviaSalidaTelaColorCrear | undefined,
): UseQueryResult<PreviaSalidaTelaColor, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_INVENTARIO_MATERIALES, 'telas-color', 'salida-previa', cuerpo],
    queryFn: () => previaSalidaTelaColor(cuerpo as PreviaSalidaTelaColorCrear),
    enabled: cuerpo !== undefined,
    // Mientras se recalcula, el aviso anterior sigue en pantalla: quitarlo y devolverlo hace que
    // el bloque parpadee cada vez que se agrega un renglón.
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

/**
 * Registra un CONTEO físico por color: se manda LO CONTADO y el servidor aplica la diferencia
 * (fila 0.098). Invalida existencias/kardex/saldos.
 */
export function useRegistrarConteoTelaColor(): UseMutationResult<
  ConteoTelaColor,
  ErrorDeApi,
  ConteoTelaColorCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: registrarConteoTelaColor,
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
