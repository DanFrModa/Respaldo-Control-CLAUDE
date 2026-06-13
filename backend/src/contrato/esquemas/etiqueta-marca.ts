import { z } from 'zod';

/**
 * Alta de etiqueta de marca (catálogo global F1-E1, ADR-0007: sin `idEmpresa`). El
 * nombre es la clave de negocio (único global). `regalias` es el porcentaje (0–100)
 * que alimenta el costeo (doc 01-Modelos §6 punto 4): se valida aquí Y en el dominio.
 * Se acepta como `number` y Prisma lo guarda como Decimal; en la salida vuelve `number`.
 */
export const esquemaEtiquetaMarcaCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  regalias: z
    .number({ error: 'Las regalías deben ser un número' })
    .min(0, { error: 'Las regalías no pueden ser menores a 0%' })
    .max(100, { error: 'Las regalías no pueden ser mayores a 100%' })
    .default(0),
});

/** Datos validados de alta de etiqueta de marca. */
export type DatosEtiquetaMarcaCrear = z.infer<typeof esquemaEtiquetaMarcaCrear>;

/**
 * Edición de etiqueta de marca: todos los campos del alta opcionales (edición
 * parcial) más `activo` para el borrado suave (plan §4: nada se borra físicamente).
 *
 * Los campos con `.default()` en el alta se sobrescriben aquí como `.optional()` SIN
 * default: en una edición parcial, omitir un campo NO debe resetearlo (Zod `.partial()`
 * NO quita los defaults). Aquí `regalias` sin `.default(0)` → si no se manda, queda
 * `undefined` y NO se pisa el porcentaje real con 0.
 */
export const esquemaEtiquetaMarcaEditar = esquemaEtiquetaMarcaCrear.partial().extend({
  id: z
    .number({ error: 'El id de la etiqueta es obligatorio' })
    .int({ error: 'El id de la etiqueta debe ser entero' })
    .positive({ error: 'El id de la etiqueta debe ser positivo' }),
  regalias: z
    .number({ error: 'Las regalías deben ser un número' })
    .min(0, { error: 'Las regalías no pueden ser menores a 0%' })
    .max(100, { error: 'Las regalías no pueden ser mayores a 100%' })
    .optional(),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de etiqueta de marca. */
export type DatosEtiquetaMarcaEditar = z.infer<typeof esquemaEtiquetaMarcaEditar>;

/**
 * Salida de una etiqueta de marca en la API. Proyección del modelo `EtiquetaMarca` a
 * JSON: el `regalias` Decimal de Prisma se serializa a `number`. Parte del contrato OpenAPI.
 */
export const esquemaEtiquetaMarcaSalida = z
  .object({
    id: z.number().int().describe('Id de la etiqueta de marca.'),
    nombre: z.string().describe('Nombre de la etiqueta de marca.'),
    regalias: z.number().describe('Porcentaje de regalías (0–100).'),
    activo: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Etiqueta de marca del catálogo (global).');

/** Forma de una etiqueta de marca tal como la devuelve la API. */
export type EtiquetaMarcaSalida = z.infer<typeof esquemaEtiquetaMarcaSalida>;

/**
 * Parámetros del listado de etiquetas de marca EN LA URL (querystring): todo llega
 * como texto, así que se coaccionan números y banderas. Mapea 1:1 al servicio de
 * dominio `listarEtiquetasMarca`.
 */
export const esquemaEtiquetasMarcaQuery = z
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
      .enum(['nombre', 'regalias', 'creadoEn'])
      .default('nombre')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de etiquetas de marca.');

/** Parámetros de listado de etiquetas de marca ya coaccionados desde la URL. */
export type EtiquetasMarcaQuery = z.infer<typeof esquemaEtiquetasMarcaQuery>;

/** Respuesta paginada del listado de etiquetas de marca (forma estándar `Pagina<T>`). */
export const esquemaEtiquetasMarcaPagina = z
  .object({
    datos: z.array(esquemaEtiquetaMarcaSalida).describe('Etiquetas de marca de la página.'),
    total: z.number().int().describe('Total de etiquetas que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de etiquetas de marca.');

/** Forma de la respuesta paginada de etiquetas de marca. */
export type EtiquetasMarcaPagina = z.infer<typeof esquemaEtiquetasMarcaPagina>;
