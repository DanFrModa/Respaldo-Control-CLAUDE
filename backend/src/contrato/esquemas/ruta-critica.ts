import { z } from 'zod';

/**
 * Esquemas Zod del CATÁLOGO CONFIGURABLE de la Ruta Crítica (Módulo 8, F5-E1; doc
 * `08-Ruta-Critica.md`; D10/D11). Es el "corazón configurable": procesos como DATOS
 * (`ProcesoDef`), sus roles responsables N:M (sobre el RBAC único, A4), las dependencias
 * (DAG, con rechazo de ciclos en el dominio) y los checklists configurables.
 *
 * Una sola definición de reglas de captura para UI y servidor (alimenta el OpenAPI). El MOTOR
 * (instancias por orden, fechas/semáforos) y las plantillas llegan en E2+; aquí solo el catálogo.
 */

// ── Enums tipados (espejo de los enums de Prisma) ────────────────────────────

/** ¿Bajo qué condición aplica un proceso a una orden? (TIPADO, no motor de expresiones). */
export const CONDICIONES_APLICABILIDAD = ['ninguna', 'soloSiLlevaAplicacion'] as const;
/** Clave de condición de aplicabilidad. */
export type CondicionAplicabilidadClave = (typeof CONDICIONES_APLICABILIDAD)[number];
/** Etiquetas para UI de cada condición de aplicabilidad. */
export const ETIQUETAS_CONDICION_APLICABILIDAD: Record<CondicionAplicabilidadClave, string> = {
  ninguna: 'Siempre aplica',
  soloSiLlevaAplicacion: 'Solo si la orden lleva aplicación/estampado',
};

/** Tipo de evento de negocio que representa un proceso (gancho con los hechos de v2). */
export const TIPOS_EVENTO_PROCESO = [
  'recepcionTela',
  'corte',
  'envioCostura',
  'reciboCostura',
  'envioEstampado',
  'reciboEstampado',
  'auditoria',
  'autorizacionArte',
  'entregaCliente',
  'manual',
] as const;
/** Clave de tipo de evento de proceso. */
export type TipoEventoProcesoClave = (typeof TIPOS_EVENTO_PROCESO)[number];
/** Etiquetas para UI de cada tipo de evento. */
export const ETIQUETAS_TIPO_EVENTO_PROCESO: Record<TipoEventoProcesoClave, string> = {
  recepcionTela: 'Recepción de tela',
  corte: 'Corte',
  envioCostura: 'Envío a costura',
  reciboCostura: 'Recibo de costura',
  envioEstampado: 'Envío a estampado',
  reciboEstampado: 'Recibo de estampado',
  auditoria: 'Auditoría de calidad',
  autorizacionArte: 'Autorización de arte',
  entregaCliente: 'Entrega a cliente',
  manual: 'Manual (sin evento del sistema)',
};

/** Cómo se calcula la duración estimada de un proceso (TIPADO; la fórmula vive en el motor). */
export const TIPOS_DURACION_PROCESO = [
  'fija',
  'porCantidad',
  'porTipoTela',
  'porAplicacion',
  'porDificultad',
] as const;
/** Clave de tipo de duración. */
export type TipoDuracionProcesoClave = (typeof TIPOS_DURACION_PROCESO)[number];
/** Etiquetas para UI de cada tipo de duración. */
export const ETIQUETAS_TIPO_DURACION_PROCESO: Record<TipoDuracionProcesoClave, string> = {
  fija: 'Duración fija (días)',
  porCantidad: 'Escala con la cantidad de piezas',
  porTipoTela: 'Según el tipo de tela',
  porAplicacion: 'Según la aplicación',
  porDificultad: 'Por dificultad (# de operaciones del modelo)',
};

// ── Campos base ──────────────────────────────────────────────────────────────

/** `codigo` estable kebab-case (minúsculas, dígitos y guiones): clave de negocio del proceso. */
const codigoProceso = z
  .string({ error: 'El código es obligatorio' })
  .trim()
  .min(1, { error: 'El código es obligatorio' })
  .max(50, { error: 'El código no puede tener más de 50 caracteres' })
  .regex(/^[a-z][a-z0-9-]*$/, {
    error: 'El código usa minúsculas, dígitos y guiones (ej. "corte")',
  });

const nombreProceso = z
  .string({ error: 'El nombre es obligatorio' })
  .trim()
  .min(1, { error: 'El nombre es obligatorio' })
  .max(200, { error: 'El nombre no puede tener más de 200 caracteres' });

