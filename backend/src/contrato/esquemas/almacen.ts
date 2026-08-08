import { z } from 'zod';

/**
 * Tipos de almacén del kardex único (plan maestro §4 "Motor de inventario único", D3):
 * PT = producto terminado, TELA = telas, AVIO = avíos.
 * Debe mantenerse alineado con el enum `TipoAlmacen` de `src/datos`.
 */
export const TIPOS_ALMACEN = ['PT', 'TELA', 'AVIO'] as const;

/** Clave de tipo de almacén. */
export type TipoAlmacenClave = (typeof TIPOS_ALMACEN)[number];

/** Etiquetas para UI de cada tipo de almacén. */
export const ETIQUETAS_TIPO_ALMACEN: Record<TipoAlmacenClave, string> = {
  PT: 'Producto terminado',
  TELA: 'Telas',
  AVIO: 'Avíos',
};

/**
 * Alta de almacén (CRUD patrón de F0, plan maestro §6 criterio de salida).
 * `idEmpresa` es opcional: un almacén puede ser global o de una empresa (A9).
 */
export const esquemaAlmacenCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  tipo: z.enum(TIPOS_ALMACEN, {
    error: 'El tipo debe ser PT (producto terminado), TELA o AVIO',
  }),
  idEmpresa: z
    .number({ error: 'La empresa debe ser un número' })
    .int({ error: 'La empresa debe ser un id entero' })
    .positive({ error: 'La empresa debe ser un id positivo' })
    .optional(),
  /**
   * CORTADOR dueño del almacén (§Post-F9.13): opcional y SOLO para almacenes de TELA. Es un
   * proveedor con rol `corte`; el dominio valida ambas cosas. `null` = sin cortador (y en la
   * edición, quitar la liga que hubiera).
   */
  idCortador: z
    .number({ error: 'El cortador debe ser un número' })
    .int({ error: 'El cortador debe ser un id entero' })
    .positive({ error: 'El cortador debe ser un id positivo' })
    .nullable()
    .optional(),
});

/** Datos validados de alta de almacén. */
export type DatosAlmacenCrear = z.infer<typeof esquemaAlmacenCrear>;

/**
 * Edición de almacén: todos los campos del alta son opcionales (edición parcial)
 * más `activo` para el borrado suave (plan §4, patrón conservado: nada se borra físicamente).
 */
export const esquemaAlmacenEditar = esquemaAlmacenCrear.partial().extend({
  id: z
    .number({ error: 'El id del almacén es obligatorio' })
    .int({ error: 'El id del almacén debe ser entero' })
    .positive({ error: 'El id del almacén debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de almacén. */
export type DatosAlmacenEditar = z.infer<typeof esquemaAlmacenEditar>;

/**
 * Salida de un almacén en la API (lo que ve el frontend). Es la proyección del
 * modelo `Almacen` a JSON: incluye la auditoría (quién/cuándo) sin filtrar nada
 * sensible. Parte del contrato OpenAPI.
 */
export const esquemaAlmacenSalida = z
  .object({
    id: z.number().int().describe('Id del almacén.'),
    nombre: z.string().describe('Nombre del almacén.'),
    tipo: z.enum(TIPOS_ALMACEN).describe('Tipo: PT, TELA o AVIO.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    idEmpresa: z
      .number()
      .int()
      .nullable()
      .describe('Empresa dueña, o null si es un almacén global.'),
    idCortador: z
      .number()
      .int()
      .nullable()
      .describe('Proveedor CORTADOR dueño del almacén (§Post-F9.13), o null si no tiene.'),
    cortador: z
      .string()
      .nullable()
      .describe('Nombre del cortador ligado (para pintarlo sin otra consulta), o null.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Almacén del catálogo (base del kardex único).');

/** Forma de un almacén tal como lo devuelve la API. */
export type AlmacenSalida = z.infer<typeof esquemaAlmacenSalida>;

/**
 * Parámetros del listado de almacenes EN LA URL (querystring): todo llega como
 * texto, así que se coaccionan números y banderas. Mapea 1:1 a los parámetros
 * del servicio de dominio `listarAlmacenes`. `.describe()` documenta el contrato.
 */
export const esquemaAlmacenesQuery = z
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
    tipo: z.enum(TIPOS_ALMACEN).optional().describe('Filtra por tipo de almacén.'),
    // En querystring todo es texto: stringbool acepta "true"/"false"/"1"/"0"
    // (z.coerce.boolean trataría cualquier texto no vacío como true).
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    todasLasEmpresas: z
      .stringbool()
      .default(false)
      .describe('Lista almacenes de todas las empresas ("true"/"false").'),
    ordenarPor: z
      .enum(['nombre', 'tipo', 'creadoEn'])
      .default('nombre')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de almacenes.');

/** Parámetros de listado de almacenes ya coaccionados desde la URL. */
export type AlmacenesQuery = z.infer<typeof esquemaAlmacenesQuery>;

/** Respuesta paginada del listado de almacenes (forma estándar `Pagina<T>`). */
export const esquemaAlmacenesPagina = z
  .object({
    datos: z.array(esquemaAlmacenSalida).describe('Almacenes de la página.'),
    total: z.number().int().describe('Total de almacenes que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de almacenes.');

/** Forma de la respuesta paginada de almacenes. */
export type AlmacenesPagina = z.infer<typeof esquemaAlmacenesPagina>;
