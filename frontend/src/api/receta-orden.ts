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
  AbrirRecetaCuerpo,
  LiberarRecetaCuerpo,
  RecetaAgregarCuerpo,
  RecetaEditarCuerpo,
  RecetaOrden,
  RecetasPorLiberarPagina,
  TipoRenglonReceta,
  TraerDelModeloCuerpo,
  TraerDelModeloResultado,
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

/** Argumentos de corregir la captura heredada de un renglón de AVÍO. */
export interface ArgsCorregirCapturaAvio {
  idOrden: number;
  idRenglon: number;
}

/**
 * ⭐⭐⭐ **EL BOTÓN «CORREGIR»** (V1-E8h, §Post-F9.130). Apaga el «se consume por talla» que un avío
 * POR MEDIDA arrastra de una captura vieja — la contradicción que hacía que la orden pidiera hasta
 * 53 veces el material que necesita.
 *
 * 🔴 Es una MUTACIÓN, y eso es el entregable: el sistema ya detectaba el error y ya sabía cuánto
 * debería pedir, pero el aviso terminaba con *"guarda el renglón para normalizarlo"* — un conjuro
 * que un no-programador no puede adivinar. Sigue siendo un acto EXPLÍCITO (D3: una lectura no
 * cambia datos); lo que cambia es que ahora el acto es un botón que se entiende.
 *
 * Qué hace y qué no lo decide el BACKEND (A1): aquí sólo se pide. El renglón vuelve a quedar SIN
 * FIRMAR —el requerido cambió—, así que también se refresca la bandeja de Desarrollo.
 */
