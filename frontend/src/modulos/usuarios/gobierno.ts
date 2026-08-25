import type { Rol } from '@/api/tipos';

/**
 * Capacidades de GOBIERNO del sistema, para el aviso anti-lockout (V1-E6c).
 *
 * El servidor es quien BLOQUEA (§Post-F9.68): impide que el sistema se quede sin
 * ningún usuario activo capaz de administrarlo. La pantalla no repite esa
 * decisión —no sabe cuántos administradores hay ni puede saberlo sin la
 * paginación entera— y por eso **no esconde ni deshabilita nada**: avisa a
 * tiempo, para que quien opera entienda POR QUÉ el guardado puede rebotar y qué
 * hacer antes, en vez de toparse con un botón muerto o con un error a ciegas.
 */

/** Las claves de permiso que gobiernan el propio sistema de seguridad. */
const CLAVES_GOBIERNO = ['usuarios.administrar', 'roles.administrar'] as const;

/** Cómo se nombra cada capacidad para la persona (no la clave técnica). */
const CAPACIDAD: Record<(typeof CLAVES_GOBIERNO)[number], string> = {
  'usuarios.administrar': 'administrar usuarios y accesos',
  'roles.administrar': 'administrar roles y permisos',
};

/**
 * Capacidades de gobierno que otorga un conjunto de roles, ya redactadas para
 * mostrarse. `catalogo` es la lista completa de roles (`GET /api/roles`), que es
 * la única que trae `clavesPermisos`; los roles del usuario solo traen id y
 * nombre, así que se cruzan por id.
 */
export function capacidadesDeGobierno(
  catalogo: readonly Rol[],
  idsRoles: readonly number[],
): string[] {
  const claves = new Set(
    catalogo.filter((rol) => idsRoles.includes(rol.id)).flatMap((rol) => rol.clavesPermisos),
  );
  return CLAVES_GOBIERNO.filter((clave) => claves.has(clave)).map((clave) => CAPACIDAD[clave]);
}

/**
 * Capacidades de gobierno que este cambio le QUITARÍA al usuario: las que tiene
 * hoy y no tendría con los roles marcados. Vacío = el cambio no toca el gobierno
 * y no hay nada que avisar.
 */
export function capacidadesQueSePierden(
  catalogo: readonly Rol[],
  idsRolesAntes: readonly number[],
  idsRolesDespues: readonly number[],
): string[] {
  const despues = new Set(capacidadesDeGobierno(catalogo, idsRolesDespues));
  return capacidadesDeGobierno(catalogo, idsRolesAntes).filter(
    (capacidad) => !despues.has(capacidad),
  );
}
