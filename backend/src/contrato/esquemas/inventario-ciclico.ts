import { z } from 'zod';

/**
 * Esquemas Zod del INVENTARIO CÍCLICO (Módulo Indicadores / Almacén, F7-E5; doc
 * `05-Indicadores.md`; ← forms `Alm_IC_Alta`/`Alm_IC_Cont`/`Alm_IC_Consulta`). Cuenta el físico
 * contra el KARDEX de v2 (D3/D6): el ALTA congela el teórico por artículo, el conteo es CIEGO (el
 * capturista NO ve el teórico) y el ajuste se aplica SOLO como MOVIMIENTO de kardex (D3).
 *
 * Una sola definición para UI y servidor (OpenAPI). La lógica vive en
 * `dominio/indicadores/inventario-ciclico.ts` (A1). A9 por empresa.
 *
 * REGLA DE CONTEO CIEGO en el contrato: los esquemas de la vista de CONTEO
 * ({@link esquemaConteoSalida}) y de la hoja de conteo NO incluyen `cantTeorica` ni `exactitud`; el
 * teórico solo aparece en la vista de EXACTITUD ({@link esquemaExactitudSalida}, permiso de consulta).
 */

/** Estado del ciclo de vida (espejo del enum Prisma `EstadoInventarioCiclico`). */
export const esquemaEstadoInventarioCiclico = z
  .enum(['abierto', 'contado', 'cerrado', 'cancelado'])
  .describe('abierto → contado → cerrado (ajuste aplicado); cancelado = abortado antes de cerrar.');

/** Valor del estado de un inventario cíclico. */
export type EstadoInventarioCiclicoValor = z.infer<typeof esquemaEstadoInventarioCiclico>;

// ── Entrada: ALTA ──────────────────────────────────────────────────────────────────────────────

/**
 * Alta de un inventario cíclico. El ALTA congela el teórico (D6): enumera los artículos con
 * existencia ≠ 0 del almacén, filtrando por uno o varios modelos (o TODO el almacén si `idsModelo`
 * va vacío/ausente).
 */
export const esquemaInventarioCiclicoCrear = z.object({
  idAlmacen: z.number().int().positive({ error: 'El almacén es obligatorio' }),
  idsModelo: z
    .array(z.number().int().positive())
    .max(500, { error: 'Demasiados modelos en el alcance' })
    .optional()
    .describe('Modelos a revisar; vacío/ausente = todo el almacén.'),
  observaciones: z.string().trim().max(300).optional(),
});

/** Datos validados del alta de un cíclico. */
export type DatosInventarioCiclicoCrear = z.infer<typeof esquemaInventarioCiclicoCrear>;

// ── Entrada: CONTEO ────────────────────────────────────────────────────────────────────────────

/** Un renglón capturado del conteo (cantidad física real, entera ≥ 0). */
export const esquemaConteoRenglonEntrada = z.object({
  idDet: z.number().int().positive(),
  cantReal: z
    .number({ error: 'La cantidad contada debe ser un número' })
    .int({ error: 'La cantidad contada debe ser entera' })
    .min(0, { error: 'La cantidad contada no puede ser negativa' }),
});

/** Captura de conteo (uno o varios renglones a la vez). */
export const esquemaInventarioCiclicoConteo = z.object({
  renglones: z.array(esquemaConteoRenglonEntrada).min(1, { error: 'Captura al menos un renglón' }),
});

/** Datos validados de captura de conteo. */
export type DatosInventarioCiclicoConteo = z.infer<typeof esquemaInventarioCiclicoConteo>;

// ── Entrada: CANCELAR ──────────────────────────────────────────────────────────────────────────

/** Cancelación (suave) de un cíclico con motivo (A7). */
export const esquemaInventarioCiclicoCancelar = z.object({
  motivo: z
    .string({ error: 'El motivo es obligatorio' })
    .trim()
    .min(3, { error: 'El motivo debe tener al menos 3 caracteres' })
    .max(300, { error: 'El motivo no puede tener más de 300 caracteres' }),
});

/** Datos validados de cancelación de cíclico. */
export type DatosInventarioCiclicoCancelar = z.infer<typeof esquemaInventarioCiclicoCancelar>;

// ── Salida: RESUMEN (encabezado + contadores; sin teórico) ───────────────────────────────────────

/** Resumen (encabezado) de un inventario cíclico: para el listado y la cabecera de las pantallas. */
export const esquemaInventarioCiclicoResumen = z
  .object({
    id: z.number().int(),
    folio: z.number().int(),
    idEmpresa: z.number().int(),
    idAlmacen: z.number().int(),
    almacen: z.string(),
    fecha: z.iso.date(),
    estado: esquemaEstadoInventarioCiclico,
    observaciones: z.string().nullable(),
    totalRenglones: z.number().int().describe('Artículos enumerados en el conteo.'),
    renglonesContados: z.number().int().describe('Artículos con conteo físico capturado.'),
    canceladoEn: z.iso.datetime().nullable(),
    motivoCancelacion: z.string().nullable(),
    creadoEn: z.iso.datetime(),
    creadoPorId: z.string().nullable(),
  })
  .describe('Encabezado de un inventario cíclico (sin el teórico — no filtra el conteo ciego).');

