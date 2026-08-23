import { z } from 'zod';

/**
 * Esquemas Zod del catálogo de AUDITORES de calidad (rediseño R9 — proto `CAT_AUDITORES`). Una sola
 * definición de reglas para la UI y el servidor (alimenta el OpenAPI). CRUD patrón catálogo con
 * borrado suave; `rol` y `nivelAql` son listas cerradas. La salida trae `numeroAuditorias`, el
 * conteo DERIVADO del histórico (auditorías cuyo `auditorPorId` coincide con el nombre).
 */

/** Roles admitidos de un auditor (proto: badge "Auditor" / "Sr. Auditor"). */
export const ROLES_AUDITOR = ['Auditor', 'Sr. Auditor'] as const;

/** Clave de rol de auditor. */
export type RolAuditorClave = (typeof ROLES_AUDITOR)[number];

/** Niveles AQL de certificación admitidos (proto: 1.0 / 1.5 / 2.5 / 4.0). Texto, no numérico. */
export const NIVELES_AQL_AUDITOR = ['1.0', '1.5', '2.5', '4.0'] as const;

/** Clave de nivel AQL de auditor. */
export type NivelAqlAuditorClave = (typeof NIVELES_AQL_AUDITOR)[number];

/** Alta de auditor. */
export const esquemaAuditorCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(120, { error: 'El nombre no puede tener más de 120 caracteres' }),
  rol: z.enum(ROLES_AUDITOR, { error: 'El rol debe ser Auditor o Sr. Auditor' }),
  nivelAql: z.enum(NIVELES_AQL_AUDITOR, { error: 'El nivel AQL debe ser 1.0, 1.5, 2.5 o 4.0' }),
});

/** Datos validados de alta de auditor. */
export type DatosAuditorCrear = z.infer<typeof esquemaAuditorCrear>;

/** Edición parcial de auditor + `activo` para el borrado suave. */
export const esquemaAuditorEditar = esquemaAuditorCrear.partial().extend({
  id: z
    .number({ error: 'El id del auditor es obligatorio' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de auditor. */
export type DatosAuditorEditar = z.infer<typeof esquemaAuditorEditar>;

/** Salida de un auditor en la API (incluye el conteo derivado de auditorías). */
export const esquemaAuditorSalida = z
  .object({
    id: z.number().int().describe('Id del auditor.'),
    nombre: z.string().describe('Nombre del auditor.'),
    rol: z.enum(ROLES_AUDITOR).describe('Rol: Auditor o Sr. Auditor.'),
    nivelAql: z
      .enum(NIVELES_AQL_AUDITOR)
      .describe('Nivel AQL de certificación (1.0 / 1.5 / 2.5 / 4.0).'),
    numeroAuditorias: z
      .number()
      .int()
      .describe('Conteo de auditorías del histórico cuyo auditor coincide con este nombre.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Auditor del catálogo de calidad.');

/** Forma de un auditor tal como lo devuelve la API. */
export type AuditorSalida = z.infer<typeof esquemaAuditorSalida>;

/** Filtros, orden y paginación del listado de auditores (querystring). */
export const esquemaAuditoresQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    busqueda: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Texto a buscar en el nombre (insensible a mayúsculas).'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre').describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de auditores.');

/** Parámetros de listado de auditores ya coaccionados desde la URL. */
export type AuditoresQuery = z.infer<typeof esquemaAuditoresQuery>;

/** Respuesta paginada del listado de auditores. */
export const esquemaAuditoresPagina = z
  .object({
    datos: z.array(esquemaAuditorSalida).describe('Auditores de la página.'),
    total: z.number().int().describe('Total que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de auditores.');

/** Forma de la respuesta paginada de auditores. */
export type AuditoresPagina = z.infer<typeof esquemaAuditoresPagina>;
