import { z } from 'zod';

/**
 * Esquemas Zod del TABLERO WIP + existencias en poder del maquilero (F3-E5; doc 03-Produccion, form
 * `Proceso` + `MaqExis`). UNA sola definición de reglas para UI y servidor (alimenta el OpenAPI).
 *
 * Son CONSULTAS de SOLO LECTURA: todo el avance (cortado/enviado/recibido/entregado) se DERIVA por
 * suma directa de `EtapaMovimientoDet` (sin acumuladores, D3/D4). El drill-down baja a color×talla.
 *
 * Fórmulas del avance por orden (todas excluyen etapas canceladas):
 *  • Por cortar          = pedido(orden) − cortado
 *  • Cortado por enviar  = cortado − enviado            (por proceso/TipoProceso, D8)
 *  • Por recibir         = enviado − recibido           (por proceso/TipoProceso)
 *  • Entregado a cliente = Σ entregas (etapa tipo `entrega_cliente`)
 *  • Por entregar        = recibido(costura) − entregado a cliente
 *
 * Las banderas/flags por querystring se RE-VALIDAN en el dominio con esquemas locales `z.boolean()`
 * (no el `stringbool` del contrato): evita el 400 espurio del hotfix F2 (PR #56).
 */

// ── Tablero WIP: listado de órdenes con su avance agregado ──────────────────────────────────────

/**
 * Filtros del TABLERO WIP en la URL (querystring). Búsqueda combinada (folio, modelo, cliente, valor
 * de referencia D7) + filtros por modelo/cliente/estado, orden y paginación. Mismas piezas que la
 * consulta de órdenes (F2-E4), pero la proyección agrega el avance por etapa.
 */
