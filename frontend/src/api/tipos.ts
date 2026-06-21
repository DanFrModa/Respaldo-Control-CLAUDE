import type { paths } from './esquema.gen';

/**
 * Alias utiles extraidos del contrato generado (`esquema.gen.ts`). Centralizar
 * aqui los tipos que la UI consume evita repetir el camino
 * `paths['...']['get']['responses'][200][...]` por todos lados y da un nombre
 * de dominio a cada forma.
 */

/** Respuesta de `GET /api/sesion`: usuario + empresa activa + permisos. */
export type Sesion = paths['/api/sesion']['get']['responses']['200']['content']['application/json'];

/**
 * Clave de permiso efectiva (union de literales del contrato). Es la MISMA
 * identidad de permiso que el backend (catalogo unico, A4): un permiso que no
 * existe en el contrato es error de compilacion al filtrar el menu.
 */
export type ClavePermiso = Sesion['permisos'][number];

/** Pagina de almacenes (`GET /api/almacenes`). */
export type AlmacenesPagina =
  paths['/api/almacenes']['get']['responses']['200']['content']['application/json'];

/** Un almacen tal como lo devuelve el API. */
export type Almacen = AlmacenesPagina['datos'][number];

/** Parametros de consulta del listado de almacenes (querystring). */
export type AlmacenesQuery = NonNullable<paths['/api/almacenes']['get']['parameters']['query']>;

/** Cuerpo de alta de almacen (`POST /api/almacenes`). */
export type AlmacenCrear =
  paths['/api/almacenes']['post']['requestBody']['content']['application/json'];

/** Cuerpo de edicion de almacen (`PATCH /api/almacenes/{id}`). */
export type AlmacenEditar =
  paths['/api/almacenes/{id}']['patch']['requestBody']['content']['application/json'];

// ── Catalogos F1-E1 (mismo patron que Almacenes) ─────────────────────────────

/** Pagina de proveedores (`GET /api/proveedores`). */
export type ProveedoresPagina =
  paths['/api/proveedores']['get']['responses']['200']['content']['application/json'];
/** Un proveedor tal como lo devuelve el API. */
export type Proveedor = ProveedoresPagina['datos'][number];
/** Parametros de consulta del listado de proveedores (querystring). */
export type ProveedoresQuery = NonNullable<paths['/api/proveedores']['get']['parameters']['query']>;
/** Tipo de proveedor (clasificacion de negocio). */
export type TipoProveedor = Proveedor['tipo'];
/** Cuerpo de alta de proveedor (`POST /api/proveedores`). */
export type ProveedorCrear =
  paths['/api/proveedores']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de proveedor (`PATCH /api/proveedores/{id}`). */
export type ProveedorEditar =
  paths['/api/proveedores/{id}']['patch']['requestBody']['content']['application/json'];

// ── Catalogo de roles de proveedor (F1-E1B, selector) ────────────────────────

/** Lista de roles/servicios de proveedor (`GET /api/roles-proveedor`) — array plano. */
export type RolesProveedorLista =
  paths['/api/roles-proveedor']['get']['responses']['200']['content']['application/json'];
/** Un rol de proveedor del catalogo selector. */
export type RolProveedor = RolesProveedorLista[number];

// ── Adjuntos de proveedor (F1-E1B, archivos en R2 via presigned) ─────────────

/** Lista de adjuntos de un proveedor (`GET /api/proveedores/{id}/adjuntos`). */
export type ProveedorAdjuntosLista =
  paths['/api/proveedores/{id}/adjuntos']['get']['responses']['200']['content']['application/json'];
/** Un adjunto de proveedor (con su URL de descarga prefirmada). */
export type ProveedorAdjunto = ProveedorAdjuntosLista['datos'][number];
/** Tipo documental de un adjunto de proveedor (constancia/contrato/otro). */
export type TipoArchivoProveedor = ProveedorAdjunto['tipo'];
/** Cuerpo para preparar la subida de un adjunto (`POST /api/proveedores/{id}/adjuntos`). */
export type ProveedorAdjuntoCrear =
  paths['/api/proveedores/{id}/adjuntos']['post']['requestBody']['content']['application/json'];
/** Respuesta al preparar la subida (registro Archivo + URL PUT prefirmada). */
export type ProveedorAdjuntoSubida =
  paths['/api/proveedores/{id}/adjuntos']['post']['responses']['201']['content']['application/json'];

// NOTA (fusion de terceros, D12/R15): los tipos de Cortador se eliminaron; el cortador es
// un Proveedor con el rol `corte` (usa los tipos de Proveedor de arriba).

/** Pagina de temporadas (`GET /api/temporadas`). */
export type TemporadasPagina =
  paths['/api/temporadas']['get']['responses']['200']['content']['application/json'];
/** Una temporada tal como la devuelve el API. */
export type Temporada = TemporadasPagina['datos'][number];
/** Parametros de consulta del listado de temporadas (querystring). */
export type TemporadasQuery = NonNullable<paths['/api/temporadas']['get']['parameters']['query']>;
/** Cuerpo de alta de temporada (`POST /api/temporadas`). */
export type TemporadaCrear =
  paths['/api/temporadas']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de temporada (`PATCH /api/temporadas/{id}`). */
