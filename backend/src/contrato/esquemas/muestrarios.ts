import { z } from 'zod';

/**
 * Esquemas Zod de MUESTRARIOS PENDIENTES (Módulo Indicadores, F7-E4; doc `05-Indicadores.md` §A.3;
 * ← `IP_MuesPend`). Seguimiento de boards y muestras: solicitud → seguimiento → entrega, con KPI de
 * cumplimiento (`fechaEntregado <= fechaRequerida`). Cancelación suave con motivo (A7). A9 por empresa.
 *
 * Una sola definición para UI y servidor (OpenAPI). La lógica vive en `dominio/indicadores/muestrarios.ts` (A1).
 */

/** Alta (solicitud) de un muestrario. */
export const esquemaMuestrarioCrear = z.object({
  idCliente: z.number().int().positive({ error: 'El cliente es obligatorio' }),
  categoria: z
    .string()
    .trim()
    .max(120, { error: 'La categoría no puede tener más de 120 caracteres' })
    .optional(),
  idTemporada: z.number().int().positive().optional(),
  cantBoards: z
    .number({ error: 'La cantidad de boards debe ser un número' })
    .int()
    .min(0, { error: 'No puede ser negativa' })
    .default(0),
  cantMuestras: z
    .number({ error: 'La cantidad de muestras debe ser un número' })
    .int()
    .min(0, { error: 'No puede ser negativa' })
    .default(0),
  fechaSolicitado: z.iso
    .date()
    .optional()
    .describe('Fecha de solicitud (default hoy; libre con permiso).'),
  fechaRequerida: z.iso.date({ error: 'La fecha requerida es obligatoria (AAAA-MM-DD)' }),
});

/** Datos validados de alta de muestrario. */
export type DatosMuestrarioCrear = z.infer<typeof esquemaMuestrarioCrear>;

/** Edición de seguimiento (parcial). `id` va en la URL. NO cambia el estado de entrega/cancelación. */
export const esquemaMuestrarioEditar = z.object({
  idCliente: z.number().int().positive().optional(),
  categoria: z.string().trim().max(120).optional(),
  idTemporada: z.number().int().positive().nullable().optional(),
  cantBoards: z.number().int().min(0).optional(),
  cantMuestras: z.number().int().min(0).optional(),
  fechaRequerida: z.iso.date().optional(),
  boardsOK: z.number().int().min(0).optional(),
  muestrasOK: z.number().int().min(0).optional(),
});

/** Datos validados de edición de muestrario. */
export type DatosMuestrarioEditar = z.infer<typeof esquemaMuestrarioEditar>;

/** Registro de la ENTREGA de un muestrario (cierra el seguimiento). */
export const esquemaMuestrarioEntregar = z.object({
  fechaEntregado: z.iso
    .date()
    .optional()
    .describe('Fecha de entrega (default hoy; libre con permiso).'),
  boardsOK: z.number().int().min(0, { error: 'No puede ser negativa' }).optional(),
  muestrasOK: z.number().int().min(0, { error: 'No puede ser negativa' }).optional(),
});

/** Datos validados de entrega de muestrario. */
export type DatosMuestrarioEntregar = z.infer<typeof esquemaMuestrarioEntregar>;

/** Cancelación (suave) de un muestrario con motivo. */
export const esquemaMuestrarioCancelar = z.object({
  motivo: z
    .string({ error: 'El motivo es obligatorio' })
    .trim()
    .min(3, { error: 'El motivo debe tener al menos 3 caracteres' })
    .max(300, { error: 'El motivo no puede tener más de 300 caracteres' }),
});

/** Datos validados de cancelación de muestrario. */
export type DatosMuestrarioCancelar = z.infer<typeof esquemaMuestrarioCancelar>;

/** Estado derivado de un muestrario. */
export const esquemaEstadoMuestrario = z
  .enum(['pendiente', 'entregado', 'cancelado'])
  .describe('Estado derivado: pendiente / entregado / cancelado.');

