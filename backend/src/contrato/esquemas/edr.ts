import { z } from 'zod';

/**
 * Esquemas Zod del ESTADO DE RESULTADOS (EDR, Módulo 6, F7-E2; doc `06-Costos-y-EDR.md` §4; D1/D2).
 * UNA sola definición de reglas para UI y servidor (alimenta el OpenAPI). Toda la lógica vive en
 * `dominio/edr/*` (A1); aquí solo las FORMAS.
 *
 * Modelo del EDR (D2, 2026-07-03):
 *  • CONSOLIDADO: el encabezado es GLOBAL por mes (sin empresa); los cortes por empresa/cliente se
 *    DERIVAN de las líneas (D2 #6). Solo entran empresas `paraEdr=true` y órdenes `noCostear=false`.
 *  • Ventas = Σ(cantVendida × precioVenta), con el PRECIO FACTURADO (editable, D2 #5). Mientras
 *    Finanzas/CFDI no exista, las líneas se PRE-PROPONEN desde las entregas a cliente de F3.
 *  • Costo = Σ(costoUnitActual × cantVendida), a COSTO ACTUAL (D1): se recalcula desde `CostoOrden`
 *    al leer; NUNCA se congela en la línea. `costoHistorico` es solo-informativo (lo llena el ETL E6).
 *  • Resultado = Ventas − Costo − Gastos − Intereses + Bonificaciones ± Otros (fórmula legacy).
 */

// ── Origen de una línea (reconciliación) ──────────────────────────────────────────────────────────

/** Origen de una línea del EDR (gobierna la reconciliación del generador). */
export const esquemaEdrOrigenLinea = z
  .enum(['automatica', 'ajustada', 'manual'])
  .describe(
    'automatica=propuesta por el generador; ajustada=editada por el usuario; manual=a mano.',
  );

/** Origen de una línea del EDR. */
export type EdrOrigenLineaClave = z.infer<typeof esquemaEdrOrigenLinea>;

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────────

/** Periodo (año/mes) — base de casi todas las operaciones del EDR. */
export const esquemaEdrGenerarCuerpo = z
  .object({
    anio: z.coerce.number().int().min(2000).max(2100).describe('Año del EDR.'),
    mes: z.coerce.number().int().min(1).max(12).describe('Mes del EDR (1-12).'),
  })
  .describe('Periodo (año/mes) a generar/reconciliar.');

/** Cuerpo de generación del EDR de un mes. */
export type DatosEdrGenerar = z.infer<typeof esquemaEdrGenerarCuerpo>;

/**
 * Cuerpo para ACTUALIZAR el encabezado global del mes (gastos/intereses/…). Todo opcional: solo se
 * pisa lo que venga (los demás quedan como están). Gastos/intereses/bonificaciones ≥ 0; `otros` es
 * SIGNADO (± al resultado, fórmula legacy).
 */
export const esquemaEdrEncabezadoCuerpo = z
  .object({
    gastos: z.number().min(0).optional().describe('Gastos del mes (≥0).'),
    intereses: z.number().min(0).optional().describe('Intereses del mes (≥0).'),
    bonificaciones: z.number().min(0).optional().describe('Bonificaciones del mes (≥0, SUMAN).'),
    otros: z.number().optional().describe('Otros (± al resultado; puede ser negativo).'),
    descOtros: z.string().trim().max(200).nullable().optional().describe('Descripción de otros.'),
    observaciones: z.string().trim().max(1000).nullable().optional().describe('Observaciones.'),
  })
  .describe('Campos del encabezado global del EDR del mes (todo opcional).');

/** Cuerpo para actualizar el encabezado del EDR. */
export type DatosEdrEncabezado = z.infer<typeof esquemaEdrEncabezadoCuerpo>;

/** Cuerpo para AJUSTAR una línea (cantidad/precio facturado). Marca la línea como `ajustada`. */
export const esquemaEdrLineaAjustarCuerpo = z
  .object({
    cantVendida: z.coerce.number().int().min(0).describe('Cantidad vendida (≥0).'),
    precioVenta: z.number().min(0).describe('Precio de venta FACTURADO por prenda (≥0).'),
  })
  .describe('Ajuste de la cantidad/precio facturado de una línea del EDR.');

