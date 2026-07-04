import { z } from 'zod';

/**
 * Esquemas Zod del INVENTARIO de PRODUCTO TERMINADO operable (F3-E3; doc 04-Inventarios). UNA sola
 * definición de reglas para UI y servidor (alimenta el OpenAPI). El detalle de un movimiento de PT
 * es SIEMPRE color×talla (D4) de UN modelo; la existencia es SIEMPRE Σ de movimientos (D3) — aquí no
 * hay esquema que edite/borre un movimiento (la corrección es un movimiento INVERSO auditado).
 *
 * Reglas de negocio (la AUTORIDAD es el dominio; estos esquemas solo cuidan la forma):
 *  • Movimiento manual: tipo de dirección entrada/salida (los `traspaso` NO entran aquí — van por el
 *    traspaso); las salidas NO pueden dejar existencia negativa (lo valida el dominio bajo lock).
 *  • Traspaso: dos almacenes DISTINTOS; el origen debe tener existencia suficiente (dominio).
 *  • Cancelación: motivo obligatorio (A7); genera el inverso (entrada↔salida) — sin no-negativo.
 */

// ── Renglón color×talla (compartido por movimiento y traspaso) ───────────────────────────────────

/** Una talla con su cantidad dentro de un color (D4). Cantidad entera ≥ 1 (los 0 se descartan). */
const esquemaMovPtTalla = z.object({
  idTalla: z
    .number({ error: 'El id de la talla es obligatorio' })
    .int({ error: 'El id de la talla debe ser entero' })
    .positive({ error: 'El id de la talla debe ser positivo' }),
  cantidad: z
    .number({ error: 'La cantidad es obligatoria' })
    .int({ error: 'La cantidad debe ser entera' })
    .min(0, { error: 'La cantidad no puede ser negativa' }),
});

/** Un renglón de la matriz de un movimiento: un color con sus cantidades por talla (D4). */
const esquemaMovPtLinea = z.object({
  idColor: z
    .number({ error: 'El id del color es obligatorio' })
    .int({ error: 'El id del color debe ser entero' })
    .positive({ error: 'El id del color debe ser positivo' }),
  tallas: z
    .array(esquemaMovPtTalla)
    .min(1, { error: 'Cada color necesita al menos una talla' })
    .describe('Cantidades por talla de este color.'),
});

/** La matriz color×talla de un movimiento (al menos un color). */
const esquemaMovPtMatriz = z
  .array(esquemaMovPtLinea)
  .min(1, { error: 'Captura al menos un color con sus tallas' })
  .describe('Matriz color×talla del movimiento (D4).');

/** Un renglón de la matriz tal como lo recibe el dominio. */
export type DatosMovPtLineaEntrada = z.infer<typeof esquemaMovPtLinea>;

// ── Movimiento manual (entrada/salida/ajuste) ────────────────────────────────────────────────────

/**
 * Alta de un MOVIMIENTO MANUAL de inventario PT (entrada, salida o ajuste — doc 04-Inventarios). Un
 * movimiento manual es de UN modelo en UN almacén. `idTipoMov` es un tipo del catálogo
 * `TipoMovimientoInventario` de dirección entrada O salida (los `traspaso` se rechazan — van por el
 * traspaso). Si la dirección es salida, el dominio valida que no deje existencia negativa.
 */
export const esquemaMovimientoPtCrear = z
  .object({
    idTipoMov: z
      .number({ error: 'El tipo de movimiento es obligatorio' })
      .int({ error: 'El id del tipo de movimiento debe ser entero' })
      .positive({ error: 'El id del tipo de movimiento debe ser positivo' })
      .describe('Tipo de movimiento del catálogo (dirección entrada o salida; nunca traspaso).'),
    idAlmacen: z
      .number({ error: 'El almacén es obligatorio' })
      .int({ error: 'El id del almacén debe ser entero' })
      .positive({ error: 'El id del almacén debe ser positivo' })
      .describe('Almacén afectado (existencia por …×almacén, D4).'),
    idModelo: z
      .number({ error: 'El modelo es obligatorio' })
      .int({ error: 'El id del modelo debe ser entero' })
      .positive({ error: 'El id del modelo debe ser positivo' })
      .describe('Modelo del movimiento (un movimiento manual es de UN modelo).'),
    fecha: z.iso
      .date({ error: 'La fecha del movimiento es obligatoria (YYYY-MM-DD)' })
      .describe('Fecha del movimiento (YYYY-MM-DD).'),
    observaciones: z.string().trim().max(1000).optional(),
    lineas: esquemaMovPtMatriz,
  })
  .describe('Datos de un movimiento manual de inventario PT (color×talla, D4).');

