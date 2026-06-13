import { z } from 'zod';

/**
 * Alta de temporada (catálogo global F1-E1, ADR-0007: sin `idEmpresa`). El nombre es
 * la clave de negocio (único global) y el único dato del catálogo.
 */
export const esquemaTemporadaCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
});

/** Datos validados de alta de temporada. */
export type DatosTemporadaCrear = z.infer<typeof esquemaTemporadaCrear>;

/**
 * Edición de temporada: el nombre es opcional (edición parcial) más `activo` para el
 * borrado suave (plan §4: nada se borra físicamente).
 */
export const esquemaTemporadaEditar = esquemaTemporadaCrear.partial().extend({
  id: z
    .number({ error: 'El id de la temporada es obligatorio' })
    .int({ error: 'El id de la temporada debe ser entero' })
    .positive({ error: 'El id de la temporada debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de temporada. */
export type DatosTemporadaEditar = z.infer<typeof esquemaTemporadaEditar>;

/**
 * Salida de una temporada en la API. Proyección del modelo `Temporada` a JSON, con
 * la auditoría (quién/cuándo). Parte del contrato OpenAPI.
 */
export const esquemaTemporadaSalida = z
  .object({
    id: z.number().int().describe('Id de la temporada.'),
    nombre: z.string().describe('Nombre de la temporada.'),
    activo: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Temporada del catálogo (global).');

/** Forma de una temporada tal como la devuelve la API. */
export type TemporadaSalida = z.infer<typeof esquemaTemporadaSalida>;

/**
 * Parámetros del listado de temporadas EN LA URL (querystring): todo llega como
 * texto, así que se coaccionan números y banderas. Mapea 1:1 al servicio de dominio
 * `listarTemporadas`.
 */
export const esquemaTemporadasQuery = z
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
      .describe('Texto a buscar en el nombre (insensible a mayúsculas).'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye las desactivadas ("true"/"false").'),
    ordenarPor: z
      .enum(['nombre', 'creadoEn'])
      .default('nombre')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de temporadas.');

/** Parámetros de listado de temporadas ya coaccionados desde la URL. */
export type TemporadasQuery = z.infer<typeof esquemaTemporadasQuery>;

/** Respuesta paginada del listado de temporadas (forma estándar `Pagina<T>`). */
export const esquemaTemporadasPagina = z
  .object({
    datos: z.array(esquemaTemporadaSalida).describe('Temporadas de la página.'),
    total: z.number().int().describe('Total de temporadas que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de temporadas.');

/** Forma de la respuesta paginada de temporadas. */
export type TemporadasPagina = z.infer<typeof esquemaTemporadasPagina>;
