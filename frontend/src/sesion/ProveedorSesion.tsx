import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { obtenerSesion } from '@/api/sesion';
import type { ClavePermiso } from '@/api/tipos';

import { CLAVE_SESION, ContextoSesion, derivarEstadoSesion, type EstadoSesion } from './contexto';

/**
 * Provee el estado de sesion a toda la app. Consulta `GET /api/sesion` una vez
 * (TanStack Query cachea el resultado) y expone usuario, permisos y un
 * `refrescar()` que se llama tras iniciar o cerrar sesion.
 *
 * El 401 (sin sesion) NO es un error: `obtenerSesion` lo devuelve como
 * `{ autenticado: false }`, asi que no se reintenta ni se muestra como fallo;
 * simplemente no hay sesion y el guard redirige a /login.
 *
 * ⭐ V1-E3i — UN PARPADEO DE RED NO ES UNA SESIÓN AUSENTE. Antes esta consulta iba con
 * `retry: false` y el estado se derivaba de `consulta.data?.autenticado ? … : null`: cualquier fallo
 * que NO fuera 401 (500, corte, timeout) dejaba `data` en `undefined`, o sea `sesion = null`, y el
 * guard mandaba al login con lo que el usuario estuviera capturando dentro. Dos cambios, los dos
 * necesarios:
 *
 *  1. **Se reintenta lo reintentable.** El 401 sigue SIN reintentarse (no es un error: llega como
 *     dato), así que estos reintentos sólo tocan los fallos de verdad — que son justo los que se
 *     arreglan solos en unos segundos cuando Railway está levantando la base (`CLAUDE.md` §8).
 *  2. **Mientras no se sepa, no se echa a nadie.** Agotados los reintentos el estado queda en
 *     `indeterminado`, que el guard trata como "no sé", no como "no hay".
 */

/** Cuántas veces se reintenta la consulta de sesión antes de rendirse (0.5 + 1 + 2 s de espera). */
const REINTENTOS_SESION = 3;

export function ProveedorSesion({ children }: { children: React.ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient();

  const consulta = useQuery({
    queryKey: CLAVE_SESION,
    queryFn: obtenerSesion,
    // La sesion no caduca sola en el cliente; se refresca explicitamente al
    // entrar/salir.
    staleTime: Infinity,
    // Sólo llegan aquí los fallos REALES (el 401 se resuelve como dato, no como error).
    retry: (fallos) => fallos < REINTENTOS_SESION,
    retryDelay: (intento) => Math.min(500 * 2 ** intento, 5000),
    // Al volver la red se vuelve a preguntar, aunque la consulta esté marcada como fresca: si la
    // respuesta anterior fue un fallo, esperar a que alguien recargue la página es dejar al usuario
    // atorado con un problema que ya se resolvió solo.
    refetchOnReconnect: 'always',
  });

  const refrescar = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: CLAVE_SESION });
  }, [queryClient]);

  const valor = useMemo<EstadoSesion>(() => {
    const sesion = consulta.data?.autenticado ? consulta.data.sesion : null;
    const permisos: ReadonlySet<ClavePermiso> = new Set(sesion?.permisos ?? []);
    // La regla (y su porqué) vive en `derivarEstadoSesion`, que se prueba sin montar React.
    const estado = derivarEstadoSesion({ data: consulta.data, esError: consulta.isError });
    return {
      sesion,
      cargando: consulta.isPending,
      estado,
      errorConsulta: estado === 'indeterminado' ? (consulta.error?.message ?? null) : null,
      permisos,
      tienePermiso: (clave) => permisos.has(clave),
      refrescar,
    };
  }, [consulta.data, consulta.isPending, consulta.isError, consulta.error, refrescar]);

  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}
