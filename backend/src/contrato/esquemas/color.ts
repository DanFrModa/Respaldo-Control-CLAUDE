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
 * A dónde se fue un color que una FUSIÓN se llevó: el canónico que lo absorbió, con su nombre.
 * Sólo el NOMBRE contesta la pregunta que se hace quien mira el catálogo ("¿y «Blanco» a dónde se
 * fue?"), y el id no viene solo/aparte a propósito: dos campos que dicen lo mismo pueden acabar
 * diciéndolo distinto.
 */
export const esquemaColorFusionadoEn = z
  .object({
    id: z.number().int().describe('Id del color canónico que lo absorbió.'),
    nombre: z.string().describe('Nombre del color canónico que lo absorbió.'),
  })
  .describe('El color canónico que absorbió a éste en una fusión.');

/** Forma del destino de una fusión. */
export type ColorFusionadoEn = z.infer<typeof esquemaColorFusionadoEn>;

/**
 * Salida de un color en la API. Proyección del modelo `Color` a JSON, con la auditoría
 * (quién/cuándo). Parte del contrato OpenAPI.
 */
export const esquemaColorSalida = z
  .object({
    id: z.number().int().describe('Id del color.'),
    nombre: z.string().describe('Nombre del color (normalizado).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    /**
     * ⭐ El RASTRO de la fusión, expuesto (`Color.idFusionadoEn` + el nombre del destino). Sin él la
     * pantalla pintaba un color ABSORBIDO como un inactivo cualquiera: la fusión existía en la base
     * y en la bitácora, pero no se veía en ningún lado. Null = a este color no se lo llevó nadie
     * (que es el caso de casi todos, incluidos los que su dueño apagó a mano).
     */
    fusionadoEn: esquemaColorFusionadoEn
      .nullable()
      .describe(
        'El color canónico que absorbió a éste en una fusión, o null si nunca lo absorbieron (un color apagado A MANO también da null).',
      ),
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
      .max(500)
      .default(20)
      .describe('Renglones por página (máx 500).'),
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

/**
 * Fusión de colores duplicados (F1-E6): reasigna las referencias de uno o varios
 * colores ORIGEN (duplicados/alias) a un color DESTINO (el canónico que se conserva)
 * y desactiva los orígenes. Resuelve la deuda de la normalización: en el viejo el
 * color era texto libre, así que la carga histórica deja alias ("NEGRO A"/"NEGRO B")
 * que aquí se consolidan en uno solo SIN perder las telas que ya lo usaban.
 *
 * `origenes` es ≥1 (varios duplicados de golpe), sin el destino dentro y sin repetir.
 */
export const esquemaColorFusionar = z
  .object({
    idDestino: z
      .number({ error: 'El color que se conserva es obligatorio' })
      .int({ error: 'El id del color destino debe ser entero' })
      .positive({ error: 'El id del color destino debe ser positivo' })
      .describe('Id del color CANÓNICO que se conserva (destino de la fusión).'),
    origenes: z
      .array(
        z
          .number({ error: 'Cada color a fusionar debe ser un número' })
          .int({ error: 'El id de un color a fusionar debe ser entero' })
          .positive({ error: 'El id de un color a fusionar debe ser positivo' }),
      )
      .min(1, { error: 'Elige al menos un color duplicado para fusionar' })
      .max(50, { error: 'No se pueden fusionar más de 50 colores de una vez' })
      .describe('Ids de los colores DUPLICADOS que se absorben en el destino.'),
  })
  .refine((datos) => !datos.origenes.includes(datos.idDestino), {
    error: 'El color que se conserva no puede estar también en la lista de duplicados',
    path: ['origenes'],
  })
  .refine((datos) => new Set(datos.origenes).size === datos.origenes.length, {
    error: 'No repitas un color en la lista de duplicados',
    path: ['origenes'],
  })
  .describe('Fusión de colores duplicados: orígenes → destino canónico.');

/** Datos validados de una fusión de colores. */
export type DatosColorFusionar = z.infer<typeof esquemaColorFusionar>;
