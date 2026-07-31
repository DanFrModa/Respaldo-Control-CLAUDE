import { z } from 'zod';

/**
 * Contrato Zod de la consulta PEDIDOS POR MES (rediseño R3, B6 — proto §4.1 `vPedidos`): la
 * pantalla de Pedidos nueva. Tabla AGRUPADA pedido → renglones/modelos, con TODO agregado EN EL
 * SERVIDOR (A1; lección F5-E7 — jamás pivotar en el cliente):
 *
 *  • cabecera del pedido `-F`: cliente, vigencia, chip de OC del cliente, cantidad/importe total;
 *  • cada renglón/modelo: cantidad · precio · importe · No. orden · corte · (el chip de estatus lo
 *    deriva la UI de cantidad/cortado/orden, como `estatusDeFila` del centro R2);
 *  • BARRA DE TOTALES del filtro completo (pedidos, órdenes, piezas, cortado, % avance, importe).
 *
 * Los IMPORTES (precio/importe/importe total) van en `null` sin `pedidos.importes` (ocultamiento
 * server-side, doc 02 §3). Las tabs de MES filtran por el mes de ENTREGA del pedido
 * (`fechaHasta ?? fechaDe`); un pedido sin ventana de entrega cae al mes de su `fechaPedido` (o de
 * su captura) — ningún pedido queda inalcanzable bajo el filtro de año.
 */

/** Querystring de la consulta (`GET /pedidos/por-mes`). */
export const esquemaPedidosPorMesQuery = z
  .object({
    anio: z.coerce
      .number()
      .int()
      .min(2000)
      .max(2100)
      .optional()
      .describe('Año de la entrega del pedido (fechaHasta ?? fechaDe).'),
    mes: z.coerce
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe('Mes de la entrega (1-12); ausente = Todos.'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    idEmpresa: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Paridad con el proto; un id distinto de la empresa activa devuelve vacío (A9).'),
    estatus: z
      .enum(['vigentes', 'entregados', 'cancelados', 'todos'])
      .default('vigentes')
      .describe('Vigentes (no cancelados ni entregados) / Entregados / Cancelados / Todos.'),
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce.number().int().min(1).max(100).default(50).describe('Pedidos por página.'),
  })
  .describe('Filtros y paginación de la consulta de pedidos por mes.');

/** Parámetros de la consulta ya coaccionados desde la URL. */
export type PedidosPorMesQuery = z.infer<typeof esquemaPedidosPorMesQuery>;

/** Estatus derivado del PEDIDO para el chip de la cabecera. */
export const esquemaEstatusPedidoMes = z
  .enum(['vigente', 'entregado', 'cancelado'])
  .describe('Cancelado (pedCancelado) > Entregado (entregadoTienda) > Vigente.');

/** Un renglón/modelo dentro de la fila agrupada del pedido. */
export const esquemaPedidoMesRenglon = z
  .object({
    id: z.number().int().describe('Id del renglón (PedidoLinea).'),
    idModelo: z.number().int().describe('Modelo del renglón.'),
    codigoModelo: z.string().describe('Nº de desarrollo (Modelo.codigo).'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    idDesarrollo: z.number().int().nullable().describe('Desarrollo del renglón (R3, B4), o null.'),
    numeroCliente: z
      .string()
      .nullable()
      .describe('Nº del cliente para el modelo (del desarrollo), o null.'),
    numeroProduccion: z
      .number()
      .int()
      .nullable()
      .describe('Nº interno de producción del modelo, o null si no ha salido a producción.'),
    cantidad: z.number().int().describe('Cantidad pedida del renglón.'),
    precio: z.number().nullable().describe('Precio por prenda, o null sin `pedidos.importes`.'),
    importe: z
      .number()
      .nullable()
      .describe('Importe (cantidad × precio), o null sin `pedidos.importes`.'),
    idOrden: z
      .number()
      .int()
      .nullable()
      .describe('OP más reciente VIVA del renglón (para el deep-link), o null (botón Generar OP).'),
    folioOrden: z.number().int().nullable().describe('Folio de esa OP, o null.'),
    numOrdenes: z
      .number()
      .int()
      .describe('Cuántas OPs vivas tiene el renglón (resurtidos; 0 = sin orden).'),
    cortado: z
      .number()
      .int()
      .describe('Σ piezas cortadas (etapas de corte vivas, F3) de las OPs del renglón.'),
  })
  .describe('Renglón/modelo de un pedido en la consulta por mes.');

/** Forma de un renglón de la consulta. */
export type PedidoMesRenglon = z.infer<typeof esquemaPedidoMesRenglon>;

/** Fila agrupada (cabecera del pedido `-F` + sus renglones). */
export const esquemaPedidoMesFila = z
  .object({
    id: z.number().int().describe('Id del pedido.'),
    folio: z.number().int().describe('Folio `-F` (consecutivo por empresa).'),
    idEmpresa: z.number().int().describe('Empresa del pedido.'),
    empresa: z.string().describe('Nombre de la empresa (FR Moda / Marilyn Fitness).'),
    idCliente: z.number().int().describe('Cliente del pedido.'),
    cliente: z.string().describe('Nombre del cliente.'),
    ocCliente: z.string().nullable().describe('OC original del cliente (chip), o null.'),
    fechaDe: z.iso.date().nullable().describe('Ventana de entrega — desde, o null.'),
    fechaHasta: z.iso.date().nullable().describe('Ventana de entrega — hasta, o null.'),
    estatus: esquemaEstatusPedidoMes,
    cantidadTotal: z.number().int().describe('Σ cantidades pedidas de los renglones.'),
    cortadoTotal: z.number().int().describe('Σ cortado de los renglones.'),
    importeTotal: z
      .number()
      .nullable()
      .describe('Σ importes de los renglones, o null sin `pedidos.importes`.'),
    renglones: z.array(esquemaPedidoMesRenglon).describe('Renglones/modelos del pedido.'),
  })
  .describe('Pedido agrupado con sus renglones (fila expandible de la consulta).');

/** Forma de una fila agrupada. */
export type PedidoMesFila = z.infer<typeof esquemaPedidoMesFila>;

/** Barra de TOTALES del filtro COMPLETO (no solo la página), agregada en servidor. */
export const esquemaPedidosPorMesTotales = z
  .object({
    pedidos: z.number().int().describe('Pedidos que cumplen el filtro.'),
    ordenes: z.number().int().describe('OPs vivas de esos pedidos.'),
    piezas: z.number().int().describe('Σ piezas pedidas.'),
    cortado: z.number().int().describe('Σ piezas cortadas.'),
    avancePct: z.number().describe('Cortado / piezas × 100 (0 si no hay piezas).'),
    importe: z.number().nullable().describe('Σ importes, o null sin `pedidos.importes`.'),
  })
  .describe('Totales del filtro completo para la barra al pie.');

/** Forma de los totales. */
export type PedidosPorMesTotales = z.infer<typeof esquemaPedidosPorMesTotales>;

/** Respuesta de la consulta: página de filas agrupadas + totales del filtro. */
export const esquemaPedidosPorMesSalida = z
  .object({
    datos: z.array(esquemaPedidoMesFila).describe('Pedidos de la página (agrupados).'),
    totales: esquemaPedidosPorMesTotales,
    total: z.number().int().describe('Total de pedidos que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Pedidos por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de la consulta de pedidos por mes.');

/** Forma de la respuesta de la consulta. */
export type PedidosPorMesSalida = z.infer<typeof esquemaPedidosPorMesSalida>;
