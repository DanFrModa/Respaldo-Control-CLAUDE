import { z } from 'zod';

/**
 * Esquemas Zod del módulo CALIDAD — base configurable (F6-E1; doc
 * `09-Control-de-Calidad.md` §2/§5; DECISIONES.md §F6 (a)–(d)). Cubre el catálogo de defectos
 * enriquecido, los tipos de producto y el motor de planes de muestreo AQL (CRUD patrón Almacenes
 * + un GET de resolución lote+nivel → muestra/límites). Una sola definición de reglas para la UI
 * y el servidor (alimenta el OpenAPI). El núcleo transaccional de auditorías llega en F6-E2.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Compartido
// ─────────────────────────────────────────────────────────────────────────────

/** Severidad informativa del defecto (METADATO, NO veredicto — decisión (a)). */
export const SEVERIDADES_DEFECTO = ['critico', 'mayor', 'menor'] as const;

/** Clave de severidad de defecto. */
export type SeveridadDefectoClave = (typeof SEVERIDADES_DEFECTO)[number];

/** Etiquetas para UI de cada severidad. */
export const ETIQUETAS_SEVERIDAD_DEFECTO: Record<SeveridadDefectoClave, string> = {
  critico: 'Crítico',
  mayor: 'Mayor',
  menor: 'Menor',
};

/**
 * Niveles AQL admitidos en v2 (ISO 2859 nivel general II, doc 09 §5.2: la columna AQL del viejo
 * trae '1', '2.5' y '10' limpios). Se modelan como números: 1.0 / 2.5 / 10. Se exponen como lista
 * cerrada para que la UI ofrezca un selector y el resolver valide la entrada.
 */
export const NIVELES_AQL = [1, 2.5, 10] as const;

/** Clave de nivel AQL. */
export type NivelAqlClave = (typeof NIVELES_AQL)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de producto (catálogo nuevo — decisión (d))
// ─────────────────────────────────────────────────────────────────────────────

/** Alta de tipo de producto. */
export const esquemaTipoProductoCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
});

/** Datos validados de alta de tipo de producto. */
export type DatosTipoProductoCrear = z.infer<typeof esquemaTipoProductoCrear>;