/** Cuerpo para ajustar una línea del EDR. */
export type DatosEdrLineaAjustar = z.infer<typeof esquemaEdrLineaAjustarCuerpo>;

/** Cuerpo para AGREGAR una línea manual (sin orden). Exige empresa `paraEdr` + cliente. */
export const esquemaEdrLineaManualCuerpo = z
  .object({
    idEmpresa: z.coerce.number().int().positive().describe('Empresa (debe ser paraEdr).'),
    idCliente: z.coerce.number().int().positive().describe('Cliente de la línea.'),
    idModelo: z.coerce.number().int().positive().optional().describe('Modelo (opcional).'),
    descripcion: z.string().trim().max(200).nullable().optional().describe('Descripción libre.'),
    cantVendida: z.coerce.number().int().min(0).describe('Cantidad vendida (≥0).'),
    precioVenta: z.number().min(0).describe('Precio de venta facturado por prenda (≥0).'),
  })
  .describe('Alta de una línea manual del EDR (sin orden; costo 0).');

/** Cuerpo para agregar una línea manual del EDR. */
export type DatosEdrLineaManual = z.infer<typeof esquemaEdrLineaManualCuerpo>;

/** Filtros de la conciliación de líneas (por empresa/cliente/modelo/origen). */
export const esquemaEdrLineasQuery = z
  .object({
    idEmpresa: z.coerce.number().int().positive().optional().describe('Filtra por empresa.'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    idModelo: z.coerce.number().int().positive().optional().describe('Filtra por modelo.'),
    origen: esquemaEdrOrigenLinea.optional().describe('Filtra por origen de la línea.'),
  })
  .describe('Filtros de la conciliación de líneas del EDR.');

/** Parámetros de la conciliación ya coaccionados. */
export type EdrLineasQuery = z.infer<typeof esquemaEdrLineasQuery>;

/** Filtros de consulta por mes (año/mes). */
export const esquemaEdrPorMesQuery = z
  .object({
    anio: z.coerce.number().int().min(2000).max(2100).describe('Año.'),
    mes: z.coerce.number().int().min(1).max(12).describe('Mes 1-12.'),
  })
  .describe('Consulta del EDR de un mes.');

/** Parámetros de la consulta por mes. */
export type EdrPorMesQuery = z.infer<typeof esquemaEdrPorMesQuery>;

/** Filtros de consulta por año (comparativo mensual). */
export const esquemaEdrPorAnioQuery = z
  .object({ anio: z.coerce.number().int().min(2000).max(2100).describe('Año.') })
  .describe('Consulta del EDR de un año (comparativo mensual).');

/** Parámetros de la consulta por año. */
export type EdrPorAnioQuery = z.infer<typeof esquemaEdrPorAnioQuery>;

// ── Salidas ─────────────────────────────────────────────────────────────────────────────────────

/** Encabezado global del EDR de un mes. */
export const esquemaEdrEncabezadoSalida = z
  .object({
    id: z.number().int().describe('Id del EDR.'),
    anio: z.number().int().describe('Año.'),
    mes: z.number().int().describe('Mes 1-12.'),
    gastos: z.number().describe('Gastos del mes.'),
    intereses: z.number().describe('Intereses del mes.'),
    bonificaciones: z.number().describe('Bonificaciones del mes (SUMAN).'),
    otros: z.number().describe('Otros (± al resultado).'),
    descOtros: z.string().nullable().describe('Descripción de otros.'),
    observaciones: z.string().nullable().describe('Observaciones.'),
    creadoEn: z.string().describe('Alta (ISO).'),
    modificadoEn: z.string().describe('Última modificación (ISO).'),
  })
  .describe('Encabezado global del EDR del mes.');

/** Forma del encabezado del EDR. */
export type EdrEncabezadoSalida = z.infer<typeof esquemaEdrEncabezadoSalida>;

/**
 * Una línea del EDR con su costo ACTUAL calculado. `costoUnitActual`/`costoActual` salen del costo
 * vigente de la orden (D1); las líneas sin orden o sin costo capturado se marcan `sinCosto` (costo 0,
 * para que el usuario las revise). `importe` = cantVendida × precioVenta.
 */
export const esquemaEdrLineaSalida = z
  .object({
    id: z.number().int().describe('Id de la línea.'),
    idEdr: z.number().int().describe('Id del EDR al que pertenece.'),
    idOrden: z.number().int().nullable().describe('Orden vendida (null en manuales).'),
    folioOrden: z.number().int().nullable().describe('Folio de la orden (null en manuales).'),
    idEmpresa: z.number().int().describe('Empresa de la línea.'),
    empresa: z.string().describe('Nombre de la empresa.'),
    idCliente: z.number().int().nullable().describe('Cliente de la línea.'),
    cliente: z.string().nullable().describe('Nombre del cliente.'),
    idModelo: z.number().int().nullable().describe('Modelo vendido.'),
    modelo: z.string().nullable().describe('Código del modelo.'),
    descripcion: z.string().nullable().describe('Descripción (líneas manuales).'),
    cantVendida: z.number().int().describe('Cantidad vendida.'),
    precioVenta: z.number().describe('Precio de venta facturado por prenda.'),
    importe: z.number().describe('cantVendida × precioVenta.'),
    costoUnitActual: z
      .number()
      .nullable()
      .describe('Costo unitario ACTUAL (o null si la línea no tiene costo).'),
    costoActual: z.number().describe('Costo total actual de la línea (0 si sin costo).'),
    sinCosto: z.boolean().describe('true si la línea no tiene costo (sin orden/CostoOrden).'),
    costoHistorico: z.number().nullable().describe('Costo histórico congelado (solo ETL E6).'),
    origen: esquemaEdrOrigenLinea.describe('Origen de la línea.'),
  })
  .describe('Una línea del EDR con su costo actual.');

/** Forma de una línea del EDR. */
export type EdrLineaSalida = z.infer<typeof esquemaEdrLineaSalida>;

/** Un corte del EDR (por empresa o por cliente): ventas, costo y utilidad bruta. */
export const esquemaEdrCorteSalida = z
  .object({
    id: z.number().int().describe('Id de la empresa o cliente.'),
    nombre: z.string().describe('Nombre de la empresa o cliente.'),
    ventas: z.number().describe('Ventas del corte.'),
    costo: z.number().describe('Costo (actual) del corte.'),
    utilidadBruta: z.number().describe('Ventas − Costo (sin gastos globales).'),
  })
  .describe('Corte del EDR por empresa o por cliente.');

/** Forma de un corte del EDR. */
export type EdrCorteSalida = z.infer<typeof esquemaEdrCorteSalida>;

/**
 * EDR CALCULADO de un mes: encabezado + totales (a costo actual) + cortes por empresa y por cliente.
 * `resultado` = ventas − costo − gastos − intereses + bonificaciones + otros (fórmula legacy).
 */
export const esquemaEdrCalculado = z
  .object({
    encabezado: esquemaEdrEncabezadoSalida.describe('Encabezado global del mes.'),
    ventas: z.number().describe('Σ(cantVendida × precioVenta) de todas las líneas.'),
    costo: z.number().describe('Σ(costoUnitActual × cantVendida) a costo ACTUAL (D1).'),
    utilidadBruta: z
      .number()
      .describe('Ventas − Costo del mes (calculado en servidor; mismo criterio que los cortes).'),
    gastos: z.number().describe('Gastos del mes (del encabezado).'),
    intereses: z.number().describe('Intereses del mes.'),
    bonificaciones: z.number().describe('Bonificaciones del mes (SUMAN).'),
    otros: z.number().describe('Otros (± al resultado).'),
    resultado: z.number().describe('Ventas − Costo − Gastos − Intereses + Bonificaciones + Otros.'),
    totalPiezas: z.number().int().describe('Σ cantVendida de las líneas.'),
    totalLineas: z.number().int().describe('Número de líneas del mes.'),
    lineasSinCosto: z.number().int().describe('Cuántas líneas quedaron sin costo (a revisar).'),
    cortesEmpresa: z.array(esquemaEdrCorteSalida).describe('Corte por empresa.'),
    cortesCliente: z.array(esquemaEdrCorteSalida).describe('Corte por cliente.'),
  })
  .describe('EDR calculado de un mes (a costo actual).');

/** Forma del EDR calculado. */
export type EdrCalculado = z.infer<typeof esquemaEdrCalculado>;

/** Respuesta de la consulta por mes: puede no existir (aún no generado). */
export const esquemaEdrPorMesSalida = z
  .object({
    existe: z.boolean().describe('¿Ya se generó el EDR de este mes?'),
    anio: z.number().int().describe('Año consultado.'),
    mes: z.number().int().describe('Mes consultado.'),
    edr: esquemaEdrCalculado.nullable().describe('EDR calculado (null si no existe).'),
  })
  .describe('EDR de un mes (o indicador de que no existe).');

/** Forma de la consulta por mes. */
export type EdrPorMesSalida = z.infer<typeof esquemaEdrPorMesSalida>;

/** Conciliación: las líneas del EDR de un mes + totales. */
export const esquemaEdrLineasSalida = z
  .object({
    idEdr: z.number().int().describe('Id del EDR.'),
    anio: z.number().int().describe('Año.'),
    mes: z.number().int().describe('Mes 1-12.'),
    lineas: z.array(esquemaEdrLineaSalida).describe('Líneas del EDR (filtradas).'),
    totalPiezas: z.number().int().describe('Σ cantVendida de las líneas mostradas.'),
    totalVentas: z.number().describe('Σ importes de las líneas mostradas.'),
    totalCosto: z.number().describe('Σ costo actual de las líneas mostradas.'),
  })
  .describe('Conciliación de las líneas del EDR de un mes.');

/** Forma de la conciliación. */
export type EdrLineasSalida = z.infer<typeof esquemaEdrLineasSalida>;

/** Un mes del comparativo anual. */
export const esquemaEdrPorAnioMes = z
  .object({
    mes: z.number().int().describe('Mes 1-12.'),
    idEdr: z.number().int().describe('Id del EDR de ese mes.'),
    ventas: z.number().describe('Ventas del mes.'),
    costo: z.number().describe('Costo (actual) del mes.'),
    gastos: z.number().describe('Gastos del mes.'),
    intereses: z.number().describe('Intereses del mes.'),
    bonificaciones: z.number().describe('Bonificaciones del mes.'),
    otros: z.number().describe('Otros del mes.'),
    resultado: z.number().describe('Resultado del mes.'),
  })
  .describe('Un mes del comparativo anual del EDR.');

/** Forma de un mes del comparativo anual. */
export type EdrPorAnioMes = z.infer<typeof esquemaEdrPorAnioMes>;

/** Corte anual por empresa (ventas/costo del año). */
export const esquemaEdrPorAnioEmpresa = z
  .object({
    idEmpresa: z.number().int().describe('Empresa.'),
    empresa: z.string().describe('Nombre de la empresa.'),
    ventas: z.number().describe('Ventas del año.'),
    costo: z.number().describe('Costo del año.'),
    utilidadBruta: z.number().describe('Ventas − Costo del año.'),
  })
  .describe('Corte anual por empresa.');

/** Forma del corte anual por empresa. */
export type EdrPorAnioEmpresa = z.infer<typeof esquemaEdrPorAnioEmpresa>;

/** Comparativo anual del EDR: los meses generados + el corte por empresa + totales. */
export const esquemaEdrPorAnioSalida = z
  .object({
    anio: z.number().int().describe('Año.'),
    meses: z.array(esquemaEdrPorAnioMes).describe('Los meses del año que ya tienen EDR.'),
    porEmpresa: z.array(esquemaEdrPorAnioEmpresa).describe('Corte anual por empresa.'),
    totalVentas: z.number().describe('Σ ventas del año.'),
    totalCosto: z.number().describe('Σ costo del año.'),
    totalResultado: z.number().describe('Σ resultado del año.'),
  })
  .describe('Comparativo anual del EDR.');

/** Forma del comparativo anual. */
export type EdrPorAnioSalida = z.infer<typeof esquemaEdrPorAnioSalida>;
