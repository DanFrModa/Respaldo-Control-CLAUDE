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
    sinCosto: z
      .boolean()
      .optional()
      .describe(
        'Marca el cargo como SIN COSTO (segundas no pagadas, decisión (f)): se excluye del saldo y del pago.',
      ),
    conFactura: z
      .boolean()
      .optional()
      .describe(
        'Con/sin factura de este cargo (decisión (h)). Solo se respeta si el proveedor es de modalidad "ambos"; ' +
          'para solo-con/solo-sin lo determina el proveedor.',
      ),
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
    precioReal: z.number().nullable().describe('Precio validado por el admin (o null / oculto).'),
    importeReal: z.number().nullable().describe('cantidadReal × precioReal (o null / oculto).'),
    sinCosto: z.boolean().describe('Cargo sin costo (segundas no pagadas, decisión f).'),
    conFactura: z.boolean().nullable().describe('Con/sin factura del cargo o null (sin definir).'),
    cantidadPagada: z.number().describe('Prendas de este cargo ya pagadas (decisión g).'),
    porPagar: z
      .number()
      .describe('Prendas que faltan por pagar (cantidadReal − cantidadPagada; 0 si no aplica).'),
    pagado: z
      .boolean()
      .describe('¿El cargo está totalmente pagado? (cantidadPagada ≥ cantidadReal).'),
    estado: z.enum(['propuesto', 'validado', 'cancelado']).describe('Estado del cargo.'),
    estadoConciliacion: z
      .enum(['capturado', 'revisado', 'pagado', 'cancelado'])
      .describe('Estado de conciliación PROYECTADO (capturado/revisado/pagado/cancelado).'),
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// F6-E4 · Movimientos EsMa (abonos, descuentos, pagos), saldos, conciliación y orden pagada.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Modalidad de facturación de un maquilero (decisión (h), R15). */
export const MODALIDADES_FACTURACION = ['solo_con', 'solo_sin', 'ambos'] as const;
/** Clave de modalidad de facturación. */
export type ModalidadFacturacionClave = (typeof MODALIDADES_FACTURACION)[number];
/** Etiquetas de UI para la modalidad de facturación. */
export const ETIQUETAS_MODALIDAD_FACTURACION: Record<ModalidadFacturacionClave, string> = {
  solo_con: 'Solo con factura',
  solo_sin: 'Solo sin factura',
  ambos: 'Ambas (con y sin factura)',
};

/** Estado de revisión de un movimiento EsMa (ex asteriscos Rev; la transición fina la opera E5). */
export const ESTADOS_REVISION_ESMA = ['capturado', 'revisado'] as const;
/** Clave de estado de revisión de un movimiento EsMa. */
export type EstadoRevisionEsMaClave = (typeof ESTADOS_REVISION_ESMA)[number];

/** Concepto de un movimiento plano de EsMa (para la salida unificada). */
export const CONCEPTOS_MOVIMIENTO_ESMA = ['abono', 'descuento', 'pago'] as const;
/** Clave de concepto de movimiento EsMa. */
export type ConceptoMovimientoEsMaClave = (typeof CONCEPTOS_MOVIMIENTO_ESMA)[number];

// ── Abonos / descuentos: captura (misma forma) ───────────────────────────────────────────────────

/**
 * Cuerpo de captura de un ABONO o un DESCUENTO a la cuenta de un maquilero (movimiento plano).
 * `conFactura` es opcional: si el proveedor es solo-con/solo-sin lo determina el proveedor; solo se
 * respeta el valor enviado cuando la modalidad del proveedor es "ambos" (decisión (h)).
 */
export const esquemaMovimientoEsMaCrear = z
  .object({
    idMaquilero: z
      .number({ error: 'El maquilero es obligatorio' })
      .int()
      .positive()
      .describe('Maquilero (Proveedor) al que se le carga el movimiento.'),
    monto: z
      .number({ error: 'El monto es obligatorio' })
      .positive({ error: 'El monto debe ser mayor a cero' })
      .describe('Importe del movimiento (positivo).'),
    fecha: z.iso
      .date({ error: 'La fecha es obligatoria (YYYY-MM-DD)' })
      .describe('Fecha del movimiento (YYYY-MM-DD).'),
    conFactura: z
      .boolean()
      .optional()
      .describe('Con/sin factura (solo aplica si el proveedor es "ambos").'),
    observaciones: z.string().trim().max(1000).optional().describe('Observaciones opcionales.'),
  })
  .describe('Captura de un abono o descuento a la cuenta de un maquilero.');

