import { z } from 'zod';

/**
 * Esquemas Zod de la ENTREGA A CLIENTE (F3-E5; doc 03-Produccion "Entrega" + 02-Pedidos: cierre del
 * ciclo de la orden). UNA sola definición de reglas para UI y servidor (alimenta el OpenAPI). La
 * entrega es la SALIDA de producto terminado al cliente: descuenta el inventario PT (vía kardex,
 * D3) y deja el seguimiento del pedido (entregado/faltante) DERIVADO de la suma de entregas vivas
 * (NUNCA un campo editable). El detalle es SIEMPRE color×talla (D4).
 *
 * Reglas de negocio (la AUTORIDAD es el dominio; estos esquemas solo cuidan la forma):
 *  • NO-NEGATIVO ESTRICTO (decisión b): no se entrega más de la existencia disponible en el almacén
 *    de origen. El dominio lo valida por suma directa de `MovimientoDetPt` bajo bloqueo — NUNCA la
 *    vista `existencia_pt`.
 *  • La entrega sale de UN almacén de origen (PT). El modelo es el de la orden (no se captura).
 *  • Cancelación = movimiento INVERSO auditado (nunca edita/borra); el pendiente del pedido regresa.
 *  • costoUnit queda NULL en toda F3 (D1/D2).
 *
 * NOTA DE ESQUEMA (SIN migración, F3-E5): `EtapaMovimiento` NO tiene una columna `idAlmacenOrigen`
 * ni `referenciaPedido`. La entrega REUSA `idAlmacenPrimeras` como su almacén de ORIGEN (es el campo
 * "almacén PT" del encabezado, libre en una entrega: no hay recibo de costura) y cualquier
 * referencia/nota del pedido va en `observaciones`. Así no se agrega ninguna columna (decisión: sin
 * migración). El reviewer debe avalar este reuso (ver TSDoc del dominio).
 */

// ── Renglón color×talla ──────────────────────────────────────────────────────────────────────────

/** Una talla con su cantidad dentro de un color (D4). Cantidad entera ≥ 0. */
const esquemaEntregaTalla = z.object({
  idTalla: z
    .number({ error: 'El id de la talla es obligatorio' })
    .int({ error: 'El id de la talla debe ser entero' })
    .positive({ error: 'El id de la talla debe ser positivo' }),
  cantidad: z
    .number({ error: 'La cantidad es obligatoria' })
    .int({ error: 'La cantidad debe ser entera' })
    .min(0, { error: 'La cantidad no puede ser negativa' }),
});

/** Un renglón de la matriz de la entrega: un color con sus cantidades por talla (D4). */
const esquemaEntregaLinea = z.object({
  idColor: z
    .number({ error: 'El id del color es obligatorio' })
    .int({ error: 'El id del color debe ser entero' })
    .positive({ error: 'El id del color debe ser positivo' }),
  tallas: z
    .array(esquemaEntregaTalla)
    .min(1, { error: 'Cada color necesita al menos una talla' })
    .describe('Cantidades por talla de este color.'),
});

/** La matriz color×talla de una entrega (al menos un color). */
const esquemaEntregaMatriz = z
  .array(esquemaEntregaLinea)
  .min(1, { error: 'Captura al menos un color con sus tallas' })
  .describe('Matriz color×talla de la entrega (D4).');

/** Un renglón de la matriz de la entrega tal como lo recibe el dominio. */
export type DatosEntregaLineaEntrada = z.infer<typeof esquemaEntregaLinea>;

// ── Alta de una entrega a cliente ─────────────────────────────────────────────────────────────────

/**
 * Alta de una ENTREGA a cliente (doc 03-Produccion "Entrega"). Sale del almacén `idAlmacen` (PT) por
 * el modelo de la orden, por color×talla. El cliente y el renglón de pedido SE DERIVAN de la orden
 * (no se capturan). La referencia/número de pedido del cliente, si se anota, va en `observaciones`
 * (no hay columna dedicada — sin migración).
 */
