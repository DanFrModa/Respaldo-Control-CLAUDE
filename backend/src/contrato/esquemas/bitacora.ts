import { z } from 'zod';

/**
 * Esquemas Zod de la CONSULTA DE BITÁCORA (F6-E1, transversal; A7). F0 entregó el motor de
 * auditoría A7 SOLO como escritura (`comun/auditoria.ts`); aquí se modela la LECTURA: el listado
 * paginado de los registros `Bitacora` con filtros por entidad, folio (idEntidad), usuario y rango
 * de fechas, para que la administración pueda auditar los cambios sin SQL. Solo lectura.
 */

/** Acciones registradas en la bitácora (alineado con el enum `AccionBitacora` de Prisma). */
export const ACCIONES_BITACORA = ['CREAR', 'MODIFICAR', 'DESACTIVAR', 'CANCELAR', 'OTRO'] as const;

/** Clave de acción de bitácora. */
export type AccionBitacoraClave = (typeof ACCIONES_BITACORA)[number];

/** Etiquetas para UI de cada acción. */
export const ETIQUETAS_ACCION_BITACORA: Record<AccionBitacoraClave, string> = {
  CREAR: 'Creó',
  MODIFICAR: 'Modificó',
  DESACTIVAR: 'Desactivó',
  CANCELAR: 'Canceló',
  OTRO: 'Otro',
};

/** Salida de un renglón de bitácora en la API. */
export const esquemaBitacoraSalida = z
  .object({
    id: z.string().describe('Id del registro (BigInt como texto).'),
    entidad: z.string().describe('Entidad afectada (ej. "Almacen").'),
    idEntidad: z.string().describe('Id del registro afectado (texto).'),
    accion: z.enum(ACCIONES_BITACORA).describe('Qué se hizo.'),
    datos: z.unknown().nullable().describe('Detalle del cambio en JSON (o null).'),
    idUsuario: z.string().nullable().describe('Id del usuario que hizo el cambio (o null).'),
    nombreUsuario: z
      .string()
      .nullable()
      .describe('Nombre del usuario (resuelto), o null si es de sistema/borrado.'),
    fecha: z.iso.datetime().describe('Cuándo ocurrió (ISO 8601).'),
  })
  .describe('Registro de bitácora (auditoría A7).');

/** Forma de un renglón de bitácora tal como lo devuelve la API. */
export type BitacoraSalida = z.infer<typeof esquemaBitacoraSalida>;

/** Filtros, orden y paginación del listado de bitácora (querystring). */
export const esquemaBitacoraQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    entidad: z.string().trim().max(100).optional().describe('Filtra por entidad (ej. "Almacen").'),
    idEntidad: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Filtra por id del registro afectado.'),
    idUsuario: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Filtra por usuario que hizo el cambio.'),
    accion: z.enum(ACCIONES_BITACORA).optional().describe('Filtra por acción.'),
    desde: z.iso.datetime().optional().describe('Fecha mínima (ISO 8601, inclusive).'),
    hasta: z.iso.datetime().optional().describe('Fecha máxima (ISO 8601, inclusive).'),
    direccion: z
      .enum(['asc', 'desc'])
      .default('desc')
      .describe('Dirección del orden por fecha (desc = más reciente primero).'),
  })
  .describe('Filtros, orden y paginación del listado de bitácora.');

/** Parámetros de listado de bitácora ya coaccionados desde la URL. */
export type BitacoraQuery = z.infer<typeof esquemaBitacoraQuery>;

/** Respuesta paginada del listado de bitácora. */
export const esquemaBitacoraPagina = z
  .object({
    datos: z.array(esquemaBitacoraSalida).describe('Registros de la página.'),
    total: z.number().int().describe('Total que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de registros de bitácora.');

/** Forma de la respuesta paginada de bitácora. */
export type BitacoraPagina = z.infer<typeof esquemaBitacoraPagina>;
