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
import { AjusteMaterialesPagina } from '@/modulos/inventarios/AjusteMaterialesPagina';
import { ExistenciasAviosPagina } from '@/modulos/inventarios/ExistenciasAviosPagina';
import { ExistenciasPtPagina } from '@/modulos/inventarios/ExistenciasPtPagina';
import { ExistenciasTelasPagina } from '@/modulos/inventarios/ExistenciasTelasPagina';
import { InventariosPagina } from '@/modulos/inventarios/InventariosPagina';
import { KardexMaterialesPagina } from '@/modulos/inventarios/KardexMaterialesPagina';
import { KardexPtPagina } from '@/modulos/inventarios/KardexPtPagina';
import { MovimientosPtPagina } from '@/modulos/inventarios/MovimientosPtPagina';
import { SalidaTelaOrdenPagina } from '@/modulos/inventarios/SalidaTelaOrdenPagina';
import { TraspasoMaterialesPagina } from '@/modulos/inventarios/TraspasoMaterialesPagina';
import { TraspasosPtPagina } from '@/modulos/inventarios/TraspasosPtPagina';
import { GaleriaModelos } from '@/modulos/modelos/GaleriaModelos';
import { ModelosPagina } from '@/modulos/modelos/ModelosPagina';
import { BandejaAutorizacionPagina } from '@/modulos/ordenes-compra/BandejaAutorizacionPagina';
import { ComprasPorOrdenPagina } from '@/modulos/ordenes-compra/ComprasPorOrdenPagina';
import { EstatusMaterialesPagina } from '@/modulos/ordenes-compra/EstatusMaterialesPagina';
import { ExplosionMaterialesPagina } from '@/modulos/ordenes-compra/ExplosionMaterialesPagina';
import { OrdenesCompraPagina } from '@/modulos/ordenes-compra/OrdenesCompraPagina';
import { RecepcionComprasPagina } from '@/modulos/ordenes-compra/RecepcionComprasPagina';
import { ConsultaNotasPagina } from '@/modulos/notas-salida/ConsultaNotasPagina';
import { NotasPorOrdenPagina } from '@/modulos/notas-salida/NotasPorOrdenPagina';
import { NotasSalidaPagina } from '@/modulos/notas-salida/NotasSalidaPagina';
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
import { ConfiguracionRcPagina } from '@/modulos/ruta-critica/ConfiguracionRcPagina';
import { DependenciasPagina } from '@/modulos/ruta-critica/DependenciasPagina';
import { PlantillasPagina } from '@/modulos/ruta-critica/PlantillasPagina';
import { ProcesosPagina } from '@/modulos/ruta-critica/ProcesosPagina';
import { ReglasDuracionPagina } from '@/modulos/ruta-critica/ReglasDuracionPagina';
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
          // Órdenes de compra (Módulo 4 · Compras, F4-E2).
          { path: 'compras/ordenes', element: <OrdenesCompraPagina /> },
          { path: 'compras/autorizacion', element: <BandejaAutorizacionPagina /> },
          { path: 'compras/por-orden', element: <ComprasPorOrdenPagina /> },
          // Explosión MRP + tablero "qué tengo / qué falta" (Módulo 3 · Compras, F4-E4, R3/R7).
          { path: 'compras/explosion', element: <ExplosionMaterialesPagina /> },
          { path: 'compras/estatus-materiales', element: <EstatusMaterialesPagina /> },
          // Recepción de compras (Módulo 3 · Compras, F4-E3).
          { path: 'compras/recepcion', element: <RecepcionComprasPagina /> },
          // Notas de salida a maquilero (Módulo 5 · Producción, F4-E5).
          { path: 'produccion/notas-salida', element: <NotasSalidaPagina /> },
          { path: 'produccion/notas-salida/consulta', element: <ConsultaNotasPagina /> },
          { path: 'produccion/notas-salida/por-orden', element: <NotasPorOrdenPagina /> },
          { path: 'inventarios', element: <InventariosPagina /> },
          { path: 'inventarios/movimientos', element: <MovimientosPtPagina /> },
          { path: 'inventarios/traspasos', element: <TraspasosPtPagina /> },
          { path: 'inventarios/existencias', element: <ExistenciasPtPagina /> },
          { path: 'inventarios/kardex', element: <KardexPtPagina /> },
          // Inventario de telas y avíos (Módulo 4, F4-E1, D5/R4).
          { path: 'inventarios/telas/existencias', element: <ExistenciasTelasPagina /> },
          { path: 'inventarios/avios/existencias', element: <ExistenciasAviosPagina /> },
          { path: 'inventarios/materiales/kardex', element: <KardexMaterialesPagina /> },
          { path: 'inventarios/telas/salida-orden', element: <SalidaTelaOrdenPagina /> },
          { path: 'inventarios/materiales/traspasos', element: <TraspasoMaterialesPagina /> },
          { path: 'inventarios/materiales/ajustes', element: <AjusteMaterialesPagina /> },
          { path: 'esma/validacion-cargos', element: <ValidacionCargosPagina /> },
          // Ruta Crítica (Módulo 8, F5-E1) — catálogo configurable + editor de dependencias.
          { path: 'ruta-critica/procesos', element: <ProcesosPagina /> },
          { path: 'ruta-critica/dependencias', element: <DependenciasPagina /> },
          // Ruta Crítica (Módulo 8, F5-E2) — plantillas de ruta y reglas de duración.
          { path: 'ruta-critica/plantillas', element: <PlantillasPagina /> },
          { path: 'ruta-critica/reglas-duracion', element: <ReglasDuracionPagina /> },
          { path: 'administracion', element: <AdministracionPagina /> },
          { path: 'administracion/usuarios', element: <UsuariosPagina /> },
          { path: 'administracion/empresas', element: <EmpresasPagina /> },
          // Configuración de la RC por empresa (colchón + calendario + festivos).
          { path: 'administracion/ruta-critica', element: <ConfiguracionRcPagina /> },
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
