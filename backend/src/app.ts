import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { rutasAlmacenes } from './api/almacenes/almacenes.rutas.js';
import { rutasAvios } from './api/avios/avios.rutas.js';
import { rutasBordados } from './api/bordados/bordados.rutas.js';
import { rutasClientes } from './api/clientes/clientes.rutas.js';
import { rutasColores } from './api/colores/colores.rutas.js';
import { rutasEmpresas } from './api/empresas/empresas.rutas.js';
import { rutasEtiquetasMarca } from './api/etiquetas-marca/etiquetas-marca.rutas.js';
import { registrarNoCacheDocumentos } from './api/cache-documentos.js';
import { registrarManejadorErrores } from './api/errores.js';
import { rutasModelos } from './api/modelos/modelos.rutas.js';
import { rutasMedidasAvioTalla } from './api/modelos/medidas-avio-talla.rutas.js';
import { rutasPedidos } from './api/pedidos/pedidos.rutas.js';
import { rutasAdjuntosPedido } from './api/pedidos/adjuntos-pedido.rutas.js';
import { rutasSalidaProduccion } from './api/pedidos/salida-produccion.rutas.js';
import { rutasImportacionPedido } from './api/pedidos/importacion-pedido.rutas.js';
import { rutasImportacionPdf } from './api/pedidos/importacion-pdf.rutas.js';
// Desarrollo, Cotización y Listas de Precios (Módulo 15, F8-E1) — catálogos de configuración +
// sub-recursos de Tela/Cliente/Modelo. Los módulos de Proyecto/Precosto/Lista/Negociación llegan
// en E2–E6 (su modelo de datos ya nace en la migración de E1).
import { rutasConceptosCosto } from './api/desarrollo/conceptos-costo.rutas.js';
import { rutasEstadosLista } from './api/desarrollo/estados-lista.rutas.js';
// Desarrollo (Módulo 15, F8-E2): proyectos por Cliente+Departamento y sus desarrollos (un modelo
// con dos números; estado DERIVADO). La capa previa a la cotización.
import { rutasProyectos } from './api/desarrollo/proyectos.rutas.js';
import { rutasDesarrollos } from './api/desarrollo/desarrollos.rutas.js';
// Desarrollo (Módulo 15, F8-E3): precosto PERSISTIDO por desarrollo (versionable por congelado
// inmutable), calculado desde el BOM con los precios amarrados de E1.
import { rutasPrecostos } from './api/desarrollo/precostos.rutas.js';
// Rediseño R5 (Módulo 15): tech pack / adjuntos del desarrollo (B16) + resolvedor de dificultad por
// # de operaciones para el editor (B7). Reusan el RBAC desarrollo.*, sin permisos nuevos.
import { rutasAdjuntosDesarrollo } from './api/desarrollo/adjuntos-desarrollo.rutas.js';
import { rutasDificultad } from './api/desarrollo/dificultad.rutas.js';
// Desarrollo (Módulo 15, F8-E4): listas de precios por Cliente+Departamento (factores + aprobación
// del dueño + PDF/Excel) y los factores del cliente (sub-recurso del cliente).
import { rutasListasPrecios } from './api/desarrollo/listas-precios.rutas.js';
// Desarrollo (Módulo 15, F8-E6): enganche Desarrollo↔Producción — ligar orden↔desarrollo, sugerencia
// de liga + precio, vista 360 desde la orden y tablero de desarrollos por estado.
import { rutasLigaOrden } from './api/desarrollo/liga-orden.rutas.js';
import { rutasClienteFactores } from './api/clientes/cliente-factores.rutas.js';
import { rutasTelaProveedores } from './api/telas/tela-proveedores.rutas.js';
import { rutasClienteDepartamentos } from './api/clientes/cliente-departamentos.rutas.js';
import { rutasInventarioAvios } from './api/inventarios/avios.rutas.js';
import { rutasMovimientosPt } from './api/inventarios/movimientos-pt.rutas.js';
import { rutasInventarioTelas } from './api/inventarios/telas.rutas.js';
import { rutasEntradasTela } from './api/inventarios/entradas-tela.rutas.js';
import { rutasTiposMovimiento } from './api/inventarios/tipos-movimiento.rutas.js';
import { rutasDireccionesEntrega } from './api/compras/direcciones-entrega.rutas.js';
import { rutasOrdenesCompra } from './api/compras/ordenes-compra.rutas.js';
import { rutasRecepcionesCompra } from './api/compras/recepciones.rutas.js';
import { rutasMrp } from './api/compras/mrp.rutas.js';
import { rutasNotasSalida } from './api/notas/notas-salida.rutas.js';
import { rutasCostos } from './api/costos/costos.rutas.js';
import { rutasEdr } from './api/edr/edr.rutas.js';
import { rutasIndicadores } from './api/indicadores/indicadores.rutas.js';
import { rutasProductividad } from './api/indicadores/productividad.rutas.js';
import { rutasFichas } from './api/indicadores/fichas.rutas.js';
import { rutasMuestrarios } from './api/indicadores/muestrarios.rutas.js';
import { rutasCiclicos } from './api/indicadores/ciclicos.rutas.js';
import { rutasCargosEsMa } from './api/esma/cargos.rutas.js';
import { rutasMovimientosEsMa } from './api/esma/movimientos.rutas.js';
import { rutasPagosEsMa } from './api/esma/pagos.rutas.js';
import { rutasCuentaEsMa } from './api/esma/cuenta.rutas.js';
import { rutasEstadoCuentaEsMa } from './api/esma/estado-cuenta.rutas.js';
import { rutasTerceros } from './api/terceros/movimientos.rutas.js';
import { rutasCxp } from './api/terceros/cxp.rutas.js';
import { rutasCfdi } from './api/terceros/cfdi.rutas.js';
import { rutasCxc } from './api/terceros/cxc.rutas.js';
import { rutasCfdiVentas } from './api/terceros/cfdi-ventas.rutas.js';
import { rutasReportesFiscales } from './api/terceros/reportes-fiscales.rutas.js';
import { rutasConsultasOrden } from './api/produccion/consultas.rutas.js';
import { rutasEntregasCliente } from './api/produccion/entregas-cliente.rutas.js';
import { rutasEtapasProduccion } from './api/produccion/etapas.rutas.js';
import { rutasImpresosOrden } from './api/produccion/impresos.rutas.js';
import { rutasOrdenes } from './api/produccion/ordenes.rutas.js';
import { rutasAdjuntosOrden } from './api/produccion/adjuntos-orden.rutas.js';
import { rutasRecibosProduccion } from './api/produccion/recibos.rutas.js';
import { rutasTiposProceso } from './api/produccion/tipos-proceso.rutas.js';
import { rutasWip } from './api/produccion/wip.rutas.js';
import { rutasBitacora } from './api/admin/bitacora.rutas.js';
import { rutasAuditorias } from './api/calidad/auditorias.rutas.js';
import { rutasDefectos } from './api/calidad/defectos.rutas.js';
import { rutasPlanesAql } from './api/calidad/planes-aql.rutas.js';
import { rutasTiposProducto } from './api/calidad/tipos-producto.rutas.js';
import { rutasAuditores } from './api/calidad/auditores.rutas.js';
import { rutasBandejaRc } from './api/ruta-critica/bandeja.rutas.js';
import { rutasConcentradoRc } from './api/ruta-critica/concentrado.rutas.js';
import { rutasAnalisisRc } from './api/ruta-critica/analisis.rutas.js';
import { rutasPlantillasRc } from './api/ruta-critica/plantillas.rutas.js';
import { rutasProcesosRc } from './api/ruta-critica/procesos.rutas.js';
import { rutasProgramacionRc } from './api/ruta-critica/programacion.rutas.js';
import { rutasHitosRc } from './api/ruta-critica/hitos.rutas.js';
import { rutasProveedores } from './api/proveedores/proveedores.rutas.js';
import { rutasRoles } from './api/roles/roles.rutas.js';
import { rutasResumen } from './api/resumen/resumen.rutas.js';
import { rutasSalud } from './api/salud/salud.rutas.js';
import { rutasSesion } from './api/sesion/sesion.rutas.js';
import { rutasTallas } from './api/tallas/tallas.rutas.js';
import { rutasTelas } from './api/telas/telas.rutas.js';
import { rutasTemporadas } from './api/temporadas/temporadas.rutas.js';
import { rutasUsuarios } from './api/usuarios/usuarios.rutas.js';
import { registrarAuth, type OpcionesAuth } from './auth/plugin.js';
import { opcionesSwagger, RUTA_DOCS } from './openapi.js';