/** Datos validados de alta de movimiento manual. */
export type DatosMovimientoPtCrear = z.infer<typeof esquemaMovimientoPtCrear>;

// ── Traspaso entre almacenes (dos patas en UNA operación) ────────────────────────────────────────

/**
 * Alta de un TRASPASO de PT entre almacenes (doc 04-Inventarios — Transferencia entre almacenes). Se
 * materializa como DOS movimientos (salida del origen + entrada al destino) en UNA transacción; la
 * existencia TOTAL no cambia. Origen y destino DISTINTOS; el origen debe tener existencia suficiente
 * (lo valida el dominio bajo lock — el traspaso nunca deja el origen negativo).
 */
export const esquemaTraspasoPtCrear = z
  .object({
    idAlmacenOrigen: z
      .number({ error: 'El almacén de origen es obligatorio' })
      .int({ error: 'El id del almacén de origen debe ser entero' })
      .positive({ error: 'El id del almacén de origen debe ser positivo' })
      .describe('Almacén desde el que sale la mercancía.'),
    idAlmacenDestino: z
      .number({ error: 'El almacén de destino es obligatorio' })
      .int({ error: 'El id del almacén de destino debe ser entero' })
      .positive({ error: 'El id del almacén de destino debe ser positivo' })
      .describe('Almacén al que entra la mercancía (distinto del origen).'),
    idModelo: z
      .number({ error: 'El modelo es obligatorio' })
      .int({ error: 'El id del modelo debe ser entero' })
      .positive({ error: 'El id del modelo debe ser positivo' })
      .describe('Modelo a traspasar (un traspaso es de UN modelo).'),
    fecha: z.iso
      .date({ error: 'La fecha del traspaso es obligatoria (YYYY-MM-DD)' })
      .describe('Fecha del traspaso (YYYY-MM-DD).'),
    observaciones: z.string().trim().max(1000).optional(),
    lineas: esquemaMovPtMatriz,
  })
  .describe('Datos de un traspaso de PT entre almacenes (color×talla, D4).');

/** Datos validados de alta de traspaso. */
export type DatosTraspasoPtCrear = z.infer<typeof esquemaTraspasoPtCrear>;

// ── Cancelación de un movimiento (inverso auditado) ──────────────────────────────────────────────

/** Cuerpo de la cancelación de un movimiento PT (motivo obligatorio, A7). */
export const esquemaMovimientoPtCancelarCuerpo = z
  .object({
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(3, { error: 'Explica el motivo (mínimo 3 caracteres)' })
      .max(500, { error: 'El motivo no puede tener más de 500 caracteres' }),
  })
  .describe('Motivo de la cancelación del movimiento.');

/** Datos validados de la cancelación. */
export type DatosMovimientoPtCancelar = z.infer<typeof esquemaMovimientoPtCancelarCuerpo>;

// ── Salida de un movimiento (encabezado + matriz) ────────────────────────────────────────────────

/** Una talla con su cantidad en la salida de un movimiento. */
const esquemaMovPtTallaSalida = z.object({
  idTalla: z.number().int().describe('Id de la talla.'),
  etiquetaTalla: z.string().describe('Etiqueta visible de la talla.'),
  cantidad: z.number().int().describe('Cantidad de la talla.'),
});

/** Un renglón color×talla en la salida de un movimiento, con total derivado. */
const esquemaMovPtLineaSalida = z.object({
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  tallas: z.array(esquemaMovPtTallaSalida).describe('Cantidades por talla.'),
  totalPiezas: z.number().int().describe('Total del renglón (derivado por suma).'),
});

