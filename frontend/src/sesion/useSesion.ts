import { useContext } from 'react';

import { ContextoSesion, type EstadoSesion } from './contexto';

/**
 * Hook para leer la sesion actual (usuario, permisos, `tienePermiso`,
 * `refrescar`). Debe usarse dentro de `ProveedorSesion`; fuera de el lanza un
 * error claro en vez de devolver datos vacios en silencio.
 */
export function useSesion(): EstadoSesion {
  const contexto = useContext(ContextoSesion);
  if (contexto === undefined) {
    throw new Error('useSesion debe usarse dentro de <ProveedorSesion>.');
  }
  return contexto;
}
