import { z } from 'zod';

/**
 * Contrato Zod del módulo PEDIDOS (F2-E1 — doc `Documentacion_MJD/02-Pedidos.md`).
 *
 * Dos niveles (doc 02 §1): el pedido INTERNO (encabezado + renglones, ex `Pedidos`/
 * `PedidosDet`) y el pedido REAL (liberación del cliente con su CEDIS/fechas, ex
 * `PedidosReales`/`PedidosRealesDet`). Reglas de captura aquí (las repite el dominio, A1):
 *
 *  • El `folio` lo asigna la secuencia atómica POR EMPRESA (A3/A9) — NO se captura.
 *  • El `idEmpresa` lo toma el dominio de la sesión activa (A9) — NO viaja en el cuerpo.
 *  • `precio` por renglón es SNAPSHOT del momento del pedido (editable).
 *  • Los campos `*V1` (snapshots migrados: idOrdCompraV1, entregadoParcialV1, cantFaltanteV1)
 *    son de SOLO LECTURA: salen en las respuestas pero NINGÚN cuerpo de entrada los lleva
 *    (espíritu D3 — su saldo vivo se deriva en F3). El precio se OMITE de las respuestas
 *    cuando la sesión no tiene `pedidos.importes` (ocultamiento server-side, NO con CSS).
 *
 * Semántica del PATCH parcial (M1, igual que Cliente/Proveedor): omitir un campo
 * (`undefined`) = no tocar; mandar `null` en un opcional = vaciarlo. Las fechas viajan como
 * `YYYY-MM-DD` (date-only, sin zona) para no desfasar por husos horarios.
 */

// ── Renglón del pedido interno ────────────────────────────────────────────────────

/**
 * Renglón de captura de un pedido interno (alta o reemplazo del set, doc 02 §2 `PedidosDet`).
 * `idModelo` + `cantidadPedida` + `precio`. El `id` viene SOLO en edición para conservar la
 * auditoría del renglón que ya existía (el dominio hace diff; si falta, es renglón nuevo).
 *
 * `precio` es OPCIONAL a propósito (no porque sea un dato secundario, sino por la regla de
 * importes, doc 02 §3): un usuario SIN `pedidos.importes` no ve ni captura el precio, así que
 * NO debe mandarlo. El dominio decide qué hacer con su ausencia según el caso (renglón nuevo →
 * 0; renglón existente → conserva el precio almacenado), NUNCA escribe un 0 falso encima del
 * precio real. Si viene, debe ser ≥ 0.
 */
export const esquemaPedidoLineaEntrada = z.object({
  id: z
    .number({ error: 'El id del renglón debe ser un número' })
    .int()
    .positive()
    .optional()
    .describe('Id del renglón existente (solo en edición; ausente = renglón nuevo).'),
  idModelo: z
    .number({ error: 'El modelo es obligatorio' })
    .int({ error: 'El id del modelo debe ser entero' })
    .positive({ error: 'El id del modelo debe ser positivo' })
    .describe('Modelo pedido (del catálogo de modelos).'),
  cantidadPedida: z
    .number({ error: 'La cantidad es obligatoria' })
    .int({ error: 'La cantidad debe ser un número entero' })
    .min(1, { error: 'La cantidad debe ser al menos 1' })
    .describe('Cantidad pedida del modelo (viejo: CantPed).'),
  precio: z
    .number({ error: 'El precio debe ser un número' })
    .min(0, { error: 'El precio no puede ser negativo' })
    .optional()
    .describe(
      'Precio pactado por prenda — snapshot del pedido (viejo: Precio). Opcional: un usuario sin `pedidos.importes` NO lo manda; el dominio conserva el precio almacenado (renglón existente) o usa 0 (renglón nuevo).',
    ),
  idDesarrollo: z
    .number({ error: 'El id del desarrollo debe ser un número' })
    .int({ error: 'El id del desarrollo debe ser entero' })
    .positive({ error: 'El id del desarrollo debe ser positivo' })
    .nullable()
    .optional()
    .describe(
      'Desarrollo (F8) del que sale el renglón (rediseño R3, B4): el constructor elige el modelo DE DESARROLLO. El dominio valida que el desarrollo sea de ese modelo y del cliente del pedido. `null` lo desliga; omitido = no tocar (edición) / sin desarrollo (alta).',
    ),
});

