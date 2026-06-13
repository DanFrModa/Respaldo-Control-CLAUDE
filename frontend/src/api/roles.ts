import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { Rol } from './tipos';

/**
 * Capa de datos de Roles — SOLO lectura para la administracion de usuarios.
 * El selector de roles del alta/edicion de usuario consume esta lista (el
 * backend valida y autoriza; el frontend no razona reglas, A1). La administracion
 * completa de roles (alta/edicion de permisos) es de una tarea aparte; aqui solo
 * se listan para asignarlos.
 *
 * Nota para el reviewer: `GET /api/roles` exige el permiso `roles.administrar`
 * en el backend; el admin lo tiene. Si un usuario tuviera `usuarios.administrar`
 * pero NO `roles.administrar`, esta consulta fallaria — por eso el hook se
 * consume condicionado a `usuarios.administrar` desde la pantalla, que es el
 * caso real (un administrador de usuarios tiene ambos permisos en el seed).
 */

/** Clave raiz de la cache de roles en TanStack Query. */
export const CLAVE_ROLES = ['roles'] as const;

/** Pide la lista completa de roles (sin paginacion; catalogo corto). */
async function listarRoles(): Promise<Rol[]> {
  const { data, error } = await api.GET('/api/roles');
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Lista todos los roles (para el selector de roles del alta/edicion de usuario). */
export function useRoles(): UseQueryResult<Rol[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ROLES, 'lista'],
    queryFn: listarRoles,
  });
}
