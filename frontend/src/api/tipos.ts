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

// ── Resumen operativo de la portada (rediseño R9, proto vResumen) ─────────────

/** Respuesta de `GET /api/resumen`: cada bloque llega null si la sesion no tiene su permiso. */
export type ResumenOperativo =
  paths['/api/resumen']['get']['responses']['200']['content']['application/json'];

/** Una orden por vencer (fila de la tabla del Resumen). */
export type OrdenPorVencer = NonNullable<ResumenOperativo['ordenesPorVencer']>[number];

/** Un punto de la grafica "Cortes por semana". */
export type CorteSemanaResumen = NonNullable<ResumenOperativo['cortesPorSemana']>[number];

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

// ── Auditores (catalogo de calidad, rediseño R9 — mismo patron que Almacenes) ─

/** Pagina de auditores (`GET /api/calidad/auditores`). */
export type AuditoresPagina =
  paths['/api/calidad/auditores']['get']['responses']['200']['content']['application/json'];

/** Un auditor tal como lo devuelve el API (incluye `numeroAuditorias` derivado). */
export type Auditor = AuditoresPagina['datos'][number];

/** Parametros de consulta del listado de auditores (querystring). */
export type AuditoresQuery = NonNullable<
  paths['/api/calidad/auditores']['get']['parameters']['query']
>;

/** Cuerpo de alta de auditor (`POST /api/calidad/auditores`). */
export type AuditorCrear =
  paths['/api/calidad/auditores']['post']['requestBody']['content']['application/json'];

/** Cuerpo de edicion de auditor (`PATCH /api/calidad/auditores/{id}`). */
export type AuditorEditar =
  paths['/api/calidad/auditores/{id}']['patch']['requestBody']['content']['application/json'];

// ── Catalogos F1-E1 (mismo patron que Almacenes) ─────────────────────────────

/** Pagina de proveedores (`GET /api/proveedores`). */
export type ProveedoresPagina =
  paths['/api/proveedores']['get']['responses']['200']['content']['application/json'];
