import { z } from 'zod';

/**
 * Alta de cortador (catálogo global F1-E1, ADR-0007: sin `idEmpresa`). El nombre es
 * la clave de negocio (único global). `precioReferencia` es un decimal que se acepta
 * como `number` (Prisma lo guarda como Decimal); en la salida se serializa a `number`.
 */
export const esquemaCortadorCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
  precioReferencia: z
    .number({ error: 'El precio de referencia debe ser un número' })
    .nonnegative({ error: 'El precio de referencia no puede ser negativo' })
    .optional(),
  telefonos: z
    .string()
    .trim()
    .max(150, { error: 'Los teléfonos no pueden tener más de 150 caracteres' })
    .optional(),
});

/** Datos validados de alta de cortador. */
export type DatosCortadorCrear = z.infer<typeof esquemaCortadorCrear>;

/**
 * Edición de cortador: todos los campos del alta opcionales (edición parcial) más
 * `activo` para el borrado suave (plan §4: nada se borra físicamente).
 */
export const esquemaCortadorEditar = esquemaCortadorCrear.partial().extend({
  id: z
    .number({ error: 'El id del cortador es obligatorio' })
    .int({ error: 'El id del cortador debe ser entero' })
    .positive({ error: 'El id del cortador debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de cortador. */
export type DatosCortadorEditar = z.infer<typeof esquemaCortadorEditar>;

/**
 * Salida de un cortador en la API. Proyección del modelo `Cortador` a JSON: el
 * `precioReferencia` Decimal de Prisma se serializa a `number` (o null). Parte del
 * contrato OpenAPI.
 */
export const esquemaCortadorSalida = z
  .object({
    id: z.number().int().describe('Id del cortador.'),
    nombre: z.string().describe('Nombre del cortador.'),
    precioReferencia: z.number().nullable().describe('Precio de referencia por corte, o null.'),
    telefonos: z.string().nullable().describe('Teléfonos, o null.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Cortador del catálogo (global).');

/** Forma de un cortador tal como lo devuelve la API. */
export type CortadorSalida = z.infer<typeof esquemaCortadorSalida>;

/**
 * Parámetros del listado de cortadores EN LA URL (querystring): todo llega como
 * texto, así que se coaccionan números y banderas. Mapea 1:1 al servicio de dominio
 * `listarCortadores`.
 */
export const esquemaCortadoresQuery = z
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
      .max(150)
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
  .describe('Filtros, orden y paginación del listado de cortadores.');

/** Parámetros de listado de cortadores ya coaccionados desde la URL. */
export type CortadoresQuery = z.infer<typeof esquemaCortadoresQuery>;

/** Respuesta paginada del listado de cortadores (forma estándar `Pagina<T>`). */
export const esquemaCortadoresPagina = z
  .object({
    datos: z.array(esquemaCortadorSalida).describe('Cortadores de la página.'),
    total: z.number().int().describe('Total de cortadores que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de cortadores.');

/** Forma de la respuesta paginada de cortadores. */
export type CortadoresPagina = z.infer<typeof esquemaCortadoresPagina>;
