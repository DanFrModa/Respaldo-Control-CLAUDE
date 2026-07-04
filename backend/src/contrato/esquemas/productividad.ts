import { z } from 'zod';

/**
 * Esquemas Zod del MOTOR DE PRODUCTIVIDAD unificado IP/Almacén (Módulo Indicadores, F7-E4; doc
 * `05-Indicadores.md` §A.1 / §B.1; MEJORAS 05 §1 "motor de productividad configurable por área"; A6).
 *
 * Una sola definición de reglas para UI y servidor (alimenta el OpenAPI). Toda la lógica —en
 * especial las DOS fórmulas de índice y la agregación del tablero— vive en
 * `dominio/indicadores/productividad.ts` (A1); aquí solo las FORMAS.
 *
 * Se despivota el patrón repetido del viejo (IP_* y Alm_Prd_*) a tres entidades distinguidas por
 * `area` (ip/almacen): personas, actividades (con estándares por área) y registros diarios.
 */

/** Área de un dato de productividad. Unifica los dos módulos gemelos del viejo (IP y Almacén). */
export const esquemaAreaProductividad = z
  .enum(['ip', 'almacen'])
  .describe('Área: "ip" (Ingeniería del Producto) o "almacen".');

// ── Personal del área (← IP_Personal) ───────────────────────────────────────────────────────────

/** Alta de una persona del área. `horasBase` solo aplica a IP (índice de IP); en almacén es opcional. */
export const esquemaPersonalCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(120, { error: 'El nombre no puede tener más de 120 caracteres' }),
  area: esquemaAreaProductividad,
  horasBase: z
    .number({ error: 'Las horas base deben ser un número' })
    .positive({ error: 'Las horas base deben ser mayores a cero' })
    .max(24, { error: 'Las horas base no pueden exceder 24' })
    .optional()
    .describe('Jornada base (horas/día) para el índice de IP. Solo IP.'),
  puesto: z
    .string()
    .trim()
    .max(120, { error: 'El puesto no puede tener más de 120 caracteres' })
    .optional(),
});

/** Datos validados de alta de personal. */
export type DatosPersonalCrear = z.infer<typeof esquemaPersonalCrear>;

/** Edición parcial de personal + `activo` (borrado suave). `id` va en la URL. */
export const esquemaPersonalEditar = esquemaPersonalCrear.partial().extend({
  id: z.number().int().positive({ error: 'El id debe ser positivo' }),
  activo: z.boolean().optional(),
});

/** Datos validados de edición de personal. */
export type DatosPersonalEditar = z.infer<typeof esquemaPersonalEditar>;

/** Salida de una persona del área. */
export const esquemaPersonalSalida = z
  .object({
    id: z.number().int(),
    nombre: z.string(),
    area: esquemaAreaProductividad,
    horasBase: z.number().nullable().describe('Jornada base (horas/día) o null.'),
    puesto: z.string().nullable(),
    activo: z.boolean(),
    creadoEn: z.iso.datetime(),
    creadoPorId: z.string().nullable(),
    modificadoEn: z.iso.datetime(),
    modificadoPorId: z.string().nullable(),
  })
  .describe('Persona del área de productividad (catálogo global).');

/** Forma de una persona tal como la devuelve la API. */
export type PersonalSalida = z.infer<typeof esquemaPersonalSalida>;

/** Filtros/orden/paginación del listado de personal. */
export const esquemaPersonalQuery = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  busqueda: z.string().trim().max(120).optional(),
  area: esquemaAreaProductividad.optional().describe('Filtra por área.'),
  incluirInactivos: z.stringbool().default(false),
  ordenarPor: z.enum(['nombre', 'area', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros de listado de personal ya coaccionados. */
export type PersonalQuery = z.infer<typeof esquemaPersonalQuery>;

/** Página de personal. */
export const esquemaPersonalPagina = z.object({
  datos: z.array(esquemaPersonalSalida),
  total: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  totalPaginas: z.number().int(),
});

/** Forma de la página de personal. */
export type PersonalPagina = z.infer<typeof esquemaPersonalPagina>;

// ── Actividades (← IP_Actividades + Alm_Prd_Act) ─────────────────────────────────────────────────

/**
 * Alta de una actividad. Los estándares que no aplican al área quedan sin valor: IP usa
 * `porcentajeD`; almacén usa `pzPersDia` (+ `porcenPzas`). El dominio ignora los que no correspondan
 * al `area` y exige el que sí (IP → porcentajeD; almacén → pzPersDia > 0).
 */
export const esquemaActividadCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(120, { error: 'El nombre no puede tener más de 120 caracteres' }),
  area: esquemaAreaProductividad,
  porcentajeD: z
    .number({ error: 'El peso debe ser un número' })
    .nonnegative({ error: 'El peso no puede ser negativo' })
    .optional()
    .describe('Peso/estándar de la actividad de IP (solo IP).'),
  pzPersDia: z
    .number({ error: 'El estándar debe ser un número' })
    .positive({ error: 'El estándar de piezas/persona/día debe ser mayor a cero' })
    .optional()
    .describe('Estándar piezas/persona/día del almacén (solo almacén; > 0).'),
  porcenPzas: z
    .number({ error: 'El peso de piezas debe ser un número' })
    .nonnegative({ error: 'El peso de piezas no puede ser negativo' })
    .optional()
    .describe('Peso de piezas de la actividad de almacén (solo almacén).'),
});