/** Valor del estado derivado de un muestrario. */
export type EstadoMuestrarioValor = z.infer<typeof esquemaEstadoMuestrario>;

/** Salida de un muestrario. */
export const esquemaMuestrarioSalida = z
  .object({
    id: z.number().int(),
    idEmpresa: z.number().int(),
    idCliente: z.number().int(),
    cliente: z.string(),
    categoria: z.string().nullable(),
    idTemporada: z.number().int().nullable(),
    temporada: z.string().nullable(),
    cantBoards: z.number().int(),
    cantMuestras: z.number().int(),
    fechaSolicitado: z.iso.date(),
    fechaRequerida: z.iso.date(),
    fechaEntregado: z.iso.date().nullable(),
    boardsOK: z.number().int(),
    muestrasOK: z.number().int(),
    solicitanteId: z.string().nullable(),
    estado: esquemaEstadoMuestrario,
    aTiempo: z
      .boolean()
      .nullable()
      .describe('Entregado a tiempo (fechaEntregado ≤ fechaRequerida); null si no entregado.'),
    cancelado: z.boolean(),
    motivoCancelacion: z.string().nullable(),
    creadoEn: z.iso.datetime(),
    creadoPorId: z.string().nullable(),
  })
  .describe('Muestrario pendiente (con estado y cumplimiento derivados).');

/** Forma de un muestrario tal como lo devuelve la API. */
export type MuestrarioSalida = z.infer<typeof esquemaMuestrarioSalida>;

/** Filtros/paginación del listado de muestrarios. */
export const esquemaMuestrariosQuery = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  estado: esquemaEstadoMuestrario.optional().describe('Filtra por estado derivado.'),
  idCliente: z.coerce.number().int().positive().optional(),
  desde: z.iso.date().optional().describe('Fecha requerida desde (inclusive).'),
  hasta: z.iso.date().optional().describe('Fecha requerida hasta (inclusive).'),
});

/** Parámetros de listado de muestrarios ya coaccionados. */
export type MuestrariosQuery = z.infer<typeof esquemaMuestrariosQuery>;

/** Página de muestrarios. */
export const esquemaMuestrariosPagina = z.object({
  datos: z.array(esquemaMuestrarioSalida),
  total: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  totalPaginas: z.number().int(),
});

/** Forma de la página de muestrarios. */
export type MuestrariosPagina = z.infer<typeof esquemaMuestrariosPagina>;

// ── KPI de cumplimiento ──────────────────────────────────────────────────────────────────────────

/** Filtros del KPI de cumplimiento de muestrarios. */
export const esquemaMuestrariosCumplimientoQuery = z.object({
  desde: z.iso.date().optional(),
  hasta: z.iso.date().optional(),
  idCliente: z.coerce.number().int().positive().optional(),
});

/** Parámetros del KPI ya coaccionados. */
export type MuestrariosCumplimientoQuery = z.infer<typeof esquemaMuestrariosCumplimientoQuery>;

/** KPI de cumplimiento de muestrarios (agregado). */
export const esquemaMuestrariosCumplimiento = z
  .object({
    total: z.number().int().describe('Muestrarios vivos (no cancelados) que cumplen el filtro.'),
    pendientes: z.number().int(),
    entregados: z.number().int(),
    aTiempo: z.number().int().describe('Entregados con fechaEntregado ≤ fechaRequerida.'),
    tarde: z.number().int().describe('Entregados fuera de tiempo.'),
    porcentaje: z
      .number()
      .nullable()
      .describe('aTiempo ÷ entregados (fracción) o null si 0 entregados.'),
  })
  .describe('KPI de cumplimiento de muestrarios.');

/** Forma del KPI de cumplimiento. */
export type MuestrariosCumplimiento = z.infer<typeof esquemaMuestrariosCumplimiento>;