/** Opciones para construir la aplicacion Fastify. */
export interface OpcionesApp {
  /**
   * Habilita el formateo legible de logs (pino-pretty), util en desarrollo.
   * En produccion se dejan los logs en JSON estructurado.
   */
  logBonito?: boolean;
  /**
   * Inyección de la autenticación (better-auth + cliente Prisma). Por defecto
   * usa los singletons de la app; las pruebas de integración lo apuntan al
   * Postgres efímero.
   */
  auth?: OpcionesAuth;
}

/**
 * Construye y configura la instancia de Fastify (sin ponerla a escuchar).
 *
 * Separar la construccion de la escucha (`servidor.ts`) mantiene la app
 * facilmente probable: los tests de integracion usan `app.inject()` sin abrir
 * un puerto.
 *
 * Orden de armado (importa):
 *  1. Compiladores Zod (validacion de entrada + serializacion de salida) y
 *     manejador de errores unico: se fijan en la raiz para toda la app.
 *  2. Autenticacion (`registrarAuth`): decora la raiz con `obtenerSesion` y
 *     `conPermiso` (se propagan a los routers) y monta `/api/auth/*`.
 *  3. OpenAPI: `@fastify/swagger` (genera el contrato desde los Zod) + Swagger
 *     UI en `/api/docs`.
 *  4. Routers de modulos bajo `/api` (el nginx del frontend proxya /api -> backend).
 */
