import { z } from 'zod';

/**
 * Contrato de Maquileros + TipoProceso (F1-E2, PIEZA A — Maquila unificada). Una sola
 * definición de las reglas de captura para UI y servidor (fuente del OpenAPI). Calca el
 * patrón de `proveedor.ts`: campos opcionales que en EDICIÓN aceptan además `null` para
 * VACIAR un dato ya capturado (M1: omitir = no tocar; `null`/'' = borrar), y los roles
 * inline como `tipos: number[]` (≥1, sin repetidos) igual que los `roles` del proveedor.
 *
 * Modelo: `Maquilero` UNIFICA Maquileros + Estampadores del viejo (doc
 * `03-Produccion.md` §Paso 4 Entrega a maquilero y §Flujo paralelo Estampado/Aplicación)
 * con sus CAPACIDADES modeladas N:N a `TipoProceso` (maquila unificada, PLANMAESTRO §4),
 * NO como tablas separadas. Catálogo GLOBAL (ADR-0007); sin Decimal en esta pieza.
 */

// ── Campos reutilizables (mismas reglas en alta y edición) ────────────────────

/** Lista de ids de tipos de proceso (capacidades, N:N). Enteros positivos únicos, ≥1. */
const esquemaTiposIds = z
  .array(z.number().int().positive())
  .min(1, { error: 'El maquilero debe tener al menos un tipo de proceso' })
  .max(20, { error: 'Demasiados tipos de proceso' })
  .refine((ids) => new Set(ids).size === ids.length, { error: 'Hay tipos de proceso repetidos' });

/** Campos opcionales del maquilero (mismas reglas de longitud en alta y edición). */
const camposOpcionales = {
  apellidos: z
    .string()
    .trim()
    .max(200, { error: 'Los apellidos no pueden tener más de 200 caracteres' })
    .optional(),
  telefonos: z
    .string()
    .trim()
    .max(200, { error: 'Los teléfonos no pueden tener más de 200 caracteres' })
    .optional(),
  direccion: z
    .string()
    .trim()
    .max(300, { error: 'La dirección no puede tener más de 300 caracteres' })
    .optional(),
  observaciones: z
    .string()
    .trim()
    .max(2000, { error: 'Las observaciones no pueden tener más de 2000 caracteres' })
    .optional(),
  /** Observaciones específicas de pago (viejo: `ObsPago`). */
  obsPago: z
    .string()
    .trim()
    .max(2000, { error: 'Las observaciones de pago no pueden tener más de 2000 caracteres' })
    .optional(),
  /** ¿Está asegurado? (viejo: `Asegurado`). El formulario siempre la manda como boolean. */
  asegurado: z.boolean({ error: '¿Asegurado? debe ser verdadero o falso' }).optional(),
} as const;

/**
 * Variante de EDICIÓN de los campos opcionales: los de texto aceptan además `null` para
 * poder VACIAR un dato ya capturado (M1). Semántica del PATCH parcial: omitir
 * (`undefined`) = no tocar; mandar `null` (o '') = ponerlo a null (borrar). La bandera
 * `asegurado` NO se hace nullable: el formulario la manda como boolean y `undefined`
 * basta para "no tocar" (igual que `factura`/`retieneIva` en el proveedor).
 */
const camposOpcionalesEditar = {
  ...camposOpcionales,
  apellidos: camposOpcionales.apellidos.nullable(),
  telefonos: camposOpcionales.telefonos.nullable(),
  direccion: camposOpcionales.direccion.nullable(),
  observaciones: camposOpcionales.observaciones.nullable(),
  obsPago: camposOpcionales.obsPago.nullable(),
} as const;

/**
 * Alta de maquilero (catálogo global F1-E2). El `corto` es la clave de negocio (único
 * global); `tipos` es la lista de ids de TipoProceso (capacidades, N:N) con al menos uno
 * (lo exige el dominio en alta y al reemplazar el set en edición, A1).
 */
export const esquemaMaquileroCrear = z.object({
  corto: z
    .string({ error: 'El código corto es obligatorio' })
    .trim()
    .min(1, { error: 'El código corto es obligatorio' })
    .max(50, { error: 'El código corto no puede tener más de 50 caracteres' }),
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(200, { error: 'El nombre no puede tener más de 200 caracteres' }),
  /** Ids de tipos de proceso a asignar (capacidades, N:N). En alta el dominio exige ≥1. */
  tipos: esquemaTiposIds,
  ...camposOpcionales,
});

/** Datos validados de alta de maquilero. */
export type DatosMaquileroCrear = z.infer<typeof esquemaMaquileroCrear>;

/**
 * Edición de maquilero: `id` + todos los campos del alta opcionales (edición parcial) +
 * `activo` para el borrado suave. `corto`/`nombre` NO son nullable (claves obligatorias);
 * los demás textos sí (M1: `null`/'' = borrar). `tipos`: si se omite, NO se tocan; si se
 * manda, el dominio reemplaza el set y exige ≥1.
 */