/** Alias explícitos (misma forma) para claridad en las rutas. */
export const esquemaAbonoCrear = esquemaMovimientoEsMaCrear;
export const esquemaDescuentoCrear = esquemaMovimientoEsMaCrear;
/** Datos validados de un abono/descuento. */
export type DatosMovimientoEsMaCrear = z.infer<typeof esquemaMovimientoEsMaCrear>;

// ── Pagos: captura ligada a cargos (decisión (g)) ────────────────────────────────────────────────

/** Una aplicación del pago a un cargo: cuántas prendas de ESE cargo cubre el pago. */
export const esquemaPagoAplicacionEntrada = z
  .object({
    idCargo: z
      .number({ error: 'El cargo es obligatorio' })
      .int()
      .positive()
      .describe('Cargo EsMa validado al que se aplica el pago.'),
    cantidad: z
      .number({ error: 'La cantidad es obligatoria' })
      .positive({ error: 'La cantidad debe ser mayor a cero' })
      .describe('Prendas de ese cargo cubiertas por el pago (≤ las que le faltan por pagar).'),
  })
  .describe('Aplicación de un pago a un cargo concreto.');

/**
 * Cuerpo de captura de un PAGO a un maquilero (decisión (g)): se aplica a uno o más cargos VALIDADOS
 * consumiendo sus prendas por pagar. El monto total se DERIVA (Σ cantidad × precio del cargo); no se
 * captura suelto. Re-pagar lo ya pagado se BLOQUEA en el servidor (anti-doble-pago duro).
 */
export const esquemaPagoCrear = z
  .object({
    idMaquilero: z
      .number({ error: 'El maquilero es obligatorio' })
      .int()
      .positive()
      .describe('Maquilero (Proveedor) al que se le paga.'),
    fecha: z.iso
      .date({ error: 'La fecha del pago es obligatoria (YYYY-MM-DD)' })
      .describe('Fecha del pago (YYYY-MM-DD).'),
    conFactura: z
      .boolean()
      .optional()
      .describe('Con/sin factura (solo aplica si el proveedor es "ambos").'),
    observaciones: z.string().trim().max(1000).optional().describe('Observaciones opcionales.'),
    aplicaciones: z
      .array(esquemaPagoAplicacionEntrada)
      .min(1, { error: 'El pago debe aplicarse al menos a un cargo.' })
      .describe('Cargos a los que se aplica el pago (uno o más).'),
  })
  .describe('Captura de un pago a un maquilero, ligado a cargos.');

/** Datos validados de un pago. */
export type DatosPagoCrear = z.infer<typeof esquemaPagoCrear>;

// ── Salida de un movimiento plano (abono/descuento) ──────────────────────────────────────────────