export async function construirApp(opciones: OpcionesApp = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opciones.logBonito
      ? {
          level: process.env.LOG_LEVEL ?? 'info',
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' },
          },
        }
      : { level: process.env.LOG_LEVEL ?? 'info' },
  });

  // 1) Zod como validador de entrada y serializador de salida de toda ruta con
  //    `schema`, y el error handler que traduce ErrorDominio/Zod -> HTTP.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(app);
  // 1.b) Anti-caché de documentos generados (impresos PDF / exports Excel). Punto COMÚN para
  //      todas las rutas: sin esto el navegador servía un PDF viejo tras un despliegue.
  registrarNoCacheDocumentos(app);

  // 2) Autenticacion: decoradores en la raiz + catch-all /api/auth/*.
  registrarAuth(app, opciones.auth ?? {});

  // 3) OpenAPI generado desde los Zod + Swagger UI navegable.
  await app.register(fastifySwagger, opcionesSwagger);
  await app.register(fastifySwaggerUi, { routePrefix: RUTA_DOCS });

  // 4) Routers de modulos (cada uno bajo /api).
  await app.register(rutasSalud, { prefix: '/api' });
  await app.register(rutasSesion, { prefix: '/api' });
  // RESUMEN OPERATIVO de la portada (rediseño R9, proto vResumen): KPIs de vistazo + órdenes por
  // vencer (semáforo RC) + cortes por semana, en una respuesta. Cada bloque respeta el permiso de
  // su dominio dueño (A4, patrón contarAlertas): sin permiso, el bloque llega null.
  await app.register(rutasResumen, { prefix: '/api' });
  await app.register(rutasAlmacenes, { prefix: '/api' });
  // Catálogos maestros globales (F1-E1) — patrón CRUD de Almacenes. NOTA: cortadores y
  // maquileros se fusionaron en proveedores (un tercero con sus roles de servicio, D12/R15).
  await app.register(rutasProveedores, { prefix: '/api' });
  await app.register(rutasTemporadas, { prefix: '/api' });
  await app.register(rutasEtiquetasMarca, { prefix: '/api' });
  await app.register(rutasColores, { prefix: '/api' });
  // Catálogos estructurados (F1-E2) — tallas/curvas (D4), clientes (D7).
  await app.register(rutasTallas, { prefix: '/api' });
  await app.register(rutasClientes, { prefix: '/api' });
  // Catálogos de materiales (F1-E3) — telas unificadas (D5) + colores, avíos (R1) + proveedores,
  // bordados (R2) + foto. Cada plugin define rutas internas sin `/api`; va bajo el prefijo `/api`.
  await app.register(rutasTelas, { prefix: '/api' });
  await app.register(rutasAvios, { prefix: '/api' });
  await app.register(rutasBordados, { prefix: '/api' });
  // Modelos (Módulo 2, F1-E4) — catálogo de productos + receta/BOM + fotos. Selector de
  // géneros (`GET /api/generos`) bajo `modelos.ver`.
  await app.register(rutasModelos, { prefix: '/api' });
  // Pedidos (Módulo PEDIDOS, F2-E1) — pedido interno (CRUD + copiar + cancelar) + pedido real
  // (crear desde pedido, listar, editar, seguimiento). Folio por empresa (A3/A9). Importes
  // ocultados server-side sin `pedidos.importes`.
  await app.register(rutasPedidos, { prefix: '/api' });
  // Pedidos — ADJUNTOS en R2 (rediseño R3, B3): el documento original de la OC del cliente
  // (Excel/PDF/imágenes) ligado al pedido vía presigned. Permisos `pedidos.ver` / `pedidos.administrar`.
  await app.register(rutasAdjuntosPedido, { prefix: '/api' });
  // Pedidos — FLUJO NUEVO (rediseño R3, B4/B6): consulta por mes (pantalla nueva), candidatos de
  // desarrollo del constructor y "Generar OP" (salida a producción). Rutas estáticas con prioridad
  // sobre `/pedidos/:id` (find-my-way).
  await app.register(rutasSalidaProduccion, { prefix: '/api' });
  // Pedidos — IMPORTADOR del pedido del cliente (rediseño R8, B15): plantilla de mapeo por cliente,
  // analizar/preview del Excel y confirmar (crea pedido + OPs con matriz + RC, reusa salidaAProduccion).
  // Paths estáticos `/pedidos/importacion/...` con prioridad sobre `/pedidos/:id`. Sin permisos nuevos.
  await app.register(rutasImportacionPedido, { prefix: '/api' });
  // Pedidos — IMPORTADOR de OC del cliente por PDF (petición Daniel — plantilla C&A): analizar N PDFs
  // (vista previa) y confirmar (pedido + una OP por PDF con matriz + RC + adjunto). Paths estáticos
  // `/pedidos/importacion-pdf/...` con prioridad sobre `/pedidos/:id`. Sin permisos nuevos.
  await app.register(rutasImportacionPdf, { prefix: '/api' });
  // Órdenes de producción (Módulo ÓRDENES, F2-E2) — alta desde un renglón de pedido, encabezado,
  // matriz (colores × tallas, total derivado), copiar matriz, cancelar (suave), referencias (D7)
  // y comentarios. Folio por empresa (A3/A9). Sin rutas de UPC.
  await app.register(rutasOrdenes, { prefix: '/api' });
  // Órdenes — ADJUNTOS de apoyo en R2 (F8-E6, R6): sube/lista/borra archivos (Excel/PDF/imágenes)
  // ligados a una orden vía presigned. Permisos `ordenes.ver` (listar/descargar) / `ordenes.administrar`
  // (subir/eliminar); el DELETE borra también el objeto físico de R2 (best-effort). Sin permisos nuevos.
  await app.register(rutasAdjuntosOrden, { prefix: '/api' });
  // Órdenes — CONSULTAS/TABLEROS/BÚSQUEDA (F2-E4 PIEZA B): consulta ligera, incompletas con
  // semáforo, tablero "pedidos por mes" y buscador global. Solo lectura (`ordenes.ver`). Sus paths
  // estáticos se registran ANTES de nada que choque con `/ordenes/:id` (Fastify los prioriza).
  await app.register(rutasConsultasOrden, { prefix: '/api' });
  // Órdenes — IMPRESOS (F2-E4 PIEZA A): PDF individual (`/ordenes/:id/impreso`) y lote consolidado
  // (`POST /ordenes/impresos`). Binarios `application/pdf`. Solo lectura (`ordenes.ver`).
  await app.register(rutasImpresosOrden, { prefix: '/api' });
  // Órdenes de COMPRA (Módulo 3, F4-E2): CRUD del documento de compra de material a un proveedor
  // (encabezado + líneas tela/avío/libre + matriz talla×color opcional + órdenes ligadas R7),
  // autorización, cancelación suave y duplicado. Folio por empresa (A3/A9). NO mueve kardex (E3).
  await app.register(rutasOrdenesCompra, { prefix: '/api' });
  // Catálogo de direcciones de entrega de la OC (§Post-F9.18): sin permisos propios, va con compras.
  await app.register(rutasDireccionesEntrega, { prefix: '/api' });
  // RECEPCIÓN de compras (Módulo 3, F4-E3): el hecho que conecta la OC con el kardex de
  // materiales — recibir (parcial/total) crea el lote de tela (D5) y mueve el kardex de
  // telas/avíos con cantidad/costo ya convertidos a unidad de consumo (R1); reverso suave (D3).
  // Solo se recibe contra una OC autorizada/recibida_parcial (decisión b, server-side).
  await app.register(rutasRecepcionesCompra, { prefix: '/api' });
  // EXPLOSIÓN MRP (Módulo 3, F4-E4, R3/R7): explosiona el BOM del modelo contra la matriz de la
  // orden → qué/cuánto comprar (netea genéricos contra el kardex, decisión d), genera OC por
  // proveedor en un clic, y el tablero "qué tengo / qué falta" (cruce requerido/en-oc/recibido).
  // NO crea permisos nuevos (usa los compras.* de E2).
  await app.register(rutasMrp, { prefix: '/api' });
  // NOTAS DE SALIDA estructuradas (Módulo 5, F4-E5, R4/R9): documento de envío de materiales a un
  // maquilero contra una orden. Renglones de AVÍO descuentan el kardex al CONFIRMAR (`salida-por-nota`);
  // los de TELA REFERENCIAN su salida-a-orden de E1 SIN segundo movimiento (anti-doble-descuento,
  // decisión (e)). Folio por empresa (A3/A9); cancelación suave con reverso de avíos (D3).
  await app.register(rutasNotasSalida, { prefix: '/api' });
  // Producción / WIP + kardex (Módulo 4/6, F3-E1): CRUD de tipos de proceso (con la bandera
  // generaEntradaPt editable solo por admin) y GET solo-lectura de tipos de movimiento de
  // inventario. El motor (kardex/eventos) vive en comun/; los flujos (corte/recibo/entrega)
  // llegan en E2–E5.
  await app.register(rutasTiposProceso, { prefix: '/api' });
  await app.register(rutasTiposMovimiento, { prefix: '/api' });
  // Inventario PT operable (Módulo 6, F3-E3): movimientos manuales (entrada/salida/ajuste),
  // traspasos entre almacenes (dos patas), cancelación por inverso auditado (D3), existencias
  // (vista) y kardex (por modelo con saldo corrido + por folio). RBAC inventario-pt.ver/.mover.
  await app.register(rutasMovimientosPt, { prefix: '/api' });
  // Inventario de TELAS y AVÍOS por kardex (Módulo 4, F4-E1, D5/R4): ajustes (telas con lote
  // multi-componente), salida de tela a orden (traza Salidas.IdOrdenes), traspasos, cancelación por
  // inverso (D3), existencias (vistas) y kardex. Importes de telas ocultos sin telas.ver-totales
  // (ex-acceso #7). RBAC inventario-telas/.avios ver/.mover.
  await app.register(rutasInventarioTelas, { prefix: '/api' });
  // ENTRADA de tela por FACTURA/REMISIÓN sin orden de compra (B1, DECISIONES §Post-F9.9 p.7): la
  // segunda vía de entrada del inventario por color — documento con cabecera + N partidas, PDF de
  // la factura adjunto en R2, confirmación que crea partidas + kardex y cancelación por inverso.
  await app.register(rutasEntradasTela, { prefix: '/api' });
  await app.register(rutasInventarioAvios, { prefix: '/api' });
  // Producción / WIP — ETAPAS (F3-E2): corte + envío a maquila unificado (M/A por TipoProceso, D8),
  // cancelación suave, pendientes derivados por orden, corte semanal por cortador y los 2 PDFs
  // (documento de envío + ficha de estampado). RBAC por ruta (produccion.corte/.envio/.cancelar/
  // .wip-ver). El corte/envío NO tocan el kardex PT (eso entra en E4 recibo / E5 entrega).
  await app.register(rutasEtapasProduccion, { prefix: '/api' });
  // Producción / WIP — RECIBO de maquila (F3-E4, etapa ⭐ central): de UNA captura se derivan WIP +
  // entrada a PT (solo costura, generaEntradaPt) + cargo EsMa propuesto. Cancelación con inverso de
  // kardex; pendientes por recibir; recibos semanales por maquilero; PDF de recibo. RBAC por ruta
  // (produccion.recibo/.cancelar/.wip-ver).
  await app.register(rutasRecibosProduccion, { prefix: '/api' });
  // Producción / WIP — ENTREGA a cliente (F3-E5): cierre del ciclo de la orden. Salida de PT
  // (kardex) no-negativa bajo lock, seguimiento del pedido DERIVADO (pedido − entregado),
  // cancelación con inverso de kardex y comprobante PDF. RBAC produccion.entrega/.cancelar/.wip-ver.
  await app.register(rutasEntregasCliente, { prefix: '/api' });
  // Producción / WIP — TABLERO de avance + existencias en poder del maquilero (F3-E5): el WIP de las
  // órdenes (derivado por suma) y lo enviado − recibido a cada maquilero. Solo lectura
  // (produccion.wip-ver).
  await app.register(rutasWip, { prefix: '/api' });
  // EsMa (F3-E4) — cola de validación de cargos de maquila derivados de los recibos (propuesto →
  // validado, ajustando cantidad/precio reales). RBAC esma.cargo-validar.
  await app.register(rutasCargosEsMa, { prefix: '/api' });
  // EsMa (F6-E4) — corazón contable: abonos/descuentos (esma.modificar), pagos ligados a cargos con
  // anti-doble-pago (esma.ver-pagos) + recibo de pago PDF, saldo derivado (D3), conciliación vs recibos
  // y estatus "orden pagada" derivado + override. Importes ocultos sin consultas.ver-importes.
  await app.register(rutasMovimientosEsMa, { prefix: '/api' });
  await app.register(rutasPagosEsMa, { prefix: '/api' });
  await app.register(rutasCuentaEsMa, { prefix: '/api' });
  // EsMa (F6-E5) — experiencia de usuario: estado de cuenta unificado + desglosado (+ PDF R9 + Excel),
  // saldos de todos, pagos/recibos semanales, selector de maquileros y revisión de partidas. Consulta
  // con esma.ver-pagos; revisar con esma.modificar. Importes ocultos sin consultas.ver-importes.
  await app.register(rutasEstadoCuentaEsMa, { prefix: '/api' });
  // FINANZAS (Módulo 14, F9-E1) — MOTOR único de cuenta corriente de terceros (CxC/CxP) que
  // generaliza EsMa (D12/D15/R10): registrar/cancelar movimientos (terceros.administrar), saldo
  // derivado (D3) y estado de cuenta con vista operativa/fiscal (terceros.ver; la fiscal exige
  // terceros.fiscal). Para un proveedor, saldo/estado de cuenta INCLUYEN EsMa por convivencia.
  await app.register(rutasTerceros, { prefix: '/api' });
  // FINANZAS (Módulo 14, F9-E2) — CxP: cuentas por pagar de proveedores (uso del motor de terceros):
  // bandeja "por pagar" con antigüedad de saldos (aging server-side), estado de cuenta (+ PDF) y
  // captura/cancelación de movimientos (cxp.ver / cxp.administrar; la vista fiscal exige terceros.fiscal).
  await app.register(rutasCxp, { prefix: '/api' });
  // FINANZAS (Módulo 14, F9-E3) — Importación de CFDI de proveedores (R11): parser/validador CFDI 4.0,
  // previsualización con conciliación (proveedor por RFC + OC por total cercano) e importación
  // transaccional (XML en R2 + cargo FISCAL de CxP por el total del CFDI). Reusa cxp.administrar.
  await app.register(rutasCfdi, { prefix: '/api' });
  // FINANZAS (Módulo 14, F9-E4) — CxC: cuentas por cobrar de clientes (uso del motor de terceros,
  // espejo de CxP): bandeja "por cobrar" con antigüedad de saldos (aging server-side), estado de cuenta
  // (+ PDF) y captura/cancelación de movimientos (cxc.ver / cxc.administrar; la vista fiscal exige
  // terceros.fiscal). Los clientes no maquilan → sin convivencia EsMa.
  await app.register(rutasCxc, { prefix: '/api' });
  // FINANZAS (Módulo 14, F9-E4) — Importación de CFDI de VENTAS (R12): reusa el parser CFDI 4.0 de E3;
  // el EMISOR debe ser la empresa activa y el RECEPTOR es el cliente; previsualización con conciliación
  // (cliente por RFC + pedido por total cercano) e importación transaccional (XML en R2 + cargo FISCAL
  // de CxC por el total del CFDI). Reusa cxc.administrar.
  await app.register(rutasCfdiVentas, { prefix: '/api' });
  // FINANZAS (Módulo 14, F9-E5) — Reportes fiscales para el contador (R13): la VISTA FISCAL del libro
  // de terceros (movimientos esFiscal=true de CxP + CxC) con su CFDI, paginada + totales; el tablero de
  // salud fiscal (conciliación consolidada + saldos por tercero) y los exports Excel/PDF. Todo lectura,
  // permiso terceros.fiscal (REUSADO → deploy SIN SEED_ON_START).
  await app.register(rutasReportesFiscales, { prefix: '/api' });
  // RUTA CRÍTICA (Módulo 8, F5-E1) — catálogo CONFIGURABLE: procesos (CRUD + borrado suave),
  // roles responsables (N:M sobre el RBAC único), dependencias (DAG con rechazo de ciclos) y
  // checklists. RBAC por ruta (rc.catalogo-ver / rc.catalogo-administrar). El MOTOR (instancias
  // por orden, fechas/semáforos) y las plantillas llegan en E2+.
  await app.register(rutasProcesosRc, { prefix: '/api' });
  // RUTA CRÍTICA (Módulo 8, F5-E2) — plantillas de ruta (procesos + tiempo estándar + encadenamiento
  // propio DAG), reglas de duración (cantidad/tela/aplicación), familias/artículos y calendario
  // laboral por empresa (días hábiles + festivos). RBAC reusa rc.catalogo-ver / rc.catalogo-administrar.
  await app.register(rutasPlantillasRc, { prefix: '/api' });
  // RUTA CRÍTICA (Módulo 8, F5-E3) — MOTOR de la ruta viva por orden (pt1): programar (generar/
  // re-generar la ruta desde la plantilla aplicable, omitiendo condicionales y reconectando
  // transitivamente; duración por las reglas de E2), ajustar la ruta de esa orden (sin tocar la
  // plantilla, D10) y consultarla. Encola el recálculo del CPM (pg-boss); las FECHAS las calcula
  // E4. RBAC por ruta (rc.programar muta, rc.ruta-ver consulta).
  await app.register(rutasProgramacionRc, { prefix: '/api' });
  // RUTA CRÍTICA (post-F9) — HITOS de la orden: actos puntuales capturados a mano (revisión OP, fit,
  // tono de tela, avíos, empaque, arte) que auto-completan su proceso RC vía el auto-avance (cierre
  // del hueco de emisores). RBAC rc.ruta-ver (listar) / rc.capturar (registrar/cancelar); A9.
  await app.register(rutasHitosRc, { prefix: '/api' });
  // RUTA CRÍTICA (Módulo 8, F5-E5) — BANDEJA "mis tareas" (procesos activos a capturar, por urgencia,
  // de los que el usuario es responsable; o todas con supervisión) + CONTEO de alertas (atrasados/
  // enRiesgo) para el badge del header. Solo lectura; RBAC rc.ruta-ver; semáforo/atraso DERIVADOS.
  await app.register(rutasBandejaRc, { prefix: '/api' });
  // RUTA CRÍTICA (Módulo 8, F5-E7) — CONCENTRADO "planeado vs real" (reemplaza RC_ConcentradoDif):
  // todas las órdenes con RC viva × sus procesos, con semáforo/atraso, AGREGADO en el servidor (SQL
  // crudo, sin pivoteo en el cliente), paginado/filtrable/ordenable, + export a Excel del mismo
  // resultado. Solo lectura; RBAC rc.ruta-ver (reusado); A9 por empresa activa.
  await app.register(rutasConcentradoRc, { prefix: '/api' });
  // RUTA CRÍTICA (Módulo 8, rediseño R7) — tablero de gestión "ANÁLISIS RC": salud de órdenes +
  // entrega/ciclo (vista F7-E3) + alertas predictivas (CPM forward pass) + riesgo por cliente +
  // cuellos, todo AGREGADO en el servidor (A1); y el desempeño del equipo (scoring + bono) en un
  // endpoint aparte con gate rc.programar (+ su export a Excel). Solo lectura; A9 por empresa activa.
  await app.register(rutasAnalisisRc, { prefix: '/api' });
  // CALIDAD (Módulo 8, F6-E1) — base configurable: catálogo de defectos enriquecido (severidad/
  // categoría/etiqueta por tipo), tipos de producto (clasificación de modelos) y el motor de planes
  // de muestreo AQL como DATOS (CRUD + resolución lote+nivel → muestra/límites). RBAC por ruta
  // (calidad.ver consulta / calidad.administrar-catalogo muta).
  await app.register(rutasDefectos, { prefix: '/api' });
  await app.register(rutasTiposProducto, { prefix: '/api' });
  // Catálogo de auditores (rediseño R9): CRUD patrón catálogo, reúsa los permisos de calidad.
  await app.register(rutasAuditores, { prefix: '/api' });
  await app.register(rutasPlanesAql, { prefix: '/api' });
  // Calidad — núcleo de auditorías (F6-E2): alta + captura de resultados + reclasificación + GETs de
  // apoyo. RBAC por ruta (calidad.generar-auditorias el alta; calidad.actualizar-auditorias la captura
  // y reclasificación; calidad.ver el detalle).
  await app.register(rutasAuditorias, { prefix: '/api' });
  // COSTOS (Módulo 6, F7-E1): pre-costo por modelo + lista de precios (precostos.consultar), costo real
  // por orden con doble juego teórico/guardado y base de prorrateo (costos.ver/.capturar), lista de
  // costos y márgenes por pedido (costos.ver, fórmula D2). Impresos R9 (lista de precios PDF, márgenes
  // PDF/Excel). Importes ocultos sin consultas.ver-importes. La regalía va sobre la venta, no en el costo.
  await app.register(rutasCostos, { prefix: '/api' });
  // EDR (Módulo 6, F7-E2): Estado de Resultados mensual CONSOLIDADO (todas las empresas paraEdr),
  // valuado a COSTO ACTUAL (D1). Genera/reconcilia las líneas desde las entregas a cliente del mes
  // (D2 #5), concilia el precio facturado, encabezado de gastos global (D2 #6) y cortes por empresa/
  // cliente. RBAC edr.ver/edr.capturar (mismos roles que costos). Impresos R9 (PDF mensual/anual, Excel).
  await app.register(rutasEdr, { prefix: '/api' });
  // INDICADORES (Módulo Indicadores, F7-E3): tableros directivos calculados en SEGUNDO PLANO sobre
  // vistas materializadas (KPIs de Ruta Crítica/D11, calidad por maquilero/F6, WIP analítico/F3). La
  // captura NUNCA espera el recálculo (plan §11): /indicadores/refrescar solo encola el job. RBAC
  // indicadores.ver (directivo/gerencial). Impresos R9 (PDF + Excel). Agregación en SQL (no en cliente).
  await app.register(rutasIndicadores, { prefix: '/api' });
  // INDICADORES · CAPTURA (Módulo Indicadores, F7-E4): motor de PRODUCTIVIDAD unificado IP/almacén
  // (personas, actividades y registros diarios; índice vs estándar por fórmula de área; tablero
  // agregado en servidor), FICHAS CONFIABLES (checklist por orden + % confiable) y MUESTRARIOS
  // pendientes (solicitud→entrega + KPI de cumplimiento). RBAC por área/aspecto (indicadores.ip-*/
  // almacen-productividad, ip-confiabilidad, ip-muestrarios); fecha libre con indicadores.fecha-libre.
  await app.register(rutasProductividad, { prefix: '/api' });
  await app.register(rutasFichas, { prefix: '/api' });
  await app.register(rutasMuestrarios, { prefix: '/api' });
  // Inventario cíclico (Módulo Indicadores / Almacén, F7-E5): alta que CONGELA el teórico (D6),
  // conteo CIEGO y ajuste como MOVIMIENTO de kardex (D3). RBAC `indicadores.ciclicos-*`.
  await app.register(rutasCiclicos, { prefix: '/api' });
  // Desarrollo, Cotización y Listas de Precios (Módulo 15, F8-E1, D13/R16–R20). Catálogos de
  // configuración de la fase (conceptos de costo R19, estados de lista R20; patrón `tipos-proceso`,
  // admin-only server-side) + sub-recursos habilitadores: precios de tela por proveedor/color (R17,
  // bajo `telas.*`), departamentos del cliente (bajo `clientes.*`) y medidas por talla del BOM (R18,
  // bajo `modelos.*`). Los flujos de Proyecto/Precosto/Lista/Negociación llegan en E2–E6.
  await app.register(rutasConceptosCosto, { prefix: '/api' });
  await app.register(rutasEstadosLista, { prefix: '/api' });
  await app.register(rutasTelaProveedores, { prefix: '/api' });
  await app.register(rutasClienteDepartamentos, { prefix: '/api' });
  await app.register(rutasMedidasAvioTalla, { prefix: '/api' });
  // Desarrollo (Módulo 15, F8-E2): proyectos de desarrollo (Cliente+Departamento, folio por empresa
  // A3/A9) y sus desarrollos (un modelo con dos números; estado DERIVADO, apagado = borrado suave con
  // motivo). RBAC desarrollo.ver/.administrar (ya sembrados en E1).
  await app.register(rutasProyectos, { prefix: '/api' });
  await app.register(rutasDesarrollos, { prefix: '/api' });
  // Desarrollo (Módulo 15, F8-E3): precosto persistido por desarrollo (RBAC desarrollo.ver/.precostear,
  // ya sembrados en E1). Importes ocultos sin consultas.ver-importes.
  await app.register(rutasPrecostos, { prefix: '/api' });
  // Rediseño R5: adjuntos del desarrollo (B16) + dificultad por # de operaciones (B7). RBAC
  // desarrollo.ver/.administrar (ya sembrados en E1). El `/desarrollos/dificultad` es segmento
  // estático (como `/desarrollos/tablero`), se registra ANTES de nada que dependa de `:id`.
  await app.register(rutasDificultad, { prefix: '/api' });
  await app.register(rutasAdjuntosDesarrollo, { prefix: '/api' });
  // Desarrollo (Módulo 15, F8-E4): factores del cliente (sub-recurso) + listas de precios por
  // Cliente+Departamento (folio A3/A9, aprobación del dueño, PDF/Excel). RBAC listas.* (sembrados en
  // E1); importes ocultos sin consultas.ver-importes.
  await app.register(rutasClienteFactores, { prefix: '/api' });
  await app.register(rutasListasPrecios, { prefix: '/api' });
  // Desarrollo (Módulo 15, F8-E6): enganche Desarrollo↔Producción (ligar/quitar orden↔desarrollo,
  // sugerencia de liga + precio propuesto, vista 360 y tablero por estado). RBAC desarrollo.ver/
  // .administrar (ya sembrados en E1); importes ocultos sin consultas.ver-importes.
  await app.register(rutasLigaOrden, { prefix: '/api' });
  // Administración (F1-E1 PIEZA C) — rutas REST sobre los servicios de dominio de F0.
  await app.register(rutasUsuarios, { prefix: '/api' });
  await app.register(rutasEmpresas, { prefix: '/api' });
  await app.register(rutasRoles, { prefix: '/api' });
  // Consulta de BITÁCORA (F6-E1, transversal) — lectura del log de auditoría A7 (admin.ver-bitacora).
  await app.register(rutasBitacora, { prefix: '/api' });

  return app;
}
