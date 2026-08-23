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
import { subirArchivoPrefirmado } from './subida-archivo';
import type {
  ConstanciaPropuesta,
  Proveedor,
  ProveedorAdjunto,
  ProveedorAdjuntoCrear,
  ProveedorAvio,
  ProveedorAvioAsignar,
  ProveedorContacto,
  ProveedorContactoCrear,
  ProveedorContactoEditar,
  ProveedorCrear,
  ProveedorEditar,
  ProveedoresPagina,
  ProveedoresQuery,
  RolProveedor,
} from './tipos';

/**
 * Capa de datos de Proveedores — replica del ESTANDAR de Almacenes (`api/almacenes.ts`).
 * Cada funcion llama al cliente TIPADO del OpenAPI, normaliza (`data` en exito,
 * `ErrorDeApi` con el mensaje del backend en fallo) y se expone como consulta o
 * mutacion (las mutaciones invalidan la cache de la lista). CERO logica de
 * negocio: el backend valida, autoriza y decide (A1).
 */

/** Clave raiz de la cache de proveedores en TanStack Query. */
export const CLAVE_PROVEEDORES = ['proveedores'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaProveedores(query: ProveedoresQuery): readonly unknown[] {
  return [...CLAVE_PROVEEDORES, 'lista', query];
}

/** Pide una pagina del listado de proveedores (busqueda + rol + orden + paginacion en servidor). */
async function listarProveedores(query: ProveedoresQuery): Promise<ProveedoresPagina> {
  const { data, error } = await api.GET('/api/proveedores', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un proveedor (`POST /api/proveedores`). */
async function crearProveedor(cuerpo: ProveedorCrear): Promise<Proveedor> {
  const { data, error } = await api.POST('/api/proveedores', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un proveedor (`PATCH /api/proveedores/{id}`). */
async function actualizarProveedor(id: number, cuerpo: ProveedorEditar): Promise<Proveedor> {
  const { data, error } = await api.PATCH('/api/proveedores/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un proveedor (borrado SUAVE, `DELETE /api/proveedores/{id}`). */
async function desactivarProveedor(id: number): Promise<Proveedor> {
  const { data, error } = await api.DELETE('/api/proveedores/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/**
 * Reactiva un proveedor desactivado (restaura el borrado suave): es un
 * `PATCH /api/proveedores/{id}` con `{ activo: true }`. El backend re-verifica que
 * el nombre siga libre y audita la reactivacion.
 */
async function reactivarProveedor(id: number): Promise<Proveedor> {
  const { data, error } = await api.PATCH('/api/proveedores/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Lista proveedores con los filtros dados (mantiene la pagina previa al paginar/buscar).
 *
 * `opciones.enabled` deshabilita la consulta cuando aun no se puede filtrar por rol: las pantallas
 * de captura que listan un rol concreto (cortadores, maquileros) la apagan mientras el rol no esta
 * resuelto, para NUNCA listar TODOS los proveedores sin filtro.
 */
export function useProveedores(
  query: ProveedoresQuery,
  opciones?: { enabled?: boolean },
): UseQueryResult<ProveedoresPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaProveedores(query),
    queryFn: () => listarProveedores(query),
    placeholderData: keepPreviousData,
    enabled: opciones?.enabled ?? true,
  });
}

/** Crea un proveedor e invalida la lista para reflejarlo. */
export function useCrearProveedor(): UseMutationResult<Proveedor, ErrorDeApi, ProveedorCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearProveedor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarProveedor {
  id: number;
  cuerpo: ProveedorEditar;
}

/** Edita un proveedor e invalida la lista. */
export function useActualizarProveedor(): UseMutationResult<
  Proveedor,
  ErrorDeApi,
  ArgsActualizarProveedor
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarProveedor) => actualizarProveedor(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES }),
  });
}

/** Desactiva un proveedor (borrado suave) e invalida la lista. */
export function useDesactivarProveedor(): UseMutationResult<Proveedor, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarProveedor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES }),
  });
}

/** Reactiva un proveedor desactivado (restaura el borrado suave) e invalida la lista. */
export function useReactivarProveedor(): UseMutationResult<Proveedor, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarProveedor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES }),
  });
}

// ── Roles de proveedor (F1-E1B, catalogo selector) ───────────────────────────

/** Clave de cache del catalogo de roles de proveedor. */
export const CLAVE_ROLES_PROVEEDOR = ['roles-proveedor'] as const;

