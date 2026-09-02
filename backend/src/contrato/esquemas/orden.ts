import { z } from 'zod';

import { esquemaPackEntrada, esquemaPackSalida } from './pack.js';

/**
 * Contrato Zod del módulo ÓRDENES de producción (F2-E2 — doc `Documentacion_MJD/03-Produccion.md`
 * y `02-Pedidos.md`). La orden es el documento con el que se manda a PRODUCIR un renglón de un
 * pedido (ex `Ordenes`/`OrdenesDet`). Reglas de captura aquí (las repite el dominio, A1):
 *
 *  • El `folio` lo asigna la secuencia atómica POR EMPRESA (A3/A9) — NO se captura.
 *  • El `idEmpresa` lo toma el dominio de la sesión activa (A9) — NO viaja en el cuerpo.
 *  • La orden NUEVA SIEMPRE sale de un renglón de pedido (`idPedidoLinea` obligatorio); el
 *    modelo/cliente/empresa se AUTORRELLENAN del renglón→pedido (no se capturan). Orden sin
 *    pedido = solo histórico (lo migra el ETL), JAMÁS captura nueva (decisión Gabriel 16-jun-2026).
 *  • El `estado` (capturada/completa/cancelada) lo DERIVAN los servicios; ningún cuerpo lo lleva.
 *  • El TOTAL de la orden y de cada color se DERIVA por suma de cantidades (D4 + espíritu D3):
 *    NUNCA viaja un `total` de entrada, y en la salida sale calculado.
 *  • Los campos-dato de v1 sin motor (RC=F5; maquilaOrd/aplicacionOrd/pagada=F3/F6; tallasV1 crudo)
 *    son de SOLO LECTURA: salen en respuestas pero NINGÚN cuerpo de entrada los lleva. El `upc`
 *    histórico (códigos de barra) fue ELIMINADO del modelo (decisión Gabriel 16-jun-2026).
 *
 * Semántica del PATCH parcial (M1, igual que Pedido/Cliente): omitir un campo (`undefined`) = no
 * tocar; mandar `null` en un opcional = vaciarlo. Las fechas date-only viajan como `YYYY-MM-DD`.
 */

// ── Fechas del encabezado (date-only YYYY-MM-DD; opcionales, nullable para vaciar) ──
/**
 * Campos de fecha del encabezado de la orden. Devueltos por una función (no una constante
 * compartida) para no reusar la MISMA instancia de ZodObject en alta y edición. Ambas variantes
 * aceptan `null` (vaciar) y `undefined` (no tocar / no capturar) — son las únicas fechas que el
 * usuario captura; las fechas RC (F5) son dato conservado sin captura.
 */
function camposFechasOrden() {
  return {
    fecha: z.iso
      .date({ error: 'La fecha de la orden no es válida' })
      .nullable()
      .optional()
      .describe('Fecha de la orden (YYYY-MM-DD).'),
    fechaEntrega: z.iso
      .date({ error: 'La fecha de entrega no es válida' })
      .nullable()
      .optional()
      .describe('Fecha de entrega comprometida (YYYY-MM-DD).'),
  } as const;
}

// ── Matriz de la orden (colores con sus tallas) ─────────────────────────────────────

/**
 * Cantidad de una talla dentro de un color de la matriz (despivota `T1..T8`, D4). `idTalla` del
 * catálogo + `cantidad` entera ≥0. Una talla aparece UNA vez por color (lo valida el dominio).
 */
export const esquemaOrdenTallaEntrada = z.object({
  idTalla: z
    .number({ error: 'La talla es obligatoria' })
    .int({ error: 'El id de la talla debe ser entero' })
    .positive({ error: 'El id de la talla debe ser positivo' })
    .describe('Talla del catálogo (D4).'),
  cantidad: z
    .number({ error: 'La cantidad es obligatoria' })
    .int({ error: 'La cantidad debe ser un número entero' })
    .min(0, { error: 'La cantidad no puede ser negativa' })
    .describe('Cantidad de prendas de esta talla en este color (viejo: T1..T8).'),
});

