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
import { registrarManejadorErrores } from './api/errores.js';
import { rutasModelos } from './api/modelos/modelos.rutas.js';
import { rutasPedidos } from './api/pedidos/pedidos.rutas.js';
import { rutasInventarioAvios } from './api/inventarios/avios.rutas.js';
import { rutasMovimientosPt } from './api/inventarios/movimientos-pt.rutas.js';
import { rutasInventarioTelas } from './api/inventarios/telas.rutas.js';
import { rutasTiposMovimiento } from './api/inventarios/tipos-movimiento.rutas.js';
import { rutasOrdenesCompra } from './api/compras/ordenes-compra.rutas.js';
import { rutasCargosEsMa } from './api/esma/cargos.rutas.js';
import { rutasConsultasOrden } from './api/produccion/consultas.rutas.js';
import { rutasEntregasCliente } from './api/produccion/entregas-cliente.rutas.js';
import { rutasEtapasProduccion } from './api/produccion/etapas.rutas.js';
import { rutasImpresosOrden } from './api/produccion/impresos.rutas.js';
import { rutasOrdenes } from './api/produccion/ordenes.rutas.js';
import { rutasRecibosProduccion } from './api/produccion/recibos.rutas.js';
import { rutasTiposProceso } from './api/produccion/tipos-proceso.rutas.js';
import { rutasWip } from './api/produccion/wip.rutas.js';
import { rutasProveedores } from './api/proveedores/proveedores.rutas.js';
import { rutasRoles } from './api/roles/roles.rutas.js';
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

  // 2) Autenticacion: decoradores en la raiz + catch-all /api/auth/*.
  registrarAuth(app, opciones.auth ?? {});

  // 3) OpenAPI generado desde los Zod + Swagger UI navegable.
  await app.register(fastifySwagger, opcionesSwagger);
  await app.register(fastifySwaggerUi, { routePrefix: RUTA_DOCS });

  // 4) Routers de modulos (cada uno bajo /api).
  await app.register(rutasSalud, { prefix: '/api' });
  await app.register(rutasSesion, { prefix: '/api' });
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
  // Órdenes de producción (Módulo ÓRDENES, F2-E2) — alta desde un renglón de pedido, encabezado,
  // matriz (colores × tallas, total derivado), copiar matriz, cancelar (suave), referencias (D7)
  // y comentarios. Folio por empresa (A3/A9). Sin rutas de UPC.
  await app.register(rutasOrdenes, { prefix: '/api' });
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
  // Administración (F1-E1 PIEZA C) — rutas REST sobre los servicios de dominio de F0.
  await app.register(rutasUsuarios, { prefix: '/api' });
  await app.register(rutasEmpresas, { prefix: '/api' });
  await app.register(rutasRoles, { prefix: '/api' });

  return app;
}
