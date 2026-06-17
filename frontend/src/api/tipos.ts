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
