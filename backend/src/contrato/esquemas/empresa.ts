import { z } from 'zod';

/**
 * Esquemas del contrato de Empresas y su configuración (Administración, F1-E1
 * PIEZA C). Reflejan 1:1 lo que aceptan los servicios de dominio
 * `dominio/admin/empresas` (que re-validan y son la autoridad).
 *
 * Las empresas son POCAS: el listado del dominio devuelve TODAS (sin paginación),
 * así que el contrato del listado es un arreglo simple, no una página.
 */

/**
 * Alta de empresa. `nombre` es la clave de negocio (único, insensible a
 * mayúsculas en el dominio); el resto es opcional. Las banderas por defecto van
 * en falso (igual que el esquema del dominio).
 */
export const esquemaEmpresaCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  razonSocial: z
    .string()
    .trim()
    .max(200, { error: 'La razón social no puede tener más de 200 caracteres' })
    .optional(),
  identificador: z
    .string()
    .trim()
    .max(20, { error: 'El identificador no puede tener más de 20 caracteres' })
    .optional(),
  favorita: z.boolean({ error: 'Favorita debe ser verdadero o falso' }).default(false),
  paraIpt: z.boolean({ error: 'Para IPT debe ser verdadero o falso' }).default(false),
  paraEdr: z.boolean({ error: 'Para EDR debe ser verdadero o falso' }).default(false),
});

/** Datos validados de alta de empresa. */
export type DatosEmpresaCrear = z.infer<typeof esquemaEmpresaCrear>;

/**
 * Edición de empresa: todos los campos del alta son opcionales (edición parcial)
 * más `activa` para reactivar (el borrado suave se hace por DELETE). El dominio
 * exige que haya al menos un cambio.
 *
 * Las banderas con `.default(false)` en el alta se sobrescriben aquí como `.optional()`
 * SIN default: en una edición parcial, omitir una bandera NO debe resetearla (Zod
 * `.partial()` NO quita los defaults). Si no se mandan, quedan `undefined` y conservan
 * su valor real en la BD (p. ej. editar el `identificador` no borra la marca de favorita).
 */
export const esquemaEmpresaEditar = esquemaEmpresaCrear.partial().extend({
  favorita: z.boolean({ error: 'Favorita debe ser verdadero o falso' }).optional(),
  paraIpt: z.boolean({ error: 'Para IPT debe ser verdadero o falso' }).optional(),
  paraEdr: z.boolean({ error: 'Para EDR debe ser verdadero o falso' }).optional(),
  activa: z.boolean({ error: 'Activa debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de empresa. */
export type DatosEmpresaEditar = z.infer<typeof esquemaEmpresaEditar>;

/**
 * Salida de una empresa en la API. Proyección del modelo `Empresa` a JSON, con
 * la auditoría (quién/cuándo). Parte del contrato OpenAPI.
 */
export const esquemaEmpresaSalida = z
  .object({
    id: z.number().int().describe('Id de la empresa.'),
    nombre: z.string().describe('Nombre corto de uso diario.'),
    razonSocial: z.string().nullable().describe('Razón social, o null.'),
    identificador: z.string().nullable().describe('Identificador corto para folios, o null.'),
    favorita: z.boolean().describe('Empresa propuesta por defecto al iniciar sesión.'),
    paraIpt: z.boolean().describe('Participa en el inventario de producto terminado.'),
    paraEdr: z.boolean().describe('Participa en el estado de resultados.'),
    activa: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Empresa (multi-empresa explícito, A9).');

/** Forma de una empresa tal como la devuelve la API. */
export type EmpresaSalida = z.infer<typeof esquemaEmpresaSalida>;

/**
 * Configuración POR EMPRESA a actualizar (ex-`Propiedades`). Todos los campos
 * opcionales; las fechas viajan como ISO 8601 (la ruta las convierte a `Date`
 * antes de delegar). El dominio exige al menos un cambio y valida el almacén PT.
 */
export const esquemaConfiguracionEmpresaActualizar = z.object({
  utilidadSugerida: z
    .number({ error: 'La utilidad sugerida debe ser un número' })
    .min(0)
    .max(1000)
    .nullable()
    .optional()
    .describe('Utilidad sugerida para costeo (porcentaje).'),
  regaliasBase: z
    .number({ error: 'Las regalías base deben ser un número' })
    .min(0)
    .max(1000)
    .nullable()
    .optional()
    .describe('Porcentaje base de regalías.'),
  colchonCostura: z
    .number({ error: 'El colchón de costura debe ser un número' })
    .int()
    .min(0)
    .max(365)
    .nullable()
    .optional()
    .describe('Días de colchón que la Ruta Crítica suma a la costura.'),
  fechaInventarioTelas: z.iso
    .datetime()
    .nullable()
    .optional()
    .describe('Fecha del último inventario físico de telas (ISO 8601).'),
  fechaInventarioPt: z.iso
    .datetime()
    .nullable()
    .optional()
    .describe('Fecha del último inventario físico de PT (ISO 8601).'),
  idAlmacenPtDefault: z
    .number({ error: 'El almacén PT por defecto debe ser un número' })
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Almacén PT por defecto (debe ser un almacén activo de tipo PT).'),
});

/** Datos validados de la configuración de empresa (fechas como ISO string). */
export type DatosConfiguracionEmpresaActualizar = z.infer<
  typeof esquemaConfiguracionEmpresaActualizar
>;

/**
 * Salida de la configuración de una empresa. Los `Decimal` de Prisma se exponen
 * como número y las fechas como ISO 8601 (o null). Parte del contrato OpenAPI.
 */
export const esquemaConfiguracionEmpresaSalida = z
  .object({
    idEmpresa: z.number().int().describe('Id de la empresa dueña de la configuración.'),
    utilidadSugerida: z.number().nullable().describe('Utilidad sugerida (porcentaje), o null.'),
    regaliasBase: z.number().nullable().describe('Porcentaje base de regalías, o null.'),
    colchonCostura: z.number().int().nullable().describe('Días de colchón de costura, o null.'),
    fechaInventarioTelas: z.iso
      .datetime()
      .nullable()
      .describe('Fecha del último inventario de telas (ISO 8601), o null.'),
    fechaInventarioPt: z.iso
      .datetime()
      .nullable()
      .describe('Fecha del último inventario de PT (ISO 8601), o null.'),
    idAlmacenPtDefault: z.number().int().nullable().describe('Almacén PT por defecto, o null.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
  })
  .describe('Configuración por empresa (ex-Propiedades del sistema viejo).');

/** Forma de la configuración de empresa tal como la devuelve la API. */
export type ConfiguracionEmpresaSalida = z.infer<typeof esquemaConfiguracionEmpresaSalida>;
