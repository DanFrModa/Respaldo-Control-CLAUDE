import { createContext } from 'react';

import type { ClavePermiso, Sesion } from '@/api/tipos';

/** Clave de cache de la sesion en TanStack Query. */
export const CLAVE_SESION = ['sesion'] as const;

/**
 * Estado de la sesion que comparte el arbol de la app. Lo provee
 * `ProveedorSesion` (que consulta `GET /api/sesion`) y lo consumen `useSesion` y
 * el guard de rutas. El catalogo de permisos es la fuente para ocultar lo que el
 * usuario no puede hacer (la decision real la toma el servidor en cada ruta).
 */
export interface EstadoSesion {
  /** Sesion del usuario si esta autenticado; `null` si no hay sesion. */
  sesion: Sesion | null;
  /** `true` mientras se resuelve la primera carga de la sesion. */
  cargando: boolean;
  /** Permisos efectivos del usuario como conjunto (vacio si no hay sesion). */
  permisos: ReadonlySet<ClavePermiso>;
  /** ¿El usuario tiene este permiso? (Siempre `false` sin sesion.) */
  tienePermiso: (clave: ClavePermiso) => boolean;
  /** Re-consulta la sesion (p. ej. tras iniciar o cerrar sesion). */
  refrescar: () => Promise<void>;
}

/**
 * Contexto de sesion. Sin proveedor el valor es `undefined`, y `useSesion` lanza
 * un error claro (uso fuera de `ProveedorSesion`).
 */
export const ContextoSesion = createContext<EstadoSesion | undefined>(undefined);
