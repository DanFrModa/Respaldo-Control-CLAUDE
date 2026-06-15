import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { Toaster } from '@/components/ui/sonner';
import { CascaronSistema } from '@/modulos/CascaronSistema';
import { AdministracionPagina } from '@/modulos/administracion/AdministracionPagina';
import { AlmacenesPagina } from '@/modulos/almacenes/AlmacenesPagina';
import { AviosPagina } from '@/modulos/avios/AviosPagina';
import { BordadosPagina } from '@/modulos/bordados/BordadosPagina';
import { GaleriaBordados } from '@/modulos/bordados/GaleriaBordados';
import { CatalogosPagina } from '@/modulos/catalogos/CatalogosPagina';
import { ClientesPagina } from '@/modulos/clientes/ClientesPagina';
import { CodigosBarraPagina } from '@/modulos/codigos-barra/CodigosBarraPagina';
import { ColoresPagina } from '@/modulos/colores/ColoresPagina';
import { EmpresasPagina } from '@/modulos/empresas/EmpresasPagina';
import { EtiquetasMarcaPagina } from '@/modulos/etiquetas-marca/EtiquetasMarcaPagina';
import { GaleriaModelos } from '@/modulos/modelos/GaleriaModelos';
import { ModelosPagina } from '@/modulos/modelos/ModelosPagina';
import { ProveedoresPagina } from '@/modulos/proveedores/ProveedoresPagina';
import { TallasCurvasPagina } from '@/modulos/tallas/TallasCurvasPagina';
import { TelasPagina } from '@/modulos/telas/TelasPagina';
import { TemporadasPagina } from '@/modulos/temporadas/TemporadasPagina';
import { UsuariosPagina } from '@/modulos/usuarios/UsuariosPagina';
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
 *  - Los CRUD de Catalogos (almacenes + los 5 de F1-E1) y de Administracion
 *    (usuarios + empresas) son rutas reales; `/:modulo` muestra "Proximamente"
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
          { path: 'catalogos/proveedores', element: <ProveedoresPagina /> },
          { path: 'catalogos/temporadas', element: <TemporadasPagina /> },
          { path: 'catalogos/etiquetas-marca', element: <EtiquetasMarcaPagina /> },
          { path: 'catalogos/colores', element: <ColoresPagina /> },
          { path: 'catalogos/tallas', element: <TallasCurvasPagina /> },
          { path: 'catalogos/clientes', element: <ClientesPagina /> },
          { path: 'catalogos/telas', element: <TelasPagina /> },
          { path: 'catalogos/avios', element: <AviosPagina /> },
          { path: 'catalogos/bordados', element: <BordadosPagina /> },
          { path: 'catalogos/galeria-bordados', element: <GaleriaBordados /> },
          { path: 'modelos', element: <ModelosPagina /> },
          { path: 'modelos/galeria', element: <GaleriaModelos /> },
          { path: 'modelos/codigos-barra', element: <CodigosBarraPagina /> },
          { path: 'administracion', element: <AdministracionPagina /> },
          { path: 'administracion/usuarios', element: <UsuariosPagina /> },
          { path: 'administracion/empresas', element: <EmpresasPagina /> },
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