export const esquemaEntregaClienteCrear = z
  .object({
    idOrden: z
      .number({ error: 'La orden es obligatoria' })
      .int({ error: 'El id de la orden debe ser entero' })
      .positive({ error: 'El id de la orden debe ser positivo' }),
    idAlmacen: z
      .number({ error: 'El almacén de origen es obligatorio' })
      .int({ error: 'El id del almacén debe ser entero' })
      .positive({ error: 'El id del almacén debe ser positivo' })
      .describe('Almacén PT de donde sale la entrega.'),
    fecha: z.iso
      .date({ error: 'La fecha de la entrega es obligatoria (YYYY-MM-DD)' })
      .describe('Fecha de la entrega (YYYY-MM-DD).'),
    observaciones: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .describe('Observaciones / referencia de pedido del cliente (texto libre), opcional.'),
    lineas: esquemaEntregaMatriz,
  })
  .describe('Datos de una entrega a cliente (color×talla, D4; salida de PT no-negativa).');

/** Datos validados de alta de entrega. */
export type DatosEntregaClienteCrear = z.infer<typeof esquemaEntregaClienteCrear>;

// ── Cancelación de una entrega ────────────────────────────────────────────────────────────────────

/** Cuerpo de la cancelación de una entrega (motivo obligatorio, A7). */
export const esquemaEntregaClienteCancelarCuerpo = z
  .object({
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(3, { error: 'Explica el motivo (mínimo 3 caracteres)' })
      .max(500, { error: 'El motivo no puede tener más de 500 caracteres' }),
  })
  .describe('Motivo de la cancelación de la entrega.');

/** Datos validados de la cancelación. */
export type DatosEntregaClienteCancelar = z.infer<typeof esquemaEntregaClienteCancelarCuerpo>;

// ── Salida de una entrega (encabezado + matriz) ──────────────────────────────────────────────────

/** Una talla con su cantidad en la salida de una entrega. */
const esquemaEntregaTallaSalida = z.object({
  idTalla: z.number().int().describe('Id de la talla.'),
  etiquetaTalla: z.string().describe('Etiqueta visible de la talla.'),
  cantidad: z.number().int().describe('Cantidad entregada de la talla.'),
});

/** Un renglón color×talla en la salida de una entrega, con total derivado. */
const esquemaEntregaLineaSalida = z.object({
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  tallas: z.array(esquemaEntregaTallaSalida).describe('Cantidades por talla.'),
  totalPiezas: z.number().int().describe('Total del renglón (derivado por suma).'),
});