/** Un proveedor tal como lo devuelve el API. */
export type Proveedor = ProveedoresPagina['datos'][number];
/** Parametros de consulta del listado de proveedores (querystring). */
export type ProveedoresQuery = NonNullable<paths['/api/proveedores']['get']['parameters']['query']>;
/** Un CONTACTO del proveedor (V1-E3f pieza B, §Post-F9.56 punto 1). */
export type ProveedorContacto = Proveedor['contactos'][number];
/** Cuerpo de alta de un contacto (`POST /api/proveedores/{id}/contactos`). */
export type ProveedorContactoCrear =
  paths['/api/proveedores/{id}/contactos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de un contacto (`PATCH /api/proveedores/{id}/contactos/{idContacto}`). */
export type ProveedorContactoEditar =
  paths['/api/proveedores/{id}/contactos/{idContacto}']['patch']['requestBody']['content']['application/json'];
/** Datos que PROPONE la Constancia de Situacion Fiscal (`POST /api/proveedores/constancia/analizar`). */
export type ConstanciaPropuesta =
  paths['/api/proveedores/constancia/analizar']['post']['responses']['200']['content']['application/json'];
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

/** Avíos que surte un proveedor (B17, `GET /api/proveedores/{id}/avios`). */
export type ProveedorAviosLista =
  paths['/api/proveedores/{id}/avios']['get']['responses']['200']['content']['application/json'];
/** Un avío que surte el proveedor (con su precio y condiciones). */
export type ProveedorAvio = ProveedorAviosLista['datos'][number];
/** Cuerpo para asignar un avío que surte el proveedor (`POST /api/proveedores/{id}/avios`). */
export type ProveedorAvioAsignar =
  paths['/api/proveedores/{id}/avios']['post']['requestBody']['content']['application/json'];

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

/** Pagina de direcciones de entrega (`GET /api/compras/direcciones-entrega`, §Post-F9.18). */
export type DireccionesEntregaPagina =
  paths['/api/compras/direcciones-entrega']['get']['responses']['200']['content']['application/json'];
/** Una direccion de entrega tal como la devuelve el API. */
export type DireccionEntrega = DireccionesEntregaPagina['datos'][number];
/** Parametros de consulta del listado de direcciones de entrega (querystring). */
export type DireccionesEntregaQuery = NonNullable<
  paths['/api/compras/direcciones-entrega']['get']['parameters']['query']
>;
/** Cuerpo de alta de direccion de entrega. */
export type DireccionEntregaCrear =
  paths['/api/compras/direcciones-entrega']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de direccion de entrega. */
export type DireccionEntregaEditar =
  paths['/api/compras/direcciones-entrega/{id}']['patch']['requestBody']['content']['application/json'];

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

/** Lista de departamentos de un cliente (`GET /api/clientes/{idCliente}/departamentos`, D13/R16). */
export type ClienteDepartamentosLista =
  paths['/api/clientes/{idCliente}/departamentos']['get']['responses']['200']['content']['application/json'];
/** Un departamento de un cliente (D13/R16). */
export type ClienteDepartamento = ClienteDepartamentosLista['datos'][number];
/** Cuerpo de alta de un departamento (`POST /api/clientes/{idCliente}/departamentos`). */
export type ClienteDepartamentoCrear =
  paths['/api/clientes/{idCliente}/departamentos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion de un departamento (`PATCH /api/clientes/{idCliente}/departamentos/{id}`). */
export type ClienteDepartamentoEditar =
  paths['/api/clientes/{idCliente}/departamentos/{id}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo de una FUSION de departamentos duplicados (canonico + absorbidos, §Post-F9.122a). */
export type ClienteDepartamentoFusionar =
  paths['/api/clientes/{idCliente}/departamentos/fusionar']['post']['requestBody']['content']['application/json'];
/** Vista previa de una fusion de departamentos: que se mueve y que pasa con los factores. */
export type FusionDepartamentosPrevia =
  paths['/api/clientes/{idCliente}/departamentos/fusionar/previa']['post']['responses']['200']['content']['application/json'];

/** Lista de CONTACTOS de un cliente (V1-E8y, §Post-F9.152 — la compradora). */
export type ClienteContactosLista =
  paths['/api/clientes/{id}/contactos']['get']['responses']['200']['content']['application/json'];
/** Un contacto del cliente (departamento OPCIONAL: null = atiende al cliente completo). */
export type ClienteContacto = ClienteContactosLista['datos'][number];
/** Cuerpo de alta de un contacto del cliente (`POST /api/clientes/{id}/contactos`). */
export type ClienteContactoCrear =
  paths['/api/clientes/{id}/contactos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edicion/archivado (`PATCH /api/clientes/{id}/contactos/{idContacto}`). */
export type ClienteContactoEditar =
  paths['/api/clientes/{id}/contactos/{idContacto}']['patch']['requestBody']['content']['application/json'];

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

// ── Pedidos por mes + constructor + salida a produccion (rediseño R3, B4/B6) ──

/** Respuesta de la consulta de pedidos por mes (`GET /api/pedidos/por-mes`). */
export type PedidosPorMes =
  paths['/api/pedidos/por-mes']['get']['responses']['200']['content']['application/json'];
/** Fila agrupada (pedido `-F` + renglones) de la consulta por mes. */
export type PedidoMesFila = PedidosPorMes['datos'][number];
/** Renglon/modelo de un pedido en la consulta por mes. */
export type PedidoMesRenglon = PedidoMesFila['renglones'][number];
/** Parametros de la consulta por mes (querystring). */
export type PedidosPorMesQuery = NonNullable<
  paths['/api/pedidos/por-mes']['get']['parameters']['query']
>;
/** Respuesta del selector de desarrollos (`GET /api/pedidos/candidatos-desarrollo`). */
export type CandidatosDesarrollo =
  paths['/api/pedidos/candidatos-desarrollo']['get']['responses']['200']['content']['application/json'];
/** Un desarrollo candidato para un renglon del pedido. */
export type CandidatoDesarrollo = CandidatosDesarrollo['datos'][number];
/** Cuerpo de generar la OP (`POST /api/pedidos/lineas/{idLinea}/salida-produccion`). */
export type SalidaProduccionCuerpo =
  paths['/api/pedidos/lineas/{idLinea}/salida-produccion']['post']['requestBody']['content']['application/json'];
/** Resultado de la salida a produccion (OP + nº de produccion + liga). */
export type SalidaProduccion =
  paths['/api/pedidos/lineas/{idLinea}/salida-produccion']['post']['responses']['201']['content']['application/json'];

// ── Importador del pedido del cliente (rediseño R8, B15 — proto §4.1 "Etapa 3") ──

/** Plantilla de importacion VIGENTE de un cliente (`GET .../importacion/plantillas/{idCliente}`). */
export type PlantillaImportacionVigente =
  paths['/api/pedidos/importacion/plantillas/{idCliente}']['get']['responses']['200']['content']['application/json'];
/** Una plantilla de importacion (mapeo columna→rol, versionada). */
export type PlantillaImportacion = NonNullable<PlantillaImportacionVigente['plantilla']>;
/** Un renglon de mapeo (columna del archivo → rol). */
export type MapeoColumna = PlantillaImportacion['mapeo'][number];
/** Rol de una columna del archivo del cliente (modeloCliente/color/talla/cantidad/precio/ignorar). */
export type RolColumnaImportacion = MapeoColumna['rol'];
/** Cuerpo de guardar (versionar) la plantilla de un cliente (`POST .../plantillas/{idCliente}`). */
export type PlantillaImportacionGuardar =
  paths['/api/pedidos/importacion/plantillas/{idCliente}']['post']['requestBody']['content']['application/json'];
/** Cuerpo de analizar el archivo (`POST .../importacion/analizar`). */
export type AnalizarImportacionCuerpo =
  paths['/api/pedidos/importacion/analizar']['post']['requestBody']['content']['application/json'];
/** Resultado de analizar (columnas + muestras + plantilla vigente + vista previa). */
export type AnalizarImportacion =
  paths['/api/pedidos/importacion/analizar']['post']['responses']['200']['content']['application/json'];
/** La vista previa de la importacion (grupos + totales), o null. */
export type PreviewImportacion = NonNullable<AnalizarImportacion['preview']>;
/** Un grupo (modelo del cliente) de la vista previa. */
export type GrupoImportacion = PreviewImportacion['grupos'][number];
/** Cuerpo de confirmar la importacion (`POST .../importacion/confirmar`). */
export type ConfirmarImportacionCuerpo =
  paths['/api/pedidos/importacion/confirmar']['post']['requestBody']['content']['application/json'];
/** Resultado de confirmar (pedido + OPs creadas + modelos no reconocidos). */
export type ConfirmarImportacion =
  paths['/api/pedidos/importacion/confirmar']['post']['responses']['201']['content']['application/json'];
/** Una OP creada por la importacion. */
export type OrdenImportada = ConfirmarImportacion['ordenes'][number];

// ── Importador de OC del cliente por PDF (peticion Daniel — plantilla C&A) ──

/** Cuerpo de analizar los PDFs del cliente (`POST .../importacion-pdf/analizar`). */
export type AnalizarPdfCuerpo =
  paths['/api/pedidos/importacion-pdf/analizar']['post']['requestBody']['content']['application/json'];
/** Resultado de analizar por PDF (un renglon por PDF + totales). */
export type AnalizarPdf =
  paths['/api/pedidos/importacion-pdf/analizar']['post']['responses']['200']['content']['application/json'];
/** Un renglon de la vista previa (un PDF parseado con su liga sugerida y advertencias). */
export type RenglonPdfPreview = AnalizarPdf['renglones'][number];
/** Cuerpo de confirmar la importacion por PDF (`POST .../importacion-pdf/confirmar`). */
export type ConfirmarPdfCuerpo =
  paths['/api/pedidos/importacion-pdf/confirmar']['post']['requestBody']['content']['application/json'];
/** Resultado de confirmar por PDF (pedido + OPs creadas + PDFs no reconocidos). */
export type ConfirmarPdf =
  paths['/api/pedidos/importacion-pdf/confirmar']['post']['responses']['201']['content']['application/json'];

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
/** Cuerpo de cancelar un pedido (V1-E4 punto 5: opcionalmente arrastra sus OPs). */
export type PedidoCancelarCuerpo =
  paths['/api/pedidos/{id}/cancelar']['post']['requestBody']['content']['application/json'];
/** Cuerpo de cancelar un pedido real (V1-E4 punto 6: motivo obligatorio). */
export type PedidoRealCancelarCuerpo =
  paths['/api/pedidos-reales/{idReal}/cancelar']['post']['requestBody']['content']['application/json'];
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

// ── Centro de comando de Órdenes (rediseño R2, §4.2) ──────────────────────────

/** Página del centro de comando (`GET /api/ordenes/centro`): las 13 columnas del proto. */
export type OrdenesCentroPagina =
  paths['/api/ordenes/centro']['get']['responses']['200']['content']['application/json'];
/** Una fila del centro de comando (agregada en servidor). */
export type OrdenCentro = OrdenesCentroPagina['datos'][number];
/** Parámetros del centro de comando (querystring). */
export type OrdenesCentroQuery = NonNullable<
  paths['/api/ordenes/centro']['get']['parameters']['query']
>;

// ── Precios de la orden con rastro inmutable (rediseño R2, §4.4.3) ─────────────

/** Resumen de precios de la orden (`GET /api/ordenes/{id}/precios`). */
export type OrdenPrecios =
  paths['/api/ordenes/{id}/precios']['get']['responses']['200']['content']['application/json'];
/** Cuerpo de captura del precio real (`PATCH /api/ordenes/{id}/precios`). */
export type OrdenPreciosPatch =
  paths['/api/ordenes/{id}/precios']['patch']['requestBody']['content']['application/json'];
/** Cuál precio de la orden se captura (maquila | aplicacion). */
export type CampoPrecioOrden = OrdenPreciosPatch['campo'];
/** Historial de eventos de precio (`GET /api/ordenes/{id}/precios/eventos`). */
export type OrdenPrecioEventos =
  paths['/api/ordenes/{id}/precios/eventos']['get']['responses']['200']['content']['application/json'];
/** Un evento inmutable del historial de precios. */
export type OrdenPrecioEvento = OrdenPrecioEventos['eventos'][number];

// ── Habilitación / surtido de avíos por orden (rediseño R6, B13; §4.6) ────────

/** Tablero de habilitación de una orden (`GET /api/ordenes/{id}/habilitacion`). */
export type HabilitacionOrden =
  paths['/api/ordenes/{id}/habilitacion']['get']['responses']['200']['content']['application/json'];
/** Un renglón (avío) del tablero de habilitación. */
export type HabilitacionAvio = HabilitacionOrden['avios'][number];
/** Estado de surtido de un avío en la orden. */
export type EstadoHabilitacion = HabilitacionAvio['estado'];

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
/** Cuerpo de DES-AUTORIZAR una OC (V1-E3y, `POST /api/ordenes-compra/{id}/desautorizar`). */
export type OrdenCompraDesautorizar =
  paths['/api/ordenes-compra/{id}/desautorizar']['post']['requestBody']['content']['application/json'];
/** Resumen de cabecera de OC (# OC abiertas + $ por recibir; `GET /api/ordenes-compra/resumen`). */
export type ResumenCompras =
  paths['/api/ordenes-compra/resumen']['get']['responses']['200']['content']['application/json'];
/** Parámetros de consulta del resumen de OC (querystring). */
export type ResumenComprasQuery = NonNullable<
  paths['/api/ordenes-compra/resumen']['get']['parameters']['query']
>;

// ── Notas de salida estructuradas (Módulo 5, F4-E5) ───────────────────────────

/** Página de notas de salida (`GET /api/notas-salida`). */
export type NotasSalidaPagina =
  paths['/api/notas-salida']['get']['responses']['200']['content']['application/json'];
/** Una nota de salida completa tal como la devuelve el API (encabezado + renglones). */
export type NotaSalida = NotasSalidaPagina['datos'][number];
/** Un renglón de una nota de salida (avío o tela/lote, con sus trazas a kardex). */
export type NotaSalidaLinea = NotaSalida['lineas'][number];
/** Estatus de la nota (controlado por los servicios del backend). */
export type EstatusNotaSalida = NotaSalida['estatus'];
/** Parámetros de consulta del listado de notas (querystring). */
export type NotasSalidaQuery = NonNullable<
  paths['/api/notas-salida']['get']['parameters']['query']
>;
/** Cuerpo de alta de nota de salida (`POST /api/notas-salida`). */
export type NotaSalidaCrear =
  paths['/api/notas-salida']['post']['requestBody']['content']['application/json'];
/** Un renglón de captura de la nota (orden destino + material avío XOR tela). */
export type NotaSalidaLineaEntrada = NonNullable<NotaSalidaCrear['lineas']>[number];
/** Cuerpo de edición de nota (`PATCH /api/notas-salida/{id}`; las líneas reemplazan al set). */
export type NotaSalidaEditar =
  paths['/api/notas-salida/{id}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo de cancelación de nota (`POST /api/notas-salida/{id}/cancelar`). */
export type NotaSalidaCancelar =
  paths['/api/notas-salida/{id}/cancelar']['post']['requestBody']['content']['application/json'];
/** Resumen de cabecera de notas (conteos por estatus + órdenes surtidas; KPIs `vNotasSalida`). */
export type ResumenNotas =
  paths['/api/notas-salida/resumen']['get']['responses']['200']['content']['application/json'];
/** Parámetros de consulta del resumen de notas (querystring). */
export type ResumenNotasQuery = NonNullable<
  paths['/api/notas-salida/resumen']['get']['parameters']['query']
>;

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
/** Un renglón de captura de la recepción (renglón de OC + cantidad + color de tela). */
export type RecepcionLineaEntrada = NonNullable<RecepcionCrear['lineas']>[number];
/** Bloque por COLOR de una línea de tela de la recepción (B1: color + complemento + lote prov.). */
export type RecepcionTelaColorEntrada = NonNullable<RecepcionLineaEntrada['telaColor']>;
/** Cuerpo del reverso de una recepción (`POST /api/recepciones-compra/{id}/reversar`). */
export type RecepcionReversar =
  paths['/api/recepciones-compra/{id}/reversar']['post']['requestBody']['content']['application/json'];

// ── Explosión MRP (F4-E4, R3/R7) ──────────────────────────────────────────────

/** Resultado de explosionar una orden (`POST /api/ordenes/{id}/explosion`). */
export type Explosion =
  paths['/api/ordenes/{id}/explosion']['post']['responses']['200']['content']['application/json'];
/** Un grupo de materiales por proveedor sugerido en la explosión. */
export type ExplosionGrupo = Explosion['grupos'][number];
/** Un material requerido (renglón de la explosión). */
export type Requerimiento = ExplosionGrupo['renglones'][number];
/** V1-E3h: un material que la explosión NO trajo porque Desarrollo no lo ha liberado. */
export type PendienteLiberar = Explosion['pendientesLiberar'][number];
/** ⭐ V1-E3q (§Post-F9.86): una de las OP que entraron a la explosión (con su pedido interno). */
export type OrdenExplosionada = Explosion['ordenes'][number];
/** ⭐ V1-E3q: el reparto por OP de un material agrupado ("se ve junto, se guarda repartido"). */
export type RepartoOrden = Requerimiento['porOrden'][number];
/** ⭐ V1-E3q: las OP del mismo pedido interno (`GET /api/ordenes/{id}/del-mismo-pedido`). */
export type OrdenesDelPedido =
  paths['/api/ordenes/{id}/del-mismo-pedido']['get']['responses']['200']['content']['application/json'];
/** Una OP hermana del mismo pedido interno. */
export type OrdenDelPedido = OrdenesDelPedido['ordenes'][number];
/** Cuerpo de generar OC / revisión previa desde la explosión (`POST /api/explosion/...`). */
export type GenerarOcCuerpo =
  paths['/api/explosion/generar-oc']['post']['requestBody']['content']['application/json'];
/** Resultado de generar OC (las OC creadas, una por proveedor, + lo omitido). */
export type GenerarOcResultado =
  paths['/api/explosion/generar-oc']['post']['responses']['201']['content']['application/json'];
/** ⭐⭐ V1-E3q (§Post-F9.85): LA REVISIÓN PREVIA (`POST /api/explosion/previo`). */
export type PlanCompra =
  paths['/api/explosion/previo']['post']['responses']['200']['content']['application/json'];
/** Una OC del plan (la que se crearía para un proveedor). */
export type PlanProveedor = PlanCompra['proveedores'][number];
/** Un material del plan, con su reparto por OP. */
export type PlanRenglon = PlanProveedor['renglones'][number];
/** Un material que se queda FUERA de la compra, con su razón. */
export type OmitidoPlan = PlanCompra['omitidos'][number];
/**
 * ⭐⭐ V1-E8e (§Post-F9.99) — cuerpo de «con esto queda cubierto» / «volver a pedirlo» desde el
 * renglón de la explosión (`PUT /api/explosion/dado-por-cubierto`). La CANTIDAD no viaja: la calcula
 * el servidor (A1) — lo que la pantalla dice es *"esto ya no me lo pidas"*, no un número.
 */
export type DarPorCubiertoCuerpo =
  paths['/api/explosion/dado-por-cubierto']['put']['requestBody']['content']['application/json'];
/** Resultado de dar por cubierto (o de deshacerlo): qué renglones se movieron y por cuánto. */
export type DarPorCubiertoResultado =
  paths['/api/explosion/dado-por-cubierto']['put']['responses']['200']['content']['application/json'];
/**
 * ⭐ V1-E3m (§Post-F9.82) — cuerpo de asignar/quitar el proveedor con el que ESTA orden compra un
 * material (`PUT /api/ordenes/{id}/materiales/proveedor`). `idProveedor: null` = quitar.
 */
export type AsignarProveedorCuerpo =
  paths['/api/ordenes/{id}/materiales/proveedor']['put']['requestBody']['content']['application/json'];
/** Resultado de asignar (o quitar) el proveedor de un material en una orden. */
export type AsignarProveedorResultado =
  paths['/api/ordenes/{id}/materiales/proveedor']['put']['responses']['200']['content']['application/json'];
/**
 * ⭐ V1-E3x (§Post-F9.88) — cuerpo del acto EN BLOQUE: el mismo proveedor a varios renglones de
 * receta (`PUT /api/materiales/proveedor-en-bloque`). Cada asignación nombra SU orden: la
 * asignación vive en la receta de esa orden y NUNCA en el catálogo.
 */
export type AsignarProveedorEnBloqueCuerpo =
  paths['/api/materiales/proveedor-en-bloque']['put']['requestBody']['content']['application/json'];
/** Resultado del acto en bloque (cuántos renglones, en cuántas órdenes, y el detalle). */
export type AsignarProveedorEnBloqueResultado =
  paths['/api/materiales/proveedor-en-bloque']['put']['responses']['200']['content']['application/json'];
// ── ⭐⭐ V1-E3u (§Post-F9.89): la tela se compra POR COLOR ──
/** Colores de tela de una orden (`GET /api/ordenes/{id}/colores-tela`). */
export type ColoresDeTela =
  paths['/api/ordenes/{id}/colores-tela']['get']['responses']['200']['content']['application/json'];
/** Un renglón de tela de la receta con su desglose por color. */
export type TelaConColores = ColoresDeTela['telas'][number];
/** Un color de la matriz de la orden con su color de tela (amarrado y/o propuesto). */
export type ColorDeLaOrden = TelaConColores['colores'][number];
/** Cuerpo de amarrar (o quitar) el color de tela de un color de la orden. */
export type AsignarColorTelaCuerpo =
  paths['/api/ordenes/{id}/colores-tela']['put']['requestBody']['content']['application/json'];
/** Cuerpo de corregir el precio de un color de tela (ACTUALIZA EL CATÁLOGO, §Post-F9.89(b)). */
export type FijarPrecioColorCuerpo =
  paths['/api/telas-colores/{idTelaColor}/precio']['put']['requestBody']['content']['application/json'];
/** Resultado de corregir el precio: trae el ANTES y el DESPUÉS para poder ENSEÑARLO. */
export type FijarPrecioColorResultado =
  paths['/api/telas-colores/{idTelaColor}/precio']['put']['responses']['200']['content']['application/json'];
/**
 * ⭐⭐ V1-E6b (§Post-F9.106) — cuerpo del alta ADITIVA de un color de tela
 * (`POST /api/telas/{id}/colores`). 🔴 NO es el grid de la tela: el grid es SET-COMPLETO y borra
 * lo que no viaja en la lista; éste crea UNO y no toca los demás.
 */
export type AgregarColorTelaCuerpo =
  paths['/api/telas/{id}/colores']['post']['requestBody']['content']['application/json'];
/** El color de tela RECIÉN CREADO (para poder elegirlo sin volver a buscarlo). */
export type ColorTelaCreado =
  paths['/api/telas/{id}/colores']['post']['responses']['201']['content']['application/json'];

/** Tablero "qué tengo / qué falta" de una orden (`GET .../estatus-materiales`). */
export type EstatusMateriales =
  paths['/api/ordenes/{id}/estatus-materiales']['get']['responses']['200']['content']['application/json'];
/** Una fila del tablero de estatus de materiales. */
export type EstatusMaterialFila = EstatusMateriales['filas'][number];

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
/** LOGO de la empresa con su URL prefirmada (`GET /api/empresas/{id}/logo`), o todo null. */
export type EmpresaLogo =
  paths['/api/empresas/{id}/logo']['get']['responses']['200']['content']['application/json'];

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

// ── Ruta Crítica: catálogo configurable de procesos (Módulo 8, F5-E1) ─────────

/** Página de procesos de la RC (`GET /api/ruta-critica/procesos`). */
export type ProcesosRcPagina =
  paths['/api/ruta-critica/procesos']['get']['responses']['200']['content']['application/json'];
/** Un proceso de la RC completo (con roles, antecesores y checklist). */
export type ProcesoRc = ProcesosRcPagina['datos'][number];
/** Un rol responsable de un proceso. */
export type ProcesoRcRol = ProcesoRc['roles'][number];
/** Un antecesor (dependencia) de un proceso. */
export type ProcesoRcAntecesor = ProcesoRc['antecesores'][number];
/** Un ítem de checklist de un proceso. */
export type ProcesoRcChecklistItem = ProcesoRc['checklist'][number];
/** Condición de aplicabilidad de un proceso. */
export type CondicionAplicabilidad = ProcesoRc['condicionAplicabilidad'];
/** Tipo de evento de un proceso. */
export type TipoEventoProceso = ProcesoRc['tipoEvento'];
/** Tipo de duración de un proceso. */
export type TipoDuracionProceso = ProcesoRc['tipoDuracion'];
/** Parámetros de consulta del listado de procesos (querystring). */
export type ProcesosRcQuery = NonNullable<
  paths['/api/ruta-critica/procesos']['get']['parameters']['query']
>;
/** Cuerpo de alta de proceso (`POST /api/ruta-critica/procesos`). */
export type ProcesoRcCrear =
  paths['/api/ruta-critica/procesos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de proceso (`PATCH /api/ruta-critica/procesos/{id}`). */
export type ProcesoRcEditar =
  paths['/api/ruta-critica/procesos/{id}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo del set de roles responsables (`PUT .../{id}/roles`). */
export type ProcesoRcRoles =
  paths['/api/ruta-critica/procesos/{id}/roles']['put']['requestBody']['content']['application/json'];
/** Cuerpo del set de dependencias (`PUT .../{id}/dependencias`). */
export type ProcesoRcDependencias =
  paths['/api/ruta-critica/procesos/{id}/dependencias']['put']['requestBody']['content']['application/json'];
/** Cuerpo del set de checklist (`PUT .../{id}/checklist`). */
export type ProcesoRcChecklist =
  paths['/api/ruta-critica/procesos/{id}/checklist']['put']['requestBody']['content']['application/json'];

// ── Ruta Crítica: plantillas, reglas de duración y calendario (Módulo 8, F5-E2) ──

/** Familia de artículos de la RC. */
export type FamiliaRc =
  paths['/api/ruta-critica/familias']['get']['responses']['200']['content']['application/json'][number];
/** Cuerpo de alta de familia. */
export type FamiliaRcCrear =
  paths['/api/ruta-critica/familias']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de familia. */
export type FamiliaRcEditar =
  paths['/api/ruta-critica/familias/{id}']['patch']['requestBody']['content']['application/json'];

/** Artículo (tipo de artículo) de la RC. */
export type ArticuloRc =
  paths['/api/ruta-critica/articulos']['get']['responses']['200']['content']['application/json'][number];
/** Cuerpo de alta de artículo. */
export type ArticuloRcCrear =
  paths['/api/ruta-critica/articulos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de artículo. */
export type ArticuloRcEditar =
  paths['/api/ruta-critica/articulos/{id}']['patch']['requestBody']['content']['application/json'];

/** Plantilla de ruta completa (con sus procesos). */
export type PlantillaRc =
  paths['/api/ruta-critica/plantillas']['get']['responses']['200']['content']['application/json'][number];
/** Un renglón (proceso) de una plantilla. */
export type PlantillaRcProceso = PlantillaRc['procesos'][number];
/** Cuerpo de alta de plantilla. */
export type PlantillaRcCrear =
  paths['/api/ruta-critica/plantillas']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de plantilla. */
export type PlantillaRcEditar =
  paths['/api/ruta-critica/plantillas/{id}']['patch']['requestBody']['content']['application/json'];

/** Factor de duración por cantidad. */
export type FactorCantidadRc =
  paths['/api/ruta-critica/reglas-duracion/cantidad']['get']['responses']['200']['content']['application/json'][number];
/** Cuerpo de alta de factor por cantidad. */
export type FactorCantidadRcCrear =
  paths['/api/ruta-critica/reglas-duracion/cantidad']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de factor por cantidad. */
export type FactorCantidadRcEditar =
  paths['/api/ruta-critica/reglas-duracion/cantidad/{id}']['patch']['requestBody']['content']['application/json'];

/** Días de duración por tipo de tela. */
export type DuracionTelaRc =
  paths['/api/ruta-critica/reglas-duracion/tela']['get']['responses']['200']['content']['application/json'][number];
/** Cuerpo de alta de duración por tela. */
export type DuracionTelaRcCrear =
  paths['/api/ruta-critica/reglas-duracion/tela']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de duración por tela. */
export type DuracionTelaRcEditar =
  paths['/api/ruta-critica/reglas-duracion/tela/{id}']['patch']['requestBody']['content']['application/json'];

/** Días de duración por aplicación. */
export type DuracionAplicacionRc =
  paths['/api/ruta-critica/reglas-duracion/aplicacion']['get']['responses']['200']['content']['application/json'][number];
/** Cuerpo de alta de duración por aplicación. */
export type DuracionAplicacionRcCrear =
  paths['/api/ruta-critica/reglas-duracion/aplicacion']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de duración por aplicación. */
export type DuracionAplicacionRcEditar =
  paths['/api/ruta-critica/reglas-duracion/aplicacion/{id}']['patch']['requestBody']['content']['application/json'];

/** Rango de dificultad por # de operaciones (R4, B7 — tabla configurable). */
export type RangoDificultadRc =
  paths['/api/ruta-critica/reglas-duracion/dificultad']['get']['responses']['200']['content']['application/json'][number];
/** Cuerpo de alta de rango de dificultad. */
export type RangoDificultadRcCrear =
  paths['/api/ruta-critica/reglas-duracion/dificultad']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de rango de dificultad. */
export type RangoDificultadRcEditar =
  paths['/api/ruta-critica/reglas-duracion/dificultad/{id}']['patch']['requestBody']['content']['application/json'];

/** Calendario laboral de una empresa. */
export type CalendarioRc =
  paths['/api/ruta-critica/calendario/{idEmpresa}']['get']['responses']['200']['content']['application/json'];
/** Cuerpo para fijar el calendario laboral. */
export type CalendarioRcActualizar =
  paths['/api/ruta-critica/calendario/{idEmpresa}']['put']['requestBody']['content']['application/json'];
/** Día festivo de una empresa. */
export type FestivoRc =
  paths['/api/ruta-critica/calendario/{idEmpresa}/festivos']['get']['responses']['200']['content']['application/json'][number];
/** Cuerpo de alta de festivo. */
export type FestivoRcCrear =
  paths['/api/ruta-critica/calendario/{idEmpresa}/festivos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de festivo. */
export type FestivoRcEditar =
  paths['/api/ruta-critica/calendario/festivos/{id}']['patch']['requestBody']['content']['application/json'];

// ── Ruta Crítica: motor por orden, bandeja de tareas y alertas (Módulo 8, F5-E3/E4/E5) ──

/** Tri-estado del semáforo de cumplimiento de la RC (derivado por el backend). */
export type SemaforoRc =
  paths['/api/ruta-critica/ordenes/{id}/ruta']['get']['responses']['200']['content']['application/json']['semaforo'];

/** Ruta Crítica VIVA de una orden (encabezado + procesos con sus fechas/semáforos). */
export type RutaOrden =
  paths['/api/ruta-critica/ordenes/{id}/ruta']['get']['responses']['200']['content']['application/json'];
/** Un proceso de la ruta viva (con plan vs real, captura y semáforo). */
export type RutaOrdenProceso = RutaOrden['procesos'][number];
/** Estado del cálculo de fechas de la ruta (calculado / recalculando / sin-ruta). */
export type EstadoRecalculoRc = RutaOrden['estadoRecalculo'];
/** Estado de un proceso de la ruta (pendiente / activo / completado). */
export type EstadoProcesoRc = RutaOrdenProceso['estado'];

/** Cuerpo para programar (generar/re-generar) la RC de una orden. */
export type ProgramarRcCuerpo =
  paths['/api/ruta-critica/ordenes/{id}/programar']['post']['requestBody']['content']['application/json'];
/** Cuerpo para ajustar la ruta de una orden (agregar/quitar procesos, dependencias). */
export type AjustarRutaCuerpo =
  paths['/api/ruta-critica/ordenes/{id}/ruta']['patch']['requestBody']['content']['application/json'];
/** Cuerpo de captura/reversión del cumplimiento de un proceso. */
export type CumplimientoRcCuerpo =
  paths['/api/ruta-critica/procesos/{idRuta}/cumplimiento']['put']['requestBody']['content']['application/json'];
/** Cuerpo de marcar/desmarcar un ítem de checklist de la ruta viva. */
export type ChecklistRcCuerpo =
  paths['/api/ruta-critica/checklist/{idItem}']['put']['requestBody']['content']['application/json'];

/** Hitos VIVOS de una orden (revisión OP, fit, tono, avíos, empaque, arte). */
export type HitosOrden =
  paths['/api/ruta-critica/ordenes/{id}/hitos']['get']['responses']['200']['content']['application/json'];
/** Un hito de la orden. */
export type HitoOrden = HitosOrden[number];
/** Tipo de hito de la orden. */
export type TipoHitoOrden = HitoOrden['tipo'];
/** Cuerpo para registrar un hito de la orden. */
export type RegistrarHitoCuerpo =
  paths['/api/ruta-critica/ordenes/{id}/hitos']['post']['requestBody']['content']['application/json'];

// ── Receta CONGELADA de la orden (V1-E3d, §Post-F9.43: "el BOM vive en la OP") ──

/** Receta congelada de una orden, con su desalineación contra el BOM del modelo. */
export type RecetaOrden =
  paths['/api/ordenes/{id}/receta']['get']['responses']['200']['content']['application/json'];
/** Renglón de TELA de la receta de la orden. */
export type RecetaOrdenTela = RecetaOrden['telas'][number];
/** Renglón de AVÍO de la receta de la orden. */
export type RecetaOrdenAvio = RecetaOrden['avios'][number];
/** Renglón de ARTE de la receta de la orden. */
export type RecetaOrdenArte = RecetaOrden['artes'][number];
/** Un cambio del BOM del modelo respecto de la receta congelada. */
export type CambioReceta = RecetaOrden['desalineacion']['cambios'][number];
/** Estado de revisión de un renglón (sin revisar / revisado / ajustado). */
export type EstadoRenglonReceta = RecetaOrdenTela['estado'];
/** Sección de la receta a la que pertenece un renglón. */
export type TipoRenglonReceta = RecetaOrdenTela['tipo'];
/** Cuerpo para AGREGAR un renglón a la receta de la orden. */
export type RecetaAgregarCuerpo =
  paths['/api/ordenes/{id}/receta/renglones']['post']['requestBody']['content']['application/json'];
/** Cuerpo para EDITAR un renglón de la receta. */
export type RecetaEditarCuerpo =
  paths['/api/ordenes/{id}/receta/renglones/{tipo}/{idRenglon}']['patch']['requestBody']['content']['application/json'];

// ── V1-E3h: la receta se libera POR PARTES (§Post-F9.72) y se JALA del modelo (§Post-F9.73) ──

/** Cuerpo de LIBERAR: los renglones que se firman, nombrados uno por uno (§Post-F9.80). */
export type LiberarRecetaCuerpo = NonNullable<
  paths['/api/ordenes/{id}/receta/liberar']['post']['requestBody']
>['content']['application/json'];
/**
 * ⭐⭐ V1-E8z — Cuerpo de ABRIR la receta (§Post-F9.160(a)): reabrirla para corregirla **congela la
 * compra de la orden** hasta que se cierre. El `motivo` es OBLIGATORIO — es lo que el comprador ve
 * en el 409 cuando intenta comprar. Cerrar no lleva cuerpo.
 */
export type AbrirRecetaCuerpo = NonNullable<
  paths['/api/ordenes/{id}/receta/abrir']['post']['requestBody']
>['content']['application/json'];
/** Cuerpo de TRAER DEL MODELO (sin `materiales` = todo lo que falte). */
export type TraerDelModeloCuerpo = NonNullable<
  paths['/api/ordenes/{id}/receta/traer-del-modelo']['post']['requestBody']
>['content']['application/json'];
/** Qué se trajo del modelo y qué se respetó (nunca en silencio, §Post-F9.73). */
export type TraerDelModeloResultado =
  paths['/api/ordenes/{id}/receta/traer-del-modelo']['post']['responses']['200']['content']['application/json'];
/** Página de la bandeja «Recetas por liberar». */
export type RecetasPorLiberarPagina =
  paths['/api/recetas-por-liberar']['get']['responses']['200']['content']['application/json'];
/** Una orden con receta pendiente de firma. */
export type RecetaPorLiberar = RecetasPorLiberarPagina['datos'][number];

/** Página de la bandeja "mis tareas" de la RC (`GET /api/ruta-critica/bandeja`). */
export type BandejaRcPagina =
  paths['/api/ruta-critica/bandeja']['get']['responses']['200']['content']['application/json'];
/** Una tarea activa de la bandeja (proceso×orden a capturar). */
export type TareaRc = BandejaRcPagina['datos'][number];
/** Un ítem de checklist de una tarea de la bandeja. */
export type TareaRcChecklistItem = TareaRc['checklist'][number];
/** Parámetros de consulta de la bandeja (querystring). */
export type BandejaRcQuery = NonNullable<
  paths['/api/ruta-critica/bandeja']['get']['parameters']['query']
>;

/** Conteo de alertas (atrasados / en riesgo) para el badge del header. */
export type AlertasRcConteo =
  paths['/api/ruta-critica/alertas/conteo']['get']['responses']['200']['content']['application/json'];

/** Urgencia de un pendiente (R4): vencida / hoy / semana / despues / sinFecha. */
export type UrgenciaPendienteRc = TareaRc['urgencia'];
/** Resumen de "Mis pendientes" (R4): KPIs + grupos por proceso (agregado en servidor). */
export type ResumenPendientesRc =
  paths['/api/ruta-critica/bandeja/resumen']['get']['responses']['200']['content']['application/json'];
/** Un grupo por proceso del resumen de pendientes. */
export type ResumenProcesoPendienteRc = ResumenPendientesRc['porProceso'][number];
/** Un usuario del selector "Viendo pendientes de:" (R4, supervisión). */
export type ResponsableRc =
  paths['/api/ruta-critica/bandeja/responsables']['get']['responses']['200']['content']['application/json'][number];
/** Cuerpo para elegir la secuencia de estampado de una orden flexible (R4, B10). */
export type SecuenciaEstampadoCuerpo =
  paths['/api/ruta-critica/ordenes/{id}/secuencia-estampado']['post']['requestBody']['content']['application/json'];

// ── Ruta Crítica: concentrado "planeado vs real" (Módulo 8, F5-E7) ────────────

/** Página del concentrado de la RC (`GET /api/ruta-critica/concentrado`). */
export type ConcentradoRcPagina =
  paths['/api/ruta-critica/concentrado']['get']['responses']['200']['content']['application/json'];
/** Una orden (fila) del concentrado, con su semáforo, atraso y sus procesos. */
export type ConcentradoRcFila = ConcentradoRcPagina['datos'][number];
/** Un proceso (celda) de la ruta de una orden en el concentrado. */
export type ConcentradoRcProceso = ConcentradoRcFila['procesos'][number];
/** Resumen por semáforo del concentrado (sobre todo el filtro). */
export type ConcentradoRcResumen = ConcentradoRcPagina['resumen'];
/** Parámetros de consulta del concentrado (querystring). */
export type ConcentradoRcQuery = NonNullable<
  paths['/api/ruta-critica/concentrado']['get']['parameters']['query']
>;

// ── Ruta Crítica: tablero de gestión "Análisis RC" (Módulo 8, rediseño R7) ────

/** Respuesta del tablero Análisis RC (`GET /api/ruta-critica/analisis`). */
export type AnalisisRc =
  paths['/api/ruta-critica/analisis']['get']['responses']['200']['content']['application/json'];
/** Salud de las órdenes (KPIs + triage). */
export type AnalisisSalud = AnalisisRc['salud'];
/** Una orden del triage "requieren atención". */
export type OrdenAtencion = AnalisisSalud['atencion'][number];
/** Entrega al cliente + tiempo de ciclo (con tendencias). */
export type EntregaCiclo = AnalisisRc['entregaCiclo'];
/** Una alerta predictiva (colchón proyectado por el forward pass). */
export type OrdenAlerta = AnalisisRc['alertas'][number];
/** Riesgo agregado por cliente. */
export type RiesgoCliente = AnalisisRc['riesgoCliente'][number];
/** Un cuello de botella por proceso. */
export type CuelloProceso = AnalisisRc['cuellos'][number];
/** Respuesta del desempeño del equipo (`GET /api/ruta-critica/analisis/desempeno`). */
export type DesempenoRc =
  paths['/api/ruta-critica/analisis/desempeno']['get']['responses']['200']['content']['application/json'];
/** Desempeño de una persona en la RC (scoring + bono). */
export type PersonaDesempeno = DesempenoRc['personas'][number];

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
/**
 * Qué precargar en la captura de una etapa
 * (`GET /api/produccion/ordenes/{id}/sugerencia-captura`, V1-E8i). NO guarda nada.
 */
export type SugerenciaCaptura =
  paths['/api/produccion/ordenes/{id}/sugerencia-captura']['get']['responses']['200']['content']['application/json'];
/** Una celda color×talla que la captura puede precargar. */
export type CeldaSugerida = SugerenciaCaptura['celdas'][number];
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
/** Una celda del rollup color×talla (`agrupar=color-talla`), ya sumada a través de almacenes. */
export type ExistenciaPtCelda = NonNullable<ExistenciasPt['porColorTalla']>[number];
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

// ── Inventario de TELAS NUEVO por COLOR (etapa A2: partidas + tela×color) ─────

/** Un movimiento de tela por COLOR tal como lo devuelve el API. */
export type MovimientoTelaColor =
  paths['/api/inventarios/telas/color/ajustes']['post']['responses']['201']['content']['application/json'];
/** Cuerpo de un ajuste de tela por color (`POST /api/inventarios/telas/color/ajustes`). */
export type AjusteTelaColorCrear =
  paths['/api/inventarios/telas/color/ajustes']['post']['requestBody']['content']['application/json'];
/** Cuerpo de una salida de tela por color a orden. */
export type SalidaTelaColorCrear =
  paths['/api/inventarios/telas/color/salidas-orden']['post']['requestBody']['content']['application/json'];
/** Cuerpo de un traspaso de tela por color. */
export type TraspasoTelaColorCrear =
  paths['/api/inventarios/telas/color/traspasos']['post']['requestBody']['content']['application/json'];
/** Resultado de un traspaso de tela por color: las dos patas. */
export type TraspasoTelaColor =
  paths['/api/inventarios/telas/color/traspasos']['post']['responses']['201']['content']['application/json'];
/** Existencias por color agrupadas TELA PADRE → colores. */
export type ExistenciasTelaColor =
  paths['/api/inventarios/telas/color/existencias']['get']['responses']['200']['content']['application/json'];
/** Una tela agrupada con sus colores hijos. */
export type ExistenciaTelaAgrupada = ExistenciasTelaColor['telas'][number];
/** Un color hijo con existencia de cuerpo y complemento. */
export type ExistenciaTelaColorHijo = ExistenciaTelaAgrupada['colores'][number];
/** Parámetros de existencias por color (querystring). */
export type ExistenciasTelaColorQuery = NonNullable<
  paths['/api/inventarios/telas/color/existencias']['get']['parameters']['query']
>;
/** Kardex de un color de tela (dos componentes con saldo corrido). */
export type KardexTelaColor =
  paths['/api/inventarios/telas/color/kardex']['get']['responses']['200']['content']['application/json'];
/** Un renglón del kardex por color. */
export type KardexTelaColorRenglon = KardexTelaColor['renglones'][number];
/** Parámetros del kardex por color (querystring). */
export type KardexTelaColorQuery = NonNullable<
  paths['/api/inventarios/telas/color/kardex']['get']['parameters']['query']
>;
/** Partidas de tela (búsqueda por folio / lote del proveedor / factura). */
export type PartidasTela =
  paths['/api/inventarios/telas/partidas']['get']['responses']['200']['content']['application/json'];
/** Una partida de tela. */
export type PartidaTela = PartidasTela['datos'][number];
/** Parámetros de la búsqueda de partidas (querystring). */
export type PartidasTelaQuery = NonNullable<
  paths['/api/inventarios/telas/partidas']['get']['parameters']['query']
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

// ── EsMa corazón contable: abonos/descuentos/pagos, saldo y conciliación (F6-E4) ──

/** Cuerpo de captura de un abono o descuento (`POST /api/esma/{abonos,descuentos}`). */
export type EsMaMovimientoCrear =
  paths['/api/esma/abonos']['post']['requestBody']['content']['application/json'];
/** Un movimiento plano de EsMa (abono/descuento) tal como lo devuelve el API. */
export type EsMaMovimiento =
  paths['/api/esma/abonos']['post']['responses']['201']['content']['application/json'];
/** Lista de abonos/descuentos de un maquilero (`GET /api/esma/maquileros/{id}/{abonos,descuentos}`). */
export type EsMaMovimientosLista =
  paths['/api/esma/maquileros/{id}/abonos']['get']['responses']['200']['content']['application/json'];

/** Cuerpo de captura de un pago ligado a cargos (`POST /api/esma/pagos`). */
export type EsMaPagoCrear =
  paths['/api/esma/pagos']['post']['requestBody']['content']['application/json'];
/** Un renglón de aplicación del pago a un cargo (parte del cuerpo). */
export type EsMaPagoAplicacionEntrada = EsMaPagoCrear['aplicaciones'][number];
/** Un pago a un maquilero (con sus aplicaciones a cargos) tal como lo devuelve el API. */
export type EsMaPago =
  paths['/api/esma/pagos']['post']['responses']['201']['content']['application/json'];
/** Una aplicación (cargo cubierto) de un pago. */
export type EsMaPagoAplicacion = EsMaPago['aplicaciones'][number];
/** Lista de pagos de un maquilero (`GET /api/esma/maquileros/{id}/pagos`). */
export type EsMaPagosLista =
  paths['/api/esma/maquileros/{id}/pagos']['get']['responses']['200']['content']['application/json'];

/** Saldo derivado de un maquilero (`GET /api/esma/maquileros/{id}/saldo`). */
export type EsMaSaldo =
  paths['/api/esma/maquileros/{id}/saldo']['get']['responses']['200']['content']['application/json'];
/** Parámetros del saldo (segmento con/sin factura). */
export type EsMaSaldoQuery = NonNullable<
  paths['/api/esma/maquileros/{id}/saldo']['get']['parameters']['query']
>;

/** Conciliación EsMa vs recibos del periodo (`GET /api/esma/conciliacion`). */
export type EsMaConciliacion =
  paths['/api/esma/conciliacion']['get']['responses']['200']['content']['application/json'];
/** Una fila del cuadre (orden + maquilero + proceso). */
export type EsMaConciliacionFila = EsMaConciliacion['filas'][number];
/** Un cargo sin recibo ligado (parte de la conciliación). */
export type EsMaCargoSinRecibo = EsMaConciliacion['cargosSinRecibo'][number];
/** Parámetros de la conciliación (querystring). */
export type EsMaConciliacionQuery = NonNullable<
  paths['/api/esma/conciliacion']['get']['parameters']['query']
>;

// ── EsMa experiencia de usuario: estado de cuenta, semanales, saldos, selector (F6-E5) ──

/** Estado de cuenta unificado de un maquilero (`GET /api/esma/maquileros/{id}/estado-cuenta`). */
export type EsMaEstadoCuenta =
  paths['/api/esma/maquileros/{id}/estado-cuenta']['get']['responses']['200']['content']['application/json'];
/** Un renglón del estado de cuenta unificado. */
export type EsMaEstadoCuentaMovimiento = EsMaEstadoCuenta['movimientos'][number];
/** Parámetros del estado de cuenta (querystring). */
export type EsMaEstadoCuentaQuery = NonNullable<
  paths['/api/esma/maquileros/{id}/estado-cuenta']['get']['parameters']['query']
>;

/** Estado de cuenta desglosado de un maquilero (`GET /api/esma/maquileros/{id}/desglosado`). */
export type EsMaDesglosado =
  paths['/api/esma/maquileros/{id}/desglosado']['get']['responses']['200']['content']['application/json'];
/** Un cargo desglosado (detalle por orden/modelo). */
export type EsMaDesglosadoCargo = EsMaDesglosado['cargos'][number];

/**
 * Bloque de PRENDAS INCOMPLETAS que el maquilero entregó (V1-E8k, §Post-F9.136). Viene en las DOS
 * vistas del estado de cuenta con la MISMA forma; es informativo y **no afecta el saldo**.
 */
export type EsMaIncompletasBloque = EsMaEstadoCuenta['incompletas'];

/** Saldos de todos los maquileros (`GET /api/esma/saldos`). */
export type EsMaSaldosTodos =
  paths['/api/esma/saldos']['get']['responses']['200']['content']['application/json'];
/** Una fila del tablero de saldos. */
export type EsMaSaldoTodosFila = EsMaSaldosTodos['filas'][number];
/** Parámetros del tablero de saldos (querystring). */
export type EsMaSaldosTodosQuery = NonNullable<
  paths['/api/esma/saldos']['get']['parameters']['query']
>;

/** Pagos semanales (`GET /api/esma/pagos-semanales`). */
export type EsMaPagosSemanales =
  paths['/api/esma/pagos-semanales']['get']['responses']['200']['content']['application/json'];
/** Un pago en la consulta semanal. */
export type EsMaPagoSemanalFila = EsMaPagosSemanales['filas'][number];
/** Parámetros de pagos semanales (querystring). */
export type EsMaPagosSemanalesQuery = NonNullable<
  paths['/api/esma/pagos-semanales']['get']['parameters']['query']
>;

/** Recibos semanales de maquila EsMa (`GET /api/esma/recibos-semanales`). */
export type EsMaRecibosSemanales =
  paths['/api/esma/recibos-semanales']['get']['responses']['200']['content']['application/json'];
/** Un recibo de maquila del periodo. */
export type EsMaReciboSemanalFila = EsMaRecibosSemanales['filas'][number];
/** Parámetros de recibos semanales EsMa (querystring). */
export type EsMaRecibosSemanalesQuery = NonNullable<
  paths['/api/esma/recibos-semanales']['get']['parameters']['query']
>;

/** Selector de maquileros de EsMa (`GET /api/esma/maquileros`). */
export type EsMaMaquileros =
  paths['/api/esma/maquileros']['get']['responses']['200']['content']['application/json'];
/** Un maquilero del selector. */
export type EsMaMaquileroFila = EsMaMaquileros['filas'][number];
/** Parámetros del selector de maquileros (querystring). */
export type EsMaMaquilerosQuery = NonNullable<
  paths['/api/esma/maquileros']['get']['parameters']['query']
>;

/** Resultado de revisar una partida (`POST /api/esma/movimientos/{concepto}/{id}/revisar`). */
export type EsMaRevision =
  paths['/api/esma/movimientos/{concepto}/{id}/revisar']['post']['responses']['200']['content']['application/json'];
/** Concepto de una partida revisable (abono/descuento/pago). */
export type EsMaConceptoRevisable =
  paths['/api/esma/movimientos/{concepto}/{id}/revisar']['post']['parameters']['path']['concepto'];

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
/** Una fila de existencia en poder del maquilero (enviado − recibido − incompletas). */
export type ExistenciaMaquileroFila = ExistenciaMaquilero['filas'][number];
/** Parámetros de las existencias en poder del maquilero (querystring). */
export type ExistenciaMaquileroQuery = NonNullable<
  paths['/api/produccion/existencias-maquilero']['get']['parameters']['query']
>;

// ── Calidad (F6-E1): defectos, tipos de producto, planes AQL y bitácora ──────

/** Página de defectos (`GET /api/calidad/defectos`). */
export type DefectosPagina =
  paths['/api/calidad/defectos']['get']['responses']['200']['content']['application/json'];
/** Un defecto tal como lo devuelve el API (con sus tipos de producto ligados). */
export type Defecto = DefectosPagina['datos'][number];
/** Severidad informativa de un defecto. */
export type SeveridadDefecto = Defecto['severidad'];
/** Parámetros de consulta del listado de defectos (querystring). */
export type DefectosQuery = NonNullable<
  paths['/api/calidad/defectos']['get']['parameters']['query']
>;
/** Cuerpo de alta de defecto (`POST /api/calidad/defectos`). */
export type DefectoCrear =
  paths['/api/calidad/defectos']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de defecto (`PATCH /api/calidad/defectos/{id}`). */
export type DefectoEditar =
  paths['/api/calidad/defectos/{id}']['patch']['requestBody']['content']['application/json'];

/** Página de tipos de producto (`GET /api/calidad/tipos-producto`). */
export type TiposProductoPagina =
  paths['/api/calidad/tipos-producto']['get']['responses']['200']['content']['application/json'];
/** Un tipo de producto tal como lo devuelve el API. */
export type TipoProducto = TiposProductoPagina['datos'][number];
/** Parámetros de consulta del listado de tipos de producto (querystring). */
export type TiposProductoQuery = NonNullable<
  paths['/api/calidad/tipos-producto']['get']['parameters']['query']
>;
/** Cuerpo de alta de tipo de producto (`POST /api/calidad/tipos-producto`). */
export type TipoProductoCrear =
  paths['/api/calidad/tipos-producto']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de tipo de producto (`PATCH /api/calidad/tipos-producto/{id}`). */
export type TipoProductoEditar =
  paths['/api/calidad/tipos-producto/{id}']['patch']['requestBody']['content']['application/json'];

/** Página de planes AQL (`GET /api/calidad/planes-aql`). */
export type PlanesAqlPagina =
  paths['/api/calidad/planes-aql']['get']['responses']['200']['content']['application/json'];
/** Un plan AQL tal como lo devuelve el API (con sus renglones y límites). */
export type PlanAql = PlanesAqlPagina['datos'][number];
/** Un renglón del plan AQL (rango de lote → muestra + límites). */
export type PlanAqlRenglon = PlanAql['renglones'][number];
/** Parámetros de consulta del listado de planes AQL (querystring). */
export type PlanesAqlQuery = NonNullable<
  paths['/api/calidad/planes-aql']['get']['parameters']['query']
>;
/** Cuerpo de alta de plan AQL (`POST /api/calidad/planes-aql`). */
export type PlanAqlCrear =
  paths['/api/calidad/planes-aql']['post']['requestBody']['content']['application/json'];
/** Cuerpo de edición de plan AQL (`PATCH /api/calidad/planes-aql/{id}`). */
export type PlanAqlEditar =
  paths['/api/calidad/planes-aql/{id}']['patch']['requestBody']['content']['application/json'];
/** Resultado de la resolución del plan (`GET /api/calidad/planes-aql/resolver`). */
export type ResolverPlan =
  paths['/api/calidad/planes-aql/resolver']['get']['responses']['200']['content']['application/json'];
/** Parámetros de la resolución del plan (querystring). */
export type ResolverPlanQuery = NonNullable<
  paths['/api/calidad/planes-aql/resolver']['get']['parameters']['query']
>;

/** Una auditoría de calidad con su detalle y sugerencia (`GET /api/calidad/auditorias/{id}`). */
export type Auditoria =
  paths['/api/calidad/auditorias/{id}']['get']['responses']['200']['content']['application/json'];
/** Un renglón defecto → fallas de una auditoría. */
export type AuditoriaDefecto = Auditoria['defectos'][number];
/** Veredicto de una auditoría (aprobado/reprobado/no_calificado). */
export type ResultadoAuditoria = Auditoria['resultado'];
/** Tipo de auditoría (en piso / final / sin definir). */
export type TipoAuditoria = Auditoria['tipoAuditoria'];
/** Sugerencia AQL informativa de una auditoría. */
export type SugerenciaAql = Auditoria['sugerencia'];
/** Cuerpo de alta de auditoría (`POST /api/calidad/auditorias`). */
export type AuditoriaCrear =
  paths['/api/calidad/auditorias']['post']['requestBody']['content']['application/json'];
/** Cuerpo de captura de resultado (`PATCH /api/calidad/auditorias/{id}/resultado`). */
export type AuditoriaResultado =
  paths['/api/calidad/auditorias/{id}/resultado']['patch']['requestBody']['content']['application/json'];
/** Cuerpo de reclasificación (`POST /api/calidad/auditorias/{id}/reclasificacion`). */
export type AuditoriaReclasificacion =
  paths['/api/calidad/auditorias/{id}/reclasificacion']['post']['requestBody']['content']['application/json'];
/** Contexto de una orden para el alta (`GET /api/calidad/auditorias/orden/{idOrden}/contexto`). */
export type AuditoriaContexto =
  paths['/api/calidad/auditorias/orden/{idOrden}/contexto']['get']['responses']['200']['content']['application/json'];
/** Un maquilero propuesto en el contexto de la orden. */
export type MaquileroPropuesto = AuditoriaContexto['maquileros'][number];

/** Página de auditorías (consulta, `GET /api/calidad/auditorias`). */
export type AuditoriasPagina =
  paths['/api/calidad/auditorias']['get']['responses']['200']['content']['application/json'];
/** Resumen ligero de una auditoría (una fila del listado). */
export type AuditoriaResumen = AuditoriasPagina['datos'][number];
/** Parámetros de consulta del listado de auditorías (querystring). */
export type AuditoriasQuery = NonNullable<
  paths['/api/calidad/auditorias']['get']['parameters']['query']
>;
/** Resumen de cabecera de auditorías (defecto principal; `GET /api/calidad/auditorias/resumen`). */
export type ResumenAuditorias =
  paths['/api/calidad/auditorias/resumen']['get']['responses']['200']['content']['application/json'];
/** Defecto principal del conjunto filtrado (o null si no hubo fallas). */
export type DefectoPrincipal = NonNullable<ResumenAuditorias['defectoPrincipal']>;
/** Parámetros de consulta del resumen de auditorías (querystring). */
export type ResumenAuditoriasQuery = NonNullable<
  paths['/api/calidad/auditorias/resumen']['get']['parameters']['query']
>;
/** Cuerpo de modificación de encabezado (`PATCH /api/calidad/auditorias/{id}`). */
export type AuditoriaModificar =
  paths['/api/calidad/auditorias/{id}']['patch']['requestBody']['content']['application/json'];
/** Cuerpo de cancelación (`POST /api/calidad/auditorias/{id}/cancelacion`). */
export type AuditoriaCancelar =
  paths['/api/calidad/auditorias/{id}/cancelacion']['post']['requestBody']['content']['application/json'];
/** Historial de auditorías de un maquilero (`GET /api/calidad/auditorias/maquilero/{idMaquilero}`). */
export type HistorialMaquilero =
  paths['/api/calidad/auditorias/maquilero/{idMaquilero}']['get']['responses']['200']['content']['application/json'];
/** Parámetros del historial por maquilero (querystring). */
export type HistorialMaquileroQuery = NonNullable<
  paths['/api/calidad/auditorias/maquilero/{idMaquilero}']['get']['parameters']['query']
>;

/** Página de bitácora (`GET /api/admin/bitacora`). */
export type BitacoraPagina =
  paths['/api/admin/bitacora']['get']['responses']['200']['content']['application/json'];
/** Un registro de bitácora tal como lo devuelve el API. */
export type RegistroBitacora = BitacoraPagina['datos'][number];
/** Acción registrada en la bitácora. */
export type AccionBitacora = RegistroBitacora['accion'];
/** Parámetros de consulta del listado de bitácora (querystring). */
export type BitacoraQuery = NonNullable<paths['/api/admin/bitacora']['get']['parameters']['query']>;

// ── Costos (Módulo 6, F7-E1) ──────────────────────────────────────────────────
/** Pre-costo de un modelo (`GET /api/costos/pre-costo/{idModelo}`). */
export type PreCostoModelo =
  paths['/api/costos/pre-costo/{idModelo}']['get']['responses']['200']['content']['application/json'];
/** Lista de precios sugeridos (`GET /api/costos/lista-precios`). */
export type ListaPrecios =
  paths['/api/costos/lista-precios']['get']['responses']['200']['content']['application/json'];
/** Un renglón de la lista de precios. */
export type ListaPreciosFila = ListaPrecios['filas'][number];
/** Parámetros de la lista de precios (querystring). */
export type ListaPreciosQuery = NonNullable<
  paths['/api/costos/lista-precios']['get']['parameters']['query']
>;
/** Costo de una orden: teórico + real de compras + guardado (`GET /api/costos/ordenes/{idOrden}`). */
export type CostoOrden =
  paths['/api/costos/ordenes/{idOrden}']['get']['responses']['200']['content']['application/json'];
/** Desglose del costo REAL de materiales desde las OC (`GET /api/costos/ordenes/{idOrden}/real`). */
export type CostoRealOrden =
  paths['/api/costos/ordenes/{idOrden}/real']['get']['responses']['200']['content']['application/json'];
/** Un material del desglose del costo real (lo comprado + lo valuado a último precio). */
export type CostoRealMaterial = CostoRealOrden['materiales'][number];
/** Cuerpo para guardar/ajustar el costo de una orden (`PUT /api/costos/ordenes/{idOrden}`). */
export type CostoOrdenGuardar =
  paths['/api/costos/ordenes/{idOrden}']['put']['requestBody']['content']['application/json'];
/** Base de prorrateo del costo unitario. */
export type BaseProrrateo = NonNullable<CostoOrdenGuardar['baseProrrateo']>;
/** Página de la lista de costos (`GET /api/costos/ordenes`). */
export type ListaCostos =
  paths['/api/costos/ordenes']['get']['responses']['200']['content']['application/json'];
/** Un renglón de la lista de costos. */
export type ListaCostosFila = ListaCostos['datos'][number];
/** Parámetros de la lista de costos (querystring). */
export type ListaCostosQuery = NonNullable<
  paths['/api/costos/ordenes']['get']['parameters']['query']
>;
/** Costos y márgenes por pedido (`GET /api/costos/margenes-por-pedido`). */
export type Margenes =
  paths['/api/costos/margenes-por-pedido']['get']['responses']['200']['content']['application/json'];
/** Un renglón de márgenes por pedido. */
export type MargenPedidoFila = Margenes['filas'][number];
/** Parámetros de márgenes por pedido (querystring). */
export type MargenesQuery = NonNullable<
  paths['/api/costos/margenes-por-pedido']['get']['parameters']['query']
>;

// ── EDR: Estado de Resultados (Módulo 6, F7-E2) ───────────────────────────────
/** EDR calculado de un mes (`GET /api/edr/{id}`). */
export type EdrCalculado =
  paths['/api/edr/{id}']['get']['responses']['200']['content']['application/json'];
/** Encabezado global del mes. */
export type EdrEncabezado = EdrCalculado['encabezado'];
/** Un corte del EDR (por empresa o cliente). */
export type EdrCorte = EdrCalculado['cortesEmpresa'][number];
/** EDR de un mes o indicador de que no existe (`GET /api/edr/por-mes`). */
export type EdrPorMes =
  paths['/api/edr/por-mes']['get']['responses']['200']['content']['application/json'];
/** Comparativo anual del EDR (`GET /api/edr/por-anio`). */
export type EdrPorAnio =
  paths['/api/edr/por-anio']['get']['responses']['200']['content']['application/json'];
/** Un mes del comparativo anual. */
export type EdrPorAnioMes = EdrPorAnio['meses'][number];
/** Conciliación de líneas del EDR (`GET /api/edr/{id}/lineas`). */
export type EdrLineas =
  paths['/api/edr/{id}/lineas']['get']['responses']['200']['content']['application/json'];
/** Una línea del EDR con su costo actual. */
export type EdrLinea = EdrLineas['lineas'][number];
/** Filtros de la conciliación de líneas. */
export type EdrLineasQuery = NonNullable<
  paths['/api/edr/{id}/lineas']['get']['parameters']['query']
>;
/** Cuerpo para generar/reconciliar el EDR de un mes (`POST /api/edr/generar`). */
export type EdrGenerar =
  paths['/api/edr/generar']['post']['requestBody']['content']['application/json'];
/** Cuerpo para actualizar el encabezado del mes (`PUT /api/edr/{id}`). */
export type EdrEncabezadoCuerpo =
  paths['/api/edr/{id}']['put']['requestBody']['content']['application/json'];
/** Cuerpo para agregar una línea manual (`POST /api/edr/{id}/lineas`). */
export type EdrLineaManual =
  paths['/api/edr/{id}/lineas']['post']['requestBody']['content']['application/json'];
/** Cuerpo para ajustar una línea (`PUT /api/edr/lineas/{idLinea}`). */
export type EdrLineaAjustar =
  paths['/api/edr/lineas/{idLinea}']['put']['requestBody']['content']['application/json'];
/** Origen de una línea del EDR. */
export type EdrOrigenLinea = EdrLinea['origen'];

// ── Ventas: vista comercial de la facturación por modelo (proto vVentas; F7-E2) ─
/** Ventas por período: resumen + página de líneas (`GET /api/edr/ventas`). */
export type Ventas =
  paths['/api/edr/ventas']['get']['responses']['200']['content']['application/json'];
/** Una línea de venta (facturación por modelo). */
export type VentaLinea = Ventas['lineas'][number];
/** Resumen agregado de ventas del período. */
export type VentasResumen = Ventas['resumen'];
/** Filtros de la consulta de ventas (querystring). */
export type VentasQuery = NonNullable<paths['/api/edr/ventas']['get']['parameters']['query']>;

// ── Indicadores: tableros directivos (Módulo Indicadores, F7-E3) ──────────────
/** Tablero de KPIs de Ruta Crítica (`GET /api/indicadores/rc`). */
export type KpisRc =
  paths['/api/indicadores/rc']['get']['responses']['200']['content']['application/json'];
/** Filtros del tablero de Ruta Crítica (querystring). */
export type KpisRcQuery = NonNullable<paths['/api/indicadores/rc']['get']['parameters']['query']>;
/** Un renglón de lead time por proceso. */
export type LeadTimeProceso = KpisRc['leadTime'][number];
/** Un renglón de cuello de botella. */
export type CuelloBotella = KpisRc['cuellosBotella'][number];
/** Un renglón de desempeño por responsable. */
export type DesempenoResponsable = KpisRc['desempeno'][number];
/** Un punto de la tendencia de la RC. */
export type TendenciaRc = KpisRc['tendencia'][number];
/** Tablero de calidad por maquilero (`GET /api/indicadores/calidad-maquileros`). */
export type KpisCalidad =
  paths['/api/indicadores/calidad-maquileros']['get']['responses']['200']['content']['application/json'];
/** Filtros del tablero de calidad (querystring). */
export type KpisCalidadQuery = NonNullable<
  paths['/api/indicadores/calidad-maquileros']['get']['parameters']['query']
>;
/** Un renglón de aprobación por maquilero. */
export type CalidadMaquilero = KpisCalidad['maquileros'][number];
/** Un defecto top. */
export type DefectoTop = KpisCalidad['defectosTop'][number];
/** Tablero WIP analítico (`GET /api/indicadores/wip`). */
export type KpisWip =
  paths['/api/indicadores/wip']['get']['responses']['200']['content']['application/json'];
/** Filtros del tablero WIP (querystring). */
export type KpisWipQuery = NonNullable<paths['/api/indicadores/wip']['get']['parameters']['query']>;
/** Una orden del tablero WIP. */
export type WipKpiFila = KpisWip['datos'][number];

// ── Indicadores · Productividad unificada IP/Almacén (F7-E4) ──────────────────
/** Página de personal del área (`GET /api/indicadores/productividad/personal`). */
export type PersonalPagina =
  paths['/api/indicadores/productividad/personal']['get']['responses']['200']['content']['application/json'];
/** Una persona del área. */
export type PersonalArea = PersonalPagina['datos'][number];
/** Filtros del listado de personal. */
export type PersonalQuery = NonNullable<
  paths['/api/indicadores/productividad/personal']['get']['parameters']['query']
>;
/** Alta de persona (`POST`). */
export type PersonalCrear =
  paths['/api/indicadores/productividad/personal']['post']['requestBody']['content']['application/json'];
/** Edición de persona (`PATCH`). */
export type PersonalEditar =
  paths['/api/indicadores/productividad/personal/{id}']['patch']['requestBody']['content']['application/json'];
/** Página de actividades (`GET /api/indicadores/productividad/actividades`). */
export type ActividadPagina =
  paths['/api/indicadores/productividad/actividades']['get']['responses']['200']['content']['application/json'];
/** Una actividad productiva. */
export type ActividadProductividad = ActividadPagina['datos'][number];
/** Filtros del listado de actividades. */
export type ActividadQuery = NonNullable<
  paths['/api/indicadores/productividad/actividades']['get']['parameters']['query']
>;
/** Alta de actividad (`POST`). */
export type ActividadCrear =
  paths['/api/indicadores/productividad/actividades']['post']['requestBody']['content']['application/json'];
/** Edición de actividad (`PATCH`). */
export type ActividadEditar =
  paths['/api/indicadores/productividad/actividades/{id}']['patch']['requestBody']['content']['application/json'];
/** Página de registros de productividad (`GET /api/indicadores/productividad/registros`). */
export type RegistrosProductividadPagina =
  paths['/api/indicadores/productividad/registros']['get']['responses']['200']['content']['application/json'];
/** Un registro de productividad (con índice). */
export type RegistroProductividad = RegistrosProductividadPagina['datos'][number];
/** Filtros del listado de registros. */
export type RegistrosProductividadQuery = NonNullable<
  paths['/api/indicadores/productividad/registros']['get']['parameters']['query']
>;
/** Alta de registro (`POST`). */
export type RegistroProductividadCrear =
  paths['/api/indicadores/productividad/registros']['post']['requestBody']['content']['application/json'];
/** Tablero de productividad (`GET /api/indicadores/productividad/tablero`). */
export type TableroProductividad =
  paths['/api/indicadores/productividad/tablero']['get']['responses']['200']['content']['application/json'];
/** Filtros del tablero de productividad. */
export type TableroProductividadQuery = NonNullable<
  paths['/api/indicadores/productividad/tablero']['get']['parameters']['query']
>;
/** Una fila del tablero de productividad. */
export type TableroProductividadFila = TableroProductividad['filas'][number];

// ── Indicadores · Fichas confiables (F7-E4) ──────────────────────────────────
/** Lista de reactivos del checklist (`GET /api/indicadores/fichas/reactivos`). */
export type ReactivosFichaLista =
  paths['/api/indicadores/fichas/reactivos']['get']['responses']['200']['content']['application/json'];
/** Un reactivo del checklist. */
export type ReactivoFicha = ReactivosFichaLista['datos'][number];
/** Checklist de confiabilidad de una orden (`GET /api/indicadores/fichas/ordenes/{idOrden}`). */
export type FichaOrden =
  paths['/api/indicadores/fichas/ordenes/{idOrden}']['get']['responses']['200']['content']['application/json'];
/** Cuerpo para guardar el checklist (`PUT`). */
export type VerificarFichaOrden =
  paths['/api/indicadores/fichas/ordenes/{idOrden}']['put']['requestBody']['content']['application/json'];
/** Indicador de % de fichas confiables (`GET /api/indicadores/fichas/confiables`). */
export type FichasConfiables =
  paths['/api/indicadores/fichas/confiables']['get']['responses']['200']['content']['application/json'];
/** Filtros del indicador de fichas confiables. */
export type FichasConfiablesQuery = NonNullable<
  paths['/api/indicadores/fichas/confiables']['get']['parameters']['query']
>;
/** Una orden en el indicador de fichas confiables. */
export type FichaConfiableFila = FichasConfiables['datos'][number];

// ── Indicadores · Muestrarios pendientes (F7-E4) ─────────────────────────────
/** Página de muestrarios (`GET /api/indicadores/muestrarios`). */
export type MuestrariosPagina =
  paths['/api/indicadores/muestrarios']['get']['responses']['200']['content']['application/json'];
/** Un muestrario (con estado/cumplimiento). */
export type Muestrario = MuestrariosPagina['datos'][number];
/** Filtros del listado de muestrarios. */
export type MuestrariosQuery = NonNullable<
  paths['/api/indicadores/muestrarios']['get']['parameters']['query']
>;
/** Alta (solicitud) de muestrario (`POST`). */
export type MuestrarioCrear =
  paths['/api/indicadores/muestrarios']['post']['requestBody']['content']['application/json'];
/** Edición de muestrario (`PATCH`). */
export type MuestrarioEditar =
  paths['/api/indicadores/muestrarios/{id}']['patch']['requestBody']['content']['application/json'];
/** Entrega de muestrario (`POST .../entregar`). */
export type MuestrarioEntregar =
  paths['/api/indicadores/muestrarios/{id}/entregar']['post']['requestBody']['content']['application/json'];
/** KPI de cumplimiento de muestrarios (`GET .../cumplimiento`). */
export type MuestrariosCumplimiento =
  paths['/api/indicadores/muestrarios/cumplimiento']['get']['responses']['200']['content']['application/json'];

// ── Indicadores · Inventario cíclico (F7-E5) ─────────────────────────────────
/** Página de inventarios cíclicos (`GET /api/indicadores/ciclicos`). */
export type InventariosCiclicosPagina =
  paths['/api/indicadores/ciclicos']['get']['responses']['200']['content']['application/json'];
/** Resumen (encabezado) de un cíclico. */
export type InventarioCiclicoResumen = InventariosCiclicosPagina['datos'][number];
/** Filtros del listado de cíclicos. */
export type InventariosCiclicosQuery = NonNullable<
  paths['/api/indicadores/ciclicos']['get']['parameters']['query']
>;
/** Alta de un cíclico (`POST`). */
export type InventarioCiclicoCrear =
  paths['/api/indicadores/ciclicos']['post']['requestBody']['content']['application/json'];
/** Estado del ciclo de vida de un cíclico. */
export type EstadoInventarioCiclico = InventarioCiclicoResumen['estado'];
/** Vista de CONTEO ciego (`GET .../conteo`). */
export type ConteoCiclico =
  paths['/api/indicadores/ciclicos/{id}/conteo']['get']['responses']['200']['content']['application/json'];
/** Un renglón de conteo ciego. */
export type ConteoCiclicoRenglon = ConteoCiclico['renglones'][number];
/** Captura de conteo (`POST .../conteo`). */
export type ConteoCiclicoCapturar =
  paths['/api/indicadores/ciclicos/{id}/conteo']['post']['requestBody']['content']['application/json'];
/** Vista de EXACTITUD (`GET .../exactitud`). */
export type ExactitudCiclico =
  paths['/api/indicadores/ciclicos/{id}/exactitud']['get']['responses']['200']['content']['application/json'];
/** Un renglón de exactitud (teórico vs real). */
export type ExactitudCiclicoRenglon = ExactitudCiclico['renglones'][number];

// ── CxP: cuentas por pagar de proveedores (Módulo 14, F9-E2) ──────────────────

/** Bandeja "por pagar" con aging + resumen (`GET /api/cxp/por-pagar`). */
export type CxpBandeja =
  paths['/api/cxp/por-pagar']['get']['responses']['200']['content']['application/json'];
/** Un renglón de la bandeja (proveedor + saldo + cubetas de aging). */
export type CxpBandejaFila = CxpBandeja['filas'][number];
/** Resumen (KPIs) de la bandeja de CxP. */
export type CxpResumen = CxpBandeja['resumen'];
/** Parámetros de la bandeja (querystring). */
export type CxpBandejaQuery = NonNullable<
  paths['/api/cxp/por-pagar']['get']['parameters']['query']
>;

/** Estado de cuenta de un proveedor (`GET /api/cxp/proveedores/{id}/estado-cuenta`). */
export type CxpEstadoCuenta =
  paths['/api/cxp/proveedores/{id}/estado-cuenta']['get']['responses']['200']['content']['application/json'];
/** Un renglón del estado de cuenta del proveedor. */
export type CxpEstadoCuentaMovimiento = CxpEstadoCuenta['movimientos'][number];
/** Parámetros del estado de cuenta (querystring). */
export type CxpEstadoCuentaQuery = NonNullable<
  paths['/api/cxp/proveedores/{id}/estado-cuenta']['get']['parameters']['query']
>;

/** Alta de un movimiento de CxP (`POST /api/cxp/proveedores/{id}/movimientos`). */
export type CxpMovimientoCrear =
  paths['/api/cxp/proveedores/{id}/movimientos']['post']['requestBody']['content']['application/json'];
/** Movimiento devuelto por el alta/cancelación de CxP (renglón del libro de terceros). */
export type CxpMovimientoSalida =
  paths['/api/cxp/proveedores/{id}/movimientos']['post']['responses']['201']['content']['application/json'];
/** Origen de un movimiento de CxP capturable. */
export type CxpOrigen = CxpMovimientoCrear['origen'];
/** Cancelación de un movimiento de CxP (`POST /api/cxp/movimientos/{id}/cancelar`). */
export type CxpMovimientoCancelar =
  paths['/api/cxp/movimientos/{id}/cancelar']['post']['requestBody']['content']['application/json'];

// ── Importación de CFDI de proveedores (Módulo 14, F9-E3; R11) ──────────────────
/** Previsualización de un CFDI (`POST /api/terceros/cfdi/previsualizar`). */
export type CfdiPrevisualizacion =
  paths['/api/terceros/cfdi/previsualizar']['post']['responses']['200']['content']['application/json'];
/** Datos fiscales extraídos de un CFDI. */
export type CfdiDatos = CfdiPrevisualizacion['datos'];
/** Un concepto (renglón) del CFDI. */
export type CfdiConcepto = CfdiDatos['conceptos'][number];
/** Proveedor candidato (match por RFC del emisor). */
export type CfdiCandidatoProveedor = NonNullable<CfdiPrevisualizacion['candidatoProveedor']>;
/** Orden de compra candidata para conciliar. */
export type CfdiCandidatoOc = CfdiPrevisualizacion['candidatosOc'][number];
/** Resultado de importar un CFDI (`POST /api/terceros/cfdi/importar`). */
export type CfdiImportarSalida =
  paths['/api/terceros/cfdi/importar']['post']['responses']['201']['content']['application/json'];
/** Cuerpo de la importación de un CFDI. */
export type CfdiImportarEntrada =
  paths['/api/terceros/cfdi/importar']['post']['requestBody']['content']['application/json'];

// ── CxC: cuentas por cobrar de clientes (Módulo 14, F9-E4) ────────────────────

/** Bandeja "por cobrar" con aging + resumen (`GET /api/cxc/por-cobrar`). */
export type CxcBandeja =
  paths['/api/cxc/por-cobrar']['get']['responses']['200']['content']['application/json'];
/** Un renglón de la bandeja (cliente + saldo + cubetas de aging). */
export type CxcBandejaFila = CxcBandeja['filas'][number];
/** Resumen (KPIs) de la bandeja de CxC. */
export type CxcResumen = CxcBandeja['resumen'];
/** Parámetros de la bandeja (querystring). */
export type CxcBandejaQuery = NonNullable<
  paths['/api/cxc/por-cobrar']['get']['parameters']['query']
>;

/** Estado de cuenta de un cliente (`GET /api/cxc/clientes/{id}/estado-cuenta`). */
export type CxcEstadoCuenta =
  paths['/api/cxc/clientes/{id}/estado-cuenta']['get']['responses']['200']['content']['application/json'];
/** Un renglón del estado de cuenta del cliente. */
export type CxcEstadoCuentaMovimiento = CxcEstadoCuenta['movimientos'][number];
/** Parámetros del estado de cuenta (querystring). */
export type CxcEstadoCuentaQuery = NonNullable<
  paths['/api/cxc/clientes/{id}/estado-cuenta']['get']['parameters']['query']
>;

/** Alta de un movimiento de CxC (`POST /api/cxc/clientes/{id}/movimientos`). */
export type CxcMovimientoCrear =
  paths['/api/cxc/clientes/{id}/movimientos']['post']['requestBody']['content']['application/json'];
/** Movimiento devuelto por el alta/cancelación de CxC (renglón del libro de terceros). */
export type CxcMovimientoSalida =
  paths['/api/cxc/clientes/{id}/movimientos']['post']['responses']['201']['content']['application/json'];
/** Origen de un movimiento de CxC capturable. */
export type CxcOrigen = CxcMovimientoCrear['origen'];
/** Cancelación de un movimiento de CxC (`POST /api/cxc/movimientos/{id}/cancelar`). */
export type CxcMovimientoCancelar =
  paths['/api/cxc/movimientos/{id}/cancelar']['post']['requestBody']['content']['application/json'];

// ── Importación de CFDI de ventas (Módulo 14, F9-E4; R12) ───────────────────────
/** Previsualización de un CFDI de venta (`POST /api/terceros/cfdi-ventas/previsualizar`). */
export type CfdiVentaPrevisualizacion =
  paths['/api/terceros/cfdi-ventas/previsualizar']['post']['responses']['200']['content']['application/json'];
/** Datos fiscales extraídos de un CFDI de venta. */
export type CfdiVentaDatos = CfdiVentaPrevisualizacion['datos'];
/** Cliente candidato (match por RFC del receptor). */
export type CfdiCandidatoCliente = NonNullable<CfdiVentaPrevisualizacion['candidatoCliente']>;
/** Pedido candidato para conciliar. */
export type CfdiCandidatoPedido = CfdiVentaPrevisualizacion['candidatosPedido'][number];
/** Resultado de importar un CFDI de venta (`POST /api/terceros/cfdi-ventas/importar`). */
export type CfdiVentaImportarSalida =
  paths['/api/terceros/cfdi-ventas/importar']['post']['responses']['201']['content']['application/json'];
/** Cuerpo de la importación de un CFDI de venta. */
export type CfdiVentaImportarEntrada =
  paths['/api/terceros/cfdi-ventas/importar']['post']['requestBody']['content']['application/json'];

// ── Reportes fiscales para el contador (Módulo 14, F9-E5; R13) ──────────────────

/** Reporte fiscal: movimientos fiscales + totales (`GET /api/reportes-fiscales`). */
export type ReporteFiscal =
  paths['/api/reportes-fiscales']['get']['responses']['200']['content']['application/json'];
/** Un renglón del reporte fiscal (movimiento con CFDI). */
export type ReporteFiscalFila = ReporteFiscal['filas'][number];
/** Totales del periodo del reporte fiscal. */
export type ReporteFiscalTotales = ReporteFiscal['totales'];
/** Parámetros del reporte fiscal (querystring). */
export type ReporteFiscalQuery = NonNullable<
  paths['/api/reportes-fiscales']['get']['parameters']['query']
>;
/** Tablero de salud fiscal (`GET /api/reportes-fiscales/salud`). */
export type SaludFiscal =
  paths['/api/reportes-fiscales/salud']['get']['responses']['200']['content']['application/json'];
/** Un saldo fiscal por tercero del tablero de salud. */
export type SaldoFiscalTercero = SaludFiscal['saldos'][number];

/** Pagina del archivo historico de ordenes (`GET /api/historico-ordenes`, §Post-F9.26). */
export type HistoricoOrdenesPagina =
  paths['/api/historico-ordenes']['get']['responses']['200']['content']['application/json'];
/** Un renglon del archivo historico. */
export type HistoricoOrdenResumen = HistoricoOrdenesPagina['datos'][number];
/** Filtros del buscador del archivo historico (querystring). */
export type HistoricoOrdenesQuery = NonNullable<
  paths['/api/historico-ordenes']['get']['parameters']['query']
>;
/** Ficha completa de una orden historica (matriz color x talla + quien la trabajo). */
export type HistoricoOrdenDetalle =
  paths['/api/historico-ordenes/{id}']['get']['responses']['200']['content']['application/json'];

/** Pagina del directorio historico de terceros (`GET /api/directorio-terceros`, §Post-F9.28). */
export type DirectorioTercerosPagina =
  paths['/api/directorio-terceros']['get']['responses']['200']['content']['application/json'];
/** Un tercero del directorio historico. */
export type DirectorioTercero = DirectorioTercerosPagina['datos'][number];
/** Filtros del buscador del directorio historico (querystring). */
export type DirectorioTercerosQuery = NonNullable<
  paths['/api/directorio-terceros']['get']['parameters']['query']
>;
