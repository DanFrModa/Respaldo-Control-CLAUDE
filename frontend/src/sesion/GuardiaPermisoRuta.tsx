import { Link, useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { rutaPermitida } from '@/modulos/catalogo';

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

  return (
    <div className="h-full overflow-y-auto" data-testid="pantalla-no-disponible">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-16 text-center">
        <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
          Esta pantalla no está disponible para tu usuario.
        </h1>
        <Button asChild className="mt-6">
          <Link to="/">Ir al inicio</Link>
        </Button>
      </div>
    </div>
  );
}