/** Pide el catalogo de roles/servicios de proveedor (array plano, sin paginacion). */
async function listarRolesProveedor(): Promise<RolProveedor[]> {
  const { data, error } = await api.GET('/api/roles-proveedor');
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Lista los roles/servicios de proveedor activos (para el selector multiple y el filtro). */
export function useRolesProveedor(): UseQueryResult<RolProveedor[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ROLES_PROVEEDOR, 'lista'],
    queryFn: listarRolesProveedor,
  });
}

/**
 * CODIGOS de rol de `RolProveedor` que la UI usa para acotar selectores. Son las claves estables
 * sembradas por el seed (`backend/prisma/seed.ts`, ROLES_PROVEEDOR_BASE) y las mismas que asigna el
 * ETL de terceros; el `nombre` del rol puede editarse desde la UI, el `codigo` no. Centralizarlas
 * evita literales sueltos por pantalla.
 */
export const COD_ROL_PROVEEDOR = {
  vendeTelas: 'vende-telas',
  vendeAvios: 'vende-avios',
  corte: 'corte',
  maquilaCostura: 'maquila-costura',
  estampado: 'estampado',
} as const;

/**
 * Lista los proveedores que prestan UN rol/servicio (por su `codigo`, p. ej. "vende-telas"),
 * filtrando en SERVIDOR (`?rol=`). Envuelve el patron que ya usaban las pantallas de Produccion
 * (resolver el rol → pasar su id → `enabled`) para no repetirlo en cada captura.
 *
 * Dos cuidados que lo hacen seguro como selector:
 *  - Mientras el catalogo de roles carga, la consulta queda DESHABILITADA: una query sin `rol`
 *    significa "todos los proveedores", justo lo que la pantalla quiere evitar (se veria un
 *    parpadeo con la lista completa).
 *  - `codigo === undefined` = no acotar (devuelve todos): permite que una pantalla decida en vivo
 *    si filtra o no, sin romper el orden de los hooks.
 *
 * El catalogo de roles va por `useRolesProveedor` (cacheado): una pantalla que quiera reintentarlo
 * o pintar su error lo llama tambien, sin costo extra de red.
 */
export function useProveedoresPorRol(
  codigo: string | undefined,
  filtros: Omit<ProveedoresQuery, 'rol'> = {},
): UseQueryResult<ProveedoresPagina, ErrorDeApi> {
  const roles = useRolesProveedor();
  const idRol =
    codigo === undefined ? undefined : roles.data?.find((rol) => rol.codigo === codigo)?.id;
  // Solo se consulta cuando NO hay que acotar, o cuando ya se conoce el id del rol.
  const listo = codigo === undefined || idRol !== undefined;

  return useProveedores(
    {
      pagina: 1,
      porPagina: 100,
      ordenarPor: 'nombre',
      direccion: 'asc',
      incluirInactivos: 'false',
      ...filtros,
      ...(idRol === undefined ? {} : { rol: idRol }),
    },
    { enabled: listo },
  );
}

// ── Adjuntos de proveedor (F1-E1B, archivos PDF en R2 via presigned) ──────────

/** Clave de cache de los adjuntos de UN proveedor. */
function claveAdjuntos(idProveedor: number): readonly unknown[] {
  return [...CLAVE_PROVEEDORES, 'adjuntos', idProveedor];
}