/** Datos validados de una cantidad por talla. */
export type DatosOrdenTallaEntrada = z.infer<typeof esquemaOrdenTallaEntrada>;

/**
 * Renglón de la matriz = un COLOR del catálogo (F1) × su PACK, con sus cantidades por talla. La
 * pareja COLOR + PACK es ÚNICA por orden (lo valida el dominio y el `@@unique` de la tabla); sin
 * packs eso es lo de siempre, «un renglón por color». El `id` viene SOLO en edición para conservar
 * la auditoría del renglón existente (diff-mínimo; si falta, es renglón nuevo).
 */
export const esquemaOrdenLineaEntrada = z.object({
  id: z
    .number({ error: 'El id del renglón debe ser un número' })
    .int()
    .positive()
    .optional()
    .describe('Id del renglón (color) existente (solo en edición; ausente = renglón nuevo).'),
  idColor: z
    .number({ error: 'El color es obligatorio' })
    .int({ error: 'El id del color debe ser entero' })
    .positive({ error: 'El id del color debe ser positivo' })
    .describe('Color del catálogo (F1; en v1 era texto libre).'),
  pantone: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .describe(
      'Código PANTONE de este color (petición Daniel: campo propio, opcional; null = sin pantone).',
    ),
  pack: esquemaPackEntrada.describe(
    'PACK / TENDIDO de este renglón (§Post-F9.10): C&A pide varias corridas distintas en una misma ' +
      'OP y antes la letra iba dentro del nombre del color («Negro A»). Omitirlo o mandarlo vacío = ' +
      'la orden NO maneja packs. Una orden es con packs o sin packs: no se pueden mezclar renglones ' +
      'con y sin pack.',
  ),
  tallas: z
    .array(esquemaOrdenTallaEntrada)
    .default([])
    .describe('Cantidades por talla de este color.'),
});

/** Datos validados de un renglón (color) de la matriz. */
export type DatosOrdenLineaEntrada = z.infer<typeof esquemaOrdenLineaEntrada>;

// ── Alta de una orden (desde un renglón de pedido) ──────────────────────────────────

/**
 * Alta de una orden de producción (doc 03-Produccion). SIEMPRE desde un renglón de pedido
 * (`idPedidoLinea`): el dominio autorrellena modelo/cliente/empresa del renglón→pedido y rechaza
 * pedidos cancelados/no-producir. El resto del encabezado es opcional. La matriz (colores/tallas)
 * se captura aparte con `guardarMatrizOrden`. `lineas` puede venir en el alta para crear la matriz
 * en la misma operación (opcional).
 */
export const esquemaOrdenCrear = z.object({
  idPedidoLinea: z
    .number({ error: 'El renglón de pedido es obligatorio' })
    .int({ error: 'El id del renglón de pedido debe ser entero' })
    .positive({ error: 'El id del renglón de pedido debe ser positivo' })
    .describe(
      'Renglón del pedido del que sale la orden (obligatorio; autorrellena modelo/cliente).',
    ),
  idMaquilero: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Maquilero asignado (Proveedor con rol de maquila); en F2 solo asignación.'),
  idEtiquetaMarca: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Etiqueta de marca de la orden.'),
  idTela: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Tela dispuesta para la orden.'),
  ...camposFechasOrden(),
  observaciones: z
    .string()
    .trim()
    .max(2000, { error: 'Las observaciones no pueden tener más de 2000 caracteres' })
    .nullable()
    .optional()
    .describe('Observaciones generales.'),
  composicion: z
    .string()
    .trim()
    .max(2000, { error: 'La composición no puede tener más de 2000 caracteres' })
    .nullable()
    .optional()
    .describe('Composición textil.'),
  compForzada: z
    .boolean()
    .optional()
    .describe('La composición se capturó a mano (no derivó del BOM).'),
  obsMaquila: z
    .string()
    .trim()
    .max(2000, { error: 'Las observaciones de maquila no pueden tener más de 2000 caracteres' })
    .nullable()
    .optional()
    .describe('Observaciones de maquila.'),
  noCostear: z.boolean().optional().describe('No costear esta orden (viejo: NoCost).'),
  lineas: z
    .array(esquemaOrdenLineaEntrada)
    .optional()
    .describe('Matriz inicial (colores con sus tallas/cantidades); opcional en el alta.'),
});

