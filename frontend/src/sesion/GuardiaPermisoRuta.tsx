import { useLocation } from 'react-router-dom';

import { rutaPermitida } from '@/modulos/catalogo';

import { PantallaNoDisponible } from './PantallaNoDisponible';
import { useSesion } from './useSesion';

/**
 * LA CAPA DE RUTA — segunda de las tres que pidió Daniel (`DECISIONES.md
 * §Post-F9.68`): el MENÚ esconde la opción, la RUTA cierra la pantalla y el
 * BACKEND rechaza la operación.
 *
 * Envuelve el `<Outlet />` del cascarón: si la sesión no tiene el permiso que
 * la ruta declara en el CATÁLOGO (`rutaPermitida`, una sola fuente), la
 * pantalla NO se monta — no se pintan su encabezado ni sus botones ni se
 * disparan sus consultas.
 *
 * ⚠️ Lo único que se dice es la EXCEPCIÓN que Daniel aprobó, para el ENLACE
 * COMPARTIDO: quien reciba la URL de una pantalla que no puede ver debe leer
 * algo, o parecería que el sistema se rompió. El texto NO nombra el permiso, NO
 * sugiere a quién pedirlo y NO trae código de error.
 *
 * Esconder es de PRESENTACIÓN (A4): el backend sigue decidiendo, y esta capa no
 * lo releva de nada.
 */
export function GuardiaPermisoRuta({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { permisos } = useSesion();
  const { pathname } = useLocation();

  if (rutaPermitida(pathname, permisos)) {
    return <>{children}</>;
  }

  return <PantallaNoDisponible />;
}
