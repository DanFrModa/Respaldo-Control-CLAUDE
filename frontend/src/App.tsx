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
import { ColoresPagina } from '@/modulos/colores/ColoresPagina';
import { EmpresasPagina } from '@/modulos/empresas/EmpresasPagina';
import { ValidacionCargosPagina } from '@/modulos/esma/ValidacionCargosPagina';
import { EtiquetasMarcaPagina } from '@/modulos/etiquetas-marca/EtiquetasMarcaPagina';
import { ExistenciasPtPagina } from '@/modulos/inventarios/ExistenciasPtPagina';
import { KardexPtPagina } from '@/modulos/inventarios/KardexPtPagina';
import { MovimientosPtPagina } from '@/modulos/inventarios/MovimientosPtPagina';
import { TraspasosPtPagina } from '@/modulos/inventarios/TraspasosPtPagina';
import { GaleriaModelos } from '@/modulos/modelos/GaleriaModelos';
import { ModelosPagina } from '@/modulos/modelos/ModelosPagina';
import { OrdenesPagina } from '@/modulos/ordenes/OrdenesPagina';
import { ConsultaOrdenesPagina } from '@/modulos/ordenes-consulta/ConsultaOrdenesPagina';
import { OrdenesIncompletasPagina } from '@/modulos/ordenes-consulta/OrdenesIncompletasPagina';
import { TableroPedidosMesPagina } from '@/modulos/ordenes-consulta/TableroPedidosMesPagina';
import { PedidosPagina } from '@/modulos/pedidos/PedidosPagina';
import { CapturaCortePagina } from '@/modulos/produccion/CapturaCortePagina';
import { CorteSemanalPagina } from '@/modulos/produccion/CorteSemanalPagina';
import { EntregaClientePagina } from '@/modulos/produccion/EntregaClientePagina';
import { EnvioMaquilaPagina } from '@/modulos/produccion/EnvioMaquilaPagina';
import { ExistenciasMaquileroPagina } from '@/modulos/produccion/ExistenciasMaquileroPagina';
import { ReciboMaquilaPagina } from '@/modulos/produccion/ReciboMaquilaPagina';
import { RecibosSemanalesPagina } from '@/modulos/produccion/RecibosSemanalesPagina';
import { TableroWipPagina } from '@/modulos/produccion/TableroWipPagina';
import { ProveedoresPagina } from '@/modulos/proveedores/ProveedoresPagina';
import { TallasCurvasPagina } from '@/modulos/tallas/TallasCurvasPagina';
import { TelasPagina } from '@/modulos/telas/TelasPagina';
import { TiposProcesoPagina } from '@/modulos/tipos-proceso/TiposProcesoPagina';
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
          { path: 'pedidos', element: <PedidosPagina /> },
          { path: 'produccion/tipos-proceso', element: <TiposProcesoPagina /> },
          { path: 'produccion/ordenes', element: <OrdenesPagina /> },
          { path: 'produccion/corte', element: <CapturaCortePagina /> },
          { path: 'produccion/envios', element: <EnvioMaquilaPagina /> },
          { path: 'produccion/recibos', element: <ReciboMaquilaPagina /> },
          { path: 'produccion/recibos-semanales', element: <RecibosSemanalesPagina /> },
          { path: 'produccion/entregas', element: <EntregaClientePagina /> },
          { path: 'produccion/wip', element: <TableroWipPagina /> },
          { path: 'produccion/existencias-maquilero', element: <ExistenciasMaquileroPagina /> },
          { path: 'produccion/corte-semanal', element: <CorteSemanalPagina /> },
          { path: 'produccion/consulta', element: <ConsultaOrdenesPagina /> },
          { path: 'produccion/incompletas', element: <OrdenesIncompletasPagina /> },
          { path: 'produccion/pedidos-por-mes', element: <TableroPedidosMesPagina /> },
          { path: 'inventarios/movimientos', element: <MovimientosPtPagina /> },
          { path: 'inventarios/traspasos', element: <TraspasosPtPagina /> },
          { path: 'inventarios/existencias', element: <ExistenciasPtPagina /> },
          { path: 'inventarios/kardex', element: <KardexPtPagina /> },
          { path: 'esma/validacion-cargos', element: <ValidacionCargosPagina /> },
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