/** Datos validados de alta de orden. */
export type DatosOrdenCrear = z.infer<typeof esquemaOrdenCrear>;

/**
 * Edición del ENCABEZADO de una orden (doc 03-Produccion). Campos opcionales (nullable para
 * vaciar) + `id`. NO toca: el estado (derivado), el folio, el pedido de origen ni la matriz (esa
 * se guarda con `guardarMatrizOrden`). La cancelación es su propia operación.
 */
export const esquemaOrdenEditar = z.object({
  id: z
    .number({ error: 'El id de la orden es obligatorio' })
    .int({ error: 'El id de la orden debe ser entero' })
    .positive({ error: 'El id de la orden debe ser positivo' }),
  idMaquilero: esquemaOrdenCrear.shape.idMaquilero,
  idEtiquetaMarca: esquemaOrdenCrear.shape.idEtiquetaMarca,
  idTela: esquemaOrdenCrear.shape.idTela,
  ...camposFechasOrden(),
  observaciones: esquemaOrdenCrear.shape.observaciones,
  composicion: esquemaOrdenCrear.shape.composicion,
  compForzada: esquemaOrdenCrear.shape.compForzada,
  obsMaquila: esquemaOrdenCrear.shape.obsMaquila,
  noCostear: esquemaOrdenCrear.shape.noCostear,
});

/** Datos validados de edición de orden. */
export type DatosOrdenEditar = z.infer<typeof esquemaOrdenEditar>;

/** Cuerpo del PATCH de orden (sin `id`: va en la URL). */
export const esquemaOrdenPatchCuerpo = esquemaOrdenEditar.omit({ id: true });

/** Datos validados del cuerpo del PATCH de orden. */
export type DatosOrdenPatchCuerpo = z.infer<typeof esquemaOrdenPatchCuerpo>;

// ── Cuerpos de la matriz (los esquemas de renglón/talla se definen arriba) ──────────

/**
 * Cuerpo de guardar la matriz completa de una orden (doc 03-Produccion `OrdenesDet`): el SET
 * COMPLETO de colores con sus tallas/cantidades. El dominio sincroniza (agrega/edita/quita) en una
 * transacción A2, valida color no repetido + tallas del catálogo + cantidades ≥0, y DERIVA
 * `estado='completa'` + `fechaCompletada` en el primer guardado con líneas (paridad con `FechaDet`).
 */
export const esquemaOrdenMatrizCuerpo = z.object({
  lineas: z
    .array(esquemaOrdenLineaEntrada)
    .describe('Set COMPLETO de renglones (colores con sus tallas).'),
});

/** Datos validados del cuerpo de la matriz. */
export type DatosOrdenMatriz = z.infer<typeof esquemaOrdenMatrizCuerpo>;

/**
 * Cuerpo de copiar la matriz de OTRA orden (doc 03-Produccion `CopiarDetallesOrd`): toma toda la
 * matriz de la orden origen y la copia a la actual, mapeando las tallas por su ETIQUETA (las
 * curvas pueden diferir). Sustituye la matriz actual.
 */
export const esquemaOrdenCopiarMatrizCuerpo = z.object({
  idOrdenOrigen: z
    .number({ error: 'La orden de origen es obligatoria' })
    .int({ error: 'El id de la orden de origen debe ser entero' })
    .positive({ error: 'El id de la orden de origen debe ser positivo' })
    .describe('Orden de la que se copia la matriz (de la misma empresa).'),
});