export const esquemaMaquileroEditar = z
  .object({
    corto: z
      .string()
      .trim()
      .min(1, { error: 'El código corto es obligatorio' })
      .max(50, { error: 'El código corto no puede tener más de 50 caracteres' })
      .optional(),
    nombre: z
      .string()
      .trim()
      .min(1, { error: 'El nombre es obligatorio' })
      .max(200, { error: 'El nombre no puede tener más de 200 caracteres' })
      .optional(),
    /** Reemplaza el set de tipos si viene; el dominio exige ≥1. Omitir = no tocar. */
    tipos: esquemaTiposIds.optional(),
    activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
    ...camposOpcionalesEditar,
  })
  .extend({
    id: z
      .number({ error: 'El id del maquilero es obligatorio' })
      .int({ error: 'El id del maquilero debe ser entero' })
      .positive({ error: 'El id del maquilero debe ser positivo' }),
  });

/** Datos validados de edición de maquilero. */
export type DatosMaquileroEditar = z.infer<typeof esquemaMaquileroEditar>;

/**
 * Cuerpo del PATCH de maquilero (la ruta REST recibe el `id` en la URL, no en el body).
 * Se deriva del esquema de edición omitiendo `id` (igual que el cortador).
 */
export const esquemaMaquileroPatchCuerpo = esquemaMaquileroEditar.omit({ id: true });

/** Datos validados del cuerpo del PATCH de maquilero (sin `id`). */
export type DatosMaquileroPatchCuerpo = z.infer<typeof esquemaMaquileroPatchCuerpo>;

/**
 * Salida de un tipo de proceso (catálogo N:N). Forma del selector
 * `GET /api/tipos-proceso` y, embebida, de cada capacidad del maquilero.
 */
export const esquemaTipoProcesoSalida = z
  .object({
    id: z.number().int().describe('Id del tipo de proceso.'),
    codigo: z.string().describe('Clave estable kebab-case.'),
    nombre: z.string().describe('Nombre legible del tipo de proceso.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
  })
  .describe('Tipo de proceso de maquila (catálogo global).');

/** Forma de un tipo de proceso tal como lo devuelve la API. */
export type TipoProcesoSalida = z.infer<typeof esquemaTipoProcesoSalida>;

/** Forma de un tipo de proceso tal como sale embebido en el maquilero (sin `activo`). */
export const esquemaTipoProcesoEnMaquilero = z
  .object({
    id: z.number().int().describe('Id del tipo de proceso.'),
    codigo: z.string().describe('Clave estable del tipo de proceso (kebab-case).'),
    nombre: z.string().describe('Nombre legible del tipo de proceso.'),
  })
  .describe('Tipo de proceso (capacidad) asignado al maquilero.');

/**
 * Salida de un maquilero en la API (lo que ve el frontend). Proyección del modelo
 * `Maquilero` a JSON, con todos sus campos, la auditoría (quién/cuándo) y los `tipos`
 * (capacidades, N:N). Parte del contrato OpenAPI.
 */
export const esquemaMaquileroSalida = z
  .object({
    id: z.number().int().describe('Id del maquilero.'),
    corto: z.string().describe('Código corto (clave de negocio).'),
    nombre: z.string().describe('Nombre del maquilero.'),
    apellidos: z.string().nullable().describe('Apellidos, o null.'),
    telefonos: z.string().nullable().describe('Teléfonos (texto libre), o null.'),
    direccion: z.string().nullable().describe('Dirección, o null.'),
    observaciones: z.string().nullable().describe('Observaciones generales, o null.'),
    obsPago: z.string().nullable().describe('Observaciones específicas de pago, o null.'),
    asegurado: z.boolean().describe('¿Está asegurado?'),
    tipos: z.array(esquemaTipoProcesoEnMaquilero).describe('Tipos de proceso (capacidades, N:N).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Maquilero del catálogo (global).');

/** Forma de un maquilero tal como lo devuelve la API. */
export type MaquileroSalida = z.infer<typeof esquemaMaquileroSalida>;

/**
 * Parámetros del listado de maquileros EN LA URL (querystring): todo llega como texto,
 * así que se coaccionan números y banderas. Filtro `tipoProceso` (por id) e
 * `incluirInactivos`; búsqueda por `corto` O `nombre` (insensible a mayúsculas).
 */
export const esquemaListarMaquileros = z
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
      .max(200)
      .optional()
      .describe('Texto a buscar en el código corto o el nombre (insensible a mayúsculas).'),
    tipoProceso: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por id de tipo de proceso (capacidad).'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    ordenarPor: z
      .enum(['corto', 'nombre', 'creadoEn'])
      .default('corto')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de maquileros.');

/** Parámetros de listado de maquileros ya coaccionados desde la URL. */
export type ListarMaquileros = z.infer<typeof esquemaListarMaquileros>;

/** Respuesta paginada del listado de maquileros (forma estándar `Pagina<T>`). */
export const esquemaMaquilerosPagina = z
  .object({
    datos: z.array(esquemaMaquileroSalida).describe('Maquileros de la página.'),
    total: z.number().int().describe('Total de maquileros que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de maquileros.');

/** Forma de la respuesta paginada de maquileros. */
export type MaquilerosPagina = z.infer<typeof esquemaMaquilerosPagina>;

/** Querystring del selector de tipos de proceso (`GET /api/tipos-proceso`). */
export const esquemaTiposProcesoQuery = z
  .object({
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los tipos de proceso desactivados ("true"/"false").'),
  })
  .describe('Filtros del selector de tipos de proceso.');

/** Parámetros del selector de tipos de proceso ya coaccionados desde la URL. */
export type TiposProcesoQuery = z.infer<typeof esquemaTiposProcesoQuery>;
