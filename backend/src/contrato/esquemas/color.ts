import { z } from 'zod';

/**
 * Alta de color (catálogo global F1-E1, ADR-0007: sin `idEmpresa`). El nombre es la
 * clave de negocio (único global) y el único dato. La normalización LIGERA (colapsar
 * espacios internos) la hace el dominio antes de guardar; aquí Zod solo recorta y exige
 * no vacío. La fusión de duplicados (alias) llega en F1-E6.
 */
export const esquemaColorCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(80, { error: 'El nombre no puede tener más de 80 caracteres' }),
});

/** Datos validados de alta de color. */
export type DatosColorCrear = z.infer<typeof esquemaColorCrear>;

/**
 * Edición de color: el nombre es opcional (edición parcial) más `activo` para el
 * borrado suave (plan §4: nada se borra físicamente).
 */
export const esquemaColorEditar = esquemaColorCrear.partial().extend({
  id: z
    .number({ error: 'El id del color es obligatorio' })
    .int({ error: 'El id del color debe ser entero' })
    .positive({ error: 'El id del color debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de color. */
export type DatosColorEditar = z.infer<typeof esquemaColorEditar>;

/**
 * Salida de un color en la API. Proyección del modelo `Color` a JSON, con la auditoría
 * (quién/cuándo). Parte del contrato OpenAPI.
 */
export const esquemaColorSalida = z
  .object({
    id: z.number().int().describe('Id del color.'),
    nombre: z.string().describe('Nombre del color (normalizado).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Color del catálogo (global).');

/** Forma de un color tal como lo devuelve la API. */
export type ColorSalida = z.infer<typeof esquemaColorSalida>;

/**
 * Parámetros del listado de colores EN LA URL (querystring): todo llega como texto,
 * así que se coaccionan números y banderas. Mapea 1:1 al servicio de dominio
 * `listarColores`.
 */
export const esquemaColoresQuery = z
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
      .max(80)
      .optional()
      .describe('Texto a buscar en el nombre (insensible a mayúsculas).'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    ordenarPor: z
      .enum(['nombre', 'creadoEn'])
      .default('nombre')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de colores.');

/** Parámetros de listado de colores ya coaccionados desde la URL. */
export type ColoresQuery = z.infer<typeof esquemaColoresQuery>;

/** Respuesta paginada del listado de colores (forma estándar `Pagina<T>`). */
export const esquemaColoresPagina = z
  .object({
    datos: z.array(esquemaColorSalida).describe('Colores de la página.'),
    total: z.number().int().describe('Total de colores que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de colores.');

/** Forma de la respuesta paginada de colores. */
export type ColoresPagina = z.infer<typeof esquemaColoresPagina>;
