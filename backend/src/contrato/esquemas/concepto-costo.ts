import { z } from 'zod';

/**
 * Esquemas Zod del catálogo de CONCEPTOS DE COSTO (F8-E1a; CRUD patrón Tipos de proceso).
 *
 * `ConceptoCosto` es la lista abierta de rubros con los que se arma el precosto de un modelo en
 * Desarrollo (tela, avíos, maquila, y los conceptos "abiertos" que agregue el usuario). Algunos
 * conceptos son FIJOS (`fijo=true`: tela/avíos/maquila): el seed los siembra y NO se pueden
 * desactivar (regla de negocio del dominio). La bandera `fijo` NO es editable por la API — solo la
 * pone el seed; el resto del catálogo (código/nombre/orden/activo) lo administra quien tenga
 * `concepto-costo.administrar`.
 *
 * Una sola definición de reglas para UI y servidor (alimenta el OpenAPI).
 */

/** `codigo` estable kebab-case (minúsculas, dígitos y guiones): clave de negocio del concepto. */
const codigoConceptoCosto = z
  .string({ error: 'El código es obligatorio' })
  .trim()
  .min(1, { error: 'El código es obligatorio' })
  .max(50, { error: 'El código no puede tener más de 50 caracteres' })
  .regex(/^[a-z][a-z0-9-]*$/, {
    error: 'El código usa minúsculas, dígitos y guiones (ej. "estampado")',
  });

/**
 * Alta de concepto de costo. `fijo` NO se acepta en la entrada (solo lo pone el seed): un alta por
 * API siempre nace con `fijo=false` (default de BD). `orden` es opcional (default `0` en BD).
 */
export const esquemaConceptoCostoCrear = z.object({
  codigo: codigoConceptoCosto,
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
});

/** Datos validados de alta de concepto de costo. */
export type DatosConceptoCostoCrear = z.infer<typeof esquemaConceptoCostoCrear>;

/**
 * Edición parcial de concepto de costo + `activo` para el borrado suave. `id` va en el cuerpo del
 * servicio (las rutas lo toman de la URL). `fijo` NO figura: no es editable por API. Un concepto
 * `fijo` NO se puede desactivar (lo rechaza el dominio).
 */
export const esquemaConceptoCostoEditar = esquemaConceptoCostoCrear.partial().extend({
  id: z
    .number({ error: 'El id del concepto de costo es obligatorio' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de concepto de costo. */
export type DatosConceptoCostoEditar = z.infer<typeof esquemaConceptoCostoEditar>;

/** Salida de un concepto de costo en la API (proyección del modelo a JSON). */
export const esquemaConceptoCostoSalida = z
  .object({
    id: z.number().int().describe('Id del concepto de costo.'),
    codigo: z.string().describe('Clave estable kebab-case (ej. "tela").'),
    nombre: z.string().describe('Nombre para mostrar.'),
    orden: z.number().int().describe('Orden de despliegue (menor primero).'),
    fijo: z
      .boolean()
      .describe('Concepto FIJO (tela/avíos/maquila): no se puede desactivar. Lo pone el seed.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Concepto de costo (catálogo global de Desarrollo).');

/** Forma de un concepto de costo tal como lo devuelve la API. */
export type ConceptoCostoSalida = z.infer<typeof esquemaConceptoCostoSalida>;

/** Filtros, orden y paginación del listado de conceptos de costo (querystring). */
export const esquemaConceptosCostoQuery = z
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
  .describe('Filtros, orden y paginación del listado de conceptos de costo.');

/** Parámetros de listado de conceptos de costo ya coaccionados desde la URL. */
export type ConceptosCostoQuery = z.infer<typeof esquemaConceptosCostoQuery>;

/** Respuesta paginada del listado de conceptos de costo (forma estándar `Pagina<T>`). */
export const esquemaConceptosCostoPagina = z
  .object({
    datos: z.array(esquemaConceptoCostoSalida).describe('Conceptos de costo de la página.'),
    total: z.number().int().describe('Total que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de conceptos de costo.');

/** Forma de la respuesta paginada de conceptos de costo. */
export type ConceptosCostoPagina = z.infer<typeof esquemaConceptosCostoPagina>;
