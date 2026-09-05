import { z } from 'zod';

import { esquemaEstadoOrden } from './orden.js';
import { esquemaPackSalida } from './pack.js';

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
 *  • Por recibir         = enviado − recibido − incompletas − faltantes saldados   (por proceso/TipoProceso; las
 *                          prendas incompletas ya volvieron del taller — V1-E8v, §Post-F9.147)
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
    // El esquema COMPARTIDO, no una copia: cuando 0.061 agregó `cerrada`, la copia habría dejado
    // el tablero sin poder filtrar por las órdenes cerradas.
    estado: esquemaEstadoOrden.optional().describe('Filtra por estado de la orden.'),
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
    estado: esquemaEstadoOrden.describe('Estado de la orden.'),
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
    incompletas: z
      .number()
      .int()
      .describe(
        'Prendas INCOMPLETAS entregadas (V1-E8v, §Post-F9.147): volvieron del taller pero no se ' +
          'produjeron, no entraron a inventario y no se pagan. Van APARTE de `recibido` y RESTAN ' +
          'del pendiente por recibir — ya no están en la maquila. Cuarta cubeta de ' +
          '`enviado = primeras + segundas + faltantes + incompletas`.',
      ),
    faltantesSaldados: z
      .number()
      .int()
      .describe(
        'Piezas FALTANTES ya SALDADAS al cerrar la orden con sus maquileros (V1, fila 0.109). ' +
          'Nunca volvieron del taller y ya no se esperan: salen del pendiente por recibir. Es la ' +
          'tercera cubeta con columna propia, junto a `recibido` e `incompletas`, y con ellas ' +
          'cierra `enviado = primeras + segundas + faltantes + incompletas`.',
      ),
    recibidoCostura: z
      .number()
      .int()
      .describe('Recibido de procesos que meten a PT (costura) — base de "por entregar".'),
    entregado: z.number().int().describe('Total entregado a cliente (Σ entregas vivas).'),
    porCortar: z.number().int().describe('pedido − cortado (negativo si hubo sobre-corte).'),
    cortadoPorEnviar: z.number().int().describe('cortado − enviado (total, todos los procesos).'),
    porRecibir: z
      .number()
      .int()
      .describe(
        'enviado − recibido − incompletas − faltantes saldados (total, todos los procesos). Es ' +
          'lo que el maquilero todavía tiene en su taller y todavía se le espera. Lo saldado sale ' +
          'de aquí a propósito (V1, fila 0.109): ya se decidió que no vuelve.',
      ),
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
    incompletas: z
      .number()
      .int()
      .describe('Σ prendas INCOMPLETAS entregadas (V1-E8v): volvieron, pero no se produjeron.'),
    faltantesSaldados: z
      .number()
      .int()
      .describe(
        'Piezas FALTANTES ya SALDADAS al cerrar la orden con sus maquileros (V1, fila 0.109). ' +
          'Nunca volvieron del taller y ya no se esperan: salen del pendiente por recibir. Es la ' +
          'tercera cubeta con columna propia, junto a `recibido` e `incompletas`, y con ellas ' +
          'cierra `enviado = primeras + segundas + faltantes + incompletas`.',
      ),
    recibidoCostura: z.number().int().describe('Recibido de procesos que meten a PT (costura).'),
    entregado: z.number().int().describe('Total entregado a cliente (Σ entregas vivas).'),
    porCortar: z.number().int().describe('pedido − cortado (piezas por cortar).'),
    cortadoPorEnviar: z.number().int().describe('cortado − enviado (piezas por enviar a maquila).'),
    porRecibir: z
      .number()
      .int()
      .describe(
        'enviado − recibido − incompletas − faltantes saldados (piezas realmente en poder de ' +
          'maquila y todavía esperadas).',
      ),
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

/**
 * Una celda color×talla×PACK con su cantidad (para las matrices del drill-down).
 *
 * ⭐ El PACK entra en la llave de la celda desde §Post-F9.10 porque el saldo de producción se lleva
 * tendido por tendido: sin él, la pantalla ofrecería un tope agregado por color que el servidor
 * rechaza pack por pack. En una orden sin packs va vacío y la celda es la de siempre. La ENTREGA A
 * CLIENTE no maneja packs (ahí ya es sólo color), así que sus celdas lo traen siempre vacío.
 */
