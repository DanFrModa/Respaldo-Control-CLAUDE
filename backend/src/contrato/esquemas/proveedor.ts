import { z } from 'zod';

/**
 * Tipos de proveedor (clasificación de negocio). Equivale al campo `TipoProv`
 * (H/T/S) del sistema viejo (doc 03-Producción §Órdenes de Compra); el mapeo de
 * esos códigos a este enum lo hace el ETL en F1-E6. Debe mantenerse alineado con
 * el enum `TipoProveedor` de `src/datos`.
 */
export const TIPOS_PROVEEDOR = ['TELAS', 'AVIOS', 'SERVICIOS', 'SIN_CLASIFICAR'] as const;

/** Clave de tipo de proveedor. */
export type TipoProveedorClave = (typeof TIPOS_PROVEEDOR)[number];

/** Etiquetas para UI de cada tipo de proveedor. */
export const ETIQUETAS_TIPO_PROVEEDOR: Record<TipoProveedorClave, string> = {
  TELAS: 'Telas',
  AVIOS: 'Avíos',
  SERVICIOS: 'Servicios',
  SIN_CLASIFICAR: 'Sin clasificar',
};

/**
 * Alta de proveedor (catálogo global F1-E1, ADR-0007: sin `idEmpresa`). El nombre
 * es la clave de negocio (único global); los demás datos son opcionales.
 */
export const esquemaProveedorCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
  razonSocial: z
    .string()
    .trim()
    .max(200, { error: 'La razón social no puede tener más de 200 caracteres' })
    .optional(),
  tipo: z
    .enum(TIPOS_PROVEEDOR, { error: 'El tipo debe ser TELAS, AVIOS, SERVICIOS o SIN_CLASIFICAR' })
    .default('SIN_CLASIFICAR'),
  telefono: z
    .string()
    .trim()
    .max(100, { error: 'El teléfono no puede tener más de 100 caracteres' })
    .optional(),
  contacto: z
    .string()
    .trim()
    .max(150, { error: 'El contacto no puede tener más de 150 caracteres' })
    .optional(),
  condiciones: z
    .string()
    .trim()
    .max(500, { error: 'Las condiciones no pueden tener más de 500 caracteres' })
    .optional(),
});

/** Datos validados de alta de proveedor. */
export type DatosProveedorCrear = z.infer<typeof esquemaProveedorCrear>;

/**
 * Edición de proveedor: todos los campos del alta son opcionales (edición parcial)
 * más `activo` para el borrado suave (plan §4: nada se borra físicamente).
 */
export const esquemaProveedorEditar = esquemaProveedorCrear.partial().extend({
  id: z
    .number({ error: 'El id del proveedor es obligatorio' })
    .int({ error: 'El id del proveedor debe ser entero' })
    .positive({ error: 'El id del proveedor debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de proveedor. */
export type DatosProveedorEditar = z.infer<typeof esquemaProveedorEditar>;

/**
 * Salida de un proveedor en la API (lo que ve el frontend). Proyección del modelo
 * `Proveedor` a JSON, con la auditoría (quién/cuándo). Parte del contrato OpenAPI.
 */
export const esquemaProveedorSalida = z
  .object({
    id: z.number().int().describe('Id del proveedor.'),
    nombre: z.string().describe('Nombre del proveedor.'),
    razonSocial: z.string().nullable().describe('Razón social, o null.'),
    tipo: z
      .enum(TIPOS_PROVEEDOR)
      .describe('Clasificación: TELAS, AVIOS, SERVICIOS o SIN_CLASIFICAR.'),
    telefono: z.string().nullable().describe('Teléfono, o null.'),
    contacto: z.string().nullable().describe('Persona de contacto, o null.'),
    condiciones: z.string().nullable().describe('Condiciones comerciales, o null.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Proveedor del catálogo (global).');

/** Forma de un proveedor tal como lo devuelve la API. */
export type ProveedorSalida = z.infer<typeof esquemaProveedorSalida>;

/**
 * Parámetros del listado de proveedores EN LA URL (querystring): todo llega como
 * texto, así que se coaccionan números y banderas. Mapea 1:1 al servicio de
 * dominio `listarProveedores`. `.describe()` documenta el contrato.
 */
export const esquemaProveedoresQuery = z
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
    tipo: z.enum(TIPOS_PROVEEDOR).optional().describe('Filtra por tipo de proveedor.'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    ordenarPor: z
      .enum(['nombre', 'tipo', 'creadoEn'])
      .default('nombre')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de proveedores.');

/** Parámetros de listado de proveedores ya coaccionados desde la URL. */
export type ProveedoresQuery = z.infer<typeof esquemaProveedoresQuery>;

/** Respuesta paginada del listado de proveedores (forma estándar `Pagina<T>`). */
export const esquemaProveedoresPagina = z
  .object({
    datos: z.array(esquemaProveedorSalida).describe('Proveedores de la página.'),
    total: z.number().int().describe('Total de proveedores que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de proveedores.');

/** Forma de la respuesta paginada de proveedores. */
export type ProveedoresPagina = z.infer<typeof esquemaProveedoresPagina>;
