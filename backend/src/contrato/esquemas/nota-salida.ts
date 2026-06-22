import { z } from 'zod';

/**
 * Esquemas Zod de las NOTAS DE SALIDA estructuradas (Módulo 5, F4-E5 — doc
 * `Documentacion_MJD/03-Produccion.md` §"Submódulo — Notas de Salida (Menú 3.4)";
 * 04-Inventarios.md §"Cómo conecta"; MEJORAS §03; R4/R9). UNA sola definición de reglas para UI y
 * servidor (alimenta el OpenAPI). Una nota documenta el ENVÍO de materiales a un maquilero
 * (un Proveedor/tercero — fusión D12/R15) contra una orden de producción. Dos tipos de renglón:
 *  • AVÍO (`idAvio`): al CONFIRMAR la nota descuenta el kardex de avíos con un movimiento
 *    `salida-por-nota` (R4 — el consumo de avíos va ligado a las notas).
 *  • TELA (`idTela` + `idLote` + `idMovimientoSalidaTela`): la tela YA se descontó UNA sola vez con
 *    `registrarSalidaTelaAOrden` (E1). La nota solo REFERENCIA ese movimiento `salida-tela-orden` y
 *    NO genera segundo movimiento (DECISIÓN (e) de Daniel — anti-doble-descuento).
 *
 * Captura por RENGLÓN: cada renglón liga una orden de producción destino (`idOrden`) y un material
 * (avío XOR tela) con su `cantidad`. La empresa la toma el dominio de la sesión activa (A9); el
 * folio `numNota` lo asigna la secuencia atómica por empresa (A3). `descripcionLegacy` NO se captura
 * (es solo para el texto libre que migrará E6).
 */

const idPositivo = (campo: string) =>
  z
    .number({ error: `El id de ${campo} es obligatorio` })
    .int({ error: `El id de ${campo} debe ser entero` })
    .positive({ error: `El id de ${campo} debe ser positivo` });

// ── Renglón de entrada ─────────────────────────────────────────────────────────────────────────

/**
 * Un renglón de nota de salida a capturar: la orden destino + el material (AVÍO XOR TELA) + cantidad.
 * El XOR avío/tela y la liga obligatoria del renglón de TELA a su movimiento `salida-tela-orden`
 * (anti-doble-descuento) los valida el DOMINIO (A1): aquí solo se fija la forma de captura.
 *  • AVÍO: `idAvio` (sin `idTela`/`idLote`/`idMovimientoSalidaTela`).
 *  • TELA: `idTela` + `idLote` + `idMovimientoSalidaTela` (movimiento de salida-a-orden de E1).
 */
export const esquemaNotaSalidaLineaEntrada = z
  .object({
    idOrden: idPositivo('la orden de producción'),
    idAvio: idPositivo('el avío').optional(),
    idTela: idPositivo('la tela').optional(),
    idLote: idPositivo('el lote').optional(),
    idMovimientoSalidaTela: idPositivo('el movimiento de salida de tela a orden').optional(),
    cantidad: z
      .number({ error: 'La cantidad enviada es obligatoria' })
      .positive({ error: 'La cantidad enviada debe ser mayor que 0' })
      .describe('Cantidad enviada (avíos en pza; telas en kg/m).'),
    unidad: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .optional()
      .describe('Unidad del renglón (pza, m, kg…), para mostrar sin join.'),
  })
  .describe('Renglón de nota de salida: orden destino + material (avío XOR tela) + cantidad.');

/** Datos validados de un renglón de nota de salida. */
export type DatosNotaSalidaLineaEntrada = z.infer<typeof esquemaNotaSalidaLineaEntrada>;

// ── Alta / edición del encabezado + renglones ────────────────────────────────────────────────────

/**
 * Alta de una nota de salida (nace `borrador`). `idMaquilero` = el Proveedor/tercero destino;
 * `idAlmacen` = el almacén ORIGEN del que salen los avíos al CONFIRMAR (un almacén por nota, en el
 * encabezado — decisión (g) de Daniel, espejo de la recepción de compra); `fechaElaboracion`
 * obligatoria; `fechaEnvio` opcional (cuando salga el envío). `lineas` = al menos un renglón. La
 * empresa y el folio los pone el dominio (A9/A3). El descuento de avíos sucede al CONFIRMAR, no al
 * crear.
 */
