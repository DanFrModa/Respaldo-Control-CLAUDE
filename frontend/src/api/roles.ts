import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { paths } from './esquema.gen';
import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { Rol } from './tipos';

/**
 * Capa de datos de Roles (administración de roles y permisos, RBAC A4). Llama al
 * cliente TIPADO del OpenAPI, normaliza (`data` en éxito, `ErrorDeApi` con el
 * mensaje del backend en fallo) y expone consultas y mutaciones; las mutaciones
 * invalidan la caché de roles. CERO lógica de negocio: el backend valida, autoriza
 * (todas las rutas exigen `roles.administrar`), protege los roles de sistema y
 * aplica el candado anti-lockout (A1).
 *
 * `asignarPermisos` tiene semántica de REEMPLAZO: el conjunto enviado sustituye
 * por completo a los permisos del rol.
 */

// ── Alias de tipo del contrato ────────────────────────────────────────────────

/** Cuerpo de alta de rol (`POST /api/roles`). */
export type RolCrear = paths['/api/roles']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de rol (`PATCH /api/roles/{id}`). */
export type RolEditar =
  paths['/api/roles/{id}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo de reemplazo de permisos (`PUT /api/roles/{id}/permisos`). */
export type RolAsignarPermisos =
  paths['/api/roles/{id}/permisos']['put']['requestBody']['content']['application/json'];
/** Catálogo de permisos agrupado por módulo (`GET /api/permisos`). */
export type CatalogoPermisos =
  paths['/api/permisos']['get']['responses']['200']['content']['application/json'];
/** Un módulo del catálogo con sus permisos. */
export type ModuloPermisos = CatalogoPermisos[number];
/** Un permiso del catálogo. */
export type PermisoCatalogo = ModuloPermisos['permisos'][number];

/** Clave raiz de la cache de roles en TanStack Query. */
export const CLAVE_ROLES = ['roles'] as const;
/** Clave raiz de la cache del catálogo de permisos. */
export const CLAVE_PERMISOS = ['permisos'] as const;

// ── Funciones de red ──────────────────────────────────────────────────────────

/** Pide la lista completa de roles (sin paginacion; catalogo corto). */
async function listarRoles(): Promise<Rol[]> {
  const { data, error } = await api.GET('/api/roles');
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Pide el catálogo de permisos agrupado por módulo (para el árbol de la pantalla). */
async function listarCatalogoPermisos(): Promise<CatalogoPermisos> {
  const { data, error } = await api.GET('/api/permisos');
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea un rol (`POST /api/roles`). */
async function crearRol(cuerpo: RolCrear): Promise<Rol> {
  const { data, error } = await api.POST('/api/roles', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza el nombre/descripción de un rol (`PATCH /api/roles/{id}`). */
async function actualizarRol(id: number, cuerpo: RolEditar): Promise<Rol> {
  const { data, error } = await api.PATCH('/api/roles/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reemplaza el conjunto de permisos de un rol (`PUT /api/roles/{id}/permisos`). */
async function asignarPermisos(id: number, clavesPermisos: string[]): Promise<Rol> {
  const { data, error } = await api.PUT('/api/roles/{id}/permisos', {
    params: { path: { id } },
    body: { clavesPermisos },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Elimina un rol (`DELETE /api/roles/{id}`, 204 sin cuerpo). */
async function eliminarRol(id: number): Promise<void> {
  const { error, response } = await api.DELETE('/api/roles/{id}', {
    params: { path: { id } },
  });
  if (!response.ok) {
    throw new ErrorDeApi(error);
  }
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista todos los roles (selector de usuarios + pantalla de administración). */
export function useRoles(): UseQueryResult<Rol[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ROLES, 'lista'],
    queryFn: listarRoles,
  });
}

/** Carga el catálogo de permisos agrupado por módulo (estable; catálogo de código). */
export function usePermisosCatalogo(): UseQueryResult<CatalogoPermisos, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_PERMISOS, 'catalogo'],
    queryFn: listarCatalogoPermisos,
    staleTime: Infinity,
  });
}

/** Crea un rol e invalida la lista. */
export function useCrearRol(): UseMutationResult<Rol, ErrorDeApi, RolCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearRol,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ROLES }),
  });
}

/** Argumentos de la mutación de edición. */
export interface ArgsActualizarRol {
  id: number;
  cuerpo: RolEditar;
}

/** Edita un rol e invalida la lista. */
export function useActualizarRol(): UseMutationResult<Rol, ErrorDeApi, ArgsActualizarRol> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarRol) => actualizarRol(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ROLES }),
  });
}

/** Argumentos de la mutación de asignación de permisos. */
export interface ArgsAsignarPermisos {
  id: number;
  clavesPermisos: string[];
}

/** Reemplaza los permisos de un rol e invalida la lista. */
export function useAsignarPermisos(): UseMutationResult<Rol, ErrorDeApi, ArgsAsignarPermisos> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, clavesPermisos }: ArgsAsignarPermisos) =>
      asignarPermisos(id, clavesPermisos),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ROLES }),
  });
}

/** Elimina un rol e invalida la lista. */
export function useEliminarRol(): UseMutationResult<void, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: eliminarRol,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_ROLES }),
  });
}