/** Datos validados del cuerpo de copiar matriz. */
export type DatosOrdenCopiarMatriz = z.infer<typeof esquemaOrdenCopiarMatrizCuerpo>;

// ── Cancelar ────────────────────────────────────────────────────────────────────────

/** Cuerpo de cancelar una orden (cancelación SUAVE): el motivo es OBLIGATORIO. */
export const esquemaOrdenCancelarCuerpo = z.object({
  motivo: z
    .string({ error: 'El motivo de cancelación es obligatorio' })
    .trim()
    .min(1, { error: 'El motivo de cancelación es obligatorio' })
    .max(2000, { error: 'El motivo no puede tener más de 2000 caracteres' })
    .describe('Motivo de la cancelación (obligatorio; viejo: MotivoCancelada).'),
});

/** Datos validados del cuerpo de cancelar. */
export type DatosOrdenCancelar = z.infer<typeof esquemaOrdenCancelarCuerpo>;

// ── Referencias (D7 — campos de cliente) ─────────────────────────────────────────────

/** Un valor de referencia: el `ClienteCampo` (ACTIVO, del cliente de la orden) + su valor. */
export const esquemaOrdenReferenciaEntrada = z.object({
  idClienteCampo: z
    .number({ error: 'El campo de referencia es obligatorio' })
    .int({ error: 'El id del campo debe ser entero' })
    .positive({ error: 'El id del campo debe ser positivo' })
    .describe(
      'Campo de referencia del cliente (D7; debe ser del cliente de la orden y estar activo).',
    ),
  valor: z
    .string()
    .trim()
    .max(500, { error: 'El valor no puede tener más de 500 caracteres' })
    .describe('Valor capturado para ese campo en esta orden.'),
});

/** Datos validados de un valor de referencia. */
export type DatosOrdenReferenciaEntrada = z.infer<typeof esquemaOrdenReferenciaEntrada>;

/** Cuerpo de guardar las referencias de una orden: el SET COMPLETO de campos con su valor. */
export const esquemaOrdenReferenciasCuerpo = z.object({
  referencias: z
    .array(esquemaOrdenReferenciaEntrada)
    .describe('Set COMPLETO de valores de referencia (por campo del cliente).'),
});

/** Datos validados del cuerpo de referencias. */
export type DatosOrdenReferencias = z.infer<typeof esquemaOrdenReferenciasCuerpo>;

// ── Comentarios ───────────────────────────────────────────────────────────────────────

/** Cuerpo de agregar un comentario INMUTABLE a una orden (viejo: ComentaOrd). */
export const esquemaOrdenComentarioCuerpo = z.object({
  comentario: z
    .string({ error: 'El comentario es obligatorio' })
    .trim()
    .min(1, { error: 'El comentario no puede estar vacío' })
    .max(4000, { error: 'El comentario no puede tener más de 4000 caracteres' })
    .describe('Texto del comentario (inmutable: no se edita ni se borra).'),
});

/** Datos validados del cuerpo de comentario. */
export type DatosOrdenComentario = z.infer<typeof esquemaOrdenComentarioCuerpo>;

// ── Salidas ─────────────────────────────────────────────────────────────────────────

/** Estado de la orden tal como sale al cliente. */
export const esquemaEstadoOrden = z
  .enum(['capturada', 'completa', 'cancelada'])
  .describe('Estado DERIVADO de la orden (no editable).');

/**
 * REQUISITOS que sostienen el estado `completa` (Daniel 26-jul-2026): la orden dice POR QUÉ está
 * como está. Regla: **tallas + receta liberada, y arte si aplica**. `arte: "no-aplica"` = el modelo
 * no lleva arte (no bloquea). `faltantes` es lo que la UI muestra como "Falta: …".
 *
 * ⭐ V1-E3d (§Post-F9.43): el segundo requisito era *"¿el modelo tiene avíos?"* y pasó a ser
 * **"¿la receta de la OP está liberada?"** — el mismo semáforo diciendo algo verdadero. Preguntarle
 * al MODELO nunca fue una pregunta sobre ESTA orden: dos órdenes del mismo modelo daban siempre la
 * misma respuesta, aunque una llevara jareta y la otra no.
 */