export const esquemaNotaSalidaCrear = z
  .object({
    idMaquilero: idPositivo('el maquilero'),
    idAlmacen: idPositivo('el almacén origen'),
    fechaElaboracion: z.iso.date({
      error: 'La fecha de elaboración es obligatoria (YYYY-MM-DD)',
    }),
    fechaEnvio: z.iso
      .date({ error: 'La fecha de envío debe ser YYYY-MM-DD' })
      .nullable()
      .optional(),
    observaciones: z.string().trim().max(2000).nullable().optional(),
    lineas: z
      .array(esquemaNotaSalidaLineaEntrada)
      .min(1, { error: 'Captura al menos un renglón' })
      .describe(
        'Renglones de la nota (avío que descuenta O tela que referencia su salida-a-orden).',
      ),
  })
  .describe('Alta de una nota de salida en borrador.');

/** Datos validados de alta de nota de salida. */
export type DatosNotaSalidaCrear = z.infer<typeof esquemaNotaSalidaCrear>;

/**
 * Edición del cuerpo de una nota de salida en BORRADOR (encabezado + reemplazo opcional del SET de
 * renglones). Todos los campos opcionales (PATCH parcial); si `lineas` viene, REEMPLAZA todo el set.
 * Una nota confirmada/cancelada NO se edita (lo refuerza el dominio). El maquilero no se exige al
 * editar (queda como estaba si no se manda).
 */
export const esquemaNotaSalidaEditarCuerpo = z
  .object({
    idMaquilero: idPositivo('el maquilero').optional(),
    idAlmacen: idPositivo('el almacén origen').optional(),
    fechaElaboracion: z.iso
      .date({ error: 'La fecha de elaboración debe ser YYYY-MM-DD' })
      .optional(),
    fechaEnvio: z.iso
      .date({ error: 'La fecha de envío debe ser YYYY-MM-DD' })
      .nullable()
      .optional(),
    observaciones: z.string().trim().max(2000).nullable().optional(),
    lineas: z
      .array(esquemaNotaSalidaLineaEntrada)
      .min(1, { error: 'Captura al menos un renglón' })
      .optional()
      .describe('Si viene, REEMPLAZA todo el set de renglones de la nota.'),
  })
  .describe('Edición del cuerpo de una nota de salida en borrador.');

/** Datos validados de edición de nota de salida. */
export type DatosNotaSalidaEditar = z.infer<typeof esquemaNotaSalidaEditarCuerpo>;

// ── Cancelación ───────────────────────────────────────────────────────────────────────────────────

/** Cuerpo de la cancelación de una nota (cancelación SUAVE, D3): el motivo es OBLIGATORIO. */
export const esquemaNotaSalidaCancelarCuerpo = z
  .object({
    motivo: z
      .string({ error: 'El motivo de la cancelación es obligatorio' })
      .trim()
      .min(1, { error: 'El motivo de la cancelación es obligatorio' })
      .max(2000, { error: 'El motivo no puede tener más de 2000 caracteres' })
      .describe('Motivo de la cancelación (obligatorio).'),
  })
  .describe('Cancelación suave de una nota de salida (reverso auditado de avíos, D3).');

/** Datos validados del cuerpo de cancelar. */
export type DatosNotaSalidaCancelar = z.infer<typeof esquemaNotaSalidaCancelarCuerpo>;

// ── Salidas (proyección a la API) ──────────────────────────────────────────────────────────────

/** Renglón de una nota de salida en la salida (con nombres y trazas a los movimientos de kardex). */
export const esquemaNotaSalidaLineaSalida = z
  .object({
    id: z.number().int().describe('Id del renglón.'),
    idOrden: z.number().int().describe('Orden de producción destino.'),
    folioOrden: z.number().int().nullable().describe('Folio de la orden destino, o null.'),
    tipo: z.enum(['avio', 'tela']).describe('Tipo del material del renglón.'),
    idAvio: z.number().int().nullable().describe('Avío del catálogo, o null.'),
    avio: z.string().nullable().describe('Clave/descripción del avío, o null.'),
    idTela: z.number().int().nullable().describe('Tela del catálogo, o null.'),
    tela: z.string().nullable().describe('Nombre de la tela, o null.'),
    idLote: z.number().int().nullable().describe('Lote de la tela enviada (D5), o null.'),
    loteClave: z.string().nullable().describe('Clave del lote, o null.'),
    idMovimientoSalidaTela: z
      .number()
      .int()
      .nullable()
      .describe('Movimiento `salida-tela-orden` de E1 que el renglón de tela referencia, o null.'),
    folioMovimientoSalidaTela: z
      .number()
      .int()
      .nullable()
      .describe('Folio del movimiento de salida de tela referenciado, o null.'),
    idMovimientoAvio: z
      .number()
      .int()
      .nullable()
      .describe('Movimiento `salida-por-nota` generado al confirmar (avío), o null.'),
    folioMovimientoAvio: z
      .number()
      .int()
      .nullable()
      .describe('Folio del movimiento de descuento de avío, o null.'),
    cantidad: z.number().describe('Cantidad enviada (avíos en pza; telas en kg/m).'),
    unidad: z.string().nullable().describe('Unidad del renglón, o null.'),
    descripcionLegacy: z
      .string()
      .nullable()
      .describe('Texto libre legado (solo migración E6), o null.'),
  })
  .describe('Renglón de una nota de salida.');