/** Un abono/descuento tal como lo devuelve la API. `monto` es null si faltan importes o el permiso. */
export const esquemaMovimientoEsMaSalida = z
  .object({
    id: z.number().int().describe('Id del movimiento.'),
    concepto: z.enum(CONCEPTOS_MOVIMIENTO_ESMA).describe('Concepto (abono/descuento/pago).'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    idMaquilero: z.number().int().describe('Maquilero (Proveedor).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    monto: z.number().nullable().describe('Importe del movimiento (null si se ocultan importes).'),
    fecha: z.string().describe('Fecha del movimiento (YYYY-MM-DD).'),
    conFactura: z.boolean().nullable().describe('Con/sin factura o null (sin definir).'),
    observaciones: z.string().nullable().describe('Observaciones o null.'),
    estadoRevision: z.enum(ESTADOS_REVISION_ESMA).describe('Estado de revisión.'),
    creadoEn: z.iso.datetime().describe('Cuándo se capturó (ISO).'),
  })
  .describe('Movimiento plano de EsMa (abono/descuento).');

/** Forma de un abono/descuento tal como lo devuelve la API. */
export type MovimientoEsMaSalida = z.infer<typeof esquemaMovimientoEsMaSalida>;

/** Lista de movimientos planos de un maquilero. */
export const esquemaMovimientosEsMaLista = z
  .object({
    filas: z.array(esquemaMovimientoEsMaSalida).describe('Movimientos del concepto pedido.'),
    total: z.number().nullable().describe('Suma de los montos (null si se ocultan importes).'),
  })
  .describe('Lista de movimientos planos de EsMa.');

/** Forma de la lista de movimientos. */
export type MovimientosEsMaLista = z.infer<typeof esquemaMovimientosEsMaLista>;

// ── Salida de un pago (con sus aplicaciones) ─────────────────────────────────────────────────────

/** Una aplicación del pago, proyectada (con folio de orden y proceso legibles). */
export const esquemaPagoAplicacionSalida = z
  .object({
    idCargo: z.number().int().describe('Cargo pagado.'),
    idOrden: z.number().int().describe('Orden del cargo.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    tipoProceso: z.string().describe('Proceso de maquila del cargo.'),
    cantidad: z.number().describe('Prendas cubiertas por este pago en ese cargo.'),
    importe: z.number().nullable().describe('Importe aplicado (null si se ocultan importes).'),
  })
  .describe('Aplicación de un pago a un cargo.');

/** Un pago tal como lo devuelve la API. */
export const esquemaPagoSalida = z
  .object({
    id: z.number().int().describe('Id del pago.'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    idMaquilero: z.number().int().describe('Maquilero (Proveedor).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    monto: z.number().nullable().describe('Importe total del pago (null si se ocultan importes).'),
    fecha: z.string().describe('Fecha del pago (YYYY-MM-DD).'),
    conFactura: z.boolean().nullable().describe('Con/sin factura o null.'),
    observaciones: z.string().nullable().describe('Observaciones o null.'),
    estadoRevision: z.enum(ESTADOS_REVISION_ESMA).describe('Estado de revisión.'),
    aplicaciones: z.array(esquemaPagoAplicacionSalida).describe('Cargos cubiertos por el pago.'),
    creadoEn: z.iso.datetime().describe('Cuándo se capturó (ISO).'),
  })
  .describe('Pago a un maquilero (con sus aplicaciones a cargos).');

/** Forma de un pago tal como lo devuelve la API. */
export type PagoSalida = z.infer<typeof esquemaPagoSalida>;

/** Lista de pagos de un maquilero. */
export const esquemaPagosLista = z
  .object({
    filas: z.array(esquemaPagoSalida).describe('Pagos del maquilero.'),
    total: z.number().nullable().describe('Suma de los pagos (null si se ocultan importes).'),
  })
  .describe('Lista de pagos de EsMa.');

/** Forma de la lista de pagos. */
export type PagosLista = z.infer<typeof esquemaPagosLista>;

// ── Saldo derivado de un maquilero (D3) ──────────────────────────────────────────────────────────

/** Filtro por facturación del saldo (segmentación de la decisión (h) — para "ambos", E5). */
export const esquemaSaldoQuery = z
  .object({
    conFactura: z
      .enum(['con', 'sin'])
      .optional()
      .describe('Segmenta el saldo por facturación (con/sin). Omitir = todo junto.'),
  })
  .describe('Filtros del saldo de un maquilero.');

/** Parámetros del saldo ya coaccionados. */
export type SaldoQuery = z.infer<typeof esquemaSaldoQuery>;

/**
 * SALDO derivado de un maquilero (D3): `Σcargos + Σabonos − Σpagos − Σdescuentos`, con nulos = 0
 * (fórmula exacta de `EsMa_SaldosMaq` con ceronulo). Los importes salen en null si se ocultan.
 */
export const esquemaSaldoSalida = z
  .object({
    idMaquilero: z.number().int().describe('Maquilero (Proveedor).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    conFactura: z
      .enum(['con', 'sin'])
      .nullable()
      .describe('Segmento aplicado o null (todo junto).'),
    totalCargos: z.number().nullable().describe('Σ cargos validados no sin-costo (o null).'),
    totalAbonos: z.number().nullable().describe('Σ abonos (o null).'),
    totalPagos: z.number().nullable().describe('Σ pagos (o null).'),
    totalDescuentos: z.number().nullable().describe('Σ descuentos (o null).'),
    saldo: z.number().nullable().describe('Saldo derivado (o null si se ocultan importes).'),
  })
  .describe('Saldo derivado de la cuenta de un maquilero.');

/** Forma del saldo. */
export type SaldoSalida = z.infer<typeof esquemaSaldoSalida>;

// ── Conciliación EsMa vs recibos (cuadre por orden+maquilero+proceso) ─────────────────────────────

/** Filtros de la conciliación: periodo (por fecha de recibo), opcional maquilero y estatus de pago. */
export const esquemaConciliacionQuery = z
  .object({
    desde: z.iso.date().optional().describe('Fecha inicial (YYYY-MM-DD), inclusiva.'),
    hasta: z.iso.date().optional().describe('Fecha final (YYYY-MM-DD), inclusiva.'),
    idMaquilero: z.coerce.number().int().positive().optional().describe('Filtra por un maquilero.'),
    pagadas: z
      .enum(['todas', 'pagadas', 'no-pagadas'])
      .default('todas')
      .describe('Filtra por estatus "pagada" de la orden (F6-E5 add-on).'),
  })
  .describe('Filtros de la conciliación EsMa vs recibos.');

/** Parámetros de la conciliación ya coaccionados. */
export type ConciliacionQuery = z.infer<typeof esquemaConciliacionQuery>;

/** Una fila de conciliación (recibido vs cargado por orden+maquilero+proceso). */
export const esquemaConciliacionFila = z
  .object({
    idOrden: z.number().int().describe('Orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    idMaquilero: z
      .number()
      .int()
      .nullable()
      .describe('Maquilero (Proveedor) o null (sin asignar).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    idTipoProceso: z.number().int().nullable().describe('Proceso de maquila.'),
    tipoProceso: z.string().describe('Nombre del proceso.'),
    recibido: z.number().describe('Σ piezas recibidas (recibos vivos del periodo).'),
    cargado: z.number().describe('Σ piezas cargadas a EsMa (cargos validados).'),
    faltantePorCargar: z.number().describe('recibido − cargado (>0 = falta cargar a EsMa).'),
    // ── F6-E5 add-on: contexto de producción/pago de la orden ────────────────────────────────────
    cortado: z.number().describe('Σ piezas cortadas de la orden (F3/wip).'),
    entregado: z.number().describe('Σ piezas entregadas al cliente de la orden (F3/wip).'),
    pagada: z.boolean().describe('¿La orden está pagada? (estatus derivado + override).'),
  })
  .describe('Cuadre recibido vs cargado por orden+maquilero+proceso.');

/** Un cargo SIN recibo ligado (histórico/manual): candidato a revisión. */
export const esquemaCargoSinReciboFila = z
  .object({
    idCargo: z.number().int().describe('Cargo sin recibo ligado.'),
    idOrden: z.number().int().describe('Orden del cargo.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    idMaquilero: z.number().int().describe('Maquilero (Proveedor).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    idTipoProceso: z.number().int().describe('Proceso de maquila.'),
    tipoProceso: z.string().describe('Nombre del proceso.'),
    cantidad: z.number().nullable().describe('Cantidad del cargo (real o null si aún propuesto).'),
  })
  .describe('Cargo EsMa sin recibo ligado.');

/** Resultado de la conciliación. */
export const esquemaConciliacionSalida = z
  .object({
    desde: z.string().nullable().describe('Inicio del periodo (YYYY-MM-DD) o null.'),
    hasta: z.string().nullable().describe('Fin del periodo (YYYY-MM-DD) o null.'),
    filas: z.array(esquemaConciliacionFila).describe('Cuadre por orden+maquilero+proceso.'),
    cargosSinRecibo: z.array(esquemaCargoSinReciboFila).describe('Cargos sin recibo ligado.'),
    totales: z
      .object({
        recibido: z.number(),
        cargado: z.number(),
        faltantePorCargar: z.number(),
        numCargosSinRecibo: z.number().int(),
      })
      .describe('Totales del periodo.'),
  })
  .describe('Conciliación EsMa vs recibos del periodo.');

/** Forma de la conciliación. */
export type ConciliacionSalida = z.infer<typeof esquemaConciliacionSalida>;

// ── Orden pagada: derivada (D3) + override manual auditado (decisión (f)) ─────────────────────────

/**
 * Cuerpo del OVERRIDE de "orden pagada" (decisión (f)): `pagadaForzada` en true/false FUERZA el
 * estatus (la derivación deja de pisarlo); `null` vuelve a la derivación automática.
 */
export const esquemaOrdenPagadaForzarCuerpo = z
  .object({
    pagadaForzada: z
      .boolean()
      .nullable()
      .describe('true/false fuerza el estatus; null vuelve a la derivación automática.'),
  })
  .describe('Override manual del estatus "pagada" de una orden.');

/** Datos validados del override. */
export type DatosOrdenPagadaForzar = z.infer<typeof esquemaOrdenPagadaForzarCuerpo>;

/** Estatus "pagada" de una orden: valor efectivo + derivado + override. */
export const esquemaOrdenPagadaSalida = z
  .object({
    idOrden: z.number().int().describe('Orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    pagada: z.boolean().describe('Valor EFECTIVO (override si lo hay; si no, el derivado).'),
    pagadaForzada: z
      .boolean()
      .nullable()
      .describe('Override manual o null (derivación automática).'),
    pagadaDerivada: z.boolean().describe('Valor DERIVADO (todos los cargos pagables, pagados).'),
    cargosPagables: z.number().int().describe('Cargos validados no sin-costo de la orden.'),
    cargosPagados: z.number().int().describe('De esos, cuántos están totalmente pagados.'),
  })
  .describe('Estatus "pagada" de una orden (derivado + override).');

/** Forma del estatus "pagada". */
export type OrdenPagadaSalida = z.infer<typeof esquemaOrdenPagadaSalida>;

// ══════════════════════════════════════════════════════════════════════════════════════════════
// F6-E5 · Estado de cuenta, desglosado, saldos de todos, consultas semanales, selector de
// maquileros y revisión de partidas (doc 07-EsMa §1/§4). Todo son consultas de solo lectura /
// agregación (A1: la lógica vive en el dominio) salvo `revisar` (transición de estado).
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Conceptos del estado de cuenta UNIFICADO (los 4 renglones que se fusionan en la línea de tiempo). */
export const CONCEPTOS_ESTADO_CUENTA = ['cargo', 'abono', 'descuento', 'pago'] as const;
/** Clave de un concepto del estado de cuenta unificado. */
export type ConceptoEstadoCuentaClave = (typeof CONCEPTOS_ESTADO_CUENTA)[number];

// ── Estado de cuenta UNIFICADO (los 4 conceptos por fecha) ────────────────────────────────────────

/** Filtros del estado de cuenta: periodo (por fecha del movimiento) y segmento de facturación. */
export const esquemaEstadoCuentaQuery = z
  .object({
    desde: z.iso.date().optional().describe('Fecha inicial (YYYY-MM-DD), inclusiva.'),
    hasta: z.iso.date().optional().describe('Fecha final (YYYY-MM-DD), inclusiva.'),
    conFactura: z
      .enum(['con', 'sin'])
      .optional()
      .describe('Segmenta por facturación (con/sin). Omitir = todo junto.'),
  })
  .describe('Filtros del estado de cuenta de un maquilero.');

/** Parámetros del estado de cuenta ya coaccionados. */
export type EstadoCuentaQuery = z.infer<typeof esquemaEstadoCuentaQuery>;

/**
 * Un renglón del estado de cuenta unificado (cargo/abono/descuento/pago) con su marca de revisión.
 * `estadoRevision` es TEXTO libre porque cada concepto tiene su propio conjunto (cargo:
 * propuesto/validado; abono/descuento/pago: capturado/revisado). `pendienteRevision` unifica la marca.
 */
export const esquemaEstadoCuentaMovimiento = z
  .object({
    concepto: z.enum(CONCEPTOS_ESTADO_CUENTA).describe('Concepto del renglón.'),
    id: z.number().int().describe('Id del movimiento del concepto.'),
    fecha: z.string().describe('Fecha del movimiento (YYYY-MM-DD).'),
    referencia: z.string().describe('Referencia legible (orden+proceso, u observaciones).'),
    monto: z
      .number()
      .nullable()
      .describe('Importe con signo contable (null si se ocultan importes).'),
    estadoRevision: z
      .string()
      .describe('Estado del renglón (propuesto/validado o capturado/revisado).'),
    pendienteRevision: z.boolean().describe('true si el renglón está pendiente de revisión.'),
  })
  .describe('Renglón del estado de cuenta unificado.');

/** Forma de un renglón del estado de cuenta. */
export type EstadoCuentaMovimiento = z.infer<typeof esquemaEstadoCuentaMovimiento>;

/** Estado de cuenta unificado de un maquilero: la línea de tiempo de los 4 conceptos + el saldo. */
export const esquemaEstadoCuentaSalida = z
  .object({
    idMaquilero: z.number().int().describe('Maquilero (Proveedor).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    desde: z.string().nullable().describe('Inicio del periodo (YYYY-MM-DD) o null.'),
    hasta: z.string().nullable().describe('Fin del periodo (YYYY-MM-DD) o null.'),
    conFactura: z
      .enum(['con', 'sin'])
      .nullable()
      .describe('Segmento aplicado o null (todo junto).'),
    saldo: esquemaSaldoSalida.describe('Saldo derivado (all-time) + su desglose por concepto.'),
    movimientos: z
      .array(esquemaEstadoCuentaMovimiento)
      .describe('Renglones del periodo, ordenados por fecha (fecha+id).'),
  })
  .describe('Estado de cuenta unificado de un maquilero.');

/** Forma del estado de cuenta unificado. */
export type EstadoCuentaSalida = z.infer<typeof esquemaEstadoCuentaSalida>;

// ── Estado de cuenta DESGLOSADO (detalle por orden/modelo — fuente del PDF/Excel) ─────────────────

/** Un cargo desglosado por orden/modelo/cantidad/precio/importe (detalle imprimible). */
export const esquemaDesglosadoCargo = z
  .object({
    idCargo: z.number().int().describe('Id del cargo.'),
    fecha: z.string().describe('Fecha del cargo (YYYY-MM-DD).'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    codigoModelo: z.string().describe('Código del modelo de la orden.'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    tipoProceso: z.string().describe('Nombre del proceso de maquila.'),
    cantidad: z.number().nullable().describe('Cantidad real (o null si aún propuesto).'),
    precio: z.number().nullable().describe('Precio real unitario (o null / oculto).'),
    importe: z.number().nullable().describe('cantidad × precio (o null / oculto).'),
    sinCosto: z.boolean().describe('Cargo sin costo (segundas no pagadas, decisión f).'),
    conFactura: z.boolean().nullable().describe('Con/sin factura o null (sin definir).'),
  })
  .describe('Cargo desglosado (detalle imprimible).');

/** Forma de un cargo desglosado. */
export type DesglosadoCargo = z.infer<typeof esquemaDesglosadoCargo>;

/** Estado de cuenta desglosado: cargos por orden/modelo + abonos/descuentos/pagos + saldo. */
export const esquemaDesglosadoSalida = z
  .object({
    idMaquilero: z.number().int().describe('Maquilero (Proveedor).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    desde: z.string().nullable().describe('Inicio del periodo (YYYY-MM-DD) o null.'),
    hasta: z.string().nullable().describe('Fin del periodo (YYYY-MM-DD) o null.'),
    conFactura: z.enum(['con', 'sin']).nullable().describe('Segmento aplicado o null.'),
    cargos: z.array(esquemaDesglosadoCargo).describe('Cargos del periodo, por orden/modelo.'),
    abonos: z.array(esquemaMovimientoEsMaSalida).describe('Abonos del periodo.'),
    descuentos: z.array(esquemaMovimientoEsMaSalida).describe('Descuentos del periodo.'),
    pagos: z.array(esquemaPagoSalida).describe('Pagos del periodo.'),
    saldo: esquemaSaldoSalida.describe('Saldo derivado (all-time) + su desglose.'),
  })
  .describe('Estado de cuenta desglosado de un maquilero.');

/** Forma del estado de cuenta desglosado. */
export type DesglosadoSalida = z.infer<typeof esquemaDesglosadoSalida>;

// ── Saldos de TODOS los maquileros (tablero, drill-down) ──────────────────────────────────────────

/** Filtro del tablero de saldos: segmento de facturación. */
export const esquemaSaldosTodosQuery = z
  .object({
    conFactura: z
      .enum(['con', 'sin'])
      .optional()
      .describe('Segmenta los saldos por facturación (con/sin). Omitir = todo junto.'),
  })
  .describe('Filtros del tablero de saldos de maquileros.');

/** Parámetros del tablero de saldos ya coaccionados. */
export type SaldosTodosQuery = z.infer<typeof esquemaSaldosTodosQuery>;

/** Saldo de un maquilero en el tablero (drill-down al estado de cuenta). */
export const esquemaSaldoTodosFila = z
  .object({
    idMaquilero: z.number().int().describe('Maquilero (Proveedor).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    corto: z.string().nullable().describe('Clave corta del taller, o null.'),
    totalCargos: z.number().nullable().describe('Σ cargos validados no sin-costo (o null).'),
    totalAbonos: z.number().nullable().describe('Σ abonos (o null).'),
    totalPagos: z.number().nullable().describe('Σ pagos (o null).'),
    totalDescuentos: z.number().nullable().describe('Σ descuentos (o null).'),
    saldo: z.number().nullable().describe('Saldo derivado (o null si se ocultan importes).'),
  })
  .describe('Saldo de un maquilero en el tablero.');

/** Forma de una fila del tablero de saldos. */
export type SaldoTodosFila = z.infer<typeof esquemaSaldoTodosFila>;

/** Tablero de saldos: maquileros activos con saldo ≠ 0. */
export const esquemaSaldosTodosSalida = z
  .object({
    conFactura: z.enum(['con', 'sin']).nullable().describe('Segmento aplicado o null.'),
    filas: z.array(esquemaSaldoTodosFila).describe('Maquileros activos con saldo ≠ 0.'),
    totalSaldo: z.number().nullable().describe('Σ de los saldos (o null si se ocultan importes).'),
  })
  .describe('Saldos de todos los maquileros.');

/** Forma del tablero de saldos. */
export type SaldosTodosSalida = z.infer<typeof esquemaSaldosTodosSalida>;

// ── Pagos semanales (navegación por semana) ───────────────────────────────────────────────────────

/** Filtro de pagos semanales: rango (lo resuelve el frontend por semana). */
export const esquemaPagosSemanalesQuery = z
  .object({
    desde: z.iso.date().optional().describe('Fecha inicial (YYYY-MM-DD), inclusiva.'),
    hasta: z.iso.date().optional().describe('Fecha final (YYYY-MM-DD), inclusiva.'),
  })
  .describe('Filtros de pagos semanales.');

/** Parámetros de pagos semanales ya coaccionados. */
export type PagosSemanalesQuery = z.infer<typeof esquemaPagosSemanalesQuery>;

/** Un pago en la consulta semanal (encabezado, sin el detalle de aplicaciones). */
export const esquemaPagoSemanalFila = z
  .object({
    id: z.number().int().describe('Id del pago.'),
    idMaquilero: z.number().int().describe('Maquilero (Proveedor).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    fecha: z.string().describe('Fecha del pago (YYYY-MM-DD).'),
    monto: z.number().nullable().describe('Importe del pago (null si se ocultan importes).'),
    conFactura: z.boolean().nullable().describe('Con/sin factura o null.'),
    estadoRevision: z.enum(ESTADOS_REVISION_ESMA).describe('Estado de revisión.'),
    numAplicaciones: z.number().int().describe('Cantidad de cargos que cubre el pago.'),
  })
  .describe('Pago en la consulta semanal.');

/** Forma de un pago semanal. */
export type PagoSemanalFila = z.infer<typeof esquemaPagoSemanalFila>;

/** Pagos del periodo con su total. */
export const esquemaPagosSemanalesSalida = z
  .object({
    desde: z.string().nullable().describe('Inicio del periodo (YYYY-MM-DD) o null.'),
    hasta: z.string().nullable().describe('Fin del periodo (YYYY-MM-DD) o null.'),
    filas: z.array(esquemaPagoSemanalFila).describe('Pagos del periodo (más recientes primero).'),
    total: z.number().nullable().describe('Σ de los pagos del periodo (o null si se ocultan).'),
  })
  .describe('Pagos semanales.');

/** Forma de los pagos semanales. */
export type PagosSemanalesSalida = z.infer<typeof esquemaPagosSemanalesSalida>;

// ── Recibos semanales de maquila (ex RecibosSemanalesMaq, menú 3.8) ───────────────────────────────

/** Filtro de recibos semanales de maquila (EsMa): periodo + opcional maquilero. */
export const esquemaRecibosSemanalesEsMaQuery = z
  .object({
    desde: z.iso.date().optional().describe('Fecha inicial (YYYY-MM-DD), inclusiva.'),
    hasta: z.iso.date().optional().describe('Fecha final (YYYY-MM-DD), inclusiva.'),
    idMaquilero: z.coerce.number().int().positive().optional().describe('Filtra por un maquilero.'),
  })
  .describe('Filtros de recibos semanales de maquila (EsMa).');

/** Parámetros de recibos semanales EsMa ya coaccionados. */
export type RecibosSemanalesEsMaQuery = z.infer<typeof esquemaRecibosSemanalesEsMaQuery>;

/** Un recibo de maquila del periodo, por maquilero/modelo (con su importe valuado al precio pactado). */
export const esquemaReciboSemanalEsMaFila = z
  .object({
    idRecibo: z.number().int().describe('Id del recibo (EtapaMovimiento).'),
    folioRecibo: z.number().int().describe('Folio del recibo.'),
    fecha: z.string().describe('Fecha del recibo (YYYY-MM-DD).'),
    idMaquilero: z
      .number()
      .int()
      .nullable()
      .describe('Maquilero (Proveedor) o null (sin asignar).'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    tipoProceso: z.string().describe('Nombre del proceso.'),
    cantidad: z.number().describe('Σ piezas recibidas.'),
    importe: z
      .number()
      .nullable()
      .describe('cantidad × precio pactado (null si se ocultan importes).'),
  })
  .describe('Recibo de maquila del periodo (por maquilero/modelo).');

/** Forma de un recibo semanal EsMa. */
export type ReciboSemanalEsMaFila = z.infer<typeof esquemaReciboSemanalEsMaFila>;

/** Recibos de maquila del periodo con sus totales. */
export const esquemaRecibosSemanalesEsMaSalida = z
  .object({
    desde: z.string().nullable().describe('Inicio del periodo (YYYY-MM-DD) o null.'),
    hasta: z.string().nullable().describe('Fin del periodo (YYYY-MM-DD) o null.'),
    filas: z.array(esquemaReciboSemanalEsMaFila).describe('Recibos del periodo.'),
    totalCantidad: z.number().describe('Σ piezas recibidas del periodo.'),
    totalImporte: z.number().nullable().describe('Σ importes valuados (o null si se ocultan).'),
  })
  .describe('Recibos semanales de maquila (EsMa).');

/** Forma de los recibos semanales EsMa. */
export type RecibosSemanalesEsMaSalida = z.infer<typeof esquemaRecibosSemanalesEsMaSalida>;

// ── Selector de maquileros de EsMa (activos + por tipo) ───────────────────────────────────────────

/** Tipo de maquilero para el selector: costura o estampado (mapea al rol del proveedor). */
export const TIPOS_MAQUILERO_ESMA = ['costura', 'estampado'] as const;
/** Clave de tipo de maquilero. */
export type TipoMaquileroEsMaClave = (typeof TIPOS_MAQUILERO_ESMA)[number];

/** Filtro del selector de maquileros: por tipo (opcional). */
export const esquemaMaquilerosEsMaQuery = z
  .object({
    tipo: z
      .enum(TIPOS_MAQUILERO_ESMA)
      .optional()
      .describe('Filtra por tipo (costura/estampado). Omitir = cualquier rol de maquila.'),
  })
  .describe('Filtros del selector de maquileros.');

/** Parámetros del selector ya coaccionados. */
export type MaquilerosEsMaQuery = z.infer<typeof esquemaMaquilerosEsMaQuery>;

/** Un maquilero para el selector (id + nombre + clave corta). */
export const esquemaMaquileroEsMaFila = z
  .object({
    id: z.number().int().describe('Maquilero (Proveedor).'),
    nombre: z.string().describe('Nombre del maquilero.'),
    corto: z.string().nullable().describe('Clave corta del taller, o null.'),
  })
  .describe('Maquilero para el selector.');

/** Forma de una fila del selector de maquileros. */
export type MaquileroEsMaFila = z.infer<typeof esquemaMaquileroEsMaFila>;

/** Lista del selector de maquileros. */
export const esquemaMaquilerosEsMaLista = z
  .object({
    filas: z.array(esquemaMaquileroEsMaFila).describe('Maquileros activos del tipo pedido.'),
  })
  .describe('Selector de maquileros de EsMa.');

/** Forma del selector de maquileros. */
export type MaquilerosEsMaLista = z.infer<typeof esquemaMaquilerosEsMaLista>;

// ── Revisión (autorización) de una partida (abono/descuento/pago) ─────────────────────────────────

/** Resultado de revisar (autorizar) una partida: su nuevo estado de revisión. */
export const esquemaRevisionSalida = z
  .object({
    concepto: z.enum(CONCEPTOS_MOVIMIENTO_ESMA).describe('Concepto (abono/descuento/pago).'),
    id: z.number().int().describe('Id del movimiento revisado.'),
    estadoRevision: z.enum(ESTADOS_REVISION_ESMA).describe('Estado de revisión resultante.'),
  })
  .describe('Resultado de la revisión de una partida.');

/** Forma del resultado de revisión. */
export type RevisionSalida = z.infer<typeof esquemaRevisionSalida>;
