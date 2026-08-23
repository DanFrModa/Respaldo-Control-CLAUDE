import { createContext } from 'react';

import type { ResultadoSesion } from '@/api/sesion';
import type { ClavePermiso, Sesion } from '@/api/tipos';

/** Clave de cache de la sesion en TanStack Query. */
export const CLAVE_SESION = ['sesion'] as const;

/**
 * ⭐ V1-E3i — CUATRO estados, no dos. Antes había `sesion: Sesion | null` y nada más, así que "no hay
 * sesión" y "no pude preguntar" se veían igual: un parpadeo de red (500, corte, timeout) dejaba
 * `data` en `undefined` → `sesion = null` → el guard mandaba a `/login` y el usuario perdía lo que
 * estaba capturando. En Railway, donde la base tarda unos segundos en levantar detrás del backend
 * (`CLAUDE.md` §8), eso se siente seguido.
 *
 *  • `cargando`      — todavía se está preguntando (incluidos los reintentos).
 *  • `con-sesion`    — hay sesión.
 *  • `sin-sesion`    — el servidor CONTESTÓ que no hay (401). Éste sí manda a /login.
 *  • `indeterminado` — no se pudo preguntar. NO es lo mismo que no tener sesión: no se echa a nadie.
 */
export type EstadoConsultaSesion = 'cargando' | 'con-sesion' | 'sin-sesion' | 'indeterminado';

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
  /**
   * En qué punto está la consulta de la sesión. `sesion === null` ya NO alcanza para decidir:
   * distingue "el servidor dijo que no hay sesión" de "no se pudo preguntar" (ver
   * {@link EstadoConsultaSesion}).
   */
  estado: EstadoConsultaSesion;
  /** Mensaje del último fallo al consultar la sesión (sólo en `indeterminado`), o `null`. */
  errorConsulta: string | null;
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

/**
 * ⭐ V1-E3i — DE LA CONSULTA AL ESTADO, en un solo lugar y sin React de por medio (para poder
 * probarlo sin montar nada). La regla que esto codifica: **lo que ya se sabe gana sobre el fallo**.
 *
 *  • Hay datos con sesión → `con-sesion`.
 *  • Hay datos sin sesión (el 401 llega como DATO, no como error) → `sin-sesion`.
 *  • No hay datos y la consulta falló → `indeterminado` (NO se sabe; no es lo mismo que "no hay").
 *  • No hay datos y no falló → `cargando` (incluye los reintentos en curso).
 *
 * El orden importa: un refetch que truena con una respuesta previa en cache NO borra la sesión
 * abierta — decir ahí "no se sabe" sacaría al usuario de la pantalla en la que está trabajando.
 */
export function derivarEstadoSesion(consulta: {
  data: ResultadoSesion | undefined;
  esError: boolean;
}): EstadoConsultaSesion {
  if (consulta.data !== undefined) {
    return consulta.data.autenticado ? 'con-sesion' : 'sin-sesion';
  }
  return consulta.esError ? 'indeterminado' : 'cargando';
}
