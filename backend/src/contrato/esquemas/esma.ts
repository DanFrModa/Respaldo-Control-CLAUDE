import { z } from 'zod';

/**
 * Esquemas Zod de los CARGOS EsMa (cuenta corriente de maquileros — doc 07-EsMa). En F3-E4 solo se
 * construye la COLA DE VALIDACIÓN: un recibo de maquila genera un cargo en estado `propuesto`
 * (cantidad × precio del envío; el precio puede nacer NULL); el admin lo `validado` ajustando la
 * cantidad y el precio reales (punto de control humano CONSERVADO de v1, doc 07-EsMa §2). El estado
 * de cuenta completo (abonos/saldos) es de F6.
 *
 * UNA sola definición de reglas para UI y servidor (alimenta el OpenAPI).
 */

// ── Validación / ajuste de un cargo ──────────────────────────────────────────────────────────────

/**
 * Cuerpo de la VALIDACIÓN de un cargo propuesto: el admin fija la cantidad y el precio REALES (puede
 * confirmar los propuestos o ajustarlos). Ambos obligatorios al validar (el cargo no se valida sin
 * precio — por eso el precio del envío pudo nacer NULL). Observaciones opcionales.
 */
export const esquemaCargoEsMaValidarCuerpo = z
  .object({
    cantidadReal: z
      .number({ error: 'La cantidad es obligatoria' })
      .min(0, { error: 'La cantidad no puede ser negativa' })
      .describe('Cantidad real de piezas a pagar (la confirmada/ajustada por el admin).'),
    precioReal: z
      .number({ error: 'El precio es obligatorio' })
      .min(0, { error: 'El precio no puede ser negativo' })
      .describe('Precio unitario real de maquila (el confirmado/ajustado por el admin).'),
    observaciones: z.string().trim().max(1000).optional(),
  })
  .describe('Datos de validación de un cargo EsMa (cantidad y precio reales).');

/** Datos validados de la validación de un cargo. */
export type DatosCargoEsMaValidar = z.infer<typeof esquemaCargoEsMaValidarCuerpo>;

// ── Filtros de la cola de cargos ─────────────────────────────────────────────────────────────────

/** Filtros de la cola de cargos EsMa (querystring). Por defecto, los `propuesto`. */
export const esquemaCargosEsMaQuery = z
  .object({
    estado: z
      .enum(['propuesto', 'validado', 'cancelado'])
      .default('propuesto')
      .describe('Estado del cargo a listar (default "propuesto").'),
    idMaquilero: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por un maquilero concreto (Proveedor).'),
  })
  .describe('Filtros de la cola de cargos EsMa.');

/** Parámetros de la cola de cargos ya coaccionados. */
export type CargosEsMaQuery = z.infer<typeof esquemaCargosEsMaQuery>;

// ── Salida de un cargo ───────────────────────────────────────────────────────────────────────────

/** Un cargo EsMa tal como lo devuelve la API. */
export const esquemaCargoEsMaSalida = z
  .object({
    id: z.number().int().describe('Id del cargo.'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    idEtapaRecibo: z.number().int().nullable().describe('Recibo que originó el cargo o null.'),
    folioRecibo: z.number().int().nullable().describe('Folio del recibo o null.'),
    idMaquilero: z.number().int().describe('Maquilero al que se carga (Proveedor).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    idOrden: z.number().int().describe('Orden a la que pertenece el cargo.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    idTipoProceso: z.number().int().describe('Proceso de maquila del cargo.'),
    tipoProceso: z.string().describe('Nombre del proceso.'),
    cantidadPropuesta: z
      .number()
      .int()
      .describe('Cantidad recibida que propuso el recibo (derivada del recibo).'),
    precioPropuesto: z
      .number()
      .nullable()
      .describe('Precio del envío propuesto (puede ser null si el envío no lo traía).'),
    importePropuesto: z
      .number()
      .nullable()
      .describe('cantidadPropuesta × precioPropuesto, o null si no hay precio.'),
    cantidadReal: z.number().nullable().describe('Cantidad validada por el admin o null.'),
    precioReal: z.number().nullable().describe('Precio validado por el admin o null.'),
    importeReal: z.number().nullable().describe('cantidadReal × precioReal o null.'),
    estado: z.enum(['propuesto', 'validado', 'cancelado']).describe('Estado del cargo.'),
    observaciones: z.string().nullable().describe('Observaciones o null.'),
    validadoEn: z.iso.datetime().nullable().describe('Cuándo se validó (ISO) o null.'),
    validadoPorId: z.string().nullable().describe('Id del usuario que validó o null.'),
    creadoEn: z.iso.datetime().describe('Cuándo se creó el cargo (ISO).'),
  })
  .describe('Cargo EsMa (cuenta de maquila) con su estado de validación.');

/** Forma de un cargo EsMa tal como lo devuelve la API. */
export type CargoEsMaSalida = z.infer<typeof esquemaCargoEsMaSalida>;

/** Respuesta de la cola de cargos EsMa. */
export const esquemaCargosEsMaLista = z
  .object({
    filas: z.array(esquemaCargoEsMaSalida).describe('Cargos EsMa del estado pedido.'),
    totalImportePropuesto: z
      .number()
      .describe('Suma de los importes propuestos (los que tienen precio).'),
  })
  .describe('Cola de cargos EsMa.');

/** Forma de la cola de cargos tal como la devuelve la API. */
export type CargosEsMaLista = z.infer<typeof esquemaCargosEsMaLista>;
