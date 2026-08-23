import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

/**
 * EL ÚNICO texto que la app le dice a un usuario cuando una pantalla no le toca
 * (`DECISIONES.md §Post-F9.68`, aprobado por Daniel palabra por palabra):
 *
 *   «Esta pantalla no está disponible para tu usuario.»
 *
 * Es la excepción legítima a «esconder, no negar»: el ENLACE COMPARTIDO. Quien
 * recibe la URL de algo que no puede ver tiene que leer algo, o parecería que el
 * sistema se rompió. NO nombra el permiso, NO sugiere a quién pedirlo y NO trae
 * código de error.
 *
 * Vive en un componente propio para que haya UNA sola redacción: la usan la capa
 * de ruta (`GuardiaPermisoRuta`) y la página comodín (`Proximamente`, cuando los
 * permisos no hacen visible el módulo). El 404 (`NoEncontrado`) NO la usa: ese
 * habla de páginas que de verdad no existen.
 */
export function PantallaNoDisponible(): React.JSX.Element {
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
