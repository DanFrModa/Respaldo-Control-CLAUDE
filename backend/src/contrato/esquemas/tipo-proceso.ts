import { z } from 'zod';

/**
 * Esquemas Zod del catálogo de TIPOS DE PROCESO de maquila (F3-E1; CRUD patrón Almacenes).
 *
 * `TipoProceso` existía desde F1-E2 (solo sembrado); F3-E1 le da CRUD y le agrega la bandera
 * `generaEntradaPt` (decisión (e), DECISIONES.md): qué proceso deja prenda terminada y por tanto
 * si su RECIBO mete a inventario PT (costura sí; estampado/bordado/lavado no). Esa bandera la
 * EDITA solo un administrador (lo decide y reaplica el servicio de dominio, A4); el resto del
 * catálogo lo administra quien tenga `tipos-proceso.administrar`.
 *
 * Una sola definición de reglas para UI y servidor (alimenta el OpenAPI).
 */

/** `codigo` estable kebab-case (minúsculas, dígitos y guiones): clave de negocio del proceso. */
const codigoTipoProceso = z
  .string({ error: 'El código es obligatorio' })
  .trim()
  .min(1, { error: 'El código es obligatorio' })
  .max(50, { error: 'El código no puede tener más de 50 caracteres' })
  .regex(/^[a-z][a-z0-9-]*$/, {
    error: 'El código usa minúsculas, dígitos y guiones (ej. "costura")',
  });

/**
 * Alta de tipo de proceso. `generaEntradaPt` es OPCIONAL en la entrada (default `false` en el
 * dominio/BD, lo SEGURO): si el usuario no es admin, el servidor IGNORA cualquier valor que venga
 * y deja el default; solo un admin puede fijarlo (A4).
 */
export const esquemaTipoProcesoCrear = z.object({
  codigo: codigoTipoProceso,
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  generaEntradaPt: z
    .boolean({ error: 'Debe ser verdadero o falso' })
    .optional()
    .describe('¿El recibo de este proceso mete a inventario PT? Solo un admin puede fijarlo.'),
});

/** Datos validados de alta de tipo de proceso. */
export type DatosTipoProcesoCrear = z.infer<typeof esquemaTipoProcesoCrear>;

/**
 * Edición parcial de tipo de proceso + `activo` para el borrado suave. `id` va en el cuerpo del
 * servicio (las rutas lo toman de la URL). `generaEntradaPt` solo lo aplica un admin (el servidor
 * lo descarta para no-admins).
 */
export const esquemaTipoProcesoEditar = esquemaTipoProcesoCrear.partial().extend({
  id: z
    .number({ error: 'El id del tipo de proceso es obligatorio' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de tipo de proceso. */
export type DatosTipoProcesoEditar = z.infer<typeof esquemaTipoProcesoEditar>;

/** Salida de un tipo de proceso en la API (proyección del modelo a JSON). */
export const esquemaTipoProcesoSalida = z
  .object({
    id: z.number().int().describe('Id del tipo de proceso.'),
    codigo: z.string().describe('Clave estable kebab-case (ej. "costura").'),
    nombre: z.string().describe('Nombre para mostrar.'),
    generaEntradaPt: z
      .boolean()
      .describe('Si el recibo de este proceso genera entrada a inventario PT (decisión (e)).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Tipo de proceso de maquila (catálogo global).');

/** Forma de un tipo de proceso tal como lo devuelve la API. */
export type TipoProcesoSalida = z.infer<typeof esquemaTipoProcesoSalida>;

/** Filtros, orden y paginación del listado de tipos de proceso (querystring). */
export const esquemaTiposProcesoQuery = z
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
  .describe('Filtros, orden y paginación del listado de tipos de proceso.');

/** Parámetros de listado de tipos de proceso ya coaccionados desde la URL. */
export type TiposProcesoQuery = z.infer<typeof esquemaTiposProcesoQuery>;

/** Respuesta paginada del listado de tipos de proceso (forma estándar `Pagina<T>`). */
export const esquemaTiposProcesoPagina = z
  .object({
    datos: z.array(esquemaTipoProcesoSalida).describe('Tipos de proceso de la página.'),
    total: z.number().int().describe('Total que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de tipos de proceso.');

/** Forma de la respuesta paginada de tipos de proceso. */
export type TiposProcesoPagina = z.infer<typeof esquemaTiposProcesoPagina>;