/** Salida de una entrega a cliente: encabezado + matriz + total. Parte del contrato OpenAPI. */
export const esquemaEntregaClienteSalida = z
  .object({
    id: z.number().int().describe('Id de la entrega (EtapaMovimiento).'),
    folio: z.number().int().describe('Folio consecutivo por empresa (A3).'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    idOrden: z.number().int().describe('Orden a la que pertenece.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    idModelo: z.number().int().describe('Modelo entregado (el de la orden).'),
    modelo: z.string().describe('Código del modelo.'),
    idCliente: z.number().int().nullable().describe('Cliente de la orden (a quien se entrega).'),
    cliente: z.string().nullable().describe('Nombre del cliente o null.'),
    idAlmacen: z.number().int().nullable().describe('Almacén de origen de la salida o null.'),
    almacen: z.string().nullable().describe('Nombre del almacén de origen o null.'),
    fecha: z.string().describe('Fecha de la entrega (YYYY-MM-DD).'),
    observaciones: z.string().nullable().describe('Observaciones / referencia de pedido o null.'),
    cancelado: z.boolean().describe('Si la entrega está cancelada (suave).'),
    canceladoEn: z.iso.datetime().nullable().describe('Cuándo se canceló (ISO) o null.'),
    canceladoPorId: z.string().nullable().describe('Id del usuario que canceló o null.'),
    motivoCancelacion: z.string().nullable().describe('Motivo de cancelación o null.'),
    idMovimientoSalida: z
      .number()
      .int()
      .nullable()
      .describe('Movimiento de kardex (salida de PT) generado por la entrega, o null.'),
    lineas: z.array(esquemaEntregaLineaSalida).describe('Matriz color×talla de la entrega.'),
    totalPiezas: z.number().int().describe('Total entregado (derivado).'),
    creadoEn: z.iso.datetime().describe('Fecha de captura (ISO).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la capturó.'),
  })
  .describe('Entrega a cliente con su matriz color×talla.');

/** Forma de una entrega tal como la devuelve la API. */
export type EntregaClienteSalida = z.infer<typeof esquemaEntregaClienteSalida>;

// ── Historial de entregas de una orden ────────────────────────────────────────────────────────────

/**
 * Historial de entregas de una orden (F3-E5): VIVAS y CANCELADAS (las canceladas se conservan como
 * historial, marcadas). Cada entrega lleva su matriz color×talla y su estado de cancelación.
 */
export const esquemaEntregasOrdenLista = z
  .object({
    idOrden: z.number().int().describe('Orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    entregas: z
      .array(esquemaEntregaClienteSalida)
      .describe('Entregas de la orden (vivas y canceladas).'),
  })
  .describe('Historial de entregas a cliente de una orden.');

/** Forma del historial de entregas tal como lo devuelve la API. */
export type EntregasOrdenLista = z.infer<typeof esquemaEntregasOrdenLista>;

// ── Seguimiento del pedido (derivado: pedido − entregado) + disponible por entregar ───────────────

/** Pendiente de UNA celda color×talla, en el seguimiento del pedido. */
const esquemaSeguimientoCelda = z.object({
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  idTalla: z.number().int().describe('Id de la talla.'),
  etiquetaTalla: z.string().describe('Etiqueta visible de la talla.'),
  pedido: z.number().int().describe('Cantidad pedida (de la orden) para esa celda.'),
  entregado: z.number().int().describe('Σ entregas vivas de la orden para esa celda.'),
  faltante: z.number().int().describe('pedido − entregado (negativo si se entregó de más).'),
  disponible: z
    .number()
    .int()
    .describe('Existencia disponible en el almacén filtrado (si se pidió).'),
});

/**
 * Seguimiento DERIVADO de una orden (F3-E5; cierre del ciclo, espíritu D3): por color×talla, lo
 * pedido (de la orden), lo ENTREGADO (Σ entregas vivas ligadas a la orden) y el FALTANTE (pedido −
 * entregado). Opcionalmente, si la pantalla pasa un almacén, el `disponible` (existencia ahí) para
 * acotar la matriz de captura. NO escribe a ninguna columna: todo es cálculo.
 */
export const esquemaSeguimientoEntregaOrden = z
  .object({
    idOrden: z.number().int().describe('Orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    idCliente: z.number().int().nullable().describe('Cliente de la orden o null.'),
    cliente: z.string().nullable().describe('Nombre del cliente o null.'),
    idModelo: z.number().int().describe('Modelo de la orden.'),
    modelo: z.string().describe('Código del modelo.'),
    celdas: z
      .array(esquemaSeguimientoCelda)
      .describe('Seguimiento por color×talla (pedido/entregado/faltante/disponible).'),
    totalPedido: z.number().int().describe('Total pedido de la orden (derivado).'),
    totalEntregado: z.number().int().describe('Total entregado (derivado de entregas vivas).'),
    totalFaltante: z.number().int().describe('Total faltante (pedido − entregado).'),
  })
  .describe('Seguimiento derivado de la entrega de una orden (pedido − entregado).');

/** Forma del seguimiento de entrega tal como lo devuelve la API. */
export type SeguimientoEntregaOrden = z.infer<typeof esquemaSeguimientoEntregaOrden>;

/** Filtros del seguimiento de entrega (querystring): un almacén opcional para el `disponible`. */
export const esquemaSeguimientoEntregaQuery = z
  .object({
    idAlmacen: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Almacén para calcular el disponible por celda (opcional).'),
  })
  .describe('Filtros del seguimiento de entrega (almacén para el disponible).');

/** Parámetros del seguimiento de entrega ya coaccionados. */
export type SeguimientoEntregaQuery = z.infer<typeof esquemaSeguimientoEntregaQuery>;