/** Datos validados de alta de actividad. */
export type DatosActividadCrear = z.infer<typeof esquemaActividadCrear>;

/** Edición parcial de actividad + `activo`. */
export const esquemaActividadEditar = esquemaActividadCrear.partial().extend({
  id: z.number().int().positive({ error: 'El id debe ser positivo' }),
  activo: z.boolean().optional(),
});

/** Datos validados de edición de actividad. */
export type DatosActividadEditar = z.infer<typeof esquemaActividadEditar>;

/** Salida de una actividad. */
export const esquemaActividadSalida = z
  .object({
    id: z.number().int(),
    nombre: z.string(),
    area: esquemaAreaProductividad,
    porcentajeD: z.number().nullable(),
    pzPersDia: z.number().nullable(),
    porcenPzas: z.number().nullable(),
    activo: z.boolean(),
    creadoEn: z.iso.datetime(),
    creadoPorId: z.string().nullable(),
    modificadoEn: z.iso.datetime(),
    modificadoPorId: z.string().nullable(),
  })
  .describe('Actividad productiva (catálogo global por área).');

/** Forma de una actividad tal como la devuelve la API. */
export type ActividadSalida = z.infer<typeof esquemaActividadSalida>;

/** Filtros/orden/paginación del listado de actividades. */
export const esquemaActividadQuery = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  busqueda: z.string().trim().max(120).optional(),
  area: esquemaAreaProductividad.optional(),
  incluirInactivos: z.stringbool().default(false),
  ordenarPor: z.enum(['nombre', 'area', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros de listado de actividades ya coaccionados. */
export type ActividadQuery = z.infer<typeof esquemaActividadQuery>;

/** Página de actividades. */
export const esquemaActividadPagina = z.object({
  datos: z.array(esquemaActividadSalida),
  total: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  totalPaginas: z.number().int(),
});

/** Forma de la página de actividades. */
export type ActividadPagina = z.infer<typeof esquemaActividadPagina>;

// ── Registros diarios (← IP_Productiv + Alm_Prd/Alm_Prd_Det) ─────────────────────────────────────

/**
 * Alta de un registro de productividad. El `area` la determina la actividad (el dominio la sella).
 * IP: exige `idPersona`. Almacén: usa `personas` (cuadrilla) y opcionalmente `idCliente`.
 * La `fecha` fuera de los últimos 7 días (atajos Hoy/Ayer/Sábado) exige `indicadores.fecha-libre`.
 */
export const esquemaRegistroProductividadCrear = z.object({
  fecha: z.iso.date({ error: 'La fecha es obligatoria (AAAA-MM-DD)' }),
  idActividad: z.number().int().positive({ error: 'La actividad es obligatoria' }),
  idPersona: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Persona (obligatoria en IP; ignorada en almacén).'),
  cantidad: z
    .number({ error: 'La cantidad es obligatoria' })
    .nonnegative({ error: 'La cantidad no puede ser negativa' }),
  horasTrabajadas: z
    .number({ error: 'Las horas trabajadas son obligatorias' })
    .positive({ error: 'Las horas trabajadas deben ser mayores a cero' })
    .max(24, { error: 'Las horas trabajadas no pueden exceder 24' }),
  personas: z
    .number()
    .int()
    .positive({ error: 'Las personas deben ser mayores a cero' })
    .default(1)
    .describe('Cuadrilla (almacén). IP = 1.'),
  idCliente: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Cliente atendido (solo almacén, opcional).'),
});

/** Datos validados de alta de registro. */
export type DatosRegistroProductividadCrear = z.infer<typeof esquemaRegistroProductividadCrear>;

/** Cancelación (suave) de un registro con motivo. */
export const esquemaRegistroProductividadCancelar = z.object({
  motivo: z
    .string({ error: 'El motivo es obligatorio' })
    .trim()
    .min(3, { error: 'El motivo debe tener al menos 3 caracteres' })
    .max(300, { error: 'El motivo no puede tener más de 300 caracteres' }),
});

/** Datos validados de cancelación de registro. */
export type DatosRegistroProductividadCancelar = z.infer<
  typeof esquemaRegistroProductividadCancelar
>;

/** Salida de un registro de productividad (con el índice ya calculado por el dominio). */
export const esquemaRegistroProductividadSalida = z
  .object({
    id: z.number().int(),
    idEmpresa: z.number().int(),
    fecha: z.iso.date(),
    area: esquemaAreaProductividad,
    idActividad: z.number().int(),
    actividad: z.string().describe('Nombre de la actividad.'),
    idPersona: z.number().int().nullable(),
    persona: z.string().nullable().describe('Nombre de la persona (IP) o null.'),
    cantidad: z.number(),
    horasTrabajadas: z.number(),
    personas: z.number().int(),
    idCliente: z.number().int().nullable(),
    cliente: z.string().nullable().describe('Nombre del cliente (almacén) o null.'),
    indice: z
      .number()
      .nullable()
      .describe('Índice de productividad real del registro (fórmula por área) o null.'),
    porcentajeTrabajado: z
      .number()
      .nullable()
      .describe('horasTrabajadas ÷ jornada base (fracción) o null.'),
    cancelado: z.boolean(),
    motivoCancelacion: z.string().nullable(),
    creadoEn: z.iso.datetime(),
    creadoPorId: z.string().nullable(),
  })
  .describe('Registro de productividad (con índice calculado).');

/** Forma de un registro tal como lo devuelve la API. */
export type RegistroProductividadSalida = z.infer<typeof esquemaRegistroProductividadSalida>;

/** Filtros/paginación del listado de registros. */
export const esquemaRegistroProductividadQuery = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  area: esquemaAreaProductividad.optional(),
  idActividad: z.coerce.number().int().positive().optional(),
  idPersona: z.coerce.number().int().positive().optional(),
  idCliente: z.coerce.number().int().positive().optional(),
  desde: z.iso.date().optional().describe('Fecha desde (inclusive).'),
  hasta: z.iso.date().optional().describe('Fecha hasta (inclusive).'),
  incluirCancelados: z.stringbool().default(false),
});

