import { z } from 'zod';

/**
 * Esquemas Zod de FICHAS CONFIABLES (Módulo Indicadores, F7-E4; doc `05-Indicadores.md` §A.2; ex
 * `IP_InfConf` + consulta `Ind_IP_InfConfiable`). Checklist de confiabilidad de la ficha técnica POR
 * ORDEN, modelado por FILAS (reactivo × orden) en vez de las 8 columnas booleanas fijas del viejo (A6).
 *
 * Una sola definición para UI y servidor (OpenAPI). La lógica vive en `dominio/indicadores/fichas.ts`
 * (A1): el indicador "% de fichas confiables" = Σ reactivos OK ÷ Σ reactivos evaluados.
 */

// ── Catálogo de reactivos (configurable, A6) ─────────────────────────────────────────────────────

/** Alta de un reactivo del checklist. */
export const esquemaReactivoFichaCrear = z.object({
  clave: z
    .string({ error: 'La clave es obligatoria' })
    .trim()
    .min(1, { error: 'La clave es obligatoria' })
    .max(60, { error: 'La clave no puede tener más de 60 caracteres' })
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, {
      error: 'La clave usa letras, dígitos, guiones o guión bajo (ej. "InfTela")',
    }),
  etiqueta: z
    .string({ error: 'La etiqueta es obligatoria' })
    .trim()
    .min(1, { error: 'La etiqueta es obligatoria' })
    .max(120, { error: 'La etiqueta no puede tener más de 120 caracteres' }),
  orden: z.number().int().min(0).default(0).describe('Orden de despliegue.'),
});

/** Datos validados de alta de reactivo. */
export type DatosReactivoFichaCrear = z.infer<typeof esquemaReactivoFichaCrear>;

/** Edición parcial de reactivo + `activo`. `id` va en la URL. */
export const esquemaReactivoFichaEditar = esquemaReactivoFichaCrear.partial().extend({
  id: z.number().int().positive({ error: 'El id debe ser positivo' }),
  activo: z.boolean().optional(),
});

/** Datos validados de edición de reactivo. */
export type DatosReactivoFichaEditar = z.infer<typeof esquemaReactivoFichaEditar>;

/** Salida de un reactivo. */
export const esquemaReactivoFichaSalida = z
  .object({
    id: z.number().int(),
    clave: z.string(),
    etiqueta: z.string(),
    orden: z.number().int(),
    activo: z.boolean(),
    creadoEn: z.iso.datetime(),
    creadoPorId: z.string().nullable(),
    modificadoEn: z.iso.datetime(),
    modificadoPorId: z.string().nullable(),
  })
  .describe('Reactivo del checklist de confiabilidad de la ficha (catálogo global).');

/** Forma de un reactivo tal como lo devuelve la API. */
export type ReactivoFichaSalida = z.infer<typeof esquemaReactivoFichaSalida>;

/** Filtro del listado de reactivos (pocos; sin paginación). */
export const esquemaReactivosFichaQuery = z.object({
  incluirInactivos: z.stringbool().default(false),
});

/** Parámetros del listado de reactivos ya coaccionados. */
export type ReactivosFichaQuery = z.infer<typeof esquemaReactivosFichaQuery>;

/** Lista de reactivos (respuesta directa, ordenada por `orden`). */
export const esquemaReactivosFichaLista = z
  .object({ datos: z.array(esquemaReactivoFichaSalida) })
  .describe('Reactivos del checklist, ordenados.');

/** Forma de la lista de reactivos. */
export type ReactivosFichaLista = z.infer<typeof esquemaReactivosFichaLista>;

// ── Verificación de una orden ────────────────────────────────────────────────────────────────────

/** Un ítem del checklist a guardar: reactivo → hecho. */
const esquemaItemVerificacion = z.object({
  idReactivo: z.number().int().positive(),
  hecho: z.boolean(),
});

