import { Loader2Icon } from 'lucide-react';
import { Navigate, Outlet } from 'react-router-dom';

import { useSesion } from './useSesion';

/**
 * Guard de las rutas de la app: mientras se resuelve la sesion muestra un
 * indicador a pantalla completa; sin sesion redirige a `/login` (reemplazando la
 * entrada en el historial para que "atras" no vuelva a la ruta protegida). Con
 * sesion, renderiza la ruta hija (`Outlet`).
 *
 * Es solo la PRIMERA barrera (UX): cada ruta del backend re-verifica sesion y
 * permiso (deny-by-default, A1/§9.2). Aqui no se decide nada de negocio.
 */
export function RutaProtegida(): React.JSX.Element {
  const { sesion, cargando } = useSesion();

  if (cargando) {
    return (
      <div className="flex min-h-svh items-center justify-center" role="status" aria-live="polite">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Cargando…</span>
      </div>
    );
  }

  if (sesion === null) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