/** Salida de un movimiento de PT: encabezado + matriz + total. Parte del contrato OpenAPI. */
export const esquemaMovimientoPtSalida = z
  .object({
    id: z.number().int().describe('Id del movimiento.'),
    folio: z.number().int().describe('Folio consecutivo por empresa (A3).'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    idTipoMov: z.number().int().describe('Tipo de movimiento.'),
    tipoMov: z.string().describe('Nombre del tipo de movimiento.'),
    direccion: z.enum(['entrada', 'salida', 'traspaso']).describe('Dirección del tipo.'),
    idAlmacen: z.number().int().describe('Almacén afectado.'),
    almacen: z.string().describe('Nombre del almacén.'),
    idModelo: z.number().int().describe('Modelo del movimiento.'),
    modelo: z.string().describe('Código del modelo.'),
    fecha: z.string().describe('Fecha del movimiento (YYYY-MM-DD).'),
    observaciones: z.string().nullable().describe('Observaciones o null.'),
    origenTipo: z.string().nullable().describe('Discriminador del hecho de origen o null.'),
    cancelado: z.boolean().describe('Si el movimiento ya fue anulado por un inverso.'),
    idMovimientoInverso: z
      .number()
      .int()
      .nullable()
      .describe('Si este movimiento ES un inverso, el id del original que anula; si no, null.'),
    lineas: z.array(esquemaMovPtLineaSalida).describe('Matriz color×talla del movimiento.'),
    totalPiezas: z.number().int().describe('Total de piezas del movimiento (derivado).'),
    creadoEn: z.iso.datetime().describe('Fecha de captura (ISO).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo capturó.'),
  })
  .describe('Movimiento de inventario PT con su matriz color×talla.');

/** Forma de un movimiento PT tal como lo devuelve la API. */
export type MovimientoPtSalida = z.infer<typeof esquemaMovimientoPtSalida>;

/** Resultado de un traspaso: las dos patas creadas (salida del origen + entrada al destino). */
export const esquemaTraspasoPtSalida = z
  .object({
    salida: esquemaMovimientoPtSalida.describe('Pata de SALIDA del almacén origen.'),
    entrada: esquemaMovimientoPtSalida.describe('Pata de ENTRADA al almacén destino.'),
  })
  .describe('Las dos patas de un traspaso de PT.');

/** Forma del resultado de un traspaso. */
export type TraspasoPtSalida = z.infer<typeof esquemaTraspasoPtSalida>;

// ── Consulta de existencias ──────────────────────────────────────────────────────────────────────

/** Filtros de la consulta de existencias (querystring). */
export const esquemaExistenciasPtQuery = z
  .object({
    idModelo: z.coerce.number().int().positive().optional().describe('Filtra por un modelo.'),
    idColor: z.coerce.number().int().positive().optional().describe('Filtra por un color.'),
    idTalla: z.coerce.number().int().positive().optional().describe('Filtra por una talla.'),
    idAlmacen: z.coerce.number().int().positive().optional().describe('Filtra por un almacén.'),
    idOrden: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por una orden de producción (F6-E2: existencia por orden).'),
    incluirCeros: z
      .stringbool()
      .default(false)
      .describe('Incluye filas con existencia 0 ("true"/"false"). Por defecto se omiten.'),
  })
  .describe('Filtros de la consulta de existencias de PT.');

/** Parámetros de la consulta de existencias ya coaccionados. */
export type ExistenciasPtQuery = z.infer<typeof esquemaExistenciasPtQuery>;

/** Una fila de existencia: un artículo (modelo×color×talla) en un almacén con su cantidad. */
const esquemaExistenciaPtFila = z.object({
  idModelo: z.number().int().describe('Id del modelo.'),
  modelo: z.string().describe('Código del modelo.'),
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  idTalla: z.number().int().describe('Id de la talla.'),
  etiquetaTalla: z.string().describe('Etiqueta visible de la talla.'),
  ordenTalla: z.number().int().describe('Orden del catálogo de la talla (para ordenar columnas).'),
  idAlmacen: z.number().int().describe('Id del almacén.'),
  almacen: z.string().describe('Nombre del almacén.'),
  idOrden: z
    .number()
    .int()
    .nullable()
    .describe(
      'Orden de producción de las prendas, o null (bucket sin orden: histórico/manual/ajuste).',
    ),
  folioOrden: z
    .number()
    .int()
    .nullable()
    .describe('Folio de la orden, o null si es del bucket sin orden.'),
  existencia: z.number().int().describe('Existencia actual (Σ de movimientos, D3).'),
});

/** Una fila de existencia tal como la devuelve la API. */
export type ExistenciaPtFila = z.infer<typeof esquemaExistenciaPtFila>;

/** Respuesta de la consulta de existencias (filas + total general derivado). */
export const esquemaExistenciasPtLista = z
  .object({
    filas: z.array(esquemaExistenciaPtFila).describe('Existencias por modelo×color×talla×almacén.'),
    totalExistencia: z.number().int().describe('Suma de la existencia de todas las filas.'),
  })
  .describe('Existencias de producto terminado (consulta de solo lectura, D3).');

/** Forma de la respuesta de existencias. */
export type ExistenciasPtLista = z.infer<typeof esquemaExistenciasPtLista>;

// ── Kardex por modelo (movimientos con saldo corrido) ────────────────────────────────────────────

/** Filtros del kardex por modelo (querystring). `idModelo` es obligatorio. */
export const esquemaKardexPtQuery = z
  .object({
    idModelo: z.coerce
      .number({ error: 'El modelo es obligatorio' })
      .int({ error: 'El id del modelo debe ser entero' })
      .positive({ error: 'El id del modelo debe ser positivo' })
      .describe('Modelo del kardex (obligatorio).'),
    idColor: z.coerce.number().int().positive().optional().describe('Filtra por un color.'),
    idTalla: z.coerce.number().int().positive().optional().describe('Filtra por una talla.'),
    idAlmacen: z.coerce.number().int().positive().optional().describe('Filtra por un almacén.'),
    idOrden: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por una orden de producción (F6-E2).'),
  })
  .describe('Filtros del kardex de un modelo.');

/** Parámetros del kardex por modelo ya coaccionados. */
export type KardexPtQuery = z.infer<typeof esquemaKardexPtQuery>;

/** Un renglón del kardex: un movimiento (su efecto + el saldo corrido tras él). */
const esquemaKardexPtRenglon = z.object({
  idMovimiento: z.number().int().describe('Id del movimiento.'),
  folio: z.number().int().describe('Folio del movimiento.'),
  fecha: z.string().describe('Fecha del movimiento (YYYY-MM-DD).'),
  idTipoMov: z.number().int().describe('Tipo de movimiento.'),
  tipoMov: z.string().describe('Nombre del tipo de movimiento.'),
  direccion: z.enum(['entrada', 'salida', 'traspaso']).describe('Dirección del tipo.'),
  idAlmacen: z.number().int().describe('Almacén del movimiento.'),
  almacen: z.string().describe('Nombre del almacén.'),
  idColor: z.number().int().describe('Color del renglón.'),
  color: z.string().describe('Nombre del color.'),
  idTalla: z.number().int().describe('Talla del renglón.'),
  etiquetaTalla: z.string().describe('Etiqueta de la talla.'),
  idOrden: z
    .number()
    .int()
    .nullable()
    .describe('Orden de producción del renglón, o null (bucket sin orden).'),
  folioOrden: z.number().int().nullable().describe('Folio de la orden, o null.'),
  entrada: z.number().int().describe('Piezas que entran en este renglón (0 si es salida).'),
  salida: z.number().int().describe('Piezas que salen en este renglón (0 si es entrada).'),
  saldo: z.number().int().describe('Saldo corrido del artículo tras este movimiento.'),
  cancelado: z.boolean().describe('Si el movimiento fue anulado por un inverso.'),
  observaciones: z.string().nullable().describe('Observaciones del movimiento o null.'),
});

/** Un renglón del kardex tal como lo devuelve la API. */
export type KardexPtRenglon = z.infer<typeof esquemaKardexPtRenglon>;

/** Respuesta del kardex por modelo (movimientos cronológicos con saldo corrido). */
export const esquemaKardexPtLista = z
  .object({
    idModelo: z.number().int().describe('Modelo del kardex.'),
    modelo: z.string().describe('Código del modelo.'),
    renglones: z.array(esquemaKardexPtRenglon).describe('Movimientos en orden cronológico.'),
  })
  .describe('Kardex de un modelo (movimientos con saldo corrido).');

/** Forma de la respuesta del kardex por modelo. */
export type KardexPtLista = z.infer<typeof esquemaKardexPtLista>;

// ── Parámetro de ruta: folio ─────────────────────────────────────────────────────────────────────

/** Parámetro de ruta `:folio` (folio del movimiento dentro de la empresa activa). */
export const esquemaParamFolio = z.object({
  folio: z.coerce
    .number({ error: 'El folio debe ser un número' })
    .int({ error: 'El folio debe ser entero' })
    .positive({ error: 'El folio debe ser positivo' })
    .describe('Folio del movimiento (consecutivo por empresa).'),
});