/** Forma de un renglón de nota de salida en la API. */
export type NotaSalidaLineaSalida = z.infer<typeof esquemaNotaSalidaLineaSalida>;

/** Salida de una nota de salida (encabezado + renglones). */
export const esquemaNotaSalidaSalida = z
  .object({
    id: z.number().int().describe('Id interno de la nota.'),
    numNota: z.number().int().describe('Folio consecutivo por empresa (A3/A9).'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    estatus: z.enum(['borrador', 'confirmada', 'cancelada']).describe('Estatus del documento.'),
    idMaquilero: z.number().int().describe('Maquilero destino (Proveedor/tercero).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    idAlmacen: z.number().int().describe('Almacén origen de los avíos (encabezado, decisión g).'),
    almacen: z.string().describe('Nombre del almacén origen.'),
    fechaElaboracion: z.iso.date().describe('Fecha de elaboración (YYYY-MM-DD).'),
    fechaEnvio: z.iso.date().nullable().describe('Fecha de envío (YYYY-MM-DD), o null.'),
    observaciones: z.string().nullable().describe('Observaciones, o null.'),
    confirmadaEn: z.iso.datetime().nullable().describe('Fecha de confirmación (ISO), o null.'),
    confirmadaPorId: z.string().nullable().describe('Usuario que confirmó, o null.'),
    canceladaEn: z.iso.datetime().nullable().describe('Fecha de cancelación (ISO), o null.'),
    canceladaPorId: z.string().nullable().describe('Usuario que canceló, o null.'),
    motivoCancelacion: z.string().nullable().describe('Motivo de la cancelación, o null.'),
    lineas: z.array(esquemaNotaSalidaLineaSalida).describe('Renglones de la nota.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del usuario que la modificó.'),
  })
  .describe('Nota de salida (encabezado + renglones).');

/** Forma de una nota de salida en la API. */
export type NotaSalidaSalida = z.infer<typeof esquemaNotaSalidaSalida>;

// ── Listado (paginado en servidor) ────────────────────────────────────────────────────────────

/** Querystring del listado de notas de salida (coacciona desde texto; el dominio re-valida). */
export const esquemaNotasSalidaQuery = z
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
      .describe('Texto a buscar (folio o nombre del maquilero).'),
    idMaquilero: z.coerce.number().int().positive().optional().describe('Filtra por maquilero.'),
    idOrden: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Notas que envían material a esta orden de producción.'),
    estatus: z
      .enum(['borrador', 'confirmada', 'cancelada'])
      .optional()
      .describe('Filtra por estatus.'),
    incluirCanceladas: z
      .stringbool()
      .default(false)
      .describe('Incluye las notas canceladas (cancelación suave).'),
    ordenarPor: z
      .enum(['numNota', 'fechaElaboracion', 'creadoEn'])
      .default('numNota')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('desc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de notas de salida.');

/** Forma de la querystring del listado. */
export type NotasSalidaQuery = z.infer<typeof esquemaNotasSalidaQuery>;

/** Página de notas de salida (forma estándar `Pagina<T>`). */
export const esquemaNotasSalidaPagina = z
  .object({
    datos: z.array(esquemaNotaSalidaSalida).describe('Notas de la página.'),
    total: z.number().int().describe('Total de notas que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de notas de salida.');

/** Forma de la página de notas de salida. */
export type NotasSalidaPagina = z.infer<typeof esquemaNotasSalidaPagina>;