export const esquemaRequisitosOrden = z
  .object({
    tallas: z.boolean().describe('La orden tiene su matriz de tallas capturada (≥1 renglón).'),
    receta: z
      .boolean()
      .describe(
        'Desarrollo liberó la receta congelada de esta orden POR COMPLETO. Desde V1-E3h ' +
          '(§Post-F9.72) la firma es por renglón y se puede liberar por partes: una orden con la ' +
          'receta a medio firmar SÍ puede comprar lo liberado, pero todavía NO está completa — que ' +
          'es exactamente lo que este requisito dice.',
      ),
    arte: z
      .union([z.literal('no-aplica'), z.boolean()])
      .describe('La receta de la orden tiene su arte; "no-aplica" si el modelo no lleva arte.'),
    completa: z.boolean().describe('Se cumplen todos los requisitos que aplican.'),
    faltantes: z
      .array(z.enum(['tallas', 'receta', 'arte']))
      .describe('Requisitos que hoy faltan (vacío si está completa).'),
  })
  .describe('Por qué la orden está (o no) completa.');

/** Forma de los requisitos de una orden en la API. */
export type RequisitosOrdenSalida = z.infer<typeof esquemaRequisitosOrden>;

/** Cantidad por talla en la salida (con la etiqueta de la talla para la UI). */
export const esquemaOrdenTallaSalida = z
  .object({
    idTalla: z.number().int().describe('Id de la talla.'),
    etiquetaTalla: z.string().describe('Etiqueta de la talla (para la UI).'),
    cantidad: z.number().int().describe('Cantidad de prendas de esta talla.'),
  })
  .describe('Cantidad por talla dentro de un color.');

/** Forma de una cantidad por talla en la API. */
export type OrdenTallaSalida = z.infer<typeof esquemaOrdenTallaSalida>;

/** Renglón (color) de la matriz en la salida, con su total derivado por suma de tallas. */
export const esquemaOrdenLineaSalida = z
  .object({
    id: z.number().int().describe('Id del renglón (color).'),
    idColor: z.number().int().describe('Id del color.'),
    color: z.string().describe('Nombre del color (para la UI).'),
    pantone: z.string().nullable().describe('Código PANTONE de este color, o null.'),
    pack: esquemaPackSalida.describe(
      'PACK / TENDIDO de este renglón (§Post-F9.10). CADENA VACÍA = la orden no maneja packs.',
    ),
    tallas: z.array(esquemaOrdenTallaSalida).describe('Cantidades por talla.'),
    totalPiezas: z.number().int().describe('Suma de las cantidades de las tallas de este color.'),
  })
  .describe('Renglón (color) de la matriz de una orden.');

/** Forma de un renglón (color) en la API. */
export type OrdenLineaSalida = z.infer<typeof esquemaOrdenLineaSalida>;

/** Valor de referencia en la salida (con la etiqueta del campo para la UI). */
export const esquemaOrdenReferenciaSalida = z
  .object({
    id: z.number().int().describe('Id del valor de referencia.'),
    idClienteCampo: z.number().int().describe('Campo de referencia del cliente.'),
    etiqueta: z.string().describe('Etiqueta del campo (para la UI).'),
    valor: z.string().describe('Valor capturado.'),
  })
  .describe('Valor de un campo de referencia de la orden.');

/** Forma de un valor de referencia en la API. */
export type OrdenReferenciaSalida = z.infer<typeof esquemaOrdenReferenciaSalida>;

/** Comentario en la salida. */
export const esquemaOrdenComentarioSalida = z
  .object({
    id: z.number().int().describe('Id del comentario.'),
    idUsuario: z.string().nullable().describe('Usuario que lo escribió, o null.'),
    nombreUsuario: z
      .string()
      .nullable()
      .describe(
        'Nombre de quien lo escribió; null si el id no resuelve (el comentario se sigue viendo).',
      ),
    comentario: z.string().describe('Texto del comentario.'),
    fecha: z.iso.datetime().describe('Fecha del comentario (ISO 8601).'),
  })
  .describe('Comentario inmutable de una orden.');