/** Parámetros de listado de registros ya coaccionados. */
export type RegistroProductividadQuery = z.infer<typeof esquemaRegistroProductividadQuery>;

/** Página de registros. */
export const esquemaRegistroProductividadPagina = z.object({
  datos: z.array(esquemaRegistroProductividadSalida),
  total: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  totalPaginas: z.number().int(),
});

/** Forma de la página de registros. */
export type RegistroProductividadPagina = z.infer<typeof esquemaRegistroProductividadPagina>;

// ── Tablero de productividad vs estándar (agregación en servidor) ────────────────────────────────

/** Cómo agrupar el tablero: por día, por semana ISO o por mes. */
export const esquemaAgrupacionTablero = z
  .enum(['dia', 'semana', 'mes'])
  .describe('Agrupación temporal del tablero.');

/** Filtros del tablero de productividad. */
export const esquemaTableroProductividadQuery = z
  .object({
    area: esquemaAreaProductividad.describe('Área del tablero (obligatoria).'),
    agrupacion: esquemaAgrupacionTablero.default('semana'),
    desde: z.iso.date().optional().describe('Fecha desde (inclusive).'),
    hasta: z.iso.date().optional().describe('Fecha hasta (inclusive).'),
    idActividad: z.coerce.number().int().positive().optional(),
    idPersona: z.coerce.number().int().positive().optional(),
    idCliente: z.coerce.number().int().positive().optional(),
  })
  .describe('Filtros del tablero de productividad vs estándar.');

/** Filtros del tablero ya coaccionados. */
export type TableroProductividadQuery = z.infer<typeof esquemaTableroProductividadQuery>;

/**
 * Renglón del tablero: un grupo (periodo × actividad × persona). El índice se AGREGA en el
 * servidor de los registros diarios reales (NO las heurísticas /5, /30 del viejo).
 */
const esquemaTableroFila = z.object({
  periodo: z.string().describe('Etiqueta del periodo (AAAA-MM-DD, AAAA-Www o AAAA-MM).'),
  anio: z.number().int(),
  periodoNum: z.number().int().describe('Nº de día del año / semana ISO / mes, para ordenar.'),
  area: esquemaAreaProductividad,
  idActividad: z.number().int(),
  actividad: z.string(),
  idPersona: z.number().int().nullable(),
  persona: z.string().nullable(),
  numRegistros: z.number().int(),
  cantidad: z.number().describe('Σ cantidad del grupo.'),
  horasTrabajadas: z.number().describe('Σ horas trabajadas del grupo.'),
  indiceTotal: z.number().describe('Σ de los índices diarios (unidades logradas vs estándar).'),
  indicePromedio: z.number().describe('Promedio de los índices diarios del grupo.'),
  porcentajeTrabajado: z
    .number()
    .nullable()
    .describe('Σ horas trabajadas ÷ Σ jornada base (fracción de utilización) o null.'),
  estandar: z
    .number()
    .nullable()
    .describe('Estándar de la actividad (porcentajeD en IP, pzPersDia en almacén) o null.'),
});

/** Respuesta del tablero de productividad. */
export const esquemaTableroProductividad = z
  .object({
    area: esquemaAreaProductividad,
    agrupacion: esquemaAgrupacionTablero,
    filas: z.array(esquemaTableroFila),
  })
  .describe('Tablero de productividad vs estándar (agregado en servidor).');

/** Forma del tablero de productividad. */
export type TableroProductividad = z.infer<typeof esquemaTableroProductividad>;
