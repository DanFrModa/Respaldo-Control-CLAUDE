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
  Usuario,
  UsuarioContrasena,
  UsuarioCrear,
  UsuarioEditar,
  UsuariosPagina,
  UsuariosQuery,
} from './tipos';

/**
 * Capa de datos de Usuarios (administracion, RBAC A4). Replica del ESTANDAR de
 * Almacenes/Proveedores, con dos diferencias del backend de admin:
 *  - el `id` es un STRING (cuid), no un numero;
 *  - todas las rutas exigen el permiso `usuarios.administrar` (no hay `.ver`).
 *
 * Cada funcion llama al cliente TIPADO del OpenAPI, normaliza (`data` en exito,
 * `ErrorDeApi` con el mensaje del backend en fallo) y se expone como consulta o
 * mutacion; las mutaciones invalidan la cache de la lista. CERO logica de
 * negocio: el backend valida, autoriza y decide (A1).
 */

/** Clave raiz de la cache de usuarios en TanStack Query. */
export const CLAVE_USUARIOS = ['usuarios'] as const;

/** Clave de cache de una pagina concreta del listado (depende de los filtros). */
function claveListaUsuarios(query: UsuariosQuery): readonly unknown[] {
  return [...CLAVE_USUARIOS, 'lista', query];
}

/** Pide una pagina del listado de usuarios (busqueda + filtros + orden + paginacion en servidor). */
async function listarUsuarios(query: UsuariosQuery): Promise<UsuariosPagina> {
  const { data, error } = await api.GET('/api/usuarios', { params: { query } });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un usuario (`POST /api/usuarios`). */
async function crearUsuario(cuerpo: UsuarioCrear): Promise<Usuario> {
  const { data, error } = await api.POST('/api/usuarios', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza un usuario (`PATCH /api/usuarios/{id}`). */
async function actualizarUsuario(id: string, cuerpo: UsuarioEditar): Promise<Usuario> {
  const { data, error } = await api.PATCH('/api/usuarios/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva un usuario (borrado SUAVE, `DELETE /api/usuarios/{id}`). */
async function desactivarUsuario(id: string): Promise<Usuario> {
  const { data, error } = await api.DELETE('/api/usuarios/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva un usuario desactivado: `PATCH /api/usuarios/{id}` con `{ activo: true }`. */
async function reactivarUsuario(id: string): Promise<Usuario> {
  const { data, error } = await api.PATCH('/api/usuarios/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desbloquea un usuario bloqueado por intentos fallidos (`POST .../desbloquear`). */
async function desbloquearUsuario(id: string): Promise<Usuario> {
  const { data, error } = await api.POST('/api/usuarios/{id}/desbloquear', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Cambia la contraseña de un usuario (`POST .../contrasena`, ≥8). No devuelve el usuario. */
async function cambiarContrasena(id: string, cuerpo: UsuarioContrasena): Promise<void> {
  const { error, response } = await api.POST('/api/usuarios/{id}/contrasena', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!response.ok) {
    throw new ErrorDeApi(error);
  }
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista usuarios con los filtros dados (mantiene la pagina previa al paginar/buscar). */
export function useUsuarios(query: UsuariosQuery): UseQueryResult<UsuariosPagina, ErrorDeApi> {
  return useQuery({
    queryKey: claveListaUsuarios(query),
    queryFn: () => listarUsuarios(query),
    placeholderData: keepPreviousData,
  });
}

/** Crea un usuario e invalida la lista para reflejarlo. */
export function useCrearUsuario(): UseMutationResult<Usuario, ErrorDeApi, UsuarioCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarUsuario {
  id: string;
  cuerpo: UsuarioEditar;
}

/** Edita un usuario e invalida la lista. */
export function useActualizarUsuario(): UseMutationResult<
  Usuario,
  ErrorDeApi,
  ArgsActualizarUsuario
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarUsuario) => actualizarUsuario(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

/** Desactiva un usuario (borrado suave) e invalida la lista. */
export function useDesactivarUsuario(): UseMutationResult<Usuario, ErrorDeApi, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

/** Reactiva un usuario desactivado e invalida la lista. */
export function useReactivarUsuario(): UseMutationResult<Usuario, ErrorDeApi, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

/** Desbloquea un usuario e invalida la lista (refleja `bloqueado`/`intentosFallidos`). */
export function useDesbloquearUsuario(): UseMutationResult<Usuario, ErrorDeApi, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desbloquearUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

/** Argumentos de la mutacion de cambio de contraseña. */
export interface ArgsCambiarContrasena {
  id: string;
  password: string;
}

/** Cambia la contraseña de un usuario. No invalida la lista (no afecta lo listado). */
export function useCambiarContrasena(): UseMutationResult<void, ErrorDeApi, ArgsCambiarContrasena> {
  return useMutation({
    mutationFn: ({ id, password }: ArgsCambiarContrasena) => cambiarContrasena(id, { password }),
  });
}
