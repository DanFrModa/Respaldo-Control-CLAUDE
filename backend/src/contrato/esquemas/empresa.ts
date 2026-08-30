import { z } from 'zod';

import { esRfcValido } from './fiscal.js';

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
  /**
   * RFC fiscal de la empresa (F9-E3, R11). Se usa para validar el RECEPTOR de los CFDI de proveedores
   * importados (A9) y como EMISOR de los CFDI de ventas (F9-E4). Se acepta vacío ('') para no
   * capturarlo / limpiarlo; si viene, debe tener la forma del RFC mexicano.
   */
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .max(13, { error: 'El RFC no puede tener más de 13 caracteres' })
    .refine((v) => v === '' || esRfcValido(v), {
      error: 'El RFC no tiene una forma válida (12 para moral, 13 para física)',
    })
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
    rfc: z.string().nullable().describe('RFC fiscal de la empresa (F9-E3), o null.'),
    identificador: z.string().nullable().describe('Identificador corto para folios, o null.'),
    favorita: z.boolean().describe('Empresa propuesta por defecto al iniciar sesión.'),
    paraIpt: z.boolean().describe('Participa en el inventario de producto terminado.'),
    paraEdr: z.boolean().describe('Participa en el estado de resultados.'),
    activa: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    idArchivoLogo: z
      .string()
      .nullable()
      .describe(
        'Id del Archivo que es el LOGO de la empresa, o null si usa el empaquetado. ' +
          'Sirve además de versión para refrescar la caché del navegador al cambiarlo.',
      ),
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
  agingLimite1: z
    .number({ error: 'El primer límite de antigüedad debe ser un número' })
    .int()
    .min(1)
    .max(3650)
    .optional()
    .describe('Fin de la primera cubeta de aging (días de atraso, F9-E5/D15d). Default 30.'),
  agingLimite2: z
    .number({ error: 'El segundo límite de antigüedad debe ser un número' })
    .int()
    .min(1)
    .max(3650)
    .optional()
    .describe('Fin de la segunda cubeta de aging (días de atraso, F9-E5/D15d). Default 60.'),
  pctDesvioCompra: z
    .number({ error: 'El porcentaje de desvío debe ser un número' })
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      '⭐⭐ V1-E3u (§Post-F9.89(a)) — a partir de qué % de diferencia entre lo que el sistema calculó ' +
        'y lo que Compras pidió se AVISA a quien autoriza la OC. Default 10. 🔴 Sólo avisa: nunca ' +
        'impide autorizar.',
    ),
  costoEmpaqueBase: z
    .number({ error: 'El costo de empaque debe ser un número' })
    .nonnegative({ error: 'El costo de empaque no puede ser negativo' })
    .max(100000)
    .optional()
    .describe(
      '⭐ V1-E8w (§Post-F9.153) — COSTO DE EMPAQUE por prenda, la tercera ancla fija del precosto. ' +
        'Daniel: *"Ponle 2.20 pesos por default, y ya si cambia, que se pueda modificar"*. Default ' +
        '2.20. 🔴 Cambiarlo alimenta sólo los renglones NUEVOS: ninguna receta ya hecha se mueve.',
    ),
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
    agingLimite1: z
      .number()
      .int()
      .describe(
        'Fin de la primera cubeta de aging (días, F9-E5/D15d). Siempre presente (default 30).',
      ),
    agingLimite2: z
      .number()
      .int()
      .describe(
        'Fin de la segunda cubeta de aging (días, F9-E5/D15d). Siempre presente (default 60).',
      ),
    pctDesvioCompra: z
      .number()
      .int()
      .describe(
        '⭐⭐ V1-E3u: % de desvío a partir del cual se avisa a quien autoriza la OC (§Post-F9.89(a)). ' +
          'Siempre presente (default 10).',
      ),
    costoEmpaqueBase: z
      .number()
      .describe(
        '⭐ V1-E8w: costo de empaque por prenda con el que nacen los precostos nuevos ' +
          '(§Post-F9.153). Siempre presente (default 2.20).',
      ),
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