/** Forma del resumen de un cíclico. */
export type InventarioCiclicoResumen = z.infer<typeof esquemaInventarioCiclicoResumen>;

/** Filtros/paginación del listado de cíclicos. */
export const esquemaInventariosCiclicosQuery = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  estado: esquemaEstadoInventarioCiclico.optional(),
  idAlmacen: z.coerce.number().int().positive().optional(),
});

/** Parámetros del listado ya coaccionados. */
export type InventariosCiclicosQuery = z.infer<typeof esquemaInventariosCiclicosQuery>;

/** Página de cíclicos. */
export const esquemaInventariosCiclicosPagina = z.object({
  datos: z.array(esquemaInventarioCiclicoResumen),
  total: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  totalPaginas: z.number().int(),
});

/** Forma de la página de cíclicos. */
export type InventariosCiclicosPagina = z.infer<typeof esquemaInventariosCiclicosPagina>;

// ── Salida: CONTEO CIEGO (SIN teórico ni exactitud) ─────────────────────────────────────────────

/** Un renglón de la vista de CONTEO — CIEGO: el artículo y su cantidad real, NUNCA el teórico. */
export const esquemaConteoRenglon = z
  .object({
    idDet: z.number().int(),
    idModelo: z.number().int(),
    modelo: z.string(),
    idColor: z.number().int(),
    color: z.string(),
    idTalla: z.number().int(),
    etiquetaTalla: z.string(),
    ordenTalla: z.number().int(),
    idOrden: z.number().int().nullable(),
    folioOrden: z.number().int().nullable(),
    cantReal: z
      .number()
      .int()
      .nullable()
      .describe('Cantidad física capturada; null si no se ha contado.'),
    contado: z.boolean(),
  })
  .describe('Renglón de conteo ciego (sin cantTeorica).');

/** Vista de CONTEO de un cíclico (encabezado + renglones ciegos). */
export const esquemaConteoSalida = z
  .object({
    id: z.number().int(),
    folio: z.number().int(),
    idAlmacen: z.number().int(),
    almacen: z.string(),
    fecha: z.iso.date(),
    estado: esquemaEstadoInventarioCiclico,
    renglones: z.array(esquemaConteoRenglon),
  })
  .describe('Vista de captura de conteo — CIEGA (sin teórico, doc 05 §Almacén / D6).');

/** Forma de la vista de conteo. */
export type ConteoSalida = z.infer<typeof esquemaConteoSalida>;

// ── Salida: EXACTITUD (teórico vs real; permiso de consulta) ────────────────────────────────────

/** Un renglón de la vista de EXACTITUD: teórico, real, exactitud (=real−teórico) y su ajuste. */
export const esquemaExactitudRenglon = z
  .object({
    idDet: z.number().int(),
    idModelo: z.number().int(),
    modelo: z.string(),
    idColor: z.number().int(),
    color: z.string(),
    idTalla: z.number().int(),
    etiquetaTalla: z.string(),
    ordenTalla: z.number().int(),
    idOrden: z.number().int().nullable(),
    folioOrden: z.number().int().nullable(),
    cantTeorica: z.number().int(),
    cantReal: z.number().int().nullable(),
    exactitud: z
      .number()
      .int()
      .nullable()
      .describe('cantReal − cantTeorica; null si el renglón no se ha contado.'),
    idMovimientoAjuste: z.number().int().nullable(),
    folioMovimientoAjuste: z.number().int().nullable(),
  })
  .describe('Renglón de exactitud (teórico vs real).');

/** Totales agregados de la vista de exactitud. */
export const esquemaExactitudTotales = z.object({
  total: z.number().int().describe('Artículos enumerados.'),
  contados: z.number().int(),
  exactos: z.number().int().describe('Renglones contados con exactitud 0.'),
  diferencias: z.number().int().describe('Renglones contados con exactitud ≠ 0.'),
  teorico: z.number().int(),
  real: z.number().int().describe('Suma de cantReal (solo renglones contados).'),
});

/** Vista de EXACTITUD de un cíclico (encabezado + renglones con teórico + totales). */
export const esquemaExactitudSalida = z
  .object({
    id: z.number().int(),
    folio: z.number().int(),
    idEmpresa: z.number().int(),
    idAlmacen: z.number().int(),
    almacen: z.string(),
    fecha: z.iso.date(),
    estado: esquemaEstadoInventarioCiclico,
    observaciones: z.string().nullable(),
    canceladoEn: z.iso.datetime().nullable(),
    motivoCancelacion: z.string().nullable(),
    renglones: z.array(esquemaExactitudRenglon),
    totales: esquemaExactitudTotales,
  })
  .describe('Vista de exactitud + generación del ajuste (permiso de consulta).');

/** Forma de la vista de exactitud. */
export type ExactitudSalida = z.infer<typeof esquemaExactitudSalida>;
