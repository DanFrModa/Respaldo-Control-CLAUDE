import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { obtenerSesion } from '@/api/sesion';
import type { ClavePermiso } from '@/api/tipos';

import { CLAVE_SESION, ContextoSesion, type EstadoSesion } from './contexto';

/**
 * Provee el estado de sesion a toda la app. Consulta `GET /api/sesion` una vez
 * (TanStack Query cachea el resultado) y expone usuario, permisos y un
 * `refrescar()` que se llama tras iniciar o cerrar sesion.
 *
 * El 401 (sin sesion) NO es un error: `obtenerSesion` lo devuelve como
 * `{ autenticado: false }`, asi que no se reintenta ni se muestra como fallo;
 * simplemente no hay sesion y el guard redirige a /login.
 */
export function ProveedorSesion({ children }: { children: React.ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient();

  const consulta = useQuery({
    queryKey: CLAVE_SESION,
    queryFn: obtenerSesion,
    // La sesion no caduca sola en el cliente; se refresca explicitamente al
    // entrar/salir. Sin reintentos: un fallo real se resuelve recargando.
    staleTime: Infinity,
    retry: false,
  });

  const refrescar = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: CLAVE_SESION });
  }, [queryClient]);

  const valor = useMemo<EstadoSesion>(() => {
    const sesion = consulta.data?.autenticado ? consulta.data.sesion : null;
    const permisos: ReadonlySet<ClavePermiso> = new Set(sesion?.permisos ?? []);
    return {
      sesion,
      cargando: consulta.isPending,
      permisos,
      tienePermiso: (clave) => permisos.has(clave),
      refrescar,
    };
  }, [consulta.data, consulta.isPending, refrescar]);

  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}