export type TemporadaEditar =
  paths['/api/temporadas/{id}']['patch']['requestBody']['content']['application/json'];

/** Pagina de etiquetas de marca (`GET /api/etiquetas-marca`). */
export type EtiquetasMarcaPagina =
  paths['/api/etiquetas-marca']['get']['responses']['200']['content']['application/json'];
/** Una etiqueta de marca tal como la devuelve el API. */
export type EtiquetaMarca = EtiquetasMarcaPagina['datos'][number];
/** Parametros de consulta del listado de etiquetas de marca (querystring). */
export type EtiquetasMarcaQuery = NonNullable<
  paths['/api/etiquetas-marca']['get']['parameters']['query']
>;
/** Cuerpo de alta de etiqueta de marca (`POST /api/etiquetas-marca`). */
export type EtiquetaMarcaCrear =
  paths['/api/etiquetas-marca']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de etiqueta de marca (`PATCH /api/etiquetas-marca/{id}`). */
export type EtiquetaMarcaEditar =
  paths['/api/etiquetas-marca/{id}']['patch']['requestBody']['content']['application/json'];

/** Pagina de colores (`GET /api/colores`). */
export type ColoresPagina =
  paths['/api/colores']['get']['responses']['200']['content']['application/json'];
/** Un color tal como lo devuelve el API. */
export type Color = ColoresPagina['datos'][number];
/** Parametros de consulta del listado de colores (querystring). */
export type ColoresQuery = NonNullable<paths['/api/colores']['get']['parameters']['query']>;
/** Cuerpo de alta de color (`POST /api/colores`). */
export type ColorCrear =
  paths['/api/colores']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de color (`PATCH /api/colores/{id}`). */
