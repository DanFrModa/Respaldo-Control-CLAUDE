import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { CLAVE_COTIZACIONES } from './cotizaciones';
import { ErrorDeApi } from './errores';
import { CLAVE_LISTAS } from './listas-precios';
import { CLAVE_PROYECTOS } from './proyectos';
import type {
  Cliente,
  ClienteCampo,
  ClienteContacto,
  ClienteContactoCrear,
  ClienteContactoEditar,
  ClienteCampoCrear,
  ClienteCampoEditar,
  ClienteCrear,
  ClienteDepartamento,
  ClienteDepartamentoCrear,
  ClienteDepartamentoEditar,
  ClienteDepartamentoFusionar,
  ClienteEditar,
  ClientesPagina,
  ClientesQuery,
  FusionDepartamentosPrevia,
} from './tipos';

/**
 * Capa de datos de Clientes (F1-E2, PIEZA C — D7) — replica del ESTANDAR de
 * Proveedores (`api/proveedores.ts`). Cada funcion llama al cliente TIPADO del
 * OpenAPI, normaliza (`data` en exito, `ErrorDeApi` con el mensaje del backend en
 * fallo) y se expone como consulta o mutacion (las mutaciones invalidan la cache).
 * CERO logica de negocio: el backend valida, autoriza y decide (A1).
 *
 * Como el cliente trae sus campos de referencia EMBEBIDOS (el backend los incluye en
 * la lista y al obtener uno), toda mutacion de campos invalida tambien la lista de
 * clientes para refrescar el detalle.
 */

/** Clave raiz de la cache de clientes en TanStack Query. */
export const CLAVE_CLIENTES = ['clientes'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaClientes(query: ClientesQuery): readonly unknown[] {
  return [...CLAVE_CLIENTES, 'lista', query];
}

/** Pide una pagina del listado de clientes (busqueda + orden + paginacion en servidor). */
async function listarClientes(query: ClientesQuery): Promise<ClientesPagina> {
  const { data, error } = await api.GET('/api/clientes', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un cliente (`POST /api/clientes`). */
async function crearCliente(cuerpo: ClienteCrear): Promise<Cliente> {
  const { data, error } = await api.POST('/api/clientes', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un cliente (`PATCH /api/clientes/{id}`). */
async function actualizarCliente(id: number, cuerpo: ClienteEditar): Promise<Cliente> {
  const { data, error } = await api.PATCH('/api/clientes/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un cliente (borrado SUAVE, `DELETE /api/clientes/{id}`). */
async function desactivarCliente(id: number): Promise<Cliente> {
  const { data, error } = await api.DELETE('/api/clientes/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Reactiva un cliente desactivado (restaura el borrado suave): es un
 * `PATCH /api/clientes/{id}` con `{ activo: true }`. El backend re-verifica que el
 * nombre siga libre y audita la reactivacion.
 */
async function reactivarCliente(id: number): Promise<Cliente> {
  const { data, error } = await api.PATCH('/api/clientes/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Trae UN cliente por id (`GET /api/clientes/{id}`), con sus campos de referencia embebidos. */
async function obtenerCliente(id: number): Promise<Cliente> {
  const { data, error } = await api.GET('/api/clientes/{id}', { params: { path: { id } } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks de cliente ──────────────────────────────────────────────────────────

/** Lista clientes con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useClientes(query: ClientesQuery): UseQueryResult<ClientesPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaClientes(query),
    queryFn: () => listarClientes(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Trae UN cliente por id; deshabilitada sin id. La usa el DEEP-LINK de `ClientesPagina`
 * (V1-E8t, §Post-F9.145): la puerta «Capturar factores» puede apuntar a un cliente que no está en
 * la página visible del listado —hay ~117—, y sin su ficha el cajón se abriría VACÍO. Mismo patrón
 * que `useFichaModelo` en el deep-link de Modelos.
 */
export function useCliente(id: number | undefined): UseQueryResult<Cliente, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CLIENTES, 'uno', id ?? 0],
    queryFn: () => obtenerCliente(id as number),
    enabled: id !== undefined,
  });
}

/** Crea un cliente e invalida la lista para reflejarlo. */
export function useCrearCliente(): UseMutationResult<Cliente, ErrorDeApi, ClienteCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearCliente,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CLIENTES }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarCliente {
  id: number;
  cuerpo: ClienteEditar;
}

/** Edita un cliente e invalida la lista. */
export function useActualizarCliente(): UseMutationResult<
  Cliente,
  ErrorDeApi,
  ArgsActualizarCliente
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarCliente) => actualizarCliente(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CLIENTES }),
  });
}

/** Desactiva un cliente (borrado suave) e invalida la lista. */
export function useDesactivarCliente(): UseMutationResult<Cliente, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarCliente,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CLIENTES }),
  });
}