/** Datos validados de un renglón de pedido. */
export type DatosPedidoLineaEntrada = z.infer<typeof esquemaPedidoLineaEntrada>;

// ── Encabezado del pedido interno ─────────────────────────────────────────────────

/** Fechas del pedido (todas opcionales). Tipo date-only `YYYY-MM-DD`. */
const camposFechasPedido = {
  fechaPedido: z.iso.date({ error: 'La fecha del pedido no es válida' }).optional(),
  fechaDe: z.iso.date({ error: 'La fecha "de" no es válida' }).optional(),
  fechaHasta: z.iso.date({ error: 'La fecha "hasta" no es válida' }).optional(),
  fechaTela: z.iso.date({ error: 'La fecha de tela no es válida' }).optional(),
  fechaElaboracion: z.iso.date({ error: 'La fecha de elaboración no es válida' }).optional(),
} as const;

/** Variante de edición: cada fecha acepta además `null` para vaciarla (M1). */
const camposFechasPedidoEditar = {
  fechaPedido: camposFechasPedido.fechaPedido.nullable(),
  fechaDe: camposFechasPedido.fechaDe.nullable(),
  fechaHasta: camposFechasPedido.fechaHasta.nullable(),
  fechaTela: camposFechasPedido.fechaTela.nullable(),
  fechaElaboracion: camposFechasPedido.fechaElaboracion.nullable(),
} as const;

/**
 * Alta de un pedido interno (doc 02 §2). El cliente + las fechas + los renglones. El folio,
 * la empresa y la auditoría los pone el dominio. `lineas` puede venir vacía (un pedido se
 * puede abrir sin renglones y agregárselos al editar).
 */
export const esquemaPedidoCrear = z.object({
  idCliente: z
    .number({ error: 'El cliente es obligatorio' })
    .int({ error: 'El id del cliente debe ser entero' })
    .positive({ error: 'El id del cliente debe ser positivo' })
    .describe('Cliente del pedido.'),
  ...camposFechasPedido,
  entregadoTienda: z.boolean().default(false).describe('Marca de entregado a tienda.'),
  noProducir: z.boolean().default(false).describe('Marcado para no producir.'),
  ocCliente: z
    .string()
    .trim()
    .max(100, { error: 'La OC del cliente no puede tener más de 100 caracteres' })
    .optional()
    .describe(
      'OC ORIGINAL del cliente (rediseño R3, B3): su nº de orden de compra. Captura viva; al crear cada OP se copia como snapshot a la orden.',
    ),
  lineas: z
    .array(esquemaPedidoLineaEntrada)
    .default([])
    .describe('Renglones del pedido (modelo + cantidad + precio).'),
});

/** Datos validados de alta de pedido. */
export type DatosPedidoCrear = z.infer<typeof esquemaPedidoCrear>;

/**
 * Edición de un pedido interno: campos del alta opcionales (fechas nullable para vaciarlas)
 * + `id`. Si `lineas` viene, el dominio SINCRONIZA el set completo (agrega/edita/quita) en
 * una transacción A2, conservando la auditoría de los renglones que no cambian. Si `lineas`
 * se OMITE, no se tocan los renglones. `activo`/cancelación NO van aquí: la cancelación es su
 * propia operación (`POST /pedidos/:id/cancelar`).
 */
