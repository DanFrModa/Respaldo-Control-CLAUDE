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
  ConcentradoCorrida,
  ConceptoPago,
  ConceptoPagoCrear,
  ConceptoPagoCuenta,
  ConceptoPagoCuentaCrear,
  ConceptoPagoCuentaEditar,
  ConceptoPagoEditar,
  ConceptosPagoPagina,
  ConceptosPagoQuery,
  CorridaCrear,
  CorridaDetalle,
  CorridasLista,
  CorridasQuery,
  RenglonCorridaGuardar,
} from './tipos';

/**
 * Capa de datos de LA CORRIDA SEMANAL DE PAGOS (fila 0.113) y del CATÁLOGO DE CONCEPTOS que no son
 * proveedores (0.125). Mismo estándar: cliente TIPADO del OpenAPI, normaliza (`data`/`ErrorDeApi`) y
 * expone hooks de TanStack Query. CERO lógica de negocio (A1): el servidor arma las secciones,
 * calcula los totales, aplica la guarda fiscal y decide qué se puede ver.
 *
 * ⚠️ Toda mutación de la corrida devuelve **la pantalla entera** (`CorridaDetalle`), y por eso se
 * siembra en la caché con `setQueryData` en vez de invalidar: teclear un monto en un renglón no
 * puede provocar un parpadeo de toda la relación mientras se recarga.
 */

/** Clave raíz de la caché de la corrida. */
export const CLAVE_CORRIDAS = ['pagos', 'corridas'] as const;
/** Clave raíz de la caché del catálogo de conceptos. */
export const CLAVE_CONCEPTOS_PAGO = ['conceptos-pago'] as const;

/** Clave de la pantalla de trabajo de UNA corrida. */
export function claveCorrida(id: number): readonly unknown[] {
  return [...CLAVE_CORRIDAS, 'detalle', id];
}

// ── Las corridas ────────────────────────────────────────────────────────────────────────────────

async function listarCorridas(query: CorridasQuery): Promise<CorridasLista> {
  const { data, error } = await api.GET('/api/pagos/corridas', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Las corridas de pago (las de con factura y las de sin), paginadas por el servidor. */
export function useCorridas(query: CorridasQuery): UseQueryResult<CorridasLista, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CORRIDAS, 'lista', query],
    queryFn: () => listarCorridas(query),
    placeholderData: keepPreviousData,
  });
}