/** Lista los adjuntos de un proveedor (`GET /api/proveedores/{id}/adjuntos`). */
async function listarAdjuntos(idProveedor: number): Promise<ProveedorAdjunto[]> {
  const { data, error } = await api.GET('/api/proveedores/{id}/adjuntos', {
    params: { path: { id: idProveedor } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/** Lista los adjuntos de un proveedor (deshabilitada si no hay id, p. ej. en alta). */
export function useAdjuntosProveedor(
  idProveedor: number | undefined,
): UseQueryResult<ProveedorAdjunto[], ErrorDeApi> {
  return useQuery({
    queryKey: claveAdjuntos(idProveedor ?? 0),
    queryFn: () => listarAdjuntos(idProveedor as number),
    enabled: idProveedor !== undefined,
  });
}

/** Argumentos de la mutacion de subida de un adjunto. */
export interface ArgsSubirAdjunto {
  idProveedor: number;
  /** El archivo PDF elegido por el usuario. */
  archivo: File;
  /**
   * Tipo documental (constancia/contrato/otro). En el contrato el campo es
   * opcional (tiene default); aqui el llamador SIEMPRE elige uno, por eso se
   * excluye `undefined` (necesario bajo `exactOptionalPropertyTypes`).
   */
  tipo: NonNullable<ProveedorAdjuntoCrear['tipo']>;
}

/**
 * Sube un adjunto PDF a R2 en DOS pasos (flujo presigned de F0):
 *   1) `POST /api/proveedores/{id}/adjuntos` con los metadatos → el backend
 *      registra el `Archivo` y devuelve una URL PUT prefirmada.
 *   2) El navegador hace `PUT` del archivo DIRECTO a esa URL (R2), con los headers
 *      `Content-Type` y `Content-Length` EXACTOS (la firma solo acepta esos).
 *
 * Si el PUT a R2 falla, se QUITA el adjunto que el paso 1 ya había registrado (si no, el proveedor
 * queda listando un archivo que nunca llegó e infla `cantidadAdjuntos`) y se propaga como
 * `ErrorDeApi` para que el toast lo muestre; el detalle del mensaje y de la limpieza vive en
 * `subida-archivo.ts`. Al terminar invalida la lista de adjuntos y la de proveedores
 * (para refrescar el conteo `cantidadAdjuntos`).
 */
async function subirAdjunto({ idProveedor, archivo, tipo }: ArgsSubirAdjunto): Promise<void> {
  const { data, error } = await api.POST('/api/proveedores/{id}/adjuntos', {
    params: { path: { id: idProveedor } },
    body: {
      tipo,
      nombreOriginal: archivo.name,
      tipoMime: archivo.type,
      tamanoBytes: archivo.size,
    },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }

  // Paso 2: PUT directo a R2 con los headers EXACTOS (tipo y tamaño firmados).
  await subirArchivoPrefirmado({
    urlSubida: data.urlSubida,
    archivo,
    tipoMime: archivo.type,
    conContentLength: true,
    sustantivo: 'el archivo',
    limpiar: () => quitarAdjunto({ idProveedor, idArchivo: data.idArchivo }),
  });
}

/** Sube un adjunto PDF (presigned PUT) e invalida las listas afectadas. */
export function useSubirAdjuntoProveedor(): UseMutationResult<void, ErrorDeApi, ArgsSubirAdjunto> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subirAdjunto,
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: claveAdjuntos(variables.idProveedor) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES });
    },
  });
}

/** Argumentos de la mutacion de quitar un adjunto. */
export interface ArgsQuitarAdjunto {
  idProveedor: number;
  idArchivo: string;
}

/** Quita un adjunto (`DELETE /api/proveedores/{id}/adjuntos/{idArchivo}`). */
async function quitarAdjunto({ idProveedor, idArchivo }: ArgsQuitarAdjunto): Promise<void> {
  const { error, response } = await api.DELETE('/api/proveedores/{id}/adjuntos/{idArchivo}', {
    params: { path: { id: idProveedor, idArchivo } },
  });
  // 204 No Content: éxito sin cuerpo (no hay `data`); cualquier !ok es error.
  if (!response.ok) {
    throw new ErrorDeApi(error);
  }
}

/** Quita un adjunto e invalida las listas afectadas (adjuntos + conteo en proveedores). */
export function useQuitarAdjuntoProveedor(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsQuitarAdjunto
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: quitarAdjunto,
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({ queryKey: claveAdjuntos(variables.idProveedor) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES });
    },
  });
}

// ── Avíos que surte el proveedor (B17, R9 — lado proveedor de AvioProveedor) ───

/** Clave de cache de los avíos que surte UN proveedor. */
function claveAviosProveedor(idProveedor: number): readonly unknown[] {
  return [...CLAVE_PROVEEDORES, 'avios', idProveedor];
}