/** Forma de un comentario en la API. */
export type OrdenComentarioSalida = z.infer<typeof esquemaOrdenComentarioSalida>;

/**
 * Salida de una orden (proyección a JSON). Incluye el encabezado, la matriz (colores/tallas con
 * total derivado), las referencias y los comentarios. Los campos-dato de v1 sin motor salen como
 * SOLO LECTURA (RC/finanzas/tallasV1).
 */
export const esquemaOrdenSalida = z
  .object({
    id: z.number().int().describe('Id interno de la orden.'),
    folio: z.number().int().describe('Folio consecutivo por empresa.'),
    idEmpresa: z.number().int().describe('Empresa dueña de la orden y del folio.'),
    estado: esquemaEstadoOrden,
    idPedidoLinea: z
      .number()
      .int()
      .nullable()
      .describe('Renglón de pedido de origen (null solo en órdenes históricas migradas).'),
    idModelo: z.number().int().describe('Modelo a producir.'),
    codigoModelo: z.string().describe('Código del modelo (para la UI).'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    idCliente: z.number().int().describe('Cliente de la orden.'),
    cliente: z.string().describe('Nombre del cliente (para la UI).'),
    idMaquilero: z.number().int().nullable().describe('Maquilero asignado (Proveedor), o null.'),
    maquilero: z.string().nullable().describe('Nombre del maquilero, o null.'),
    idEtiquetaMarca: z.number().int().nullable().describe('Etiqueta de marca, o null.'),
    etiquetaMarca: z.string().nullable().describe('Nombre de la etiqueta de marca, o null.'),
    idTela: z.number().int().nullable().describe('Tela dispuesta, o null.'),
    tela: z.string().nullable().describe('Nombre de la tela, o null.'),
    fecha: z.iso.date().nullable().describe('Fecha de la orden (YYYY-MM-DD), o null.'),
    fechaEntrega: z.iso.date().nullable().describe('Fecha de entrega comprometida, o null.'),
    observaciones: z.string().nullable().describe('Observaciones generales, o null.'),
    composicion: z.string().nullable().describe('Composición textil, o null.'),
    compForzada: z.boolean().describe('La composición se capturó a mano.'),
    obsMaquila: z.string().nullable().describe('Observaciones de maquila, o null.'),
    noCostear: z.boolean().describe('No costear esta orden.'),
    fechaCompletada: z.iso
      .datetime()
      .nullable()
      .describe(
        'Fecha en que la orden quedó completa por PRIMERA vez (se sella una vez y no se borra), o null.',
      ),
    requisitos: esquemaRequisitosOrden,
    motivoCancelada: z.string().nullable().describe('Motivo de la cancelación, o null.'),
    ocCliente: z
      .string()
      .nullable()
      .describe(
        'SNAPSHOT de la OC original del cliente, copiado del pedido AL CREAR la orden (R3, B3). Solo lectura: queda amarrado aunque el pedido se reorganice.',
      ),
    // ── Datos de v1 conservados de SOLO LECTURA (sin motor; ETL los puebla). ──
    tallasV1: z
      .string()
      .nullable()
      .describe('Cadena cruda de tallas del viejo, de SOLO LECTURA (trazabilidad).'),
    maquilaOrd: z
      .number()
      .nullable()
      .describe('Costo de maquila de v1 (dato; motor en F3/F6), o null.'),
    aplicacionOrd: z
      .number()
      .nullable()
      .describe('Costo de aplicación/estampado de v1 (dato; motor en F3/F6), o null.'),
    pagada: z.boolean().nullable().describe('Maquila pagada (dato de v1; motor en F6), o null.'),
    enRiesgo: z.boolean().nullable().describe('Bandera RC de v1 (dato; motor en F5), o null.'),
    siRC: z.boolean().nullable().describe('Bandera RC de v1 (dato; motor en F5), o null.'),
    rcViva: z.boolean().nullable().describe('Bandera RC de v1 (dato; motor en F5), o null.'),
    // ── Matriz, totales derivados, referencias y comentarios. ──
    lineas: z.array(esquemaOrdenLineaSalida).describe('Matriz: colores con sus tallas.'),
    totalPiezas: z.number().int().describe('Total de prendas de la orden (Σ de todas las tallas).'),
    referencias: z
      .array(esquemaOrdenReferenciaSalida)
      .describe('Valores de referencia del cliente.'),
    comentarios: z.array(esquemaOrdenComentarioSalida).describe('Comentarios (cronológicos).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Orden de producción (encabezado + matriz + referencias + comentarios).');

/** Forma de una orden en la API. */
export type OrdenSalida = z.infer<typeof esquemaOrdenSalida>;

// ── Listado / búsqueda ────────────────────────────────────────────────────────────────

/**
 * Parámetros del listado de órdenes EN LA URL (querystring). Búsqueda combinada (folio, modelo,
 * cliente, valor de referencia D7) + filtros por modelo/cliente/año/estado, orden y paginación.
 */
export const esquemaListarOrdenes = z
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
      .describe('Texto a buscar (folio, código de modelo, cliente o valor de referencia).'),
    idModelo: z.coerce.number().int().positive().optional().describe('Filtra por modelo.'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    anio: z.coerce
      .number()
      .int()
      .min(2000)
      .max(2100)
      .optional()
      .describe('Filtra por año de la fecha.'),
    estado: esquemaEstadoOrden.optional().describe('Filtra por estado.'),
    incluirCanceladas: z
      .stringbool()
      .default(false)
      .describe('Incluye las órdenes canceladas (cancelación suave).'),
    ordenarPor: z
      .enum(['folio', 'fecha', 'fechaEntrega', 'creadoEn'])
      .default('folio')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('desc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de órdenes.');

/** Parámetros de listado de órdenes ya coaccionados desde la URL. */
export type ListarOrdenes = z.infer<typeof esquemaListarOrdenes>;

/** Respuesta paginada del listado de órdenes (forma estándar `Pagina<T>`). */
export const esquemaOrdenesPagina = z
  .object({
    datos: z.array(esquemaOrdenSalida).describe('Órdenes de la página.'),
    total: z.number().int().describe('Total de órdenes que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de órdenes.');

/** Forma de la respuesta paginada de órdenes. */
export type OrdenesPagina = z.infer<typeof esquemaOrdenesPagina>;

// ── Impreso de la orden (F2-E4, R9) ────────────────────────────────────────────────────

/**
 * Cuerpo de la impresión por LOTE de órdenes (`POST /ordenes/impresos`): la lista de ids de
 * órdenes (de la empresa activa) a consolidar en UN solo PDF (una orden por página). Entre 1 y 100
 * ids. La respuesta NO es JSON sino `application/pdf` (un Buffer binario), por eso no hay esquema de
 * respuesta en el contrato — el endpoint solo documenta su cuerpo.
 */
export const esquemaOrdenesImpresoCuerpo = z
  .object({
    ids: z
      .array(
        z
          .number({ error: 'Cada id de orden debe ser un número' })
          .int({ error: 'El id de la orden debe ser entero' })
          .positive({ error: 'El id de la orden debe ser positivo' }),
      )
      .min(1, { error: 'Indica al menos una orden a imprimir' })
      .max(100, { error: 'No se pueden imprimir más de 100 órdenes a la vez' })
      .describe('Ids de las órdenes a consolidar en el PDF (una por página).'),
  })
  .describe('Lote de órdenes a imprimir en un solo PDF.');

/** Datos validados del cuerpo de impresión por lote. */
export type DatosOrdenesImpreso = z.infer<typeof esquemaOrdenesImpresoCuerpo>;