export const esquemaTableroWipQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    busqueda: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Texto a buscar (folio, código de modelo, cliente o valor de referencia D7).'),
    idModelo: z.coerce.number().int().positive().optional().describe('Filtra por modelo.'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    estado: z
      .enum(['capturada', 'completa', 'cancelada'])
      .optional()
      .describe('Filtra por estado de la orden.'),
    soloPendientes: z
      .stringbool()
      .default(false)
      .describe('Si true, solo órdenes con algo pendiente (por cortar/enviar/recibir/entregar).'),
    ordenarPor: z
      .enum(['folio', 'fecha', 'fechaEntrega'])
      .default('folio')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('desc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del tablero WIP.');

/** Parámetros del tablero WIP ya coaccionados desde la URL. */
export type TableroWipQuery = z.infer<typeof esquemaTableroWipQuery>;

/**
 * Una fila del TABLERO WIP: una orden con su encabezado ligero + los totales DERIVADOS por etapa y
 * los pendientes. Todo agregado en servidor (Σ de `EtapaMovimientoDet`). Pensado para la tabla
 * resumen; el drill-down color×talla vive en {@link esquemaWipOrden}.
 */
export const esquemaWipOrdenFila = z
  .object({
    idOrden: z.number().int().describe('Id de la orden.'),
    folio: z.number().int().describe('Folio consecutivo por empresa.'),
    estado: z.enum(['capturada', 'completa', 'cancelada']).describe('Estado de la orden.'),
    fecha: z.string().nullable().describe('Fecha de la orden (YYYY-MM-DD) o null.'),
    fechaEntrega: z.string().nullable().describe('Fecha de entrega comprometida o null.'),
    idModelo: z.number().int().describe('Modelo a producir.'),
    codigoModelo: z.string().describe('Código del modelo (para la UI).'),
    idCliente: z.number().int().describe('Cliente de la orden.'),
    cliente: z.string().describe('Nombre del cliente (para la UI).'),
    pedido: z.number().int().describe('Total pedido por la orden (Σ de la matriz).'),
    cortado: z.number().int().describe('Total cortado (Σ etapas de corte vivas).'),
    enviado: z
      .number()
      .int()
      .describe('Total enviado a maquila (Σ envíos vivos, todos los procesos).'),
    recibido: z
      .number()
      .int()
      .describe('Total recibido de maquila (Σ recibos vivos, todos los procesos).'),
    recibidoCostura: z
      .number()
      .int()
      .describe('Recibido de procesos que meten a PT (costura) — base de "por entregar".'),
    entregado: z.number().int().describe('Total entregado a cliente (Σ entregas vivas).'),
    porCortar: z.number().int().describe('pedido − cortado (negativo si hubo sobre-corte).'),
    cortadoPorEnviar: z.number().int().describe('cortado − enviado (total, todos los procesos).'),
    porRecibir: z.number().int().describe('enviado − recibido (total, todos los procesos).'),
    porEntregar: z
      .number()
      .int()
      .describe('recibido(costura) − entregado a cliente (lo que falta entregar).'),
  })
  .describe('Una orden en el tablero WIP, con su avance agregado por etapa.');

/** Forma de una fila del tablero WIP. */
export type WipOrdenFila = z.infer<typeof esquemaWipOrdenFila>;

/**
 * Agregado por etapa sobre TODO el universo filtrado (no solo la página): Σ de piezas por etapa,
 * derivada por suma directa de `EtapaMovimientoDet` (D3/D4) — MISMO criterio que las filas y que el
 * agregado de Indicadores (`kpisWip`), pero bajo el permiso del tablero (`produccion.wip-ver`). Sirve
 * a los KPIs de vistazo del proto (piezas por etapa). El filtro `soloPendientes` NO afecta este
 * agregado (una orden sin nada pendiente aporta 0 a cada etapa pendiente).
 */
export const esquemaWipTotales = z
  .object({
    pedido: z.number().int().describe('Total pedido (Σ de la matriz) del universo filtrado.'),
    cortado: z.number().int().describe('Total cortado (Σ etapas de corte vivas).'),
    enviado: z.number().int().describe('Total enviado a maquila (Σ envíos vivos).'),
    recibido: z.number().int().describe('Total recibido de maquila (Σ recibos vivos).'),
    recibidoCostura: z.number().int().describe('Recibido de procesos que meten a PT (costura).'),
    entregado: z.number().int().describe('Total entregado a cliente (Σ entregas vivas).'),
    porCortar: z.number().int().describe('pedido − cortado (piezas por cortar).'),
    cortadoPorEnviar: z.number().int().describe('cortado − enviado (piezas por enviar a maquila).'),
    porRecibir: z.number().int().describe('enviado − recibido (piezas en poder de maquila).'),
    porEntregar: z.number().int().describe('recibido(costura) − entregado (piezas por entregar).'),
  })
  .describe('Agregado de piezas por etapa del universo filtrado (KPIs del tablero WIP).');

/** Forma del agregado por etapa del tablero WIP. */
export type WipTotales = z.infer<typeof esquemaWipTotales>;

/** Respuesta paginada del tablero WIP (forma estándar `Pagina<T>`) + agregado por etapa. */
export const esquemaTableroWipPagina = z
  .object({
    datos: z.array(esquemaWipOrdenFila).describe('Órdenes (con avance) de la página.'),
    totales: esquemaWipTotales.describe('Agregado de piezas por etapa del universo filtrado.'),
    total: z.number().int().describe('Total de órdenes que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página del tablero WIP (órdenes con su avance) + agregado por etapa.');

/** Forma de la respuesta paginada del tablero WIP. */
export type TableroWipPagina = z.infer<typeof esquemaTableroWipPagina>;

// ── Drill-down de una orden: pendientes por etapa y por color×talla ──────────────────────────────

/** Una celda color×talla con su cantidad (para las matrices del drill-down). */
const esquemaWipCelda = z.object({
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  idTalla: z.number().int().describe('Id de la talla.'),
  etiquetaTalla: z.string().describe('Etiqueta visible de la talla.'),
  cantidad: z.number().int().describe('Cantidad (puede ser negativa por sobre-corte).'),
});

/** Pendiente de un PROCESO de maquila por color×talla (cortado por enviar / por recibir). */
const esquemaWipProcesoPendiente = z.object({
  idTipoProceso: z.number().int().describe('Id del tipo de proceso.'),
  tipoProceso: z.string().describe('Nombre del proceso.'),
  codigoProceso: z.string().describe('Código del proceso (kebab-case).'),
  generaEntradaPt: z.boolean().describe('Si el proceso mete a PT (costura).'),
  celdas: z.array(esquemaWipCelda).describe('Celdas pendientes (≠ 0) de este proceso.'),
  totalPendiente: z.number().int().describe('Total pendiente de este proceso (derivado).'),
});

/**
 * Lo que UN maquilero concreto tiene pendiente de devolver de un proceso (enviado − recibido de
 * ESE tercero). Es el desglose que exige la regla de Daniel (28-jul-2026): *"no puedo recibir un
 * corte de un maquilero diferente al que se lo entregué"* — la pantalla de recibo ofrece solo a
 * quienes tienen entrega viva, y la matriz se valida contra el pendiente de ESE maquilero, no
 * contra el del proceso entero. Derivado en servidor (A1/B2), nunca pivoteado en el cliente.
 */
const esquemaWipMaquileroPendiente = z.object({
  idMaquilero: z
    .number()
    .int()
    .nullable()
    .describe('Maquilero (Proveedor), o null si el histórico migrado no lo trae.'),
  maquilero: z.string().describe('Nombre del maquilero (o "Sin asignar" en lo migrado sin dato).'),
  celdas: z.array(esquemaWipCelda).describe('Celdas pendientes (≠ 0) de ese maquilero.'),
  totalPendiente: z
    .number()
    .int()
    .describe('Total pendiente de ese maquilero (derivado; NEGATIVO si recibió sin envío).'),
});

/** Forma del pendiente por recibir de UN maquilero. */
export type WipMaquileroPendiente = z.infer<typeof esquemaWipMaquileroPendiente>;

/** Pendiente POR RECIBIR de un proceso, con su desglose por maquilero. */
const esquemaWipProcesoPorRecibir = esquemaWipProcesoPendiente.extend({
  porMaquilero: z
    .array(esquemaWipMaquileroPendiente)
    .describe(
      'enviado − recibido por MAQUILERO (todo tercero con envío o recibo vivo del proceso).',
    ),
});

/**
 * DRILL-DOWN de UNA orden: el avance completo (totales + pendientes por etapa) con el detalle
 * color×talla. Cubre "órdenes incompletas / qué falta": cada etapa muestra su faltante real por
 * celda ("faltan 12 pzas talla 6 color rojo"). Todo DERIVADO (sin acumuladores).
 */
export const esquemaWipOrden = z
  .object({
    idOrden: z.number().int().describe('Id de la orden.'),
    folio: z.number().int().describe('Folio de la orden.'),
    estado: z.enum(['capturada', 'completa', 'cancelada']).describe('Estado de la orden.'),
    idModelo: z.number().int().describe('Modelo a producir.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    idCliente: z.number().int().describe('Cliente de la orden.'),
    cliente: z.string().describe('Nombre del cliente.'),
    // Totales derivados (mismos que la fila del tablero).
    pedido: z.number().int().describe('Total pedido.'),
    cortado: z.number().int().describe('Total cortado.'),
    enviado: z.number().int().describe('Total enviado.'),
    recibido: z.number().int().describe('Total recibido.'),
    recibidoCostura: z.number().int().describe('Recibido de costura (mete a PT).'),
    entregado: z.number().int().describe('Total entregado a cliente.'),
    porEntregar: z.number().int().describe('recibido(costura) − entregado.'),
    // Detalle por color×talla.
    porCortar: z
      .array(esquemaWipCelda)
      .describe('pedido − cortado por color×talla (negativo si sobre-corte).'),
    cortadoPorEnviar: z
      .array(esquemaWipProcesoPendiente)
      .describe('cortado − enviado por proceso, color×talla.'),
    porRecibir: z
      .array(esquemaWipProcesoPorRecibir)
      .describe('enviado − recibido por proceso, color×talla, con desglose por maquilero.'),
    entregadoCeldas: z
      .array(esquemaWipCelda)
      .describe('Entregado a cliente por color×talla (Σ de entregas vivas).'),
  })
  .describe('Drill-down del avance de una orden (totales + pendientes por etapa, color×talla).');

/** Forma del drill-down de una orden. */
export type WipOrden = z.infer<typeof esquemaWipOrden>;

// ── Existencias en poder del maquilero (enviado − recibido) ──────────────────────────────────────

/**
 * Filtros de las EXISTENCIAS EN PODER DEL MAQUILERO en la URL (querystring). Base del form `MaqExis`
 * del viejo: lo que cada maquilero tiene pendiente de devolver (enviado − recibido). Filtros por
 * maquilero/proceso/orden.
 */
export const esquemaExistenciaMaquileroQuery = z
  .object({
    idMaquilero: z.coerce.number().int().positive().optional().describe('Filtra por un maquilero.'),
    idTipoProceso: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por un tipo de proceso.'),
    idOrden: z.coerce.number().int().positive().optional().describe('Filtra por una orden.'),
  })
  .describe('Filtros de las existencias en poder del maquilero.');

/** Parámetros de las existencias del maquilero ya coaccionados. */
export type ExistenciaMaquileroQuery = z.infer<typeof esquemaExistenciaMaquileroQuery>;

/**
 * Una fila de EXISTENCIA EN PODER DEL MAQUILERO: por maquilero × proceso × orden, lo que tiene
 * pendiente de devolver = enviado − recibido. Solo se devuelven filas con saldo ≠ 0.
 */
export const esquemaExistenciaMaquileroFila = z
  .object({
    idMaquilero: z
      .number()
      .int()
      .nullable()
      .describe('Maquilero (Proveedor) o null si no se asignó.'),
    maquilero: z.string().describe('Nombre del maquilero (o "Sin asignar").'),
    idTipoProceso: z.number().int().describe('Tipo de proceso.'),
    tipoProceso: z.string().describe('Nombre del proceso.'),
    idOrden: z.number().int().describe('Orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    codigoModelo: z.string().describe('Código del modelo de la orden.'),
    enviado: z.number().int().describe('Piezas enviadas (Σ envíos vivos).'),
    recibido: z.number().int().describe('Piezas recibidas (Σ recibos vivos).'),
    enPoder: z.number().int().describe('enviado − recibido (lo que el maquilero tiene pendiente).'),
  })
  .describe('Existencia en poder de un maquilero (enviado − recibido) por orden y proceso.');

/** Forma de una fila de existencia en poder del maquilero. */
export type ExistenciaMaquileroFila = z.infer<typeof esquemaExistenciaMaquileroFila>;

/** Respuesta de las existencias en poder del maquilero: filas + total global en poder. */
export const esquemaExistenciaMaquileroLista = z
  .object({
    filas: z
      .array(esquemaExistenciaMaquileroFila)
      .describe('Existencias en poder por maquilero × proceso × orden (saldo ≠ 0).'),
    totalEnPoder: z.number().int().describe('Total de piezas en poder de maquileros (derivado).'),
  })
  .describe('Existencias en poder del maquilero (enviado − recibido).');

/** Forma de la respuesta de existencias en poder del maquilero. */
export type ExistenciaMaquileroLista = z.infer<typeof esquemaExistenciaMaquileroLista>;