/** Edición parcial de tipo de producto + `activo` para el borrado suave. */
export const esquemaTipoProductoEditar = esquemaTipoProductoCrear.partial().extend({
  id: z
    .number({ error: 'El id del tipo de producto es obligatorio' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de tipo de producto. */
export type DatosTipoProductoEditar = z.infer<typeof esquemaTipoProductoEditar>;

/** Salida de un tipo de producto en la API. */
export const esquemaTipoProductoSalida = z
  .object({
    id: z.number().int().describe('Id del tipo de producto.'),
    nombre: z.string().describe('Nombre del tipo de producto.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Tipo de producto (catálogo de clasificación de modelos para Calidad).');

/** Forma de un tipo de producto tal como lo devuelve la API. */
export type TipoProductoSalida = z.infer<typeof esquemaTipoProductoSalida>;

/** Filtros, orden y paginación del listado de tipos de producto (querystring). */
export const esquemaTiposProductoQuery = z
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
      .max(100)
      .optional()
      .describe('Texto a buscar en el nombre (insensible a mayúsculas).'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre').describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de tipos de producto.');

/** Parámetros de listado de tipos de producto ya coaccionados desde la URL. */
export type TiposProductoQuery = z.infer<typeof esquemaTiposProductoQuery>;

/** Respuesta paginada del listado de tipos de producto. */
export const esquemaTiposProductoPagina = z
  .object({
    datos: z.array(esquemaTipoProductoSalida).describe('Tipos de producto de la página.'),
    total: z.number().int().describe('Total que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de tipos de producto.');

/** Forma de la respuesta paginada de tipos de producto. */
export type TiposProductoPagina = z.infer<typeof esquemaTiposProductoPagina>;

// ─────────────────────────────────────────────────────────────────────────────
// Defectos (catálogo enriquecido — ex CC_Catalogo)
// ─────────────────────────────────────────────────────────────────────────────

/** Nivel AQL del defecto: uno de los niveles admitidos (1 / 2.5 / 10). */
const nivelAqlDefecto = z
  .number({ error: 'El nivel AQL es obligatorio' })
  .refine((v): v is NivelAqlClave => (NIVELES_AQL as readonly number[]).includes(v), {
    error: 'El nivel AQL debe ser 1, 2.5 o 10',
  });

/**
 * Alta de defecto. `tiposProducto` son los ids de tipo a los que aplica (M:N); si `aplicaGeneral`
 * es `true`, el defecto aplica a todos y `tiposProducto` se ignora (lo normaliza el dominio).
 */
export const esquemaDefectoCrear = z.object({
  clave: z
    .string({ error: 'La clave es obligatoria' })
    .trim()
    .min(1, { error: 'La clave es obligatoria' })
    .max(50, { error: 'La clave no puede tener más de 50 caracteres' }),
  descripcion: z
    .string({ error: 'La descripción es obligatoria' })
    .trim()
    .min(1, { error: 'La descripción es obligatoria' })
    .max(300, { error: 'La descripción no puede tener más de 300 caracteres' }),
  pag: z.string().trim().max(50).optional(),
  nivelAQL: nivelAqlDefecto.describe('Nivel AQL del defecto (1, 2.5 o 10).'),
  favorito: z.boolean().default(false).describe('Se pre-carga en toda auditoría nueva.'),
  categoria: z.string().trim().max(100).optional(),
  severidad: z
    .enum(SEVERIDADES_DEFECTO)
    .default('menor')
    .describe('Severidad informativa (NO entra en el veredicto).'),
  aplicaGeneral: z
    .boolean()
    .default(false)
    .describe('Si aplica a TODOS los tipos de producto (ignora las ligas).'),
  tiposProducto: z
    .array(z.number().int().positive())
    .default([])
    .describe('Ids de los tipos de producto a los que aplica (vacío si aplicaGeneral).'),
});

/** Datos validados de alta de defecto. */
export type DatosDefectoCrear = z.infer<typeof esquemaDefectoCrear>;

/** Edición parcial de defecto + `activo` para el borrado suave. */
export const esquemaDefectoEditar = esquemaDefectoCrear.partial().extend({
  id: z
    .number({ error: 'El id del defecto es obligatorio' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de defecto. */
export type DatosDefectoEditar = z.infer<typeof esquemaDefectoEditar>;

/** Tipo de producto ligado a un defecto (forma reducida en la salida del defecto). */
export const esquemaDefectoTipoSalida = z
  .object({
    id: z.number().int().describe('Id del tipo de producto.'),
    nombre: z.string().describe('Nombre del tipo de producto.'),
  })
  .describe('Tipo de producto ligado a un defecto.');

/** Salida de un defecto en la API (incluye sus tipos de producto ligados). */
export const esquemaDefectoSalida = z
  .object({
    id: z.number().int().describe('Id del defecto.'),
    clave: z.string().describe('Clave de negocio del defecto.'),
    descripcion: z.string().describe('Descripción del defecto.'),
    pag: z.string().nullable().describe('Página/referencia del manual de calidad.'),
    nivelAQL: z.number().describe('Nivel AQL del defecto (1 / 2.5 / 10).'),
    favorito: z.boolean().describe('Si se pre-carga en toda auditoría nueva.'),
    categoria: z.string().nullable().describe('Categoría libre para agrupar.'),
    severidad: z.enum(SEVERIDADES_DEFECTO).describe('Severidad informativa.'),
    aplicaGeneral: z.boolean().describe('Si aplica a todos los tipos de producto.'),
    tiposProducto: z
      .array(esquemaDefectoTipoSalida)
      .describe('Tipos de producto ligados (vacío si aplicaGeneral).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Defecto del catálogo de calidad.');

/** Forma de un defecto tal como lo devuelve la API. */
export type DefectoSalida = z.infer<typeof esquemaDefectoSalida>;

/** Filtros, orden y paginación del listado de defectos (querystring). */
export const esquemaDefectosQuery = z
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
      .max(100)
      .optional()
      .describe('Texto a buscar en la clave o descripción (insensible a mayúsculas).'),
    nivelAQL: z.coerce.number().optional().describe('Filtra por nivel AQL (1 / 2.5 / 10).'),
    severidad: z.enum(SEVERIDADES_DEFECTO).optional().describe('Filtra por severidad.'),
    soloFavoritos: z.stringbool().default(false).describe('Solo los favoritos ("true"/"false").'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    ordenarPor: z
      .enum(['clave', 'descripcion', 'nivelAQL', 'creadoEn'])
      .default('clave')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de defectos.');

/** Parámetros de listado de defectos ya coaccionados desde la URL. */
export type DefectosQuery = z.infer<typeof esquemaDefectosQuery>;

/** Respuesta paginada del listado de defectos. */
export const esquemaDefectosPagina = z
  .object({
    datos: z.array(esquemaDefectoSalida).describe('Defectos de la página.'),
    total: z.number().int().describe('Total que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de defectos.');

/** Forma de la respuesta paginada de defectos. */
export type DefectosPagina = z.infer<typeof esquemaDefectosPagina>;

// ─────────────────────────────────────────────────────────────────────────────
// Planes de muestreo AQL (motor como datos)
// ─────────────────────────────────────────────────────────────────────────────

/** Límite acepta/rechaza de un renglón POR NIVEL AQL (entrada). */
export const esquemaPlanLimiteEntrada = z.object({
  nivelAQL: nivelAqlDefecto.describe('Nivel AQL al que aplica el límite (1 / 2.5 / 10).'),
  aceptar: z
    .number({ error: 'El número de aceptación es obligatorio' })
    .int({ error: 'Debe ser entero' })
    .min(0, { error: 'No puede ser negativo' }),
  rechazar: z
    .number({ error: 'El número de rechazo es obligatorio' })
    .int({ error: 'Debe ser entero' })
    .min(1, { error: 'Debe ser al menos 1' }),
});

/** Renglón del plan por rango de tamaño de lote → muestra + límites por nivel (entrada). */
export const esquemaPlanRenglonEntrada = z.object({
  loteMin: z
    .number({ error: 'El lote mínimo es obligatorio' })
    .int({ error: 'Debe ser entero' })
    .min(1, { error: 'El lote mínimo debe ser al menos 1' }),
  loteMax: z
    .number()
    .int({ error: 'Debe ser entero' })
    .min(1, { error: 'El lote máximo debe ser al menos 1' })
    .nullable()
    .describe('Lote máximo (inclusivo); null = sin tope (último rango abierto).'),
  tamanoMuestra: z
    .number({ error: 'El tamaño de muestra es obligatorio' })
    .int({ error: 'Debe ser entero' })
    .min(1, { error: 'El tamaño de muestra debe ser al menos 1' }),
  limites: z
    .array(esquemaPlanLimiteEntrada)
    .min(1, { error: 'Cada renglón necesita al menos un límite por nivel' })
    .describe('Límites acepta/rechaza por nivel AQL de este renglón.'),
});

/** Alta de plan AQL con sus renglones. */
export const esquemaPlanAqlCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  renglones: z
    .array(esquemaPlanRenglonEntrada)
    .min(1, { error: 'El plan necesita al menos un renglón' })
    .describe('Renglones por rango de tamaño de lote.'),
});

/** Datos validados de alta de plan AQL. */
export type DatosPlanAqlCrear = z.infer<typeof esquemaPlanAqlCrear>;

/**
 * Edición de plan AQL: nombre y/o renglones (si vienen `renglones`, REEMPLAZAN el set completo,
 * patrón "rewrite del BOM" en transacción) + `activo` para el borrado suave.
 */
export const esquemaPlanAqlEditar = z.object({
  id: z
    .number({ error: 'El id del plan es obligatorio' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' }),
  nombre: z.string().trim().min(1).max(100).optional(),
  renglones: z.array(esquemaPlanRenglonEntrada).min(1).optional(),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de plan AQL. */
export type DatosPlanAqlEditar = z.infer<typeof esquemaPlanAqlEditar>;

/** Límite de salida (acepta/rechaza por nivel). */
export const esquemaPlanLimiteSalida = z
  .object({
    nivelAQL: z.number().describe('Nivel AQL del límite (1 / 2.5 / 10).'),
    aceptar: z.number().int().describe('Número de aceptación (Ac).'),
    rechazar: z.number().int().describe('Número de rechazo (Re).'),
  })
  .describe('Límite acepta/rechaza por nivel AQL.');

/** Renglón de salida (rango de lote → muestra + límites). */
export const esquemaPlanRenglonSalida = z
  .object({
    id: z.number().int().describe('Id del renglón.'),
    loteMin: z.number().int().describe('Lote mínimo del rango (inclusivo).'),
    loteMax: z.number().int().nullable().describe('Lote máximo (inclusivo) o null (sin tope).'),
    tamanoMuestra: z.number().int().describe('Tamaño de muestra del rango.'),
    limites: z.array(esquemaPlanLimiteSalida).describe('Límites por nivel AQL.'),
  })
  .describe('Renglón del plan por rango de tamaño de lote.');

/** Salida de un plan AQL con sus renglones. */
export const esquemaPlanAqlSalida = z
  .object({
    id: z.number().int().describe('Id del plan.'),
    nombre: z.string().describe('Nombre del plan.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    renglones: z
      .array(esquemaPlanRenglonSalida)
      .describe('Renglones del plan, ordenados por lote.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Plan de muestreo AQL con sus renglones.');

/** Forma de un plan AQL tal como lo devuelve la API. */
export type PlanAqlSalida = z.infer<typeof esquemaPlanAqlSalida>;

/** Filtros y paginación del listado de planes AQL (querystring). */
export const esquemaPlanesAqlQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    busqueda: z.string().trim().max(100).optional().describe('Texto a buscar en el nombre.'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre').describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de planes AQL.');

/** Parámetros de listado de planes AQL ya coaccionados desde la URL. */
export type PlanesAqlQuery = z.infer<typeof esquemaPlanesAqlQuery>;

/** Respuesta paginada del listado de planes AQL. */
export const esquemaPlanesAqlPagina = z
  .object({
    datos: z.array(esquemaPlanAqlSalida).describe('Planes AQL de la página.'),
    total: z.number().int().describe('Total que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de planes AQL.');

/** Forma de la respuesta paginada de planes AQL. */
export type PlanesAqlPagina = z.infer<typeof esquemaPlanesAqlPagina>;

// ─────────────────────────────────────────────────────────────────────────────
// Resolución / preview del plan (lote + nivel → muestra/límites)
// ─────────────────────────────────────────────────────────────────────────────

/** Parámetros del GET de resolución/preview del plan (querystring). */
export const esquemaResolverPlanQuery = z
  .object({
    tamanoLote: z.coerce
      .number({ error: 'El tamaño del lote es obligatorio' })
      .int({ error: 'Debe ser entero' })
      .min(1, { error: 'El tamaño del lote debe ser al menos 1' })
      .describe('Tamaño del lote a inspeccionar.'),
    nivelAQL: z.coerce
      .number({ error: 'El nivel AQL es obligatorio' })
      .refine((v) => (NIVELES_AQL as readonly number[]).includes(v), {
        error: 'El nivel AQL debe ser 1, 2.5 o 10',
      })
      .describe('Nivel AQL a consultar (1 / 2.5 / 10).'),
  })
  .describe('Parámetros de resolución del plan AQL.');

/** Parámetros de resolución ya coaccionados desde la URL. */
export type ResolverPlanQuery = z.infer<typeof esquemaResolverPlanQuery>;

/** Resultado de la resolución del plan (muestra + límite del nivel pedido). */
export const esquemaResolverPlanSalida = z
  .object({
    idPlan: z.number().int().describe('Id del plan default activo usado para resolver.'),
    nombrePlan: z.string().describe('Nombre del plan default activo.'),
    tamanoLote: z.number().int().describe('Tamaño del lote consultado.'),
    nivelAQL: z.number().describe('Nivel AQL consultado.'),
    tamanoMuestra: z.number().int().describe('Tamaño de muestra del renglón que cubre el lote.'),
    aceptar: z.number().int().describe('Número de aceptación (Ac) del nivel para ese renglón.'),
    rechazar: z.number().int().describe('Número de rechazo (Re) del nivel para ese renglón.'),
  })
  .describe('Muestra y límites resueltos del plan AQL default para (lote, nivel).');

/** Forma del resultado de resolución del plan. */
export type ResolverPlanSalida = z.infer<typeof esquemaResolverPlanSalida>;
