import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { Toaster } from '@/components/ui/sonner';
import { CascaronSistema } from '@/modulos/CascaronSistema';
import { AlmacenesPagina } from '@/modulos/almacenes/AlmacenesPagina';
import { CatalogosPagina } from '@/modulos/catalogos/CatalogosPagina';
import { Inicio } from '@/paginas/Inicio';
import { Login } from '@/paginas/Login';
import { NoEncontrado } from '@/paginas/NoEncontrado';
import { Proximamente } from '@/paginas/Proximamente';
import { ProveedorSesion } from '@/sesion/ProveedorSesion';
import { RutaProtegida } from '@/sesion/RutaProtegida';

/**
 * Cliente de TanStack Query (cache del estado del servidor). Una sola instancia
 * para toda la app. Sin reintentos automaticos: los errores del API ya vienen
 * con mensaje en español y se muestran/reintentan explicitamente.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

/**
 * Rutas de la SPA (React Router en modo datos):
 *  - `/login` es publica.
 *  - El resto cuelga de `RutaProtegida` (exige sesion) -> `CascaronSistema` (la
 *    cascara con sidebar + header), que renderiza cada pantalla en su `Outlet`.
 *  - `/catalogos/almacenes` es el CRUD real; `/:modulo` muestra "Proximamente"
 *    para los modulos aun no construidos (su ruta especifica tiene prioridad).
 */
const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    element: <RutaProtegida />,
    children: [
      {
        element: <CascaronSistema />,
        children: [
          { index: true, element: <Inicio /> },
          { path: 'catalogos', element: <CatalogosPagina /> },
          { path: 'catalogos/almacenes', element: <AlmacenesPagina /> },
          { path: ':modulo', element: <Proximamente /> },
          { path: '*', element: <NoEncontrado /> },
        ],
      },
    ],
  },
]);

/** Raiz de la app: provee cache de datos, sesion, ruteo y notificaciones. */
export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ProveedorSesion>
        <RouterProvider router={router} />
        <Toaster position="top-right" richColors />
      </ProveedorSesion>
    </QueryClientProvider>
  );
}