const esquemaWipCelda = z.object({
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  pack: esquemaPackSalida.describe('PACK de la celda. CADENA VACÍA = sin pack.'),
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
 * Una celda del pendiente POR RECIBIR de un maquilero (V1-E8k / V1-E8v). Extiende la celda del WIP
 * con las PRENDAS INCOMPLETAS que ese maquilero ya entregó de la celda.
 *
 * 🔴 V1-E8v (§Post-F9.147) RETIRÓ el campo `recibible` que vivía aquí. Existía porque el pendiente
 * (`cantidad`) y lo recibible eran números DISTINTOS: el pendiente se dejaba abierto "para cobrar
 * el faltante". Daniel corrigió ese encuadre —la incompleta ya volvió, el faltante es otra cosa—,
 * así que hoy son EL MISMO número y publicar los dos sería verdad duplicada: dos campos que dicen
 * lo mismo derivan en cuanto alguien toque uno. `cantidad` es el tope de la matriz de captura, y lo
 * calcula el servidor con la MISMA función (`pendientePorCelda`) que valida el guardado bajo lock.
 */
const esquemaWipCeldaPorRecibir = esquemaWipCelda.extend({
  incompletas: z
    .number()
    .int()
    .describe(
      'Prendas INCOMPLETAS que ese maquilero YA entregó de esta celda (V1-E8k, §Post-F9.136): ' +
        'prendas a las que les faltó una pieza y nunca se terminaron de coser. RESTAN del ' +
        'pendiente (V1-E8v: ya volvieron del taller) y viajan aquí para la trazabilidad — una ' +
        'celda con pendiente 0 e incompletas 5 dice qué pasó con esas 5 prendas.',
    ),
});

/**
 * Lo que UN maquilero concreto tiene pendiente de devolver de un proceso (`enviado − buenas −
 * incompletas − faltantes saldados` de ESE tercero). Es el desglose que exige la regla de Daniel (28-jul-2026): *"no puedo recibir un
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
  celdas: z
    .array(esquemaWipCeldaPorRecibir)
    .describe('Celdas con pendiente o con incompletas entregadas, de ese maquilero.'),
  totalPendiente: z
    .number()
    .int()
    .describe(
      'Total pendiente de ese maquilero = enviado − buenas − incompletas − faltantes saldados (derivado; NEGATIVO si ' +
        'recibió sin envío). Es lo que TIENE y a la vez lo que todavía se le puede recibir.',
    ),
  totalIncompletas: z
    .number()
    .int()
    .describe('Prendas incompletas que ya entregó (informativo; SÍ cierran el pendiente, V1-E8v).'),
  faltantesSaldados: z
    .number()
    .int()
    .describe(
      'Piezas FALTANTES de ese maquilero ya SALDADAS al cerrar la orden con él (V1, fila 0.109). ' +
        'Restan de `totalPendiente`: ya se decidió que no vuelven. Viajan aquí para que la celda ' +
        'cerrada siga contando su historia en vez de desaparecer.',
    ),
  faltantesSaldables: z
    .number()
    .int()
    .describe(
      'Las piezas que de VERDAD se pueden saldar hoy con ese maquilero: Σ del pendiente POSITIVO ' +
        'por color×talla (V1, fila 0.109). Es el número exacto que el servidor escribirá al cerrar ' +
        '—y por el que multiplicará el descuento—, y por eso es el que la pantalla debe enseñar y ' +
        'usar para decidir si ofrece el botón. ⚠️ NO es `totalPendiente`: esa suma es plana y una ' +
        'celda NEGATIVA (histórico migrado, o lo devuelto sin decir de qué pack era) la compensa. ' +
        'Con +5 y −5 la suma plana da 0 —el botón no aparecería y esa orden nunca se podría ' +
        'cerrar— habiendo 5 piezas que saldar; con +5 y −3 da 2 mientras el cobro saldría por 5.',
    ),
  precioFaltante: z
    .number()
    .nullable()
    .describe(
      'Precio pactado del envío vivo a ese maquilero, base del cobro que se PROPONDRÍA al cerrar ' +
        '(V1, fila 0.109). `null` si el envío no lo trae (histórico migrado) o si el usuario no ' +
        'tiene `ordenes.ver-precio-real-maquila` (redactado, R2 §4.4.3).',
    ),
  importeFaltantePropuesto: z
    .number()
    .nullable()
    .describe(
      'Lo que se propondría cobrarle si se cerrara AHORA: `faltantesSaldables × precioFaltante`, ' +
        'calculado en el SERVIDOR para que la confirmación no re-derive la regla. `null` sin ' +
        'precio o sin permiso de verlo.',
    ),
});

/** Forma del pendiente por recibir de UN maquilero. */
export type WipMaquileroPendiente = z.infer<typeof esquemaWipMaquileroPendiente>;

/** Pendiente POR RECIBIR de un proceso, con su desglose por maquilero. */
const esquemaWipProcesoPorRecibir = esquemaWipProcesoPendiente.extend({
  devuelveAPt: z
    .boolean()
    .describe(
      'Las prendas de este proceso salieron del almacén al enviarlas (V1-E4b, §Post-F9.61): están en TRÁNSITO y su recibo las DEVUELVE, así que pide almacén destino aunque el proceso no cree PT.',
    ),
  stockSinOrden: z
    .boolean()
    .describe(
      'Esas prendas salieron del bucket de existencia «sin orden asignada» (histórico migrado / inventario de arranque) y ahí regresan. Fija el bucket de las entregas siguientes: no se pueden mezclar.',
    ),
  porMaquilero: z
    .array(esquemaWipMaquileroPendiente)
    .describe(
      'enviado − buenas − incompletas − faltantes saldados por MAQUILERO (todo tercero con envío o recibo vivo del ' +
        'proceso).',
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
    estado: esquemaEstadoOrden.describe('Estado de la orden.'),
    idModelo: z.number().int().describe('Modelo a producir.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    idCliente: z.number().int().describe('Cliente de la orden.'),
    cliente: z.string().describe('Nombre del cliente.'),
    // Totales derivados (mismos que la fila del tablero).
    pedido: z.number().int().describe('Total pedido.'),
    cortado: z.number().int().describe('Total cortado.'),
    enviado: z.number().int().describe('Total enviado.'),
    enviadoCostura: z
      .number()
      .int()
      .describe(
        'Enviado a procesos que meten a PT (costura), por SUMA DIRECTA de sus envíos vivos. Lo ' +
          'publica el servidor (A1) para que el stepper del panel de avance no lo DESPEJE del ' +
          'pendiente: ese despeje invertía la fórmula del pendiente y, desde que éste resta las ' +
          'incompletas (V1-E8v), devolvía `enviado − incompletas`.',
      ),
    recibido: z.number().int().describe('Total recibido BUENO (primeras + segundas).'),
    incompletas: z
      .number()
      .int()
      .describe(
        'Total de prendas INCOMPLETAS entregadas en la orden (V1-E8v, §Post-F9.147). Volvieron ' +
          'del taller pero se perdieron: no se produjeron, no se inventariaron y no se pagan.',
      ),
    pendientePorRecibir: z
      .number()
      .int()
      .describe(
        'enviado − recibido − incompletas − faltantes saldados: el FALTANTE VIVO, lo que el ' +
          'maquilero todavía tiene. Con `enviado`, `recibido`, `incompletas` y ' +
          '`faltantesSaldados` cierra la trazabilidad que pidió Daniel: qué pasó con cada prenda ' +
          'que se mandó.',
      ),
    faltantesSaldados: z
      .number()
      .int()
      .describe(
        'Piezas FALTANTES ya SALDADAS al cerrar la orden con sus maquileros (V1, fila 0.109): ' +
          'nunca volvieron y ya no se esperan. Con `recibido` e `incompletas` completa la ' +
          'trazabilidad de las cuatro cubetas.',
      ),
    recibidoCostura: z.number().int().describe('Recibido de costura (mete a PT).'),
    empacado: z
      .number()
      .int()
      .describe(
        'Σ piezas EMPACADAS de la orden (etapas de empaque vivas, 0.114). Es una cantidad PROPIA: ' +
          'no se deriva de lo recibido ni de lo entregado (se fabrican 1,000 y se empacan 990, la ' +
          'regla de C&A que dictó Daniel), y no toca inventario. Se publica desde el servidor por ' +
          'la misma razón que `enviadoCostura`: para que el stepper del panel no la re-derive.',
      ),
    entregado: z.number().int().describe('Total entregado a cliente.'),
    porEntregar: z.number().int().describe('recibido(costura) − entregado.'),
    // Detalle por color×talla.
    porCortar: z
      .array(esquemaWipCelda)
      .describe('pedido − cortado por color×talla (negativo si sobre-corte).'),
    cortadoCeldas: z
      .array(esquemaWipCelda)
      .describe(
        'Σ corte VIVO por color×talla. Es el disponible a enviar de un proceso que TODAVÍA no ' +
          'tiene envíos (no aparece en cortadoPorEnviar, que solo enumera los ya usados); sin este ' +
          'dato la pantalla tenía que re-derivarlo restando pedido − porCortar, y la misma regla ' +
          'escrita en dos lados deriva (V1-E8i).',
      ),
    cortadoPorEnviar: z
      .array(esquemaWipProcesoPendiente)
      .describe('cortado − enviado por proceso, color×talla.'),
    porRecibir: z
      .array(esquemaWipProcesoPorRecibir)
      .describe(
        'enviado − buenas − incompletas − faltantes saldados por proceso, color×talla, con desglose por maquilero.',
      ),
    entregadoCeldas: z
      .array(esquemaWipCelda)
      .describe('Entregado a cliente por color×talla (Σ de entregas vivas).'),
  })
  .describe('Drill-down del avance de una orden (totales + pendientes por etapa, color×talla).');

/** Forma del drill-down de una orden. */
export type WipOrden = z.infer<typeof esquemaWipOrden>;

// ── Existencias en poder del maquilero (enviado − recibido − incompletas − faltantes saldados) ───────────────────────

/**
 * Filtros de las EXISTENCIAS EN PODER DEL MAQUILERO en la URL (querystring). Base del form `MaqExis`
 * del viejo: lo que cada maquilero tiene pendiente de devolver (enviado − recibido − incompletas − faltantes saldados).
 * Filtros por
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
 * pendiente de devolver = `enviado − buenas − incompletas − faltantes saldados` (V1-E8v, §Post-F9.147: la incompleta ya
 * volvió, así que deja de estar en la maquila). Solo se devuelven filas con saldo ≠ 0.
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
    recibido: z.number().int().describe('Piezas recibidas BUENAS (Σ recibos vivos).'),
    incompletas: z
      .number()
      .int()
      .describe(
        'Prendas INCOMPLETAS que devolvió (V1-E8v): ya no las tiene, pero tampoco se produjeron.',
      ),
    faltantesSaldados: z
      .number()
      .int()
      .describe(
        'Piezas suyas ya SALDADAS al cerrar la orden con él (V1, fila 0.109): dejan de estar en su ' +
          'poder porque ya se decidió que no vuelven (se le cobraron o se le perdonaron).',
      ),
    enPoder: z
      .number()
      .int()
      .describe(
        'enviado − recibido − incompletas − faltantes saldados (lo que el maquilero tiene de ' +
          'verdad y todavía se le espera).',
      ),
  })
  .describe(
    'Existencia en poder de un maquilero (enviado − recibido − incompletas − faltantes saldados) por orden y proceso.',
  );

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
  .describe(
    'Existencias en poder del maquilero (enviado − recibido − incompletas − faltantes saldados).',
  );

/** Forma de la respuesta de existencias en poder del maquilero. */
export type ExistenciaMaquileroLista = z.infer<typeof esquemaExistenciaMaquileroLista>;