export function useCorregirCapturaAvio(): UseMutationResult<
  RecetaOrden,
  ErrorDeApi,
  ArgsCorregirCapturaAvio
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, idRenglon }: ArgsCorregirCapturaAvio) => {
      const { data, error } = await api.POST(
        '/api/ordenes/{id}/receta/renglones/avio/{idRenglon}/corregir',
        { params: { path: { id: idOrden, idRenglon } } },
      );
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (receta, { idOrden }) => {
      trasMutar(qc, idOrden, receta);
      void qc.invalidateQueries({ queryKey: CLAVE_RECETAS_POR_LIBERAR });
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

/** Argumentos de liberar: QUÉ renglones se firman (V1-E3h §Post-F9.72, V1-E3k §Post-F9.80). */
export interface ArgsLiberarReceta {
  idOrden: number;
  /**
   * ⭐ V1-E3k (§Post-F9.80): **obligatorio**, y hay que nombrar los renglones. Antes se podía omitir
   * y significaba «firma la receta entera»; Daniel quitó ese atajo (*"no tiene sentido liberar las
   * cosas sin ver"*), y el contrato ya no lo acepta.
   */
  cuerpo: LiberarRecetaCuerpo;
}

/**
 * LIBERA renglones de la receta, **uno por uno** (§Post-F9.72 los partió, §Post-F9.80 quitó los
 * atajos en bloque).
 *
 * La puerta dejó de ser todo-o-nada: se compra lo liberado. Qué se puede firmar y qué no (que no
 * queden renglones sin revisar entre los firmados, que la lista no venga vacía) lo decide el
 * BACKEND — aquí no se replica ninguna de esas reglas (A1).
 */
export function useLiberarReceta(): UseMutationResult<RecetaOrden, ErrorDeApi, ArgsLiberarReceta> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, cuerpo }: ArgsLiberarReceta) => {
      const { data, error } = await api.POST('/api/ordenes/{id}/receta/liberar', {
        params: { path: { id: idOrden } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (receta, { idOrden }) => {
      trasMutar(qc, idOrden, receta);
      // La bandeja de Desarrollo cuenta pendientes por orden: firmar cambia lo que muestra.
      void qc.invalidateQueries({ queryKey: CLAVE_RECETAS_POR_LIBERAR });
    },
  });
}

// ── ⭐⭐ V1-E8z · EL CANDADO DE COMPRA (§Post-F9.160(a)) ──────────────────────────────────────

/** Argumentos de ABRIR la receta: el motivo es obligatorio (lo exige el contrato). */
export interface ArgsAbrirReceta {
  idOrden: number;
  cuerpo: AbrirRecetaCuerpo;
}

/**
 * ⭐⭐⭐ **REABRE la receta para corregirla y CONGELA la compra de la orden.** DANIEL: *"pongamos un
 * candado que no se pueda comprar nada hasta que esté cerrado otra vez"*.
 *
 * **Las firmas NO se pierden**: reabrir sólo marca, así que cerrar es un clic y sólo hay que
 * re-firmar lo que se toque (§Post-F9.165 punto 1). Todas las reglas —que la receta esté liberada
 * completa, que no esté ya abierta, que la orden esté viva— las decide el BACKEND (A1); aquí sólo
 * se pide.
 *
 * Se invalida también la BANDEJA: la orden reabierta aparece ahí marcada «En corrección», que es lo
 * único que impide que se quede congelada e invisible.
 */
export function useAbrirReceta(): UseMutationResult<RecetaOrden, ErrorDeApi, ArgsAbrirReceta> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, cuerpo }: ArgsAbrirReceta) => {
      const { data, error } = await api.POST('/api/ordenes/{id}/receta/abrir', {
        params: { path: { id: idOrden } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (receta, { idOrden }) => {
      trasMutar(qc, idOrden, receta);
      void qc.invalidateQueries({ queryKey: CLAVE_RECETAS_POR_LIBERAR });
    },
  });
}

/**
 * **CIERRA la receta reabierta y descongela la compra.** El backend exige que no quede ningún
 * renglón vivo sin firmar y nombra los que falten (A1: esa regla no se replica aquí). Sin cuerpo: la
 * razón ya se dio al abrir.
 */
export function useCerrarReceta(): UseMutationResult<RecetaOrden, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (idOrden: number) => {
      const { data, error } = await api.POST('/api/ordenes/{id}/receta/cerrar', {
        params: { path: { id: idOrden } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (receta, idOrden) => {
      trasMutar(qc, idOrden, receta);
      void qc.invalidateQueries({ queryKey: CLAVE_RECETAS_POR_LIBERAR });
    },
  });
}

/** Argumentos de traer del modelo (sin `materiales` = todo lo que falte). */
export interface ArgsTraerDelModelo {
  idOrden: number;
  cuerpo?: TraerDelModeloCuerpo;
}

/**
 * TRAE DEL MODELO lo que le falta a la receta (§Post-F9.73). Lo jala **Desarrollo**
 * (`desarrollo.administrar`), no compras.
 *
 * Devuelve la receta ya recargada MÁS el resumen de qué se trajo y qué se respetó: el backend nunca
 * pisa un renglón existente y dice por qué (aquí solo se pinta ese resumen — A1).
 */
export function useTraerDelModelo(): UseMutationResult<
  TraerDelModeloResultado,
  ErrorDeApi,
  ArgsTraerDelModelo
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idOrden, cuerpo }: ArgsTraerDelModelo) => {
      const { data, error } = await api.POST('/api/ordenes/{id}/receta/traer-del-modelo', {
        params: { path: { id: idOrden } },
        body: cuerpo ?? {},
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: (resultado, { idOrden }) => {
      trasMutar(qc, idOrden, resultado.receta);
      void qc.invalidateQueries({ queryKey: CLAVE_RECETAS_POR_LIBERAR });
    },
  });
}

/** Clave de la caché de la bandeja «Recetas por liberar». */
export const CLAVE_RECETAS_POR_LIBERAR = ['recetas-por-liberar'] as const;

/** Filtros de la bandeja (lo que viaja en la URL del endpoint). */
export interface FiltrosRecetasPorLiberar {
  pagina?: number;
  porPagina?: number;
  soloConOrdenCompra?: boolean;
  busqueda?: string;
}

/**
 * BANDEJA «Recetas por liberar» (§Post-F9.72, DANIEL: *"está buenísima"*). Una fila por ORDEN,
 * ordenada por fecha de entrega, con los conteos por tipo y la marca de "ya está frenando dinero"
 * **agregados en el servidor** (A1: aquí no se suma nada).
 */
export function useRecetasPorLiberar(
  filtros: FiltrosRecetasPorLiberar = {},
): UseQueryResult<RecetasPorLiberarPagina, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_RECETAS_POR_LIBERAR, filtros],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/recetas-por-liberar', {
        params: {
          query: {
            pagina: filtros.pagina ?? 1,
            porPagina: filtros.porPagina ?? 20,
            soloConOrdenCompra: filtros.soloConOrdenCompra === true ? 'true' : 'false',
            ...(filtros.busqueda === undefined || filtros.busqueda === ''
              ? {}
              : { busqueda: filtros.busqueda }),
          },
        },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
  });
}
