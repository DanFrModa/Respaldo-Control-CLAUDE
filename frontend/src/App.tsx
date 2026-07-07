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
import { CapturaMovimientoPagina } from '@/modulos/esma/CapturaMovimientoPagina';
import { CapturaPagosPagina } from '@/modulos/esma/CapturaPagosPagina';
import { ConciliacionCargosPagina } from '@/modulos/esma/ConciliacionCargosPagina';
import { DesglosadoPagina } from '@/modulos/esma/DesglosadoPagina';
import { EsMaPagina } from '@/modulos/esma/EsMaPagina';
import { EstadoCuentaPagina } from '@/modulos/esma/EstadoCuentaPagina';
import { PagosSemanalesPagina } from '@/modulos/esma/PagosSemanalesPagina';
import { RecibosSemanalesEsMaPagina } from '@/modulos/esma/RecibosSemanalesEsMaPagina';
import { SaldosMaquilerosPagina } from '@/modulos/esma/SaldosMaquilerosPagina';
import { ValidacionCargosPagina } from '@/modulos/esma/ValidacionCargosPagina';
import { EtiquetasMarcaPagina } from '@/modulos/etiquetas-marca/EtiquetasMarcaPagina';
import { CostosPagina } from '@/modulos/costos/CostosPagina';
import { CosteoOrdenPagina } from '@/modulos/costos/CosteoOrdenPagina';
import { ListaCostosPagina } from '@/modulos/costos/ListaCostosPagina';
import { ListaPreciosPagina } from '@/modulos/costos/ListaPreciosPagina';
import { MargenesPagina } from '@/modulos/costos/MargenesPagina';
import { PreCostoPagina } from '@/modulos/costos/PreCostoPagina';
import { EdrPagina } from '@/modulos/edr/EdrPagina';
import { GestionMesPagina } from '@/modulos/edr/GestionMesPagina';
import { ConciliacionPagina } from '@/modulos/edr/ConciliacionPagina';
import { EdrPorMesPagina } from '@/modulos/edr/EdrPorMesPagina';
import { EdrPorAnioPagina } from '@/modulos/edr/EdrPorAnioPagina';
import { IndicadoresPagina } from '@/modulos/indicadores/IndicadoresPagina';
import { TableroRcPagina } from '@/modulos/indicadores/TableroRcPagina';
import { TableroCalidadPagina } from '@/modulos/indicadores/TableroCalidadPagina';
import { TableroWipPagina as TableroWipIndicadoresPagina } from '@/modulos/indicadores/TableroWipPagina';
import { CapturaProductividadPagina } from '@/modulos/indicadores/CapturaProductividadPagina';
import { TableroProductividadPagina } from '@/modulos/indicadores/TableroProductividadPagina';
import { ProductividadCatalogosPagina } from '@/modulos/indicadores/ProductividadCatalogosPagina';
import { FichasConfiablesPagina } from '@/modulos/indicadores/FichasConfiablesPagina';
import { MuestrariosPagina } from '@/modulos/indicadores/MuestrariosPagina';
import { InventariosCiclicosPagina } from '@/modulos/indicadores/InventariosCiclicosPagina';
import { ConteoCiclicoPagina } from '@/modulos/indicadores/ConteoCiclicoPagina';
import { ExactitudCiclicoPagina } from '@/modulos/indicadores/ExactitudCiclicoPagina';
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
import { DesarrolloPagina } from '@/modulos/desarrollo/DesarrolloPagina';
import { ListasPreciosPagina } from '@/modulos/listas-precios/ListasPreciosPagina';
import { CapturaCortePagina } from '@/modulos/produccion/CapturaCortePagina';
import { CorteSemanalPagina } from '@/modulos/produccion/CorteSemanalPagina';
import { EntregaClientePagina } from '@/modulos/produccion/EntregaClientePagina';
import { EnvioMaquilaPagina } from '@/modulos/produccion/EnvioMaquilaPagina';
import { ExistenciasMaquileroPagina } from '@/modulos/produccion/ExistenciasMaquileroPagina';
import { ReciboMaquilaPagina } from '@/modulos/produccion/ReciboMaquilaPagina';
import { RecibosSemanalesPagina } from '@/modulos/produccion/RecibosSemanalesPagina';
import { TableroWipPagina } from '@/modulos/produccion/TableroWipPagina';
import { ProveedoresPagina } from '@/modulos/proveedores/ProveedoresPagina';
import { BitacoraPagina } from '@/modulos/administracion/BitacoraPagina';
import { RolesPagina } from '@/modulos/administracion/RolesPagina';
import { ConceptosCostoPagina } from '@/modulos/conceptos-costo/ConceptosCostoPagina';
import { EstadosListaPagina } from '@/modulos/estados-lista/EstadosListaPagina';
import { AltaAuditoriaPagina } from '@/modulos/calidad/AltaAuditoriaPagina';
import { AuditoriasPorMaquileroPagina } from '@/modulos/calidad/AuditoriasPorMaquileroPagina';
import { CalidadPagina } from '@/modulos/calidad/CalidadPagina';
import { CapturaAuditoriaPagina } from '@/modulos/calidad/CapturaAuditoriaPagina';
import { ConsultaAuditoriasPagina } from '@/modulos/calidad/ConsultaAuditoriasPagina';
import { DefectosPagina } from '@/modulos/calidad/DefectosPagina';
import { PlanesAqlPagina } from '@/modulos/calidad/PlanesAqlPagina';
import { TiposProductoPagina } from '@/modulos/calidad/TiposProductoPagina';
import { BandejaTareasPagina } from '@/modulos/ruta-critica/BandejaTareasPagina';
import { ConcentradoPagina } from '@/modulos/ruta-critica/ConcentradoPagina';
import { ConfiguracionRcPagina } from '@/modulos/ruta-critica/ConfiguracionRcPagina';
import { DependenciasPagina } from '@/modulos/ruta-critica/DependenciasPagina';
import { PlantillasPagina } from '@/modulos/ruta-critica/PlantillasPagina';
import { ProcesosPagina } from '@/modulos/ruta-critica/ProcesosPagina';
import { ProgramarRcPagina } from '@/modulos/ruta-critica/ProgramarRcPagina';
import { ReglasDuracionPagina } from '@/modulos/ruta-critica/ReglasDuracionPagina';
import { RutaCriticaPagina } from '@/modulos/ruta-critica/RutaCriticaPagina';
import { RutaPorOrdenPagina } from '@/modulos/ruta-critica/RutaPorOrdenPagina';
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
          // Desarrollo (Módulo 15, F8-E2/E6): pestañas Proyectos (lista+detalle) y Tablero por estado.
          { path: 'desarrollo', element: <DesarrolloPagina /> },
          // Listas de precios (Módulo 15, F8-E4): lista + detalle con la vista de aprobación del dueño.
          { path: 'listas-precios', element: <ListasPreciosPagina /> },
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
          // EsMa (Módulo 7): portada-hub + validación de cargos (F3-E4), corazón contable (F6-E4) y la
          // experiencia de usuario del estado de cuenta (F6-E5). Rutas estáticas antes de cualquier :param.
          { path: 'esma', element: <EsMaPagina /> },
          { path: 'esma/estado-cuenta', element: <EstadoCuentaPagina /> },
          { path: 'esma/saldos', element: <SaldosMaquilerosPagina /> },
          { path: 'esma/desglosado', element: <DesglosadoPagina /> },
          { path: 'esma/pagos-semanales', element: <PagosSemanalesPagina /> },
          { path: 'esma/recibos-semanales', element: <RecibosSemanalesEsMaPagina /> },
          { path: 'esma/validacion-cargos', element: <ValidacionCargosPagina /> },
          { path: 'esma/conciliacion', element: <ConciliacionCargosPagina /> },
          { path: 'esma/abonos', element: <CapturaMovimientoPagina concepto="abonos" /> },
          { path: 'esma/descuentos', element: <CapturaMovimientoPagina concepto="descuentos" /> },
          { path: 'esma/pagos', element: <CapturaPagosPagina /> },
          // Ruta Crítica (Módulo 8) — portada-hub de las sub-vistas (antes caía en ":modulo").
          { path: 'ruta-critica', element: <RutaCriticaPagina /> },
          // Ruta Crítica (Módulo 8, F5-E1) — catálogo configurable + editor de dependencias.
          { path: 'ruta-critica/procesos', element: <ProcesosPagina /> },
          { path: 'ruta-critica/dependencias', element: <DependenciasPagina /> },
          // Ruta Crítica (Módulo 8, F5-E2) — plantillas de ruta y reglas de duración.
          { path: 'ruta-critica/plantillas', element: <PlantillasPagina /> },
          { path: 'ruta-critica/reglas-duracion', element: <ReglasDuracionPagina /> },
          // Ruta Crítica (Módulo 8, F5-E5) — motor por orden: bandeja, programar y RC por orden.
          { path: 'ruta-critica/bandeja', element: <BandejaTareasPagina /> },
          // Ruta Crítica (Módulo 8, F5-E7) — concentrado "planeado vs real" (tablero gerencial).
          { path: 'ruta-critica/concentrado', element: <ConcentradoPagina /> },
          { path: 'ruta-critica/ordenes/:idOrden', element: <RutaPorOrdenPagina /> },
          { path: 'ruta-critica/ordenes/:idOrden/programar', element: <ProgramarRcPagina /> },
          // Calidad (Módulo 9, F6-E1) — catálogos base: defectos, tipos de producto, planes AQL.
          { path: 'calidad', element: <CalidadPagina /> },
          { path: 'calidad/defectos', element: <DefectosPagina /> },
          { path: 'calidad/tipos-producto', element: <TiposProductoPagina /> },
          { path: 'calidad/planes-aql', element: <PlanesAqlPagina /> },
          // Auditorías de calidad (F6-E2): alta + captura de resultados.
          { path: 'calidad/auditorias/nueva', element: <AltaAuditoriaPagina /> },
          // Consulta + historial por maquilero (F6-E3). Rutas estáticas antes de `:id`.
          { path: 'calidad/auditorias', element: <ConsultaAuditoriasPagina /> },
          { path: 'calidad/auditorias/maquilero', element: <AuditoriasPorMaquileroPagina /> },
          { path: 'calidad/auditorias/:id', element: <CapturaAuditoriaPagina /> },
          // Costos (Módulo 6, F7-E1): hub + pre-costo/lista de precios (precostos.consultar) y
          // costeo de orden/lista de costos/márgenes (costos.ver/.capturar). Rutas estáticas antes
          // del catch-all ":modulo".
          { path: 'costos', element: <CostosPagina /> },
          { path: 'costos/pre-costo', element: <PreCostoPagina /> },
          { path: 'costos/lista-precios', element: <ListaPreciosPagina /> },
          { path: 'costos/costeo', element: <CosteoOrdenPagina /> },
          { path: 'costos/lista', element: <ListaCostosPagina /> },
          { path: 'costos/margenes', element: <MargenesPagina /> },
          // EDR (Módulo 6, F7-E2): hub + gestión del mes (edr.capturar) y conciliación/por mes/por
          // año (edr.ver). Rutas estáticas antes del catch-all ":modulo".
          { path: 'edr', element: <EdrPagina /> },
          { path: 'edr/mes', element: <GestionMesPagina /> },
          { path: 'edr/conciliacion', element: <ConciliacionPagina /> },
          { path: 'edr/por-mes', element: <EdrPorMesPagina /> },
          { path: 'edr/por-anio', element: <EdrPorAnioPagina /> },
          // Indicadores (Módulo Indicadores, F7-E3): hub + 3 tableros directivos (RC, calidad, WIP),
          // todos `indicadores.ver`. Rutas estáticas antes del catch-all ":modulo".
          { path: 'indicadores', element: <IndicadoresPagina /> },
          { path: 'indicadores/ruta-critica', element: <TableroRcPagina /> },
          { path: 'indicadores/calidad', element: <TableroCalidadPagina /> },
          { path: 'indicadores/wip', element: <TableroWipIndicadoresPagina /> },
          // Indicadores · CAPTURA (F7-E4): productividad (captura/tablero/catálogos), fichas
          // confiables y muestrarios. Cada pantalla re-verifica su permiso en el backend (A1).
          { path: 'indicadores/productividad/captura', element: <CapturaProductividadPagina /> },
          { path: 'indicadores/productividad/tablero', element: <TableroProductividadPagina /> },
          {
            path: 'indicadores/productividad/catalogos',
            element: <ProductividadCatalogosPagina />,
          },
          { path: 'indicadores/fichas-confiables', element: <FichasConfiablesPagina /> },
          { path: 'indicadores/muestrarios', element: <MuestrariosPagina /> },
          // Indicadores · Inventario cíclico (F7-E5): lista/alta + conteo ciego + exactitud/ajuste.
          { path: 'indicadores/ciclicos', element: <InventariosCiclicosPagina /> },
          { path: 'indicadores/ciclicos/:id/conteo', element: <ConteoCiclicoPagina /> },
          { path: 'indicadores/ciclicos/:id/exactitud', element: <ExactitudCiclicoPagina /> },
          { path: 'administracion', element: <AdministracionPagina /> },
          { path: 'administracion/usuarios', element: <UsuariosPagina /> },
          { path: 'administracion/roles', element: <RolesPagina /> },
          { path: 'administracion/empresas', element: <EmpresasPagina /> },
          // Configuración de la RC por empresa (colchón + calendario + festivos).
          { path: 'administracion/ruta-critica', element: <ConfiguracionRcPagina /> },
          // Bitácora de auditoría (A7, F6-E1).
          { path: 'administracion/bitacora', element: <BitacoraPagina /> },
          // Catálogos globales de Desarrollo (F8-E1), admin-only.
          { path: 'administracion/conceptos-costo', element: <ConceptosCostoPagina /> },
          { path: 'administracion/estados-lista', element: <EstadosListaPagina /> },
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