async function obtenerCorrida(id: number): Promise<CorridaDetalle> {
  const { data, error } = await api.GET('/api/pagos/corridas/{id}', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** La PANTALLA DE TRABAJO de una corrida (secciones por rubro + bloqueos). */
export function useCorrida(id: number | null): UseQueryResult<CorridaDetalle, ErrorDeApi> {
  return useQuery({
    queryKey: claveCorrida(id ?? 0),
    queryFn: () => obtenerCorrida(id as number),
    enabled: id !== null,
  });
}

/** Siembra la pantalla devuelta por una mutación y refresca la lista (sin parpadeo). */
function useSembrarDetalle(): (detalle: CorridaDetalle) => void {
  const qc = useQueryClient();
  return (detalle) => {
    qc.setQueryData(claveCorrida(detalle.corrida.id), detalle);
    void qc.invalidateQueries({ queryKey: [...CLAVE_CORRIDAS, 'lista'] });
  };
}

async function crearCorrida(cuerpo: CorridaCrear): Promise<CorridaDetalle> {
  const { data, error } = await api.POST('/api/pagos/corridas', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Abre la corrida de la semana (carga los conceptos predeterminados en cero). */
export function useCrearCorrida(): UseMutationResult<CorridaDetalle, ErrorDeApi, CorridaCrear> {
  const sembrar = useSembrarDetalle();
  return useMutation({ mutationFn: crearCorrida, onSuccess: sembrar });
}

/** Argumentos para guardar un renglón: la corrida, el cuerpo y —al editar— el renglón. */
export interface GuardarRenglonArgs {
  idCorrida: number;
  cuerpo: RenglonCorridaGuardar;
  idRenglon?: number;
}

async function guardarRenglon({
  idCorrida,
  cuerpo,
  idRenglon,
}: GuardarRenglonArgs): Promise<CorridaDetalle> {
  if (idRenglon === undefined) {
    const { data, error } = await api.POST('/api/pagos/corridas/{id}/renglones', {
      params: { path: { id: idCorrida } },
      body: cuerpo,
    });
    if (!data) throw new ErrorDeApi(error);
    return data;
  }
  const { data, error } = await api.PUT('/api/pagos/corridas/{id}/renglones/{idRenglon}', {
    params: { path: { id: idCorrida, idRenglon } },
    body: cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Captura o reemplaza un renglón (monto, forma de pago, cuenta destino). */
export function useGuardarRenglon(): UseMutationResult<
  CorridaDetalle,
  ErrorDeApi,
  GuardarRenglonArgs
> {
  const sembrar = useSembrarDetalle();
  return useMutation({ mutationFn: guardarRenglon, onSuccess: sembrar });
}

async function eliminarRenglon(args: {
  idCorrida: number;
  idRenglon: number;
}): Promise<CorridaDetalle> {
  const { data, error } = await api.DELETE('/api/pagos/corridas/{id}/renglones/{idRenglon}', {
    params: { path: { id: args.idCorrida, idRenglon: args.idRenglon } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Quita un renglón de un borrador. */
export function useEliminarRenglon(): UseMutationResult<
  CorridaDetalle,
  ErrorDeApi,
  { idCorrida: number; idRenglon: number }
> {
  const sembrar = useSembrarDetalle();
  return useMutation({ mutationFn: eliminarRenglon, onSuccess: sembrar });
}

async function cerrarCorrida(id: number): Promise<CorridaDetalle> {
  const { data, error } = await api.POST('/api/pagos/corridas/{id}/cerrar', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Cierra la relación (aquí muerde la guarda fiscal, con nombre y apellido). */
export function useCerrarCorrida(): UseMutationResult<CorridaDetalle, ErrorDeApi, number> {
  const sembrar = useSembrarDetalle();
  return useMutation({ mutationFn: cerrarCorrida, onSuccess: sembrar });
}

async function ejecutarCorrida(id: number): Promise<CorridaDetalle> {
  const { data, error } = await api.POST('/api/pagos/corridas/{id}/ejecutar', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Ejecuta: el dinero salió y nacen los movimientos en los estados de cuenta. */
export function useEjecutarCorrida(): UseMutationResult<CorridaDetalle, ErrorDeApi, number> {
  const qc = useQueryClient();
  const sembrar = useSembrarDetalle();
  return useMutation({
    mutationFn: ejecutarCorrida,
    onSuccess: (detalle) => {
      sembrar(detalle);
      // Al ejecutar nacen pagos y movimientos: los saldos de EsMa y la bandeja de CxP cambian.
      void qc.invalidateQueries({ queryKey: ['esma'] });
      void qc.invalidateQueries({ queryKey: ['cxp'] });
    },
  });
}

async function obtenerConcentrado(id: number): Promise<ConcentradoCorrida> {
  const { data, error } = await api.GET('/api/pagos/corridas/{id}/concentrado', {
    params: { path: { id } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** La relación ejecutable (sólo lo que lleva monto, por rubro y por monto). */
export function useConcentrado(
  id: number | null,
  habilitado: boolean,
): UseQueryResult<ConcentradoCorrida, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CORRIDAS, 'concentrado', id],
    queryFn: () => obtenerConcentrado(id as number),
    enabled: id !== null && habilitado,
  });
}

// ── El catálogo de conceptos (0.125) ────────────────────────────────────────────────────────────

async function listarConceptos(query: ConceptosPagoQuery): Promise<ConceptosPagoPagina> {
  const { data, error } = await api.GET('/api/conceptos-pago', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** El catálogo de conceptos de pago que no son proveedores. */
export function useConceptosPago(
  query: ConceptosPagoQuery,
): UseQueryResult<ConceptosPagoPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CONCEPTOS_PAGO, 'lista', query],
    queryFn: () => listarConceptos(query),
    placeholderData: keepPreviousData,
  });
}

async function crearConcepto(cuerpo: ConceptoPagoCrear): Promise<ConceptoPago> {
  const { data, error } = await api.POST('/api/conceptos-pago', { body: cuerpo });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Da de alta un concepto de pago. */
export function useCrearConceptoPago(): UseMutationResult<
  ConceptoPago,
  ErrorDeApi,
  ConceptoPagoCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: crearConcepto,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CONCEPTOS_PAGO }),
  });
}

async function editarConcepto(args: {
  id: number;
  cuerpo: ConceptoPagoEditar;
}): Promise<ConceptoPago> {
  const { data, error } = await api.PATCH('/api/conceptos-pago/{id}', {
    params: { path: { id: args.id } },
    body: args.cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Edita, retira o reactiva un concepto de pago. */
export function useEditarConceptoPago(): UseMutationResult<
  ConceptoPago,
  ErrorDeApi,
  { id: number; cuerpo: ConceptoPagoEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: editarConcepto,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CONCEPTOS_PAGO }),
  });
}

async function crearCuentaConcepto(args: {
  id: number;
  cuerpo: ConceptoPagoCuentaCrear;
}): Promise<ConceptoPagoCuenta> {
  const { data, error } = await api.POST('/api/conceptos-pago/{id}/cuentas', {
    params: { path: { id: args.id } },
    body: args.cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Agrega una cuenta/destino de pago a un concepto. */
export function useCrearCuentaConcepto(): UseMutationResult<
  ConceptoPagoCuenta,
  ErrorDeApi,
  { id: number; cuerpo: ConceptoPagoCuentaCrear }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: crearCuentaConcepto,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CONCEPTOS_PAGO }),
  });
}

async function editarCuentaConcepto(args: {
  id: number;
  idCuenta: number;
  cuerpo: ConceptoPagoCuentaEditar;
}): Promise<ConceptoPagoCuenta> {
  const { data, error } = await api.PATCH('/api/conceptos-pago/{id}/cuentas/{idCuenta}', {
    params: { path: { id: args.id, idCuenta: args.idCuenta } },
    body: args.cuerpo,
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

/** Edita, retira, reactiva o deja por omisión una cuenta de un concepto. */
export function useEditarCuentaConcepto(): UseMutationResult<
  ConceptoPagoCuenta,
  ErrorDeApi,
  { id: number; idCuenta: number; cuerpo: ConceptoPagoCuentaEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: editarCuentaConcepto,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CONCEPTOS_PAGO }),
  });
}