// ── Alta / edición de un proceso ─────────────────────────────────────────────

/**
 * Alta de proceso de la RC. Las banderas y los tipos son opcionales en la entrada (toman su
 * default en el dominio/BD). Los roles, dependencias y checklist se gestionan por sub-recursos
 * aparte (no en el alta), para mantener cada operación atómica y auditable por separado.
 */
export const esquemaProcesoCrear = z.object({
  codigo: codigoProceso,
  nombre: nombreProceso,
  critico: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
  ultimoProceso: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
  esResurtido: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
  condicionAplicabilidad: z.enum(CONDICIONES_APLICABILIDAD).optional(),
  tipoEvento: z.enum(TIPOS_EVENTO_PROCESO).optional(),
  tipoDuracion: z.enum(TIPOS_DURACION_PROCESO).optional(),
});

/** Datos validados de alta de proceso. */
export type DatosProcesoCrear = z.infer<typeof esquemaProcesoCrear>;

/** Edición parcial de proceso + `activo` para el borrado suave. `id` lo toma la ruta de la URL. */
export const esquemaProcesoEditar = esquemaProcesoCrear.partial().extend({
  id: z
    .number({ error: 'El id del proceso es obligatorio' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de proceso. */
export type DatosProcesoEditar = z.infer<typeof esquemaProcesoEditar>;

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
export const esquemaProcesoPatchCuerpo = esquemaProcesoEditar.omit({ id: true });
/** Datos validados del cuerpo del PATCH de proceso. */
export type DatosProcesoPatchCuerpo = z.infer<typeof esquemaProcesoPatchCuerpo>;

// ── Sub-recursos: roles responsables, dependencias, checklist ────────────────

/** Set COMPLETO de roles responsables del proceso (reemplaza el set actual). N ids de rol. */
export const esquemaProcesoRolesCuerpo = z.object({
  idsRoles: z
    .array(
      z
        .number({ error: 'El id del rol debe ser un número' })
        .int({ error: 'El id del rol debe ser entero' })
        .positive({ error: 'El id del rol debe ser positivo' }),
    )
    .describe('Ids de los roles RESPONSABLES del proceso (set completo; reemplaza el actual).'),
});
/** Datos validados del set de roles responsables. */
export type DatosProcesoRoles = z.infer<typeof esquemaProcesoRolesCuerpo>;

/**
 * Set COMPLETO de antecesores del proceso (reemplaza el set actual). El dominio RECHAZA ciclos
 * (directos y transitivos) y que un proceso sea su propio antecesor.
 */
export const esquemaProcesoDependenciasCuerpo = z.object({
  idsAntecesores: z
    .array(
      z
        .number({ error: 'El id del antecesor debe ser un número' })
        .int({ error: 'El id del antecesor debe ser entero' })
        .positive({ error: 'El id del antecesor debe ser positivo' }),
    )
    .describe('Ids de los procesos ANTECESORES (set completo; el dominio rechaza ciclos).'),
});
/** Datos validados del set de dependencias. */
export type DatosProcesoDependencias = z.infer<typeof esquemaProcesoDependenciasCuerpo>;

/** Un ítem de checklist en la captura (id opcional: si viene, se conserva; si no, es nuevo). */
export const esquemaChecklistItemEntrada = z.object({
  id: z
    .number({ error: 'El id del ítem debe ser un número' })
    .int({ error: 'El id del ítem debe ser entero' })
    .positive({ error: 'El id del ítem debe ser positivo' })
    .optional(),
  descripcion: z
    .string({ error: 'La descripción del ítem es obligatoria' })
    .trim()
    .min(1, { error: 'La descripción del ítem es obligatoria' })
    .max(300, { error: 'La descripción no puede tener más de 300 caracteres' }),
});
/** Datos validados de un ítem de checklist. */
export type DatosChecklistItemEntrada = z.infer<typeof esquemaChecklistItemEntrada>;

/**
 * Set COMPLETO del checklist del proceso (reemplaza el set actual). El `orden` lo asigna el dominio
 * por la posición en el arreglo; los ítems quitados se DESACTIVAN (borrado suave), no se borran.
 */
export const esquemaProcesoChecklistCuerpo = z.object({
  items: z
    .array(esquemaChecklistItemEntrada)
    .max(100, { error: 'El checklist no puede tener más de 100 ítems' })
    .describe('Ítems del checklist EN ORDEN (set completo; los quitados se desactivan).'),
});
/** Datos validados del set de checklist. */
export type DatosProcesoChecklist = z.infer<typeof esquemaProcesoChecklistCuerpo>;

// ── Salidas ──────────────────────────────────────────────────────────────────

/** Rol responsable de un proceso (proyección ligera para la salida). */
export const esquemaProcesoRolSalida = z
  .object({
    idRol: z.number().int().describe('Id del rol responsable.'),
    nombre: z.string().describe('Nombre del rol responsable.'),
  })
  .describe('Rol responsable de un proceso de la RC.');
/** Forma de un rol responsable en la API. */
export type ProcesoRolSalida = z.infer<typeof esquemaProcesoRolSalida>;

/** Antecesor de un proceso (proyección ligera para la salida). */
export const esquemaProcesoAntecesorSalida = z
  .object({
    idProceso: z.number().int().describe('Id del proceso antecesor.'),
    codigo: z.string().describe('Código del proceso antecesor.'),
    nombre: z.string().describe('Nombre del proceso antecesor.'),
  })
  .describe('Proceso antecesor (debe ocurrir antes).');
/** Forma de un antecesor en la API. */
export type ProcesoAntecesorSalida = z.infer<typeof esquemaProcesoAntecesorSalida>;

/** Ítem de checklist (proyección de salida). */
export const esquemaChecklistItemSalida = z
  .object({
    id: z.number().int().describe('Id del ítem.'),
    descripcion: z.string().describe('Texto del ítem a verificar.'),
    orden: z.number().int().describe('Orden de despliegue dentro del checklist.'),
  })
  .describe('Ítem (activo) del checklist de un proceso.');
/** Forma de un ítem de checklist en la API. */
export type ChecklistItemSalida = z.infer<typeof esquemaChecklistItemSalida>;

/** Salida de un proceso de la RC en la API (proyección del modelo + relaciones). */
export const esquemaProcesoSalida = z
  .object({
    id: z.number().int().describe('Id del proceso.'),
    codigo: z.string().describe('Clave estable kebab-case (ej. "corte").'),
    nombre: z.string().describe('Nombre para mostrar.'),
    critico: z.boolean().describe('¿Es un proceso crítico de la ruta?'),
    ultimoProceso: z.boolean().describe('¿Es el último proceso (checkpoint final)?'),
    esResurtido: z.boolean().describe('¿Aplica también en órdenes de resurtido?'),
    condicionAplicabilidad: z
      .enum(CONDICIONES_APLICABILIDAD)
      .describe('Condición de aplicabilidad a una orden.'),
    tipoEvento: z.enum(TIPOS_EVENTO_PROCESO).describe('Evento de negocio que representa.'),
    tipoDuracion: z.enum(TIPOS_DURACION_PROCESO).describe('Cómo se estima su duración.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    roles: z.array(esquemaProcesoRolSalida).describe('Roles responsables (N:M).'),
    antecesores: z.array(esquemaProcesoAntecesorSalida).describe('Procesos antecesores (DAG).'),
    checklist: z.array(esquemaChecklistItemSalida).describe('Ítems activos del checklist.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Proceso de la Ruta Crítica (catálogo configurable global).');
/** Forma de un proceso de la RC tal como lo devuelve la API. */
export type ProcesoSalida = z.infer<typeof esquemaProcesoSalida>;

/** Filtros, orden y paginación del listado de procesos (querystring). */
export const esquemaProcesosQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página (máx 100).'),
    busqueda: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Texto a buscar en el código o nombre (insensible a mayúsculas).'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    ordenarPor: z
      .enum(['codigo', 'nombre', 'creadoEn'])
      .default('nombre')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de procesos de la RC.');
/** Parámetros de listado de procesos ya coaccionados desde la URL. */
export type ProcesosQuery = z.infer<typeof esquemaProcesosQuery>;

/** Respuesta paginada del listado de procesos (forma estándar `Pagina<T>`). */
export const esquemaProcesosPagina = z
  .object({
    datos: z.array(esquemaProcesoSalida).describe('Procesos de la página.'),
    total: z.number().int().describe('Total que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de procesos de la RC.');
/** Forma de la respuesta paginada de procesos. */
export type ProcesosPagina = z.infer<typeof esquemaProcesosPagina>;