/**
 * Guarda (upsert) el checklist de confiabilidad de una orden. El revisor es el usuario de la sesión;
 * la fecha, hoy (o la enviada si tiene `indicadores.fecha-libre`). Reemplaza el estado de los
 * reactivos enviados; los no enviados quedan como estaban.
 */
export const esquemaVerificarFichaOrden = z.object({
  items: z
    .array(esquemaItemVerificacion)
    .min(1, { error: 'Debe enviar al menos un reactivo' })
    .describe('Reactivos a marcar (reactivo → hecho).'),
  fecha: z.iso.date().optional().describe('Fecha de la revisión (default hoy; libre con permiso).'),
});

/** Datos validados de verificación de ficha. */
export type DatosVerificarFichaOrden = z.infer<typeof esquemaVerificarFichaOrden>;

/** Un renglón del checklist de una orden (reactivo + estado). */
const esquemaFichaItemSalida = z.object({
  idReactivo: z.number().int(),
  clave: z.string(),
  etiqueta: z.string(),
  orden: z.number().int(),
  hecho: z.boolean(),
  revisorId: z.string().nullable(),
  fecha: z.iso.date().nullable(),
});

/** Checklist completo de una orden con su % de confiabilidad. */
export const esquemaFichaOrdenSalida = z
  .object({
    idOrden: z.number().int(),
    folio: z.number().int(),
    idModelo: z.number().int().nullable(),
    codigoModelo: z.string().nullable(),
    items: z.array(esquemaFichaItemSalida),
    totalReactivos: z.number().int().describe('Reactivos activos considerados.'),
    hechos: z.number().int().describe('Reactivos OK.'),
    porcentaje: z.number().nullable().describe('hechos ÷ total (fracción) o null si 0 reactivos.'),
    revisorId: z.string().nullable(),
    revisor: z.string().nullable(),
    fecha: z.iso.date().nullable().describe('Fecha de la última revisión.'),
  })
  .describe('Checklist de confiabilidad de la ficha de una orden.');

/** Forma del checklist de una orden. */
export type FichaOrdenSalida = z.infer<typeof esquemaFichaOrdenSalida>;

// ── Indicador agregado de % de fichas confiables ─────────────────────────────────────────────────

/** Filtros del indicador de fichas confiables. */
export const esquemaFichasConfiablesQuery = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  desde: z.iso.date().optional(),
  hasta: z.iso.date().optional(),
  idCliente: z.coerce.number().int().positive().optional(),
});

/** Parámetros del indicador ya coaccionados. */
export type FichasConfiablesQuery = z.infer<typeof esquemaFichasConfiablesQuery>;

/** Una orden evaluada en el indicador. */
const esquemaFichaConfiableFila = z.object({
  idOrden: z.number().int(),
  folio: z.number().int(),
  idCliente: z.number().int(),
  cliente: z.string(),
  idModelo: z.number().int(),
  codigoModelo: z.string(),
  totalReactivos: z.number().int(),
  hechos: z.number().int(),
  porcentaje: z.number().nullable(),
  confiable: z.boolean().describe('true si TODOS los reactivos evaluados están OK (ex "OK").'),
  fecha: z.iso.date().nullable(),
});

/** Respuesta del indicador de fichas confiables: global + página de órdenes. */
export const esquemaFichasConfiables = z
  .object({
    global: z.object({
      ordenesEvaluadas: z.number().int(),
      ordenesConfiables: z.number().int().describe('Órdenes con el 100% de reactivos OK.'),
      reactivosTotales: z.number().int(),
      reactivosOk: z.number().int(),
      porcentaje: z.number().nullable().describe('Σ OK ÷ Σ evaluados (fracción) o null.'),
    }),
    datos: z.array(esquemaFichaConfiableFila),
    total: z.number().int(),
    pagina: z.number().int(),
    porPagina: z.number().int(),
    totalPaginas: z.number().int(),
  })
  .describe('Indicador de % de fichas confiables (agregado + por orden).');

/** Forma del indicador de fichas confiables. */
export type FichasConfiables = z.infer<typeof esquemaFichasConfiables>;