export const esquemaPedidoEditar = z.object({
  id: z
    .number({ error: 'El id del pedido es obligatorio' })
    .int({ error: 'El id del pedido debe ser entero' })
    .positive({ error: 'El id del pedido debe ser positivo' }),
  idCliente: z
    .number({ error: 'El id del cliente debe ser entero' })
    .int()
    .positive()
    .optional()
    .describe('Cliente del pedido (si se omite, no se toca).'),
  ...camposFechasPedidoEditar,
  entregadoTienda: z.boolean().optional().describe('Marca de entregado a tienda.'),
  noProducir: z.boolean().optional().describe('Marcado para no producir.'),
  ocCliente: z
    .string()
    .trim()
    .max(100, { error: 'La OC del cliente no puede tener más de 100 caracteres' })
    .nullable()
    .optional()
    .describe(
      'OC del cliente (`null` la vacía; omitida = no tocar). Editar aquí NO re-escribe el snapshot de las órdenes ya nacidas (R3, B3).',
    ),
  lineas: z
    .array(esquemaPedidoLineaEntrada)
    .optional()
    .describe('Set COMPLETO de renglones (si se omite, no se tocan).'),
});

/** Datos validados de edición de pedido. */
export type DatosPedidoEditar = z.infer<typeof esquemaPedidoEditar>;

/** Cuerpo del PATCH de pedido (sin `id`: va en la URL). */
export const esquemaPedidoPatchCuerpo = esquemaPedidoEditar.omit({ id: true });

/** Datos validados del cuerpo del PATCH de pedido. */
export type DatosPedidoPatchCuerpo = z.infer<typeof esquemaPedidoPatchCuerpo>;

/**
 * Cuerpo de copiar un pedido (doc 02 §4.3): clona el pedido en uno nuevo con folio nuevo y
 * SOLO los renglones seleccionados (reemplaza el MsgBox por renglón del viejo con una
 * selección múltiple en un clic). Si `idLineas` se omite o viene vacío, se copian TODOS.
 */
export const esquemaPedidoCopiarCuerpo = z.object({
  idLineas: z
    .array(z.number().int().positive())
    .optional()
    .describe('Ids de los renglones a copiar (vacío/omitido = todos).'),
});

/** Datos validados del cuerpo de copiar pedido. */
export type DatosPedidoCopiar = z.infer<typeof esquemaPedidoCopiarCuerpo>;

// ── Salida de un renglón de pedido ────────────────────────────────────────────────

/**
 * Renglón de pedido tal como sale al cliente. `precio`/`importe` son NULLABLE: el dominio
 * los pone en `null` cuando la sesión NO tiene `pedidos.importes` (ocultamiento server-side).
 * `entregadoParcialV1`/`cantFaltanteV1` son snapshots migrados de solo lectura.
 */