export type ColorEditar =
  paths['/api/colores/{id}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo de fusion de colores duplicados (`POST /api/colores/fusionar`). */
export type ColorFusionar =
  paths['/api/colores/fusionar']['post']['requestBody']['content']['application/json'];

// ── Catalogos estructurados F1-E2 ─────────────────────────────────────────────

// NOTA (fusion de terceros, D12/R15): la "maquila unificada" (Maquilero + TipoProceso) se
// elimino. Un maquilero es ahora un Proveedor con sus roles de servicio (tipos de Proveedor
// de arriba). El catalogo TipoProceso se conserva en BD para la Ruta Critica (F5) pero ya no
// expone selector REST, asi que aqui no hay tipos derivados de el.

// PIEZA B — Tallas / Curvas (D4).

/** Pagina de tallas (`GET /api/tallas`). */
export type TallasPagina =
  paths['/api/tallas']['get']['responses']['200']['content']['application/json'];
/** Una talla tal como la devuelve el API. */
export type Talla = TallasPagina['datos'][number];
/** Parametros de consulta del listado de tallas (querystring). */
export type TallasQuery = NonNullable<paths['/api/tallas']['get']['parameters']['query']>;
/** Cuerpo de alta de talla (`POST /api/tallas`). */
export type TallaCrear = paths['/api/tallas']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de talla (`PATCH /api/tallas/{id}`). */
export type TallaEditar =
  paths['/api/tallas/{id}']['patch']['requestBody']['content']['application/json'];

/** Pagina de curvas de tallas (`GET /api/curvas-talla`). */
export type CurvasPagina =
  paths['/api/curvas-talla']['get']['responses']['200']['content']['application/json'];
/** Una curva de tallas tal como la devuelve el API (con sus items ordenados). */
export type Curva = CurvasPagina['datos'][number];
/** Un renglon de una curva (talla + posicion). */
export type CurvaItem = Curva['items'][number];
/** Parametros de consulta del listado de curvas (querystring). */
export type CurvasQuery = NonNullable<paths['/api/curvas-talla']['get']['parameters']['query']>;
/** Cuerpo de alta de curva (`POST /api/curvas-talla`). */
export type CurvaCrear =
  paths['/api/curvas-talla']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de curva (`PATCH /api/curvas-talla/{id}`). */
export type CurvaEditar =
  paths['/api/curvas-talla/{id}']['patch']['requestBody']['content']['application/json'];

// PIEZA C — Clientes (D7) + campos de referencia.

/** Pagina de clientes (`GET /api/clientes`). */
export type ClientesPagina =
  paths['/api/clientes']['get']['responses']['200']['content']['application/json'];
/** Un cliente tal como lo devuelve el API (con sus campos de referencia). */
export type Cliente = ClientesPagina['datos'][number];
/** Parametros de consulta del listado de clientes (querystring). */
export type ClientesQuery = NonNullable<paths['/api/clientes']['get']['parameters']['query']>;
/** Cuerpo de alta de cliente (`POST /api/clientes`). */
export type ClienteCrear =
  paths['/api/clientes']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de cliente (`PATCH /api/clientes/{id}`). */
export type ClienteEditar =
  paths['/api/clientes/{id}']['patch']['requestBody']['content']['application/json'];

/** Lista de campos de referencia de un cliente (`GET /api/clientes/{id}/campos`). */
export type ClienteCamposLista =
  paths['/api/clientes/{id}/campos']['get']['responses']['200']['content']['application/json'];
/** Un campo de referencia de un cliente (D7). */
export type ClienteCampo = ClienteCamposLista['datos'][number];
/** Tipo de dato de un campo de referencia (TEXTO/NUMERO/FECHA). */
export type TipoCampoCliente = ClienteCampo['tipo'];
/** Cuerpo de alta de un campo de referencia (`POST /api/clientes/{id}/campos`). */
export type ClienteCampoCrear =
  paths['/api/clientes/{id}/campos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de un campo de referencia (`PATCH /api/clientes/{id}/campos/{idCampo}`). */
export type ClienteCampoEditar =
  paths['/api/clientes/{id}/campos/{idCampo}']['patch']['requestBody']['content']['application/json'];

// ── Pedidos (Modulo PEDIDOS, F2-E1) — pedido interno + pedido real ────────────

/** Pagina de pedidos internos (`GET /api/pedidos`). */
export type PedidosPagina =
  paths['/api/pedidos']['get']['responses']['200']['content']['application/json'];
/** Un pedido interno tal como lo devuelve el API (con sus renglones). */
export type Pedido = PedidosPagina['datos'][number];
/** Un renglon de un pedido interno. */
export type PedidoLinea = Pedido['lineas'][number];
/** Parametros de consulta del listado de pedidos (querystring). */
export type PedidosQuery = NonNullable<paths['/api/pedidos']['get']['parameters']['query']>;
/** Cuerpo de alta de pedido (`POST /api/pedidos`). */
export type PedidoCrear =
  paths['/api/pedidos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de pedido (`PATCH /api/pedidos/{id}`). */
export type PedidoEditar =
  paths['/api/pedidos/{id}']['patch']['requestBody']['content']['application/json'];
/** Un renglon de captura de pedido (modelo + cantidad + precio). */
export type PedidoLineaEntrada = NonNullable<PedidoCrear['lineas']>[number];
/** Cuerpo de copiar un pedido (`POST /api/pedidos/{id}/copiar`). */
export type PedidoCopiar =
  paths['/api/pedidos/{id}/copiar']['post']['requestBody']['content']['application/json'];

/** Lista de pedidos reales de un pedido (`GET /api/pedidos/{id}/reales`). */
export type PedidoRealesLista =
  paths['/api/pedidos/{id}/reales']['get']['responses']['200']['content']['application/json'];
/** Un pedido real (liberacion del cliente) con su detalle. */
export type PedidoReal = PedidoRealesLista['datos'][number];
/** Un renglon de un pedido real. */
export type PedidoRealLinea = PedidoReal['lineas'][number];
/** Cuerpo de alta de un pedido real (`POST /api/pedidos/{id}/reales`). */
export type PedidoRealCrear =
  paths['/api/pedidos/{id}/reales']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion del encabezado de un pedido real (`PATCH /api/pedidos-reales/{idReal}`). */
export type PedidoRealEditar =
  paths['/api/pedidos-reales/{idReal}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo del seguimiento por renglon (`PATCH /api/pedidos-reales/{idReal}/seguimiento`). */
export type PedidoRealSeguimiento =
  paths['/api/pedidos-reales/{idReal}/seguimiento']['patch']['requestBody']['content']['application/json'];

// ── Ordenes (Modulo PRODUCCION, F2-E2/E3) — orden de produccion + matriz ──────

/** Pagina de ordenes (`GET /api/ordenes`). */
export type OrdenesPagina =
  paths['/api/ordenes']['get']['responses']['200']['content']['application/json'];
/** Una orden de produccion completa tal como la devuelve el API. */
export type Orden = OrdenesPagina['datos'][number];
/** Un renglon de la matriz (un color con sus tallas). */
export type OrdenLinea = Orden['lineas'][number];
/** Una talla con su cantidad dentro de un renglon de la matriz. */
export type OrdenTalla = OrdenLinea['tallas'][number];
/** Un valor de referencia D7 de la orden. */
export type OrdenReferencia = Orden['referencias'][number];
/** Un comentario (inmutable) de la orden. */
export type OrdenComentario = Orden['comentarios'][number];
/** Estado DERIVADO de la orden (capturada/completa/cancelada). */
export type EstadoOrden = Orden['estado'];
/** Parametros de consulta del listado de ordenes (querystring). */
export type OrdenesQuery = NonNullable<paths['/api/ordenes']['get']['parameters']['query']>;
/** Cuerpo de alta de orden (`POST /api/ordenes`). */
export type OrdenCrear =
  paths['/api/ordenes']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion del encabezado (`PATCH /api/ordenes/{id}`). */
export type OrdenEditar =
  paths['/api/ordenes/{id}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo del set COMPLETO de la matriz (`PUT /api/ordenes/{id}/matriz`). */
export type OrdenMatriz =
  paths['/api/ordenes/{id}/matriz']['put']['requestBody']['content']['application/json'];
/** Un renglon de captura de la matriz (color con sus tallas/cantidades). */
export type OrdenMatrizLinea = OrdenMatriz['lineas'][number];
/** Cuerpo de copiar la matriz de otra orden (`POST /api/ordenes/{id}/copiar-matriz`). */
export type OrdenCopiarMatriz =
  paths['/api/ordenes/{id}/copiar-matriz']['post']['requestBody']['content']['application/json'];
/** Cuerpo de cancelacion de orden (`POST /api/ordenes/{id}/cancelar`). */
export type OrdenCancelar =
  paths['/api/ordenes/{id}/cancelar']['post']['requestBody']['content']['application/json'];
/** Cuerpo del set COMPLETO de referencias D7 (`PUT /api/ordenes/{id}/referencias`). */
export type OrdenReferencias =
  paths['/api/ordenes/{id}/referencias']['put']['requestBody']['content']['application/json'];
/** Cuerpo de alta de un comentario (`POST /api/ordenes/{id}/comentarios`). */
export type OrdenComentarioCrear =
  paths['/api/ordenes/{id}/comentarios']['post']['requestBody']['content']['application/json'];

// ── Consultas/tableros/busqueda de Ordenes (F2-E4) ─────────────────────────────

/** Pagina de la CONSULTA ligera de ordenes (`GET /api/ordenes/consulta`). */
export type OrdenesConsultaPagina =
  paths['/api/ordenes/consulta']['get']['responses']['200']['content']['application/json'];
/** Una orden en proyeccion LIGERA (para tablas de consulta). */
export type OrdenLigera = OrdenesConsultaPagina['datos'][number];
/** Parametros de la consulta ligera (querystring). */
export type OrdenesConsultaQuery = NonNullable<
  paths['/api/ordenes/consulta']['get']['parameters']['query']
>;

/** Pagina de ordenes INCOMPLETAS (`GET /api/ordenes/incompletas`). */
export type OrdenesIncompletasPagina =
  paths['/api/ordenes/incompletas']['get']['responses']['200']['content']['application/json'];
/** Una orden incompleta (con antiguedad + semaforo derivado). */
export type OrdenIncompleta = OrdenesIncompletasPagina['datos'][number];
/** Semaforo de antiguedad de una orden incompleta (verde/amarillo/urgente). */
export type SemaforoOrden = OrdenIncompleta['semaforo'];
/** Parametros del listado de incompletas (querystring). */
export type OrdenesIncompletasQuery = NonNullable<
  paths['/api/ordenes/incompletas']['get']['parameters']['query']
>;

/** Tablero "pedidos por mes" (`GET /api/ordenes/tablero/pedidos-por-mes`). */
export type TableroPedidosMes =
  paths['/api/ordenes/tablero/pedidos-por-mes']['get']['responses']['200']['content']['application/json'];
/** Una fila del tablero (un mes con sus metricas). */
export type TableroPedidosMesFila = TableroPedidosMes['filas'][number];
/** Parametros del tablero (querystring). */
export type TableroPedidosMesQuery = NonNullable<
  paths['/api/ordenes/tablero/pedidos-por-mes']['get']['parameters']['query']
>;

/** Resultados del buscador global de ordenes (`GET /api/ordenes/buscar`). */
export type OrdenesBuscar =
  paths['/api/ordenes/buscar']['get']['responses']['200']['content']['application/json'];
/** Un hit ligero del buscador global. */
export type OrdenHit = OrdenesBuscar['datos'][number];

// ── Órdenes de compra (Módulo 4 · Compras, F4-E2) ─────────────────────────────

/** Página de órdenes de compra (`GET /api/ordenes-compra`). */
export type OrdenesCompraPagina =
  paths['/api/ordenes-compra']['get']['responses']['200']['content']['application/json'];
/** Una orden de compra completa tal como la devuelve el API (encabezado + líneas + total). */
export type OrdenCompra = OrdenesCompraPagina['datos'][number];
/** Un renglón de una orden de compra (material + cantidad + precio + matriz opcional). */
export type OrdenCompraLinea = OrdenCompra['lineas'][number];
/** Una celda talla×color de un renglón de OC. */
export type OrdenCompraLineaTalla = OrdenCompraLinea['tallas'][number];
/** Una orden de producción ligada a la OC (encabezado). */
export type OrdenCompraOrdenLigada = OrdenCompra['ordenesLigadas'][number];
/** Estatus de la OC (controlado por los servicios del backend). */
export type EstatusOrdenCompra = OrdenCompra['estatus'];
/** Parámetros de consulta del listado de OC (querystring). */
export type OrdenesCompraQuery = NonNullable<
  paths['/api/ordenes-compra']['get']['parameters']['query']
>;
/** Cuerpo de alta de OC (`POST /api/ordenes-compra`). */
export type OrdenCompraCrear =
  paths['/api/ordenes-compra']['post']['requestBody']['content']['application/json'];
/** Un renglón de captura de la OC (material + cantidad + precio + matriz opcional). */
export type OrdenCompraLineaEntrada = NonNullable<OrdenCompraCrear['lineas']>[number];
/** Cuerpo de edición de OC (`PATCH /api/ordenes-compra/{id}`; las líneas reemplazan al set). */
export type OrdenCompraEditar =
  paths['/api/ordenes-compra/{id}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo de cancelación de OC (`POST /api/ordenes-compra/{id}/cancelar`). */
export type OrdenCompraCancelar =
  paths['/api/ordenes-compra/{id}/cancelar']['post']['requestBody']['content']['application/json'];

// ── Recepción de compras (Módulo 3 · Compras, F4-E3) ──────────────────────────

/** Lista de recepciones de una OC (`GET /api/ordenes-compra/{idOrdenCompra}/recepciones`). */
export type RecepcionesLista =
  paths['/api/ordenes-compra/{idOrdenCompra}/recepciones']['get']['responses']['200']['content']['application/json'];
/** Una recepción de compra (encabezado + renglones recibidos). */
export type Recepcion = RecepcionesLista['recepciones'][number];
/** Un renglón recibido de una recepción (material + cantidad + lote/movimiento). */
export type RecepcionLinea = Recepcion['lineas'][number];
/** Cuerpo de alta de una recepción (`POST /api/ordenes-compra/{idOrdenCompra}/recepciones`). */
export type RecepcionCrear =
  paths['/api/ordenes-compra/{idOrdenCompra}/recepciones']['post']['requestBody']['content']['application/json'];
/** Un renglón de captura de la recepción (renglón de OC + cantidad + lote opcional). */
export type RecepcionLineaEntrada = NonNullable<RecepcionCrear['lineas']>[number];
/** Lote a capturar en una línea de tela de la recepción (color + componentes, D5). */
export type RecepcionLoteEntrada = NonNullable<RecepcionLineaEntrada['lote']>;
/** Cuerpo del reverso de una recepción (`POST /api/recepciones-compra/{id}/reversar`). */
export type RecepcionReversar =
  paths['/api/recepciones-compra/{id}/reversar']['post']['requestBody']['content']['application/json'];

// ── Administracion F1-E1: Usuarios ────────────────────────────────────────────
// OJO: lista PAGINADA (`{datos,total,...}`) e `id` = string (cuid). Todas las
// rutas exigen `usuarios.administrar` (no existe `usuarios.ver`).

/** Pagina de usuarios (`GET /api/usuarios`). */
export type UsuariosPagina =
  paths['/api/usuarios']['get']['responses']['200']['content']['application/json'];
/** Un usuario tal como lo devuelve el API (con sus roles). */
export type Usuario = UsuariosPagina['datos'][number];
/** Parametros de consulta del listado de usuarios (querystring). */
export type UsuariosQuery = NonNullable<paths['/api/usuarios']['get']['parameters']['query']>;
/** Cuerpo de alta de usuario (`POST /api/usuarios`). */
export type UsuarioCrear =
  paths['/api/usuarios']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de usuario (`PATCH /api/usuarios/{id}`). */
export type UsuarioEditar =
  paths['/api/usuarios/{id}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo de reemplazo de roles (`POST /api/usuarios/{id}/roles`). */
export type UsuarioAsignarRoles =
  paths['/api/usuarios/{id}/roles']['post']['requestBody']['content']['application/json'];
/** Cuerpo de cambio de contraseña (`POST /api/usuarios/{id}/contrasena`). */
export type UsuarioContrasena =
  paths['/api/usuarios/{id}/contrasena']['post']['requestBody']['content']['application/json'];

// ── Administracion F1-E1: Roles (solo lectura para el selector) ────────────────

/** Lista de roles (`GET /api/roles`) — array plano, sin paginacion. */
export type RolesLista =
  paths['/api/roles']['get']['responses']['200']['content']['application/json'];
/** Un rol tal como lo devuelve el API. */
export type Rol = RolesLista[number];

// ── Administracion F1-E1: Empresas ────────────────────────────────────────────
// OJO: lista SIN paginacion (array plano, favorita primero), `id` = int y el flag
// se llama `activa` (femenino). Todas las rutas exigen `empresas.administrar`.

/** Lista de empresas (`GET /api/empresas`) — array plano (favorita primero). */
export type EmpresasLista =
  paths['/api/empresas']['get']['responses']['200']['content']['application/json'];
/** Una empresa tal como la devuelve el API. */
export type Empresa = EmpresasLista[number];
/** Cuerpo de alta de empresa (`POST /api/empresas`). */
export type EmpresaCrear =
  paths['/api/empresas']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de empresa (`PATCH /api/empresas/{id}`). */
export type EmpresaEditar =
  paths['/api/empresas/{id}']['patch']['requestBody']['content']['application/json'];
/** Configuracion por empresa (`GET /api/empresas/{id}/configuracion`). */
export type EmpresaConfiguracion =
  paths['/api/empresas/{id}/configuracion']['get']['responses']['200']['content']['application/json'];
/** Cuerpo de edicion de la configuracion (`PATCH /api/empresas/{id}/configuracion`). */
export type EmpresaConfiguracionEditar =
  paths['/api/empresas/{id}/configuracion']['patch']['requestBody']['content']['application/json'];

// ── Tipos de proceso de maquila (Módulo 4, F3-E1; CRUD patrón Almacenes) ─────

/** Pagina de tipos de proceso (`GET /api/tipos-proceso`). */
export type TiposProcesoPagina =
  paths['/api/tipos-proceso']['get']['responses']['200']['content']['application/json'];
/** Un tipo de proceso tal como lo devuelve el API. */
export type TipoProceso = TiposProcesoPagina['datos'][number];
/** Parametros de consulta del listado de tipos de proceso (querystring). */
export type TiposProcesoQuery = NonNullable<
  paths['/api/tipos-proceso']['get']['parameters']['query']
>;
/** Cuerpo de alta de tipo de proceso (`POST /api/tipos-proceso`). */
export type TipoProcesoCrear =
  paths['/api/tipos-proceso']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de tipo de proceso (`PATCH /api/tipos-proceso/{id}`). */
export type TipoProcesoEditar =
  paths['/api/tipos-proceso/{id}']['patch']['requestBody']['content']['application/json'];

// ── Tipos de movimiento de inventario (Módulo 6, F3-E1; solo lectura) ────────

/** Lista de tipos de movimiento de inventario (`GET /api/tipos-movimiento`). */
export type TiposMovimientoLista =
  paths['/api/tipos-movimiento']['get']['responses']['200']['content']['application/json'];
/** Un tipo de movimiento de inventario del catalogo. */
export type TipoMovimiento = TiposMovimientoLista['datos'][number];

// ── Etapas de producción: corte + envío a maquila (F3-E2) ────────────────────

/** Una etapa de producción (corte/envío) tal como la devuelve el API. */
export type Etapa =
  paths['/api/produccion/cortes']['post']['responses']['201']['content']['application/json'];
/** Cuerpo de alta de un corte (`POST /api/produccion/cortes`). */
export type CorteCrear =
  paths['/api/produccion/cortes']['post']['requestBody']['content']['application/json'];
/** Cuerpo de alta de un envío a maquila (`POST /api/produccion/envios`). */
export type EnvioCrear =
  paths['/api/produccion/envios']['post']['requestBody']['content']['application/json'];
/** Cuerpo de cancelación de una etapa (`POST /api/produccion/{cortes|envios}/{id}/cancelar`). */
export type EtapaCancelar =
  paths['/api/produccion/cortes/{id}/cancelar']['post']['requestBody']['content']['application/json'];
/** Pendientes derivados de una orden (`GET /api/produccion/ordenes/{id}/pendientes`). */
export type PendientesOrden =
  paths['/api/produccion/ordenes/{id}/pendientes']['get']['responses']['200']['content']['application/json'];
/** Historial de etapas (cortes/envíos) de una orden (`GET /api/produccion/ordenes/{id}/etapas`). */
export type EtapasOrden =
  paths['/api/produccion/ordenes/{id}/etapas']['get']['responses']['200']['content']['application/json'];
/** Una etapa del historial de una orden (corte o envío, viva o cancelada). */
export type EtapaHistorial = EtapasOrden['etapas'][number];
/** Corte semanal por cortador (`GET /api/produccion/corte-semanal`). */
export type CorteSemanal =
  paths['/api/produccion/corte-semanal']['get']['responses']['200']['content']['application/json'];
/** Parámetros del corte semanal (querystring). */
export type CorteSemanalQuery = NonNullable<
  paths['/api/produccion/corte-semanal']['get']['parameters']['query']
>;

// ── Inventario PT operable: movimientos, traspasos, existencias y kardex (F3-E3) ──────

/** Un movimiento de inventario PT tal como lo devuelve el API (con su matriz color×talla). */
export type MovimientoPt =
  paths['/api/inventarios/pt/movimientos']['post']['responses']['201']['content']['application/json'];
/** Cuerpo de alta de un movimiento manual (`POST /api/inventarios/pt/movimientos`). */
export type MovimientoPtCrear =
  paths['/api/inventarios/pt/movimientos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de alta de un traspaso entre almacenes (`POST /api/inventarios/pt/traspasos`). */
export type TraspasoPtCrear =
  paths['/api/inventarios/pt/traspasos']['post']['requestBody']['content']['application/json'];
/** Resultado de un traspaso: las dos patas creadas (salida + entrada). */
export type TraspasoPt =
  paths['/api/inventarios/pt/traspasos']['post']['responses']['201']['content']['application/json'];
/** Cuerpo de cancelación de un movimiento (`POST /api/inventarios/pt/movimientos/{id}/cancelar`). */
export type MovimientoPtCancelar =
  paths['/api/inventarios/pt/movimientos/{id}/cancelar']['post']['requestBody']['content']['application/json'];
/** Existencias de PT (`GET /api/inventarios/pt/existencias`). */
export type ExistenciasPt =
  paths['/api/inventarios/pt/existencias']['get']['responses']['200']['content']['application/json'];
/** Una fila de existencia (un artículo en un almacén con su cantidad). */
export type ExistenciaPtFila = ExistenciasPt['filas'][number];
/** Parámetros de la consulta de existencias (querystring). */
export type ExistenciasPtQuery = NonNullable<
  paths['/api/inventarios/pt/existencias']['get']['parameters']['query']
>;
/** Kardex de un modelo (`GET /api/inventarios/pt/kardex`). */
export type KardexPt =
  paths['/api/inventarios/pt/kardex']['get']['responses']['200']['content']['application/json'];
/** Un renglón del kardex (un movimiento con su efecto + saldo corrido). */
export type KardexPtRenglon = KardexPt['renglones'][number];
/** Parámetros del kardex por modelo (querystring). */
export type KardexPtQuery = NonNullable<
  paths['/api/inventarios/pt/kardex']['get']['parameters']['query']
>;

// ── Inventario de TELAS por kardex (Módulo 4, F4-E1; tela×lote, D5) ───────────

/** Un movimiento de inventario de tela tal como lo devuelve el API. */
export type MovimientoTela =
  paths['/api/inventarios/telas/ajustes']['post']['responses']['201']['content']['application/json'];
/** Cuerpo de un ajuste de tela (`POST /api/inventarios/telas/ajustes`). */
export type AjusteTelaCrear =
  paths['/api/inventarios/telas/ajustes']['post']['requestBody']['content']['application/json'];
/** Cuerpo de una salida de tela a orden (`POST /api/inventarios/telas/salidas-orden`). */
export type SalidaTelaCrear =
  paths['/api/inventarios/telas/salidas-orden']['post']['requestBody']['content']['application/json'];
/** Cuerpo de un traspaso de tela (`POST /api/inventarios/telas/traspasos`). */
export type TraspasoTelaCrear =
  paths['/api/inventarios/telas/traspasos']['post']['requestBody']['content']['application/json'];
/** Resultado de un traspaso de tela: las dos patas. */
export type TraspasoTela =
  paths['/api/inventarios/telas/traspasos']['post']['responses']['201']['content']['application/json'];
/** Cuerpo de cancelación de un movimiento de material (compartido tela/avío). */
export type MovimientoMaterialCancelar =
  paths['/api/inventarios/telas/movimientos/{id}/cancelar']['post']['requestBody']['content']['application/json'];
/** Existencias de tela (`GET /api/inventarios/telas/existencias`). */
export type ExistenciasTela =
  paths['/api/inventarios/telas/existencias']['get']['responses']['200']['content']['application/json'];
/** Una fila de existencia de tela (tela×lote×almacén + componentes del lote). */
export type ExistenciaTelaFila = ExistenciasTela['filas'][number];
/** Parámetros de la consulta de existencias de tela (querystring). */
export type ExistenciasTelaQuery = NonNullable<
  paths['/api/inventarios/telas/existencias']['get']['parameters']['query']
>;
/** Kardex de una tela (`GET /api/inventarios/telas/kardex`). */
export type KardexTela =
  paths['/api/inventarios/telas/kardex']['get']['responses']['200']['content']['application/json'];
/** Un renglón del kardex de tela. */
export type KardexTelaRenglon = KardexTela['renglones'][number];
/** Parámetros del kardex de tela (querystring). */
export type KardexTelaQuery = NonNullable<
  paths['/api/inventarios/telas/kardex']['get']['parameters']['query']
>;

// ── Inventario de AVÍOS por kardex (Módulo 4, F4-E1; multi-almacén, R4) ───────

/** Un movimiento de inventario de avío tal como lo devuelve el API. */
export type MovimientoAvio =
  paths['/api/inventarios/avios/ajustes']['post']['responses']['201']['content']['application/json'];
/** Cuerpo de un ajuste de avío (`POST /api/inventarios/avios/ajustes`). */
export type AjusteAvioCrear =
  paths['/api/inventarios/avios/ajustes']['post']['requestBody']['content']['application/json'];
/** Cuerpo de un traspaso de avío (`POST /api/inventarios/avios/traspasos`). */
export type TraspasoAvioCrear =
  paths['/api/inventarios/avios/traspasos']['post']['requestBody']['content']['application/json'];
/** Resultado de un traspaso de avío: las dos patas. */
export type TraspasoAvio =
  paths['/api/inventarios/avios/traspasos']['post']['responses']['201']['content']['application/json'];
/** Existencias de avío (`GET /api/inventarios/avios/existencias`). */
export type ExistenciasAvio =
  paths['/api/inventarios/avios/existencias']['get']['responses']['200']['content']['application/json'];
/** Una fila de existencia de avío (avío×almacén). */
export type ExistenciaAvioFila = ExistenciasAvio['filas'][number];
/** Parámetros de la consulta de existencias de avío (querystring). */
export type ExistenciasAvioQuery = NonNullable<
  paths['/api/inventarios/avios/existencias']['get']['parameters']['query']
>;
/** Kardex de un avío (`GET /api/inventarios/avios/kardex`). */
export type KardexAvio =
  paths['/api/inventarios/avios/kardex']['get']['responses']['200']['content']['application/json'];
/** Un renglón del kardex de avío. */
export type KardexAvioRenglon = KardexAvio['renglones'][number];
/** Parámetros del kardex de avío (querystring). */
export type KardexAvioQuery = NonNullable<
  paths['/api/inventarios/avios/kardex']['get']['parameters']['query']
>;

// ── Recibo de maquila + cargos EsMa (F3-E4) ──────────────────────────────────

/** Un recibo de maquila tal como lo devuelve el API (con su matriz color×talla y calidad). */
export type Recibo =
  paths['/api/produccion/recibos']['post']['responses']['201']['content']['application/json'];
/** Cuerpo de alta de un recibo (`POST /api/produccion/recibos`). */
export type ReciboCrear =
  paths['/api/produccion/recibos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de cancelación de un recibo (`POST /api/produccion/recibos/{id}/cancelar`). */
export type ReciboCancelar =
  paths['/api/produccion/recibos/{id}/cancelar']['post']['requestBody']['content']['application/json'];
/** Pendientes por recibir de una orden (`GET /api/produccion/ordenes/{id}/pendientes-recibir`). */
export type PendientesRecibir =
  paths['/api/produccion/ordenes/{id}/pendientes-recibir']['get']['responses']['200']['content']['application/json'];
/** Recibos semanales por maquilero (`GET /api/produccion/recibos-semanales`). */
export type RecibosSemanales =
  paths['/api/produccion/recibos-semanales']['get']['responses']['200']['content']['application/json'];
/** Parámetros de los recibos semanales (querystring). */
export type RecibosSemanalesQuery = NonNullable<
  paths['/api/produccion/recibos-semanales']['get']['parameters']['query']
>;
/** Un cargo EsMa (cuenta de maquila) tal como lo devuelve el API. */
export type CargoEsMa =
  paths['/api/esma/cargos/{id}']['get']['responses']['200']['content']['application/json'];
/** Cola de cargos EsMa por estado (`GET /api/esma/cargos`). */
export type CargosEsMa =
  paths['/api/esma/cargos']['get']['responses']['200']['content']['application/json'];
/** Una fila de la cola de cargos EsMa. */
export type CargoEsMaFila = CargosEsMa['filas'][number];
/** Parámetros de la cola de cargos EsMa (querystring). */
export type CargosEsMaQuery = NonNullable<paths['/api/esma/cargos']['get']['parameters']['query']>;
/** Cuerpo de validación de un cargo EsMa (`POST /api/esma/cargos/{id}/validar`). */
export type CargoEsMaValidar =
  paths['/api/esma/cargos/{id}/validar']['post']['requestBody']['content']['application/json'];

// ── Entrega a cliente (F3-E5) — cierre del ciclo de la orden ──────────────────

/** Una entrega a cliente tal como la devuelve el API (con su matriz color×talla). */
export type EntregaCliente =
  paths['/api/produccion/entregas-cliente']['post']['responses']['201']['content']['application/json'];
/** Cuerpo de alta de una entrega (`POST /api/produccion/entregas-cliente`). */
export type EntregaClienteCrear =
  paths['/api/produccion/entregas-cliente']['post']['requestBody']['content']['application/json'];
/** Cuerpo de cancelación de una entrega (`POST /api/produccion/entregas-cliente/{id}/cancelar`). */
export type EntregaClienteCancelar =
  paths['/api/produccion/entregas-cliente/{id}/cancelar']['post']['requestBody']['content']['application/json'];
/** Historial de entregas de una orden (`GET /api/produccion/ordenes/{id}/entregas`). */
export type EntregasOrden =
  paths['/api/produccion/ordenes/{id}/entregas']['get']['responses']['200']['content']['application/json'];
/** Una entrega del historial de una orden (viva o cancelada). */
export type EntregaHistorial = EntregasOrden['entregas'][number];
/** Seguimiento derivado de la entrega de una orden (`GET .../seguimiento-entrega`). */
export type SeguimientoEntrega =
  paths['/api/produccion/ordenes/{id}/seguimiento-entrega']['get']['responses']['200']['content']['application/json'];
/** Una celda del seguimiento (pedido/entregado/faltante/disponible). */
export type SeguimientoEntregaCelda = SeguimientoEntrega['celdas'][number];
/** Parámetros del seguimiento de entrega (querystring). */
export type SeguimientoEntregaQuery = NonNullable<
  paths['/api/produccion/ordenes/{id}/seguimiento-entrega']['get']['parameters']['query']
>;

// ── Tablero WIP + existencias en poder del maquilero (F3-E5) ──────────────────

/** Tablero WIP: órdenes con su avance derivado (`GET /api/produccion/wip`). */
export type TableroWip =
  paths['/api/produccion/wip']['get']['responses']['200']['content']['application/json'];
/** Una fila del tablero WIP (una orden con su avance por etapa). */
export type WipOrdenFila = TableroWip['datos'][number];
/** Parámetros del tablero WIP (querystring). */
export type TableroWipQuery = NonNullable<
  paths['/api/produccion/wip']['get']['parameters']['query']
>;
/** Drill-down del avance de una orden (`GET /api/produccion/wip/ordenes/{id}`). */
export type WipOrden =
  paths['/api/produccion/wip/ordenes/{id}']['get']['responses']['200']['content']['application/json'];
/** Una celda color×talla del drill-down WIP. */
export type WipCelda = WipOrden['porCortar'][number];
/** Un proceso pendiente del drill-down (cortado por enviar / por recibir). */
export type WipProcesoPendiente = WipOrden['cortadoPorEnviar'][number];
/** Existencias en poder del maquilero (`GET /api/produccion/existencias-maquilero`). */
export type ExistenciaMaquilero =
  paths['/api/produccion/existencias-maquilero']['get']['responses']['200']['content']['application/json'];
/** Una fila de existencia en poder del maquilero (enviado − recibido). */
export type ExistenciaMaquileroFila = ExistenciaMaquilero['filas'][number];
/** Parámetros de las existencias en poder del maquilero (querystring). */
export type ExistenciaMaquileroQuery = NonNullable<
  paths['/api/produccion/existencias-maquilero']['get']['parameters']['query']
>;