// ── LOGO de la empresa (post-F9, petición de Daniel del 25-jul-2026) ──────────

/**
 * Solicitud de subida del LOGO de la empresa (flujo presigned, igual que la foto de bordado). Solo
 * **PNG o JPG** y hasta **5 MB**: son los formatos que `@react-pdf/renderer` sabe incrustar en los
 * impresos, y el peso viaja dentro de cada PDF. El dominio re-valida (es la autoridad).
 */
export const esquemaEmpresaLogoCrear = z
  .object({
    nombreOriginal: z
      .string({ error: 'El nombre del archivo es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre del archivo es obligatorio' })
      .max(255)
      .describe('Nombre del archivo tal como lo llama el usuario.'),
    tipoMime: z
      .enum(['image/png', 'image/jpeg'], {
        error: 'El logo debe ser una imagen PNG o JPG (son las que se pueden imprimir en los PDF)',
      })
      .describe('Tipo MIME del logo: image/png o image/jpeg.'),
    tamanoBytes: z
      .number({ error: 'El tamaño es obligatorio' })
      .int({ error: 'El tamaño debe ser un entero de bytes' })
      .positive({ error: 'El archivo está vacío' })
      .max(5 * 1024 * 1024, { error: 'El logo no puede pesar más de 5 MB' })
      .describe('Tamaño exacto en bytes.'),
  })
  .describe('Datos para preparar la subida del logo de la empresa.');

/** Datos validados de la solicitud de subida del logo. */
export type DatosEmpresaLogoCrear = z.infer<typeof esquemaEmpresaLogoCrear>;

/**
 * Confirmación de la subida del logo (PASO 2). Se manda DESPUÉS de que el PUT a R2 salió bien: solo
 * entonces la empresa cambia de logo y se borra el anterior. Así una subida a medias (PUT fallido,
 * pestaña cerrada) deja intacta la marca del sistema.
 */
export const esquemaEmpresaLogoConfirmar = z
  .object({
    idArchivo: z
      .string({ error: 'El id del archivo es obligatorio' })
      .trim()
      .min(1, { error: 'El id del archivo es obligatorio' })
      .describe('Id del Archivo devuelto al preparar la subida.'),
  })
  .describe('Confirma que el logo ya se subió a R2 y lo deja como logo vigente.');

/** Datos validados de la confirmación del logo. */
export type DatosEmpresaLogoConfirmar = z.infer<typeof esquemaEmpresaLogoConfirmar>;

/** Salida tras solicitar la subida del logo: registro + URL PUT prefirmada para R2. */
export const esquemaEmpresaLogoSubida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo creado para el logo.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida del logo (URL prefirmada).');

/** Forma de la respuesta al preparar la subida del logo. */
export type EmpresaLogoSubida = z.infer<typeof esquemaEmpresaLogoSubida>;

/**
 * Logo de una empresa con su URL GET prefirmada (para la vista previa de Administración). Todo en
 * `null` cuando la empresa aún no tiene logo propio: ahí el sistema usa el PNG empaquetado.
 */
export const esquemaEmpresaLogoSalida = z
  .object({
    idArchivo: z.string().nullable().describe('Id del registro Archivo del logo, o null.'),
    nombreOriginal: z.string().nullable().describe('Nombre original del archivo, o null.'),
    tipoMime: z.string().nullable().describe('Tipo MIME del logo, o null.'),
    tamanoBytes: z.number().int().nullable().describe('Tamaño en bytes, o null.'),
    urlDescarga: z
      .string()
      .nullable()
      .describe('URL GET prefirmada para ver el logo, o null si la empresa no tiene.'),
  })
  .describe('Logo de la empresa (con su URL de descarga) o vacío si no tiene.');

/** Forma del logo de una empresa tal como la devuelve la API. */
export type EmpresaLogoSalida = z.infer<typeof esquemaEmpresaLogoSalida>;