export const esquemaPedidoLineaSalida = z
  .object({
    id: z.number().int().describe('Id del renglón.'),
    idModelo: z.number().int().describe('Id del modelo pedido.'),
    codigoModelo: z.string().describe('Código del modelo (para la UI).'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    urlFotoModelo: z
      .string()
      .nullable()
      .describe('URL prefirmada de la foto principal del modelo, o null.'),
    cantidadPedida: z.number().int().describe('Cantidad pedida.'),
    precio: z
      .number()
      .nullable()
      .describe('Precio por prenda, o null si la sesión no puede ver importes.'),
    importe: z
      .number()
      .nullable()
      .describe('Importe del renglón (cantidad × precio), o null si no puede ver importes.'),
    entregadoParcialV1: z
      .number()
      .int()
      .nullable()
      .describe(
        'Snapshot migrado de SOLO LECTURA: cantidad ya entregada en el viejo (no saldo vivo).',
      ),
    cantFaltanteV1: z
      .number()
      .int()
      .nullable()
      .describe('Snapshot migrado de SOLO LECTURA: cantidad faltante en el viejo (no saldo vivo).'),
    idDesarrollo: z
      .number()
      .int()
      .nullable()
      .describe('Desarrollo (F8) del que sale el renglón (R3, B4), o null (legado/F2).'),
    numeroProduccion: z
      .number()
      .int()
      .nullable()
      .describe(
        'Nº interno de producción del MODELO del renglón (R3, B4), o null si el modelo aún no sale a producción.',
      ),
  })
  .describe('Renglón de un pedido interno.');

/** Forma de un renglón de pedido en la API. */
export type PedidoLineaSalida = z.infer<typeof esquemaPedidoLineaSalida>;

// ── Salida de un pedido interno ───────────────────────────────────────────────────

/** Salida de un pedido interno (proyección a JSON). Incluye cliente, fechas, banderas y renglones. */
export const esquemaPedidoSalida = z
  .object({
    id: z.number().int().describe('Id interno del pedido.'),
    folio: z.number().int().describe('Folio consecutivo por empresa.'),
    idEmpresa: z.number().int().describe('Empresa dueña del pedido y del folio.'),
    idCliente: z.number().int().describe('Cliente del pedido.'),
    cliente: z.string().describe('Nombre del cliente (para la UI).'),
    fechaPedido: z.iso.date().nullable().describe('Fecha del pedido (YYYY-MM-DD), o null.'),
    fechaDe: z.iso.date().nullable().describe('Ventana de entrega — desde, o null.'),
    fechaHasta: z.iso.date().nullable().describe('Ventana de entrega — hasta, o null.'),
    fechaTela: z.iso.date().nullable().describe('Fecha de tela, o null.'),
    fechaElaboracion: z.iso.date().nullable().describe('Fecha de elaboración, o null.'),
    entregadoTienda: z.boolean().describe('Marca de entregado a tienda.'),
    noProducir: z.boolean().describe('Marcado para no producir.'),
    pedCancelado: z.boolean().describe('Cancelación suave: el pedido sigue consultable.'),
    ocCliente: z
      .string()
      .nullable()
      .describe('OC original del cliente (R3, B3 — captura viva del pedido), o null.'),
    idOrdCompraV1: z
      .number()
      .int()
      .nullable()
      .describe(
        'Snapshot migrado de SOLO LECTURA: orden de compra ligada en el viejo (sin FK hasta F4).',
      ),
    totalPiezas: z.number().int().describe('Suma de las cantidades pedidas de los renglones.'),
    totalImporte: z
      .number()
      .nullable()
      .describe('Suma de los importes (Σ cantidad × precio), o null si no puede ver importes.'),
    lineas: z.array(esquemaPedidoLineaSalida).describe('Renglones del pedido.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Pedido interno (encabezado + renglones).');

/** Forma de un pedido interno en la API. */
export type PedidoSalida = z.infer<typeof esquemaPedidoSalida>;

/** Parámetros del listado de pedidos EN LA URL (querystring). */
export const esquemaListarPedidos = z
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
      .describe('Texto a buscar (folio o nombre del cliente).'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    incluirCancelados: z
      .stringbool()
      .default(false)
      .describe('Incluye los pedidos cancelados (cancelación suave).'),
    ordenarPor: z
      .enum(['folio', 'fechaPedido', 'creadoEn'])
      .default('folio')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('desc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de pedidos.');

/** Parámetros de listado de pedidos ya coaccionados desde la URL. */
export type ListarPedidos = z.infer<typeof esquemaListarPedidos>;

/** Respuesta paginada del listado de pedidos (forma estándar `Pagina<T>`). */
export const esquemaPedidosPagina = z
  .object({
    datos: z.array(esquemaPedidoSalida).describe('Pedidos de la página.'),
    total: z.number().int().describe('Total de pedidos que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de pedidos.');

/** Forma de la respuesta paginada de pedidos. */
export type PedidosPagina = z.infer<typeof esquemaPedidosPagina>;

// ── Pedido real ───────────────────────────────────────────────────────────────────

/** Fechas del pedido real (todas opcionales). */
const camposFechasPedidoReal = {
  fechaPedPR: z.iso.date({ error: 'La fecha del pedido real no es válida' }).optional(),
  fechaInicio: z.iso.date({ error: 'La fecha de inicio no es válida' }).optional(),
  fechaFin: z.iso.date({ error: 'La fecha de fin no es válida' }).optional(),
} as const;

/** Variante de edición: cada fecha acepta `null` para vaciarla (M1). */
const camposFechasPedidoRealEditar = {
  fechaPedPR: camposFechasPedidoReal.fechaPedPR.nullable(),
  fechaInicio: camposFechasPedidoReal.fechaInicio.nullable(),
  fechaFin: camposFechasPedidoReal.fechaFin.nullable(),
} as const;

/**
 * Alta de un pedido real (doc 02 §4.4): el dominio REPLICA automáticamente un renglón por
 * cada renglón del pedido interno (no se mandan renglones en el alta). Aquí solo el
 * encabezado: número del cliente, CEDIS, apertura y fechas (todo opcional/texto libre en F2).
 */
export const esquemaPedidoRealCrear = z.object({
  numPedReal: z
    .string()
    .trim()
    .max(100, { error: 'El número de pedido real no puede tener más de 100 caracteres' })
    .optional()
    .describe('Número del pedido real del cliente.'),
  cedis: z
    .string()
    .trim()
    .max(150, { error: 'El CEDIS no puede tener más de 150 caracteres' })
    .optional()
    .describe('Centro de distribución destino.'),
  apertura: z
    .string()
    .trim()
    .max(150, { error: 'La apertura no puede tener más de 150 caracteres' })
    .optional()
    .describe('Apertura/temporada (texto libre).'),
  ...camposFechasPedidoReal,
});

/** Datos validados de alta de pedido real. */
export type DatosPedidoRealCrear = z.infer<typeof esquemaPedidoRealCrear>;

/**
 * Edición del ENCABEZADO de un pedido real (los renglones se capturan aparte con el
 * seguimiento). Campos del alta opcionales (texto/fechas nullable para vaciarlos) +
 * `fechaEntregadaReal`. NO incluye cancelación (diferida a una decisión de Daniel).
 */
export const esquemaPedidoRealEditar = z.object({
  numPedReal: esquemaPedidoRealCrear.shape.numPedReal.nullable(),
  cedis: esquemaPedidoRealCrear.shape.cedis.nullable(),
  apertura: esquemaPedidoRealCrear.shape.apertura.nullable(),
  ...camposFechasPedidoRealEditar,
  fechaEntregadaReal: z.iso
    .date({ error: 'La fecha entregada real no es válida' })
    .nullable()
    .optional()
    .describe('Fecha en que se entregó el pedido real, o null.'),
});

/** Datos validados de edición de pedido real. */
export type DatosPedidoRealEditar = z.infer<typeof esquemaPedidoRealEditar>;

/**
 * Renglón de seguimiento de un pedido real (captura manual en F2, doc 02 §2 `PedidosRealesDet`):
 * el `id` del renglón (creado por la réplica automática) + las cantidades. Solo se editan
 * cantidades (el modelo/precio vienen del renglón del pedido interno, no se tocan aquí).
 */
export const esquemaPedidoRealLineaSeguimiento = z.object({
  id: z
    .number({ error: 'El id del renglón es obligatorio' })
    .int()
    .positive()
    .describe('Id del renglón del pedido real.'),
  cantidadPR: z
    .number()
    .int({ error: 'La cantidad debe ser entera' })
    .min(0, { error: 'La cantidad no puede ser negativa' })
    .optional()
    .describe('Cantidad del pedido real.'),
  cantidadEnviada: z
    .number()
    .int({ error: 'La cantidad enviada debe ser entera' })
    .min(0, { error: 'La cantidad enviada no puede ser negativa' })
    .optional()
    .describe('Cantidad enviada.'),
  cantidadEntregadaReal: z
    .number()
    .int({ error: 'La cantidad entregada debe ser entera' })
    .min(0, { error: 'La cantidad entregada no puede ser negativa' })
    .optional()
    .describe('Cantidad realmente entregada/aceptada.'),
  empaques: z
    .number()
    .int({ error: 'Los empaques deben ser un entero' })
    .min(0, { error: 'Los empaques no pueden ser negativos' })
    .optional()
    .describe('Empaques.'),
});

/** Datos validados de un renglón de seguimiento de pedido real. */
export type DatosPedidoRealLineaSeguimiento = z.infer<typeof esquemaPedidoRealLineaSeguimiento>;

/** Cuerpo del seguimiento de un pedido real: el set de renglones a actualizar (los que cambian). */
export const esquemaPedidoRealSeguimientoCuerpo = z.object({
  lineas: z
    .array(esquemaPedidoRealLineaSeguimiento)
    .describe('Renglones de seguimiento a actualizar (por id).'),
});

/** Datos validados del cuerpo de seguimiento. */
export type DatosPedidoRealSeguimiento = z.infer<typeof esquemaPedidoRealSeguimientoCuerpo>;

/** Salida de un renglón de pedido real. `precio`/`importe` se ocultan sin `pedidos.importes`. */
export const esquemaPedidoRealLineaSalida = z
  .object({
    id: z.number().int().describe('Id del renglón del pedido real.'),
    idPedidoLinea: z.number().int().describe('Renglón del pedido interno del que cuelga.'),
    idModelo: z.number().int().describe('Id del modelo (del renglón del pedido interno).'),
    codigoModelo: z.string().describe('Código del modelo (para la UI).'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    cantidadPedida: z.number().int().describe('Cantidad pedida del renglón del pedido interno.'),
    precio: z.number().nullable().describe('Precio del renglón interno, o null si no ve importes.'),
    cantidadPR: z.number().int().describe('Cantidad del pedido real.'),
    cantidadEnviada: z.number().int().describe('Cantidad enviada.'),
    cantidadEntregadaReal: z.number().int().describe('Cantidad entregada/aceptada.'),
    empaques: z.number().int().describe('Empaques.'),
  })
  .describe('Renglón de un pedido real.');

/** Forma de un renglón de pedido real en la API. */
export type PedidoRealLineaSalida = z.infer<typeof esquemaPedidoRealLineaSalida>;

/** Salida de un pedido real (encabezado + renglones de seguimiento). */
export const esquemaPedidoRealSalida = z
  .object({
    id: z.number().int().describe('Id del pedido real.'),
    idPedido: z.number().int().describe('Pedido interno al que pertenece.'),
    numPedReal: z.string().nullable().describe('Número del pedido real del cliente, o null.'),
    cedis: z.string().nullable().describe('CEDIS destino, o null.'),
    apertura: z.string().nullable().describe('Apertura/temporada, o null.'),
    fechaPedPR: z.iso.date().nullable().describe('Fecha del pedido real, o null.'),
    fechaInicio: z.iso.date().nullable().describe('Inicio de la ventana de entrega, o null.'),
    fechaFin: z.iso.date().nullable().describe('Fin de la ventana de entrega, o null.'),
    fechaEntregadaReal: z.iso.date().nullable().describe('Fecha en que se entregó, o null.'),
    lineas: z.array(esquemaPedidoRealLineaSalida).describe('Renglones del pedido real.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Pedido real (liberación del cliente contra un pedido interno).');

/** Forma de un pedido real en la API. */
export type PedidoRealSalida = z.infer<typeof esquemaPedidoRealSalida>;

/** Lista de pedidos reales de un pedido (respuesta de `GET /pedidos/:id/reales`). */
export const esquemaPedidoRealesLista = z
  .object({
    datos: z.array(esquemaPedidoRealSalida).describe('Pedidos reales del pedido interno.'),
  })
  .describe('Pedidos reales de un pedido interno.');

/** Forma de la lista de pedidos reales. */
export type PedidoRealesLista = z.infer<typeof esquemaPedidoRealesLista>;
