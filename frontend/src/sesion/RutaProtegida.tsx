import { Loader2Icon, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import { useSesion } from './useSesion';

/**
 * Guard de las rutas de la app: mientras se resuelve la sesion muestra un
 * indicador a pantalla completa; sin sesion redirige a `/login` (reemplazando la
 * entrada en el historial para que "atras" no vuelva a la ruta protegida). Con
 * sesion, renderiza la ruta hija (`Outlet`).
 *
 * Es solo la PRIMERA barrera (UX): cada ruta del backend re-verifica sesion y
 * permiso (deny-by-default, A1/§9.2). Aqui no se decide nada de negocio.
 *
 * ⭐ V1-E3i — EL CUARTO ESTADO. `sesion === null` ya no basta para mandar a nadie al login: cuando
 * la consulta FALLA (y no cuando el servidor contesta 401), el estado es `indeterminado` y aquí se
 * dice *"no pudimos confirmar tu sesión"* con un botón de reintentar. Sacar al usuario por un
 * parpadeo de red le costaba lo que estuviera capturando.
 */
export function RutaProtegida(): React.JSX.Element {
  const { estado, errorConsulta, refrescar } = useSesion();
  const [reintentando, setReintentando] = useState(false);

  if (estado === 'cargando') {
    return (
      <div className="flex min-h-svh items-center justify-center" role="status" aria-live="polite">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Cargando…</span>
      </div>
    );
  }

  if (estado === 'indeterminado') {
    return (
      <div
        className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center"
        role="alert"
        data-testid="sesion-indeterminada"
      >
        <WifiOff className="size-7 text-muted-foreground" aria-hidden />
        <p className="max-w-md text-sm">
          <b>No pudimos confirmar tu sesión.</b> Puede ser un problema de conexión o que el servidor
          esté arrancando. <b>No cerramos tu sesión</b>: reintenta en un momento.
        </p>
        {errorConsulta === null ? null : (
          <p className="max-w-md text-xs text-muted-foreground">{errorConsulta}</p>
        )}
        <Button
          onClick={() => {
            setReintentando(true);
            void refrescar().finally(() => setReintentando(false));
          }}
          disabled={reintentando}
          data-testid="sesion-reintentar"
        >
          {reintentando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
          Reintentar
        </Button>
      </div>
    );
  }

  if (estado === 'sin-sesion') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