/** Reactiva un cliente desactivado (restaura el borrado suave) e invalida la lista. */
export function useReactivarCliente(): UseMutationResult<Cliente, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarCliente,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_CLIENTES }),
  });
}

// ── Campos de referencia del cliente (D7) ───────────────────────────────────────

/** Clave de cache de los campos de UN cliente. */
function claveCampos(idCliente: number): readonly unknown[] {
  return [...CLAVE_CLIENTES, 'campos', idCliente];
}

/** Lista los campos de referencia de un cliente (`GET /api/clientes/{id}/campos`). */
async function listarCamposCliente(idCliente: number): Promise<ClienteCampo[]> {
  const { data, error } = await api.GET('/api/clientes/{id}/campos', {
    params: { path: { id: idCliente }, query: { incluirInactivos: 'true' } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/**
 * Lista los campos de un cliente, incluidos los desactivados (el editor los muestra
 * para poder reactivarlos). Deshabilitada si no hay id (p. ej. en alta, antes de
 * guardar el cliente).
 */
export function useCamposCliente(
  idCliente: number | undefined,
): UseQueryResult<ClienteCampo[], ErrorDeApi> {
  return useQuery({
    queryKey: claveCampos(idCliente ?? 0),
    queryFn: () => listarCamposCliente(idCliente as number),
    enabled: idCliente !== undefined,
  });
}

/** Argumentos de la mutacion de alta de un campo. */
export interface ArgsAgregarCampo {
  idCliente: number;
  cuerpo: ClienteCampoCrear;
}

/** Agrega un campo de referencia (`POST /api/clientes/{id}/campos`). */
async function agregarCampo({ idCliente, cuerpo }: ArgsAgregarCampo): Promise<ClienteCampo> {
  const { data, error } = await api.POST('/api/clientes/{id}/campos', {
    params: { path: { id: idCliente } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Refresca los campos del cliente y la lista (el cliente embebe sus campos). */
function invalidarCampos(queryClient: ReturnType<typeof useQueryClient>, idCliente: number): void {
  void queryClient.invalidateQueries({ queryKey: claveCampos(idCliente) });
  void queryClient.invalidateQueries({ queryKey: CLAVE_CLIENTES });
}

/** Agrega un campo de referencia e invalida los campos del cliente y la lista. */
export function useAgregarCampoCliente(): UseMutationResult<
  ClienteCampo,
  ErrorDeApi,
  ArgsAgregarCampo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: agregarCampo,
    onSuccess: (_resultado, variables) => invalidarCampos(queryClient, variables.idCliente),
  });
}

/** Argumentos de la mutacion de edicion de un campo. */
export interface ArgsActualizarCampo {
  idCliente: number;
  idCampo: number;
  cuerpo: ClienteCampoEditar;
}

/** Actualiza un campo de referencia (`PATCH /api/clientes/{id}/campos/{idCampo}`). */
async function actualizarCampo({
  idCliente,
  idCampo,
  cuerpo,
}: ArgsActualizarCampo): Promise<ClienteCampo> {
  const { data, error } = await api.PATCH('/api/clientes/{id}/campos/{idCampo}', {
    params: { path: { id: idCliente, idCampo } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Edita un campo de referencia e invalida los campos del cliente y la lista. */
export function useActualizarCampoCliente(): UseMutationResult<
  ClienteCampo,
  ErrorDeApi,
  ArgsActualizarCampo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: actualizarCampo,
    onSuccess: (_resultado, variables) => invalidarCampos(queryClient, variables.idCliente),
  });
}

/** Argumentos de las mutaciones que solo necesitan ubicar el campo. */
export interface ArgsCampo {
  idCliente: number;
  idCampo: number;
}

/** Desactiva un campo de referencia (borrado SUAVE, `DELETE /api/clientes/{id}/campos/{idCampo}`). */
async function desactivarCampo({ idCliente, idCampo }: ArgsCampo): Promise<ClienteCampo> {
  const { data, error } = await api.DELETE('/api/clientes/{id}/campos/{idCampo}', {
    params: { path: { id: idCliente, idCampo } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un campo de referencia e invalida los campos del cliente y la lista. */
export function useDesactivarCampoCliente(): UseMutationResult<
  ClienteCampo,
  ErrorDeApi,
  ArgsCampo
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarCampo,
    onSuccess: (_resultado, variables) => invalidarCampos(queryClient, variables.idCliente),
  });
}

/**
 * Reactiva un campo de referencia desactivado: es un PATCH con `{ activo: true }`
 * (mismo patron que reactivar un cliente). Invalida los campos del cliente y la lista.
 */
async function reactivarCampo({ idCliente, idCampo }: ArgsCampo): Promise<ClienteCampo> {
  const { data, error } = await api.PATCH('/api/clientes/{id}/campos/{idCampo}', {
    params: { path: { id: idCliente, idCampo } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva un campo de referencia desactivado e invalida los campos del cliente y la lista. */
export function useReactivarCampoCliente(): UseMutationResult<ClienteCampo, ErrorDeApi, ArgsCampo> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarCampo,
    onSuccess: (_resultado, variables) => invalidarCampos(queryClient, variables.idCliente),
  });
}

// ── Departamentos del cliente (D13/R16) ─────────────────────────────────────────

/** Clave de cache de los departamentos de UN cliente. */
function claveDepartamentos(idCliente: number): readonly unknown[] {
  return [...CLAVE_CLIENTES, 'departamentos', idCliente];
}

/** Lista los departamentos de un cliente (`GET /api/clientes/{idCliente}/departamentos`). */
async function listarDepartamentos(idCliente: number): Promise<ClienteDepartamento[]> {
  const { data, error } = await api.GET('/api/clientes/{idCliente}/departamentos', {
    params: { path: { idCliente }, query: { incluirInactivos: 'true' } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/**
 * Lista los departamentos de un cliente, incluidos los desactivados (el editor los muestra
 * para poder reactivarlos). Deshabilitada si no hay id.
 */
export function useDepartamentosCliente(
  idCliente: number | undefined,
): UseQueryResult<ClienteDepartamento[], ErrorDeApi> {
  return useQuery({
    queryKey: claveDepartamentos(idCliente ?? 0),
    queryFn: () => listarDepartamentos(idCliente as number),
    enabled: idCliente !== undefined,
  });
}

/** Refresca los departamentos del cliente (no van embebidos en la lista de clientes). */
function invalidarDepartamentos(
  queryClient: ReturnType<typeof useQueryClient>,
  idCliente: number,
): void {
  void queryClient.invalidateQueries({ queryKey: claveDepartamentos(idCliente) });
}

/** Argumentos de la mutacion de alta de un departamento. */
export interface ArgsAgregarDepartamento {
  idCliente: number;
  cuerpo: ClienteDepartamentoCrear;
}

/** Agrega un departamento (`POST /api/clientes/{idCliente}/departamentos`). */
async function agregarDepartamento({
  idCliente,
  cuerpo,
}: ArgsAgregarDepartamento): Promise<ClienteDepartamento> {
  const { data, error } = await api.POST('/api/clientes/{idCliente}/departamentos', {
    params: { path: { idCliente } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Agrega un departamento e invalida los departamentos del cliente. */
export function useAgregarDepartamentoCliente(): UseMutationResult<
  ClienteDepartamento,
  ErrorDeApi,
  ArgsAgregarDepartamento
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: agregarDepartamento,
    onSuccess: (_resultado, variables) => invalidarDepartamentos(queryClient, variables.idCliente),
  });
}

/** Argumentos de la mutacion de edicion de un departamento. */
export interface ArgsActualizarDepartamento {
  idCliente: number;
  id: number;
  cuerpo: ClienteDepartamentoEditar;
}

/** Actualiza un departamento (`PATCH /api/clientes/{idCliente}/departamentos/{id}`). */
async function actualizarDepartamento({
  idCliente,
  id,
  cuerpo,
}: ArgsActualizarDepartamento): Promise<ClienteDepartamento> {
  const { data, error } = await api.PATCH('/api/clientes/{idCliente}/departamentos/{id}', {
    params: { path: { idCliente, id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Edita un departamento e invalida los departamentos del cliente. */
export function useActualizarDepartamentoCliente(): UseMutationResult<
  ClienteDepartamento,
  ErrorDeApi,
  ArgsActualizarDepartamento
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: actualizarDepartamento,
    onSuccess: (_resultado, variables) => invalidarDepartamentos(queryClient, variables.idCliente),
  });
}

/** Argumentos de las mutaciones que solo ubican el departamento. */
export interface ArgsDepartamento {
  idCliente: number;
  id: number;
}

/** Desactiva un departamento (borrado SUAVE, `DELETE .../departamentos/{id}`). */
async function desactivarDepartamento({
  idCliente,
  id,
}: ArgsDepartamento): Promise<ClienteDepartamento> {
  const { data, error } = await api.DELETE('/api/clientes/{idCliente}/departamentos/{id}', {
    params: { path: { idCliente, id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un departamento e invalida los departamentos del cliente. */
export function useDesactivarDepartamentoCliente(): UseMutationResult<
  ClienteDepartamento,
  ErrorDeApi,
  ArgsDepartamento
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarDepartamento,
    onSuccess: (_resultado, variables) => invalidarDepartamentos(queryClient, variables.idCliente),
  });
}

/** Reactiva un departamento desactivado: PATCH con `{ activo: true }`. */
async function reactivarDepartamento({
  idCliente,
  id,
}: ArgsDepartamento): Promise<ClienteDepartamento> {
  const { data, error } = await api.PATCH('/api/clientes/{idCliente}/departamentos/{id}', {
    params: { path: { idCliente, id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva un departamento desactivado e invalida los departamentos del cliente. */
export function useReactivarDepartamentoCliente(): UseMutationResult<
  ClienteDepartamento,
  ErrorDeApi,
  ArgsDepartamento
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarDepartamento,
    onSuccess: (_resultado, variables) => invalidarDepartamentos(queryClient, variables.idCliente),
  });
}

// ── FUSION de departamentos duplicados (§Post-F9.122a) ──────────────────────────

/** Argumentos de la fusion (y de su vista previa): el cliente + el cuerpo canonico/absorbidos. */
export interface ArgsFusionarDepartamentos {
  idCliente: number;
  cuerpo: ClienteDepartamentoFusionar;
}

/**
 * VISTA PREVIA de la fusion (`POST .../departamentos/fusionar/previa`). Solo lectura: dice cuantos
 * proyectos, listas y cotizaciones se moverian y si los factores del absorbido se descartan.
 *
 * Va por POST porque el cuerpo es la seleccion (canonico + N absorbidos), no un filtro de URL.
 */
async function previaFusionDepartamentos({
  idCliente,
  cuerpo,
}: ArgsFusionarDepartamentos): Promise<FusionDepartamentosPrevia> {
  const { data, error } = await api.POST(
    '/api/clientes/{idCliente}/departamentos/fusionar/previa',
    { params: { path: { idCliente } }, body: cuerpo },
  );
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Consulta la vista previa de una fusion. Deshabilitada mientras no haya canonico y al menos un
 * absorbido marcado — asi el dialogo no pregunta por una seleccion incompleta.
 *
 * 🔴 Es la MISMA cuenta que el servidor usa al fusionar (`previsualizarFusionDepartamentos` recorre
 * las mismas referencias que el repunte): la pantalla NO calcula el impacto por su cuenta.
 */
export function usePreviaFusionDepartamentos(
  idCliente: number | undefined,
  idDestino: number | null,
  origenes: readonly number[],
): UseQueryResult<FusionDepartamentosPrevia, ErrorDeApi> {
  const habilitada = idCliente !== undefined && idDestino !== null && origenes.length > 0;
  return useQuery({
    queryKey: [
      ...CLAVE_CLIENTES,
      'fusion-departamentos-previa',
      idCliente,
      idDestino,
      [...origenes],
    ],
    queryFn: () =>
      previaFusionDepartamentos({
        idCliente: idCliente as number,
        cuerpo: { idDestino: idDestino as number, origenes: [...origenes] },
      }),
    enabled: habilitada,
  });
}

/** Fusiona departamentos duplicados (`POST .../departamentos/fusionar`). */
async function fusionarDepartamentos({
  idCliente,
  cuerpo,
}: ArgsFusionarDepartamentos): Promise<ClienteDepartamento> {
  const { data, error } = await api.POST('/api/clientes/{idCliente}/departamentos/fusionar', {
    params: { path: { idCliente } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Fusiona departamentos duplicados en el canonico e invalida TODO lo que colgaba de ellos: los
 * departamentos del cliente, y ademas proyectos/listas/cotizaciones, que acaban de cambiar de
 * departamento y estaban cacheados con el viejo.
 */
export function useFusionarDepartamentos(): UseMutationResult<
  ClienteDepartamento,
  ErrorDeApi,
  ArgsFusionarDepartamentos
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fusionarDepartamentos,
    onSuccess: (_resultado, variables) => {
      invalidarDepartamentos(queryClient, variables.idCliente);
      void queryClient.invalidateQueries({ queryKey: CLAVE_PROYECTOS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_LISTAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_COTIZACIONES });
    },
  });
}

// ── ⭐ CONTACTOS del cliente (V1-E8y, §Post-F9.152 — la compradora) ───────────

/** Clave de cache de los contactos de un cliente. */
function claveContactosCliente(idCliente: number): readonly unknown[] {
  return [...CLAVE_CLIENTES, 'contactos', idCliente];
}

/** Lista los contactos de un cliente (`GET /api/clientes/{id}/contactos`). */
async function listarContactosCliente(
  id: number,
  incluirInactivos: boolean,
): Promise<ClienteContacto[]> {
  const { data, error } = await api.GET('/api/clientes/{id}/contactos', {
    params: { path: { id }, query: { incluirInactivos: String(incluirInactivos) } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/** Agrega un contacto (`POST /api/clientes/{id}/contactos`). */
async function crearContactoCliente(
  id: number,
  cuerpo: ClienteContactoCrear,
): Promise<ClienteContacto> {
  const { data, error } = await api.POST('/api/clientes/{id}/contactos', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Edita (o ARCHIVA con `activo: false`) un contacto del cliente. */
async function actualizarContactoCliente(
  id: number,
  idContacto: number,
  cuerpo: ClienteContactoEditar,
): Promise<ClienteContacto> {
  const { data, error } = await api.PATCH('/api/clientes/{id}/contactos/{idContacto}', {
    params: { path: { id, idContacto } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Contactos ACTIVOS de un cliente; deshabilitada hasta que haya id.
 *
 * Se piden aparte (no vienen en la ficha del cliente, a diferencia de los del proveedor) porque el
 * consumidor natural es la MESA de negociación, que sólo conoce el `idCliente` de la lista y no
 * quiere arrastrar el cliente entero con sus campos de referencia para leer dos nombres.
 */
export function useContactosCliente(
  idCliente: number | undefined,
  incluirInactivos = false,
): UseQueryResult<ClienteContacto[], ErrorDeApi> {
  return useQuery({
    queryKey: [...claveContactosCliente(idCliente ?? 0), incluirInactivos],
    queryFn: () => listarContactosCliente(idCliente as number, incluirInactivos),
    enabled: idCliente !== undefined,
  });
}

/** Argumentos del alta de contacto de cliente. */
export interface ArgsCrearContactoCliente {
  idCliente: number;
  cuerpo: ClienteContactoCrear;
}

/** Agrega un contacto al cliente e invalida su lista de contactos. */
export function useCrearContactoCliente(): UseMutationResult<
  ClienteContacto,
  ErrorDeApi,
  ArgsCrearContactoCliente
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idCliente, cuerpo }: ArgsCrearContactoCliente) =>
      crearContactoCliente(idCliente, cuerpo),
    onSuccess: (_resultado, variables) =>
      queryClient.invalidateQueries({ queryKey: claveContactosCliente(variables.idCliente) }),
  });
}

/** Argumentos de la edición/archivado de contacto de cliente. */
export interface ArgsActualizarContactoCliente {
  idCliente: number;
  idContacto: number;
  cuerpo: ClienteContactoEditar;
}

/** Edita o archiva un contacto e invalida su lista. */
export function useActualizarContactoCliente(): UseMutationResult<
  ClienteContacto,
  ErrorDeApi,
  ArgsActualizarContactoCliente
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idCliente, idContacto, cuerpo }: ArgsActualizarContactoCliente) =>
      actualizarContactoCliente(idCliente, idContacto, cuerpo),
    onSuccess: (_resultado, variables) =>
      queryClient.invalidateQueries({ queryKey: claveContactosCliente(variables.idCliente) }),
  });
}
