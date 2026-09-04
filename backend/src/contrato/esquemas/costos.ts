import { z } from 'zod';

/**
 * Esquemas Zod del MOTOR DE COSTEO (Módulo 6, F7-E1; doc `06-Costos-y-EDR.md` §2/§3/§5; D1/D2).
 * UNA sola definición de reglas para UI y servidor (alimenta el OpenAPI). Toda la lógica vive en
 * `dominio/costos/*` (A1); aquí solo las FORMAS.
 *
 * Modelo de costeo (D2, 2026-07-02):
 *  • Pre-costo por modelo = receta `paraPreCosto` × precios de catálogo + maquila del modelo. El
 *    arte entra UNA vez por modelo, SIN cantidad. La REGALÍA NO es componente del costo.
 *  • Costo real por orden = componentes en DOBLE juego teórico (`*Calc`) / guardado (`*Cost`);
 *    `costoTotal` = Σ de los GUARDADOS. Costo unitario = `costoTotal` ÷ base de prorrateo. Desde
 *    0.061 el default es `recibido` (piezas recibidas de costura); hasta esa versión fue `cortado`.
 *  • Precio sugerido (lista de precios): utilidad + regalías SOBRE LA VENTA, redondeo AL ALZA.
 */

// ── Base de prorrateo (D2) ──────────────────────────────────────────────────────────────────────

/**
 * Base sobre la que se divide el costo total para el unitario (D2).
 *
 * ⭐ **El DEFAULT es `recibido` desde 0.061** (§Post-F9.154(b), DANIEL 30-ago-2026). Era `cortado`.
 * Textual: *«Las 10 faltantes se las voy a cobrar al maquilero… esas las sacaría de la ecuación. Y
 * las segundas también se venden a un Saldero. Las únicas que se pierden por completo son las
 * incompletas.»* ⇒ primeras y segundas SÍ entran al divisor (se venden); faltantes NO (se cobran
 * en EsMa) e incompletas TAMPOCO (son la merma). `recibido` es exactamente esa cuenta: Σ de
 * `EtapaMovimientoDet.cantidad` (= primeras + segundas) de los recibos de procesos que meten a PT.
 * Descartó dividir entre las cortadas porque **escondería el costo de la merma**.
 *
 * ⚠️ Imprecisión DECLARADA y no corregida: el cobro al maquilero por el faltante NO reduce el costo
 * de la orden — vive en EsMa, que es otra cuenta.
 */
export const esquemaBaseProrrateo = z
  .enum(['cortado', 'recibido', 'vendido'])
  .describe(
    'Base de prorrateo del costo unitario (cortado=CantCorte, recibido=costura [DEFAULT], vendido).',
  );

/** Base de prorrateo del costo unitario. */
export type BaseProrrateo = z.infer<typeof esquemaBaseProrrateo>;

// ── Pre-costo por modelo (receta × catálogo) ─────────────────────────────────────────────────────

/** Un renglón de tela del pre-costo (consumo × precio de catálogo). */
const esquemaPreCostoTela = z.object({
  idTela: z.number().int().describe('Id de la tela.'),
  tela: z.string().describe('Nombre de la tela.'),
  consumoPorPrenda: z.number().describe('Consumo de tela por prenda (receta).'),
  precioUnitario: z
    .number()
    .nullable()
    .describe('Precio de catálogo por unidad (o null sin importes).'),
  importe: z.number().nullable().describe('consumo × precio (o null sin importes).'),
});

/** Un renglón de avío del pre-costo (consumo × precio de catálogo). */
const esquemaPreCostoAvio = z.object({
  idAvio: z.number().int().describe('Id del avío.'),
  clave: z.string().describe('Clave del avío.'),
  descripcion: z.string().describe('Descripción del avío.'),
  consumoPorPrenda: z.number().describe('Consumo de avío por prenda (receta).'),
  precioUnitario: z
    .number()
    .nullable()
    .describe('Precio de referencia por unidad (o null sin importes).'),
  importe: z.number().nullable().describe('consumo × precio (o null sin importes).'),
});