/** Lista los avíos que surte un proveedor (`GET /api/proveedores/{id}/avios`). */
async function listarAviosProveedor(idProveedor: number): Promise<ProveedorAvio[]> {
  const { data, error } = await api.GET('/api/proveedores/{id}/avios', {
    params: { path: { id: idProveedor } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/** Lista los avíos que surte un proveedor (deshabilitada si no hay id, p. ej. en alta). */
export function useAviosProveedor(
  idProveedor: number | undefined,
): UseQueryResult<ProveedorAvio[], ErrorDeApi> {
  return useQuery({
    queryKey: claveAviosProveedor(idProveedor ?? 0),
    queryFn: () => listarAviosProveedor(idProveedor as number),
    enabled: idProveedor !== undefined,
  });
}

/** Argumentos de la mutacion de asignar un avío que surte el proveedor. */
export interface ArgsAsignarAvioProveedor {
  idProveedor: number;
  cuerpo: ProveedorAvioAsignar;
}

/** Asigna un avío que surte el proveedor (`POST /api/proveedores/{id}/avios`). */
async function asignarAvioProveedor({
  idProveedor,
  cuerpo,
}: ArgsAsignarAvioProveedor): Promise<ProveedorAvio[]> {
  const { data, error } = await api.POST('/api/proveedores/{id}/avios', {
    params: { path: { id: idProveedor } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/** Asigna un avío que surte el proveedor e invalida su lista de avíos. */
export function useAsignarAvioProveedor(): UseMutationResult<
  ProveedorAvio[],
  ErrorDeApi,
  ArgsAsignarAvioProveedor
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: asignarAvioProveedor,
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({
        queryKey: claveAviosProveedor(variables.idProveedor),
      });
    },
  });
}

/** Argumentos de la mutacion de quitar un avío que surte el proveedor. */
export interface ArgsQuitarAvioProveedor {
  idProveedor: number;
  idAvio: number;
}

/** Quita un avío que surte el proveedor (`DELETE /api/proveedores/{id}/avios/{idAvio}`). */
async function quitarAvioProveedor({
  idProveedor,
  idAvio,
}: ArgsQuitarAvioProveedor): Promise<ProveedorAvio[]> {
  const { data, error } = await api.DELETE('/api/proveedores/{id}/avios/{idAvio}', {
    params: { path: { id: idProveedor, idAvio } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data.datos;
}

/** Quita un avío que surte el proveedor e invalida su lista de avíos. */
export function useQuitarAvioProveedor(): UseMutationResult<
  ProveedorAvio[],
  ErrorDeApi,
  ArgsQuitarAvioProveedor
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: quitarAvioProveedor,
    onSuccess: (_resultado, variables) => {
      void queryClient.invalidateQueries({
        queryKey: claveAviosProveedor(variables.idProveedor),
      });
    },
  });
}

// ── Contactos del proveedor (V1-E3f pieza B, §Post-F9.56 punto 1) ────────────

/** Agrega un contacto (`POST /api/proveedores/{id}/contactos`). */
async function crearContactoProveedor(
  id: number,
  cuerpo: ProveedorContactoCrear,
): Promise<ProveedorContacto> {
  const { data, error } = await api.POST('/api/proveedores/{id}/contactos', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Edita (o ARCHIVA con `activo: false`) un contacto. */
async function actualizarContactoProveedor(
  id: number,
  idContacto: number,
  cuerpo: ProveedorContactoEditar,
): Promise<ProveedorContacto> {
  const { data, error } = await api.PATCH('/api/proveedores/{id}/contactos/{idContacto}', {
    params: { path: { id, idContacto } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Argumentos de la mutacion de alta de contacto. */
export interface ArgsCrearContacto {
  id: number;
  cuerpo: ProveedorContactoCrear;
}

/** Agrega un contacto al proveedor e invalida la lista (los contactos viajan en la ficha). */
export function useCrearContactoProveedor(): UseMutationResult<
  ProveedorContacto,
  ErrorDeApi,
  ArgsCrearContacto
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsCrearContacto) => crearContactoProveedor(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES }),
  });
}

/** Argumentos de la mutacion de edicion/archivado de contacto. */
export interface ArgsActualizarContacto {
  id: number;
  idContacto: number;
  cuerpo: ProveedorContactoEditar;
}

/** Edita o archiva un contacto e invalida la lista. */
export function useActualizarContactoProveedor(): UseMutationResult<
  ProveedorContacto,
  ErrorDeApi,
  ArgsActualizarContacto
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, idContacto, cuerpo }: ArgsActualizarContacto) =>
      actualizarContactoProveedor(id, idContacto, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES }),
  });
}

// ── Constancia de Situacion Fiscal (V1-E3f pieza B, §Post-F9.55) ─────────────

/**
 * Lee una Constancia de Situacion Fiscal y devuelve lo que PROPONE. No guarda nada: la pantalla
 * llena los campos y una persona confirma antes de que se escriba (regla de §Post-F9.55).
 */
async function analizarConstancia(archivoBase64: string): Promise<ConstanciaPropuesta> {
  const { data, error } = await api.POST('/api/proveedores/constancia/analizar', {
    body: { archivoBase64 },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Analiza la constancia (mutacion: no cachea nada, cada archivo es distinto). */
export function useAnalizarConstancia(): UseMutationResult<
  ConstanciaPropuesta,
  ErrorDeApi,
  string
> {
  return useMutation({ mutationFn: analizarConstancia });
}
