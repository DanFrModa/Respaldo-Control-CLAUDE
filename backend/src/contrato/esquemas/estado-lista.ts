import { z } from 'zod';

/**
 * Esquemas Zod del catálogo de ESTADOS DE LISTA DE PRECIOS (F8-E1a; CRUD patrón Tipos de proceso).
 *
 * `EstadoLista` es la lista configurable de estados por los que pasa una lista de precios en la
 * negociación (abierta / en-negociación / cerrada / ya-pedida…). La bandera `esCierre` marca un
 * estado de CIERRE (bloquea nuevas rondas/ediciones de renglón, E5) y SÍ es configurable: la edita
 * quien tenga `estado-lista.administrar`. Sin regla de "fijo" (a diferencia de `ConceptoCosto`).
 *
 * Una sola definición de reglas para UI y servidor (alimenta el OpenAPI).
 */

/** `codigo` estable kebab-case (minúsculas, dígitos y guiones): clave de negocio del estado. */
const codigoEstadoLista = z
  .string({ error: 'El código es obligatorio' })
  .trim()
  .min(1, { error: 'El código es obligatorio' })
  .max(50, { error: 'El código no puede tener más de 50 caracteres' })
  .regex(/^[a-z][a-z0-9-]*$/, {
    error: 'El código usa minúsculas, dígitos y guiones (ej. "en-negociacion")',
  });

/**
 * Alta de estado de lista. `orden` y `esCierre` son opcionales (default `0` / `false` en BD).
 */
export const esquemaEstadoListaCrear = z.object({
  codigo: codigoEstadoLista,
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  orden: z
    .number({ error: 'El orden debe ser un número' })
    .int({ error: 'El orden debe ser entero' })
    .min(0, { error: 'El orden no puede ser negativo' })
    .optional()
    .describe('Orden de despliegue en la lista (menor primero). Default 0.'),
  esCierre: z
    .boolean({ error: 'Debe ser verdadero o falso' })
    .optional()
    .describe(
      '¿Es un estado de CIERRE? (bloquea nuevas rondas/ediciones de renglón). Default false.',
    ),
});

/** Datos validados de alta de estado de lista. */
export type DatosEstadoListaCrear = z.infer<typeof esquemaEstadoListaCrear>;

/**
 * Edición parcial de estado de lista + `activo` para el borrado suave. `id` va en el cuerpo del
 * servicio (las rutas lo toman de la URL). `esCierre` SÍ es editable (es configuración).
 */
export const esquemaEstadoListaEditar = esquemaEstadoListaCrear.partial().extend({
  id: z
    .number({ error: 'El id del estado de lista es obligatorio' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de estado de lista. */
export type DatosEstadoListaEditar = z.infer<typeof esquemaEstadoListaEditar>;

/** Salida de un estado de lista en la API (proyección del modelo a JSON). */
export const esquemaEstadoListaSalida = z
  .object({
    id: z.number().int().describe('Id del estado de lista.'),
    codigo: z.string().describe('Clave estable kebab-case (ej. "abierta").'),
    nombre: z.string().describe('Nombre para mostrar.'),
    orden: z.number().int().describe('Orden de despliegue (menor primero).'),
    esCierre: z
      .boolean()
      .describe('Si es un estado de CIERRE (bloquea nuevas rondas/ediciones de renglón).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Estado de lista de precios (catálogo global de Desarrollo).');

/** Forma de un estado de lista tal como lo devuelve la API. */
export type EstadoListaSalida = z.infer<typeof esquemaEstadoListaSalida>;

/** Filtros, orden y paginación del listado de estados de lista (querystring). */
export const esquemaEstadosListaQuery = z
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
      .enum(['orden', 'codigo', 'nombre', 'creadoEn'])
      .default('orden')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de estados de lista.');

/** Parámetros de listado de estados de lista ya coaccionados desde la URL. */
export type EstadosListaQuery = z.infer<typeof esquemaEstadosListaQuery>;

/** Respuesta paginada del listado de estados de lista (forma estándar `Pagina<T>`). */
export const esquemaEstadosListaPagina = z
  .object({
    datos: z.array(esquemaEstadoListaSalida).describe('Estados de lista de la página.'),
    total: z.number().int().describe('Total que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de estados de lista.');

/** Forma de la respuesta paginada de estados de lista. */
export type EstadosListaPagina = z.infer<typeof esquemaEstadosListaPagina>;