/** Un renglón de ARTE del pre-costo (precio UNA vez por modelo, sin cantidad). */
const esquemaPreCostoArte = z.object({
  idArte: z.number().int().describe('Id del arte (bordado/estampado) del modelo.'),
  arte: z.string().describe('Nombre del arte.'),
  precio: z.number().nullable().describe('Precio del arte en el modelo (o null sin importes).'),
});

/**
 * PRE-COSTO de un modelo: la receta `paraPreCosto` valuada a precios de catálogo + la maquila del
 * modelo, con el precio de venta SUGERIDO (utilidad + regalías parametrizadas, redondeo al alza).
 * Los importes/costos van en `null` cuando la sesión no tiene `consultas.ver-importes`.
 */
export const esquemaPreCostoModelo = z
  .object({
    idModelo: z.number().int().describe('Id del modelo.'),
    codigo: z.string().describe('Código del modelo.'),
    descripcion: z.string().nullable().describe('Descripción del modelo.'),
    telas: z.array(esquemaPreCostoTela).describe('Telas de la receta (paraPreCosto).'),
    avios: z.array(esquemaPreCostoAvio).describe('Avíos de la receta (paraPreCosto).'),
    artes: z.array(esquemaPreCostoArte).describe('Arte del modelo (sin cantidad).'),
    totalTela: z.number().nullable().describe('Σ importes de tela (o null sin importes).'),
    totalAvios: z.number().nullable().describe('Σ importes de avíos (o null sin importes).'),
    totalArte: z.number().nullable().describe('Σ precios del arte (o null sin importes).'),
    maquila: z.number().nullable().describe('Maquila base del modelo (o null sin importes).'),
    costoTotal: z
      .number()
      .nullable()
      .describe('Costo estimado = tela + avíos + arte + maquila (SIN regalías, D2).'),
    utilidadSugerida: z
      .number()
      .nullable()
      .describe('% de utilidad usado en el precio sugerido (config. de la empresa).'),
    regaliasBase: z
      .number()
      .nullable()
      .describe('% de regalías (sobre la venta) usado en el precio sugerido.'),
    precioSugerido: z
      .number()
      .nullable()
      .describe('Precio de venta sugerido (parametrizado, redondeo al alza) o null sin importes.'),
  })
  .describe('Pre-costo estimado de un modelo (receta × catálogo + maquila) + precio sugerido.');

/** Forma del pre-costo de un modelo. */
export type PreCostoModelo = z.infer<typeof esquemaPreCostoModelo>;

// ── Lista de precios (por género) ────────────────────────────────────────────────────────────────

