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
  Proveedor,
  ProveedorAdjunto,
  ProveedorAdjuntoCrear,
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

/** Pide una pagina del listado de proveedores (busqueda + tipo + orden + paginacion en servidor). */
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

/** Lista proveedores con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useProveedores(
  query: ProveedoresQuery,
): UseQueryResult<ProveedoresPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaProveedores(query),
    queryFn: () => listarProveedores(query),
    placeholderData: keepPreviousData,
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
 * Si el PUT a R2 falla, se propaga como `ErrorDeApi` para que el toast lo muestre.
 * (El `Archivo` registrado quedaría sin objeto en R2; es inofensivo y el usuario
 * puede reintentar.) Al terminar invalida la lista de adjuntos y la de proveedores
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
  let respuesta: Response;
  try {
    respuesta = await fetch(data.urlSubida, {
      method: 'PUT',
      headers: {
        'Content-Type': archivo.type,
        'Content-Length': String(archivo.size),
      },
      body: archivo,
    });
  } catch {
    throw new ErrorDeApi({
      codigo: 'SUBIDA',
      mensaje: 'No se pudo subir el archivo. Verifica tu conexión e intenta de nuevo.',
    });
  }
  if (!respuesta.ok) {
    throw new ErrorDeApi({
      codigo: 'SUBIDA',
      mensaje: 'El almacenamiento rechazó el archivo. Intenta de nuevo.',
    });
  }
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