/** Filtros de la LISTA DE PRECIOS: por género y estado (activos/inactivos). */
export const esquemaListaPreciosQuery = z
  .object({
    idGenero: z.coerce.number().int().positive().optional().describe('Filtra por género.'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Si true, incluye también los modelos descontinuados.'),
  })
  .describe('Filtros de la lista de precios (género + activos/inactivos).');

/** Parámetros de la lista de precios ya coaccionados. */
export type ListaPreciosQuery = z.infer<typeof esquemaListaPreciosQuery>;

/** Un renglón de la lista de precios: modelo con su costo estimado y su precio sugerido. */
export const esquemaListaPreciosFila = z.object({
  idModelo: z.number().int().describe('Id del modelo.'),
  codigo: z.string().describe('Código del modelo.'),
  descripcion: z.string().nullable().describe('Descripción del modelo.'),
  genero: z.string().nullable().describe('Género del modelo (o null).'),
  activo: z.boolean().describe('¿El modelo está activo?'),
  costo: z.number().nullable().describe('Costo estimado (pre-costo) o null sin importes.'),
  precioSugerido: z.number().nullable().describe('Precio de venta sugerido o null sin importes.'),
});

/** Respuesta de la lista de precios. */
export const esquemaListaPreciosSalida = z
  .object({
    utilidadSugerida: z.number().nullable().describe('% de utilidad aplicado.'),
    regaliasBase: z.number().nullable().describe('% de regalías aplicado (sobre la venta).'),
    filas: z.array(esquemaListaPreciosFila).describe('Modelos con costo y precio sugerido.'),
  })
  .describe('Lista de precios sugeridos por modelo (parametrizada).');

/** Forma de la lista de precios. */
export type ListaPreciosSalida = z.infer<typeof esquemaListaPreciosSalida>;

// ── Costo real por orden (teórico + guardado) ────────────────────────────────────────────────────

/** Cantidades DERIVADAS de la orden (por suma de EtapaMovimientoDet), base del prorrateo. */
const esquemaCantidadesOrden = z.object({
  pedido: z.number().int().describe('Total pedido (Σ matriz de la orden).'),
  cortado: z.number().int().describe('Piezas cortadas (Σ etapas de corte vivas).'),
  recibido: z.number().int().describe('Piezas recibidas de costura (mete a PT).'),
  vendido: z.number().int().describe('Piezas entregadas a cliente.'),
});

/** Componentes TEÓRICOS de la orden (receta × precios vigentes × piezas cortadas). */
const esquemaCostoTeorico = z.object({
  telaPorPrenda: z.number().nullable().describe('Costo de tela por prenda (receta paraCosto).'),
  aviosPorPrenda: z.number().nullable().describe('Costo de avíos por prenda (receta paraCosto).'),
  procesosPorPrenda: z
    .number()
    .nullable()
    .describe('Costo de procesos por prenda (maquila + estampado + arte).'),
  tela: z.number().nullable().describe('Tela teórica total = por prenda × cortado.'),
  avios: z.number().nullable().describe('Avíos teóricos totales = por prenda × cortado.'),
  procesos: z.number().nullable().describe('Procesos teóricos totales = por prenda × cortado.'),
  total: z.number().nullable().describe('Costo teórico total = tela + avíos + procesos.'),
});

/** Componentes GUARDADOS del costo de la orden (lo que se persiste en CostoOrden). */
const esquemaCostoGuardado = z.object({
  telaCalc: z.number().nullable().describe('Tela teórica congelada al guardar.'),
  telaCost: z.number().nullable().describe('Tela GUARDADA (ajustable).'),
  telaReal: z.number().nullable().describe('Tela REAL de compras congelada al guardar.'),
  procesosCalc: z.number().nullable().describe('Procesos teóricos congelados al guardar.'),
  procesosCost: z.number().nullable().describe('Procesos GUARDADOS (ajustables).'),
  aviosCalc: z.number().nullable().describe('Avíos teóricos congelados al guardar.'),
  aviosCost: z.number().nullable().describe('Avíos GUARDADOS (ajustables).'),
  aviosReal: z.number().nullable().describe('Avíos REALES de compras congelados al guardar.'),
  otros: z.number().nullable().describe('Otros costos.'),
  descOtros: z.string().nullable().describe('Descripción de otros costos.'),
  costoTotal: z.number().nullable().describe('Costo total = Σ de los guardados.'),
  baseProrrateo: esquemaBaseProrrateo.describe('Base de prorrateo elegida.'),
  observaciones: z.string().nullable().describe('Observaciones.'),
  creadoEn: z.string().describe('Fecha de captura (ISO).'),
  modificadoEn: z.string().describe('Última modificación (ISO).'),
});

// ── Costo REAL de materiales desde las OC (petición de Daniel, 26-jul-2026) ──────────────────────

/** De dónde salió el precio con el que se valuó un material en el costo REAL. */
export const esquemaOrigenPrecioReal = z
  .enum(['compra-directa', 'ultimo-precio-compra', 'catalogo', 'sin-precio'])
  .describe(
    'Origen del precio con el que se valuó la parte del consumo SIN compra propia: ' +
      '`compra-directa` = la compra ligada a la orden cubre todo (no hubo que valuar nada); ' +
      '`ultimo-precio-compra` = último precio de compra del material; `catalogo` = nunca se ha ' +
      'comprado, se usó el precio de catálogo; `sin-precio` = no hay precio por ningún lado.',
  );

/** Origen del precio con el que se valuó un material en el costo real. */
export type OrigenPrecioReal = z.infer<typeof esquemaOrigenPrecioReal>;

/** De dónde salió la cantidad REQUERIDA del material (snapshot del MRP o la receta). */
export const esquemaOrigenRequerido = z
  .enum(['snapshot-mrp', 'receta', 'sin-requerido'])
  .describe(
    'Origen del consumo requerido, SIEMPRE sobre las piezas CORTADAS (la base del teórico): ' +
      '`snapshot-mrp` = explosión de materiales escalada de piezas pedidas a cortadas y ' +
      'reconciliada con la receta de costo; `receta` = receta paraCosto × cortadas (sin explosión); ' +
      '`sin-requerido` = el modelo no tiene receta de costo.',
  );

/** Origen de las cantidades requeridas del costo real. */
export type OrigenRequerido = z.infer<typeof esquemaOrigenRequerido>;

/** Un renglón de compra REAL ligado a la orden (trazabilidad: qué OC, a quién y a qué precio). */
const esquemaCompraReal = z.object({
  idOrdenCompra: z.number().int().describe('Id de la orden de compra.'),
  numCompra: z.number().int().describe('Folio de la orden de compra.'),
  estatus: z
    .string()
    .describe('Estatus de la OC (autorizada / recibida_parcial / recibida_total).'),
  fecha: z.string().nullable().describe('Fecha de la OC (YYYY-MM-DD) o null.'),
  idProveedor: z.number().int().describe('Proveedor al que se le compró.'),
  proveedor: z.string().describe('Nombre del proveedor.'),
  cantidad: z
    .number()
    .describe('Cantidad comprada en la línea, en unidad de CONSUMO (§Post-F9.97).'),
  unidad: z.string().nullable().describe('Unidad de la línea —siempre la de CONSUMO, §Post-F9.97.'),
  precio: z.number().nullable().describe('Precio unitario de la línea (o null sin importes).'),
  importe: z.number().nullable().describe('cantidad × precio (o null sin importes).'),
});

/** Un material del costo REAL: lo comprado directo + lo valuado a último precio de compra. */
const esquemaMaterialReal = z.object({
  tipo: z.enum(['tela', 'avio', 'libre']).describe('Tipo de material del renglón.'),
  idTela: z.number().int().nullable().describe('Id de la tela (o null).'),
  idAvio: z.number().int().nullable().describe('Id del avío (o null).'),
  material: z.string().describe('Nombre/clave del material.'),
  unidad: z.string().nullable().describe('Unidad de consumo del material.'),
  esGenerico: z.boolean().describe('¿Es un avío genérico (de stock, R4)?'),
  requerido: z.number().describe('Cantidad que la orden requiere (unidad de consumo).'),
  comprado: z
    .number()
    .describe('Cantidad comprada y ligada a la orden, ya en unidad de consumo (R1).'),
  compras: z.array(esquemaCompraReal).describe('Líneas de OC ligadas a la orden (trazabilidad).'),
  importeDirecto: z.number().nullable().describe('Σ de lo comprado directo (o null sin importes).'),
  cantidadValuada: z
    .number()
    .describe('Consumo SIN compra propia = max(0, requerido − comprado). Se valúa aparte.'),
  precioValuado: z
    .number()
    .nullable()
    .describe(
      'Precio unitario usado para valuar (último de compra o catálogo); null sin importes.',
    ),
  importeValuado: z
    .number()
    .nullable()
    .describe('cantidadValuada × precioValuado (o null sin importes).'),
  origenPrecio: esquemaOrigenPrecioReal.describe('De dónde salió el precio del material.'),
  ultimaCompra: z
    .object({
      idOrdenCompra: z.number().int().describe('Id de la OC del último precio.'),
      numCompra: z.number().int().describe('Folio de la OC del último precio.'),
      estatus: z.string().describe('Estatus de esa OC (autorizada / recibida_*).'),
      fecha: z.string().nullable().describe('Fecha de esa OC (YYYY-MM-DD) o null.'),
      idProveedor: z.number().int().describe('Proveedor de esa OC.'),
      proveedor: z.string().describe('Nombre del proveedor de esa OC.'),
    })
    .nullable()
    .describe('OC de la que salió el ÚLTIMO precio de compra (null si no aplica).'),
  importe: z.number().nullable().describe('Costo real del material = directo + valuado.'),
});

/** Resumen del costo REAL de materiales (el que se muestra junto al teórico y al guardado). */
export const esquemaCostoRealResumen = z.object({
  tela: z.number().nullable().describe('Costo real de TELA (o null sin importes).'),
  avios: z.number().nullable().describe('Costo real de AVÍOS (o null sin importes).'),
  total: z.number().nullable().describe('tela + avíos (los procesos NO entran al real).'),
  importeDirecto: z
    .number()
    .nullable()
    .describe('Parte que viene de compras ligadas a la orden (tela + avíos).'),
  importeValuado: z
    .number()
    .nullable()
    .describe('Parte valuada a último precio de compra / catálogo (tela + avíos).'),
  importeLibre: z
    .number()
    .nullable()
    .describe('Compras LIBRES (sin material de catálogo) ligadas a la orden: NO entran al total.'),
  hayCompras: z
    .boolean()
    .describe('¿Hay al menos una línea de OC de tela/avío ligada a la orden y autorizada?'),
  origenRequerido: esquemaOrigenRequerido.describe('De dónde salieron las cantidades requeridas.'),
  piezasBase: z
    .number()
    .int()
    .describe(
      'Piezas CORTADAS sobre las que se calculó el consumo requerido (la base del teórico).',
    ),
  avisos: z
    .array(z.string())
    .describe('Avisos del cálculo (nunca truena en silencio). NUNCA contienen un importe.'),
});

/** Resumen del costo real de materiales de una orden. */
export type CostoRealResumen = z.infer<typeof esquemaCostoRealResumen>;

/** DESGLOSE completo del costo real de materiales de una orden (endpoint aparte, bajo demanda). */
export const esquemaCostoRealOrdenSalida = esquemaCostoRealResumen
  .extend({
    idOrden: z.number().int().describe('Id de la orden.'),
    folio: z.number().int().describe('Folio de la orden.'),
    materiales: z
      .array(esquemaMaterialReal)
      .describe('Un renglón por material (telas, avíos y compras libres).'),
  })
  .describe('Costo real de materiales de una orden, desglosado por material (desde las OC).');

/** Forma del desglose del costo real de materiales. */
export type CostoRealOrdenSalida = z.infer<typeof esquemaCostoRealOrdenSalida>;

/**
 * POR QUÉ no hay costo unitario, cuando no lo hay (0.061 — §Post-F9.154(b)/(c)). Nació al pasar el
 * divisor a `recibido`: hasta el primer recibo de costura la base es 0 y el unitario sale `null`, y
 * un `null` pelón hacía que la pantalla dijera «—» sin distinguir *«todavía no hay piezas
 * recibidas»* de *«esta orden no tiene costo capturado»* o de *«no tienes permiso de ver importes»*.
 * El motivo lo dicta el SERVIDOR (con la regla, A1) para que ninguna pantalla lo invente.
 */
export const esquemaMotivoSinUnitario = z
  .enum(['sin-base', 'sin-costo', 'sin-importes'])
  .describe(
    'Por qué no hay unitario: sin-base = la base de prorrateo todavía es 0 (p. ej. aún no hay ' +
      'piezas recibidas); sin-costo = la orden no tiene costo capturado; sin-importes = falta el ' +
      'permiso `consultas.ver-importes`.',
  );

/** Por qué no hay costo unitario (o null cuando sí lo hay). */
export type MotivoSinUnitario = z.infer<typeof esquemaMotivoSinUnitario>;

/** El costo unitario y la base usada para calcularlo. */
const esquemaCostoUnitario = z.object({
  base: esquemaBaseProrrateo.describe('Base usada (`recibido` por defecto desde 0.061).'),
  cantidadBase: z.number().int().describe('Piezas de la base (divisor).'),
  costoUnitario: z
    .number()
    .nullable()
    .describe('costoTotal ÷ cantidadBase, o null si la base es 0, no hay costo, o sin importes.'),
  motivoSinUnitario: esquemaMotivoSinUnitario
    .nullable()
    .describe('Por qué `costoUnitario` es null; null cuando SÍ hay unitario.'),
  textoSinUnitario: z
    .string()
    .nullable()
    .describe(
      'La frase que la pantalla debe mostrar en lugar del unitario (p. ej. "Aún no hay piezas ' +
        'recibidas…"). La redacta el servidor; null cuando sí hay unitario.',
    ),
  congeladoEn: z.iso
    .datetime()
    .nullable()
    .describe(
      'Cuándo se CONGELÓ este unitario al cerrar la orden (0.061). Con valor, `cantidadBase` y ' +
        '`costoUnitario` NO se recalculan: son los del cierre. null = se calcula en vivo.',
    ),
});

/**
 * COSTO de una orden: el TEÓRICO calculado en vivo + el GUARDADO (o null si aún no se costea) +
 * las cantidades derivadas + el costo unitario. Importes en `null` sin `consultas.ver-importes`.
 */
export const esquemaCostoOrdenSalida = z
  .object({
    idOrden: z.number().int().describe('Id de la orden.'),
    folio: z.number().int().describe('Folio de la orden.'),
    idModelo: z.number().int().describe('Modelo de la orden.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo.'),
    idCliente: z.number().int().describe('Cliente de la orden.'),
    cliente: z.string().describe('Nombre del cliente.'),
    noCostear: z
      .boolean()
      .describe('Si true, la orden está marcada "no costear" (no se guarda costo).'),
    cantidades: esquemaCantidadesOrden.describe('Cantidades derivadas de la orden.'),
    teorico: esquemaCostoTeorico.describe('Componentes teóricos (receta × precios).'),
    real: esquemaCostoRealResumen.describe('Costo REAL de materiales desde las órdenes de compra.'),
    guardado: esquemaCostoGuardado
      .nullable()
      .describe('Costo guardado (o null si no se ha costeado).'),
    unitario: esquemaCostoUnitario.describe('Costo unitario y su base.'),
    ordenCerrada: z
      .boolean()
      .describe(
        '⭐ 0.061: la ORDEN está CERRADA — no admite captura de costo y su unitario está ' +
          'congelado. La pantalla lo usa para no ofrecer campos que el servidor va a rechazar.',
      ),
  })
  .describe('Costo de una orden: teórico + real de compras + guardado + cantidades + unitario.');

/** Forma del costo de una orden. */
export type CostoOrdenSalida = z.infer<typeof esquemaCostoOrdenSalida>;

/**
 * Cuerpo para GUARDAR/ajustar el costo de una orden (PUT).
 *
 * SEMÁNTICA DE LOS CAMPOS OPCIONALES (26-jul-2026): **omitir = CONSERVAR** lo ya guardado (o caer al
 * valor propuesto si es el primer costeo); **`null` = BORRAR** el componente.
 *
 * ⭐ **`baseProrrateo` YA NO es la excepción (0.061).** Hasta esa versión traía `.default('cortado')`
 * y omitirla PISABA la base de una orden ya costeada; hoy es `.optional()` sin default y sigue la
 * misma regla que todos: omitir CONSERVA la guardada y, en el primer costeo, cae a `recibido`.
 */
export const esquemaCostoOrdenGuardarCuerpo = z
  .object({
    telaCost: z
      .number()
      .min(0)
      .nullable()
      .optional()
      .describe(
        'Tela guardada (≥0). OMITIR = conservar lo ya guardado (o, en el primer costeo, el real ' +
          'de compras si la orden tiene compras, y si no el teórico). `null` = borrar.',
      ),
    procesosCost: z
      .number()
      .min(0)
      .nullable()
      .optional()
      .describe(
        'Procesos guardados (≥0). OMITIR = conservar lo ya guardado (o el teórico en el primer ' +
          'costeo: los procesos no se compran con OC). `null` = borrar.',
      ),
    aviosCost: z
      .number()
      .min(0)
      .nullable()
      .optional()
      .describe(
        'Avíos guardados (≥0). OMITIR = conservar lo ya guardado (o, en el primer costeo, el real ' +
          'de compras si la orden tiene compras, y si no el teórico). `null` = borrar.',
      ),
    otros: z
      .number()
      .min(0)
      .nullable()
      .optional()
      .describe('Otros costos (≥0). OMITIR = conservar lo ya guardado. `null` = borrar.'),
    descOtros: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .describe('Descripción de otros. OMITIR = conservar lo ya guardado. `null` = borrar.'),
    baseProrrateo: esquemaBaseProrrateo
      .optional()
      .describe(
        'Base de prorrateo. OMITIR = conservar la ya guardada (y, en el PRIMER costeo, `recibido`). ' +
          'Hasta 0.061 traía `.default("cortado")`, así que un PUT que la omitiera PISABA la base ' +
          'de una orden ya costeada y le cambiaba el unitario sin que nadie lo pidiera.',
      ),
    observaciones: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .describe('Observaciones. OMITIR = conservar lo ya guardado. `null` = borrar.'),
  })
  .describe(
    'Componentes guardados del costo de una orden (el total lo arma el servidor). Omitir un ' +
      'componente lo CONSERVA; mandar `null` lo borra. Desde 0.061 eso vale TAMBIÉN para ' +
      '`baseProrrateo` (ya no tiene default): omitirla conserva la guardada.',
  );

/** Cuerpo para guardar el costo de una orden. */
export type CostoOrdenGuardarCuerpo = z.infer<typeof esquemaCostoOrdenGuardarCuerpo>;

// ── Lista de costos (grid modelo/orden) ──────────────────────────────────────────────────────────

/** Filtros de la LISTA DE COSTOS (órdenes ya costeadas). */
export const esquemaListaCostosQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    busqueda: z.string().trim().max(200).optional().describe('Folio, código de modelo o cliente.'),
    idModelo: z.coerce.number().int().positive().optional().describe('Filtra por modelo.'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    ordenarPor: z
      .enum(['folio', 'costoTotal', 'fecha'])
      .default('folio')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('desc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación de la lista de costos.');

/** Parámetros de la lista de costos ya coaccionados. */
export type ListaCostosQuery = z.infer<typeof esquemaListaCostosQuery>;

/** Un renglón de la lista de costos. */
export const esquemaListaCostosFila = z.object({
  idOrden: z.number().int().describe('Id de la orden.'),
  folio: z.number().int().describe('Folio de la orden.'),
  idModelo: z.number().int().describe('Modelo.'),
  codigoModelo: z.string().describe('Código del modelo.'),
  idCliente: z.number().int().describe('Cliente.'),
  cliente: z.string().describe('Nombre del cliente.'),
  fecha: z.string().nullable().describe('Fecha de la orden (YYYY-MM-DD) o null.'),
  cortado: z.number().int().describe('Piezas cortadas.'),
  costoTotal: z.number().nullable().describe('Costo total guardado (o null sin importes).'),
  costoUnitario: z.number().nullable().describe('Costo unitario (o null sin importes / base 0).'),
  motivoSinUnitario: esquemaMotivoSinUnitario
    .nullable()
    .describe('Por qué `costoUnitario` es null; null cuando SÍ hay unitario (0.061).'),
  textoSinUnitario: z
    .string()
    .nullable()
    .describe('La frase a mostrar en lugar del unitario; null cuando sí hay unitario (0.061).'),
  baseProrrateo: esquemaBaseProrrateo.describe('Base de prorrateo guardada.'),
});

/** Respuesta paginada de la lista de costos. */
export const esquemaListaCostosPagina = z
  .object({
    datos: z.array(esquemaListaCostosFila).describe('Órdenes costeadas de la página.'),
    total: z.number().int().describe('Total de órdenes costeadas que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de la lista de costos.');

/** Forma de la lista de costos. */
export type ListaCostosPagina = z.infer<typeof esquemaListaCostosPagina>;

// ── Márgenes por pedido ──────────────────────────────────────────────────────────────────────────

/** Filtros de los MÁRGENES POR PEDIDO (mes/año/cliente sobre `fechaHasta` del pedido). */
export const esquemaMargenesQuery = z
  .object({
    anio: z.coerce.number().int().min(2000).max(2100).optional().describe('Año (fechaHasta).'),
    mes: z.coerce.number().int().min(1).max(12).optional().describe('Mes 1-12 (fechaHasta).'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
  })
  .describe('Filtros de márgenes por pedido.');

/** Parámetros de márgenes ya coaccionados. */
export type MargenesQuery = z.infer<typeof esquemaMargenesQuery>;

/**
 * Un renglón de MÁRGENES POR PEDIDO. Margen = 1 − (costoUnitario ÷ (precio − bonificaciones))
 * (fórmula de Daniel, D2 #6). Solo agrega órdenes con costo ≠ 0. Importes en `null` sin permiso.
 */
export const esquemaMargenPedidoFila = z.object({
  idPedido: z.number().int().describe('Id del pedido.'),
  folio: z.number().int().describe('Folio del pedido.'),
  idCliente: z.number().int().describe('Cliente.'),
  cliente: z.string().describe('Nombre del cliente.'),
  fechaHasta: z.string().nullable().describe('Fecha de entrega comprometida (hasta) o null.'),
  cantidad: z.number().int().describe('Piezas pedidas (de las órdenes con costo).'),
  importe: z.number().nullable().describe('Σ (precio × cantidad) o null sin importes.'),
  margenPromedio: z
    .number()
    .nullable()
    .describe('Promedio simple de los márgenes por orden (fracción).'),
  margenPonderado: z
    .number()
    .nullable()
    .describe('Margen ponderado por cantidad (fracción) o null sin importes.'),
  margenPesosPorPieza: z
    .number()
    .nullable()
    .describe('Margen en $ por pieza (precio neto − costo unitario) o null sin importes.'),
});

/** Respuesta de márgenes por pedido: filas + totales. */
export const esquemaMargenesSalida = z
  .object({
    filas: z
      .array(esquemaMargenPedidoFila)
      .describe('Márgenes por pedido (órdenes con costo ≠ 0).'),
    totalImporte: z
      .number()
      .nullable()
      .describe('Σ importes de todos los pedidos (o null sin importes).'),
    totalPiezas: z.number().int().describe('Σ piezas de todos los pedidos.'),
  })
  .describe('Costos y márgenes por pedido.');

/** Forma de la respuesta de márgenes por pedido. */
export type MargenesSalida = z.infer<typeof esquemaMargenesSalida>;
