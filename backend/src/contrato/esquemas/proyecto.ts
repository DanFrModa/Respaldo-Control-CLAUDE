import { z } from 'zod';

import { esquemaDesarrolloSalida } from './desarrollo.js';

/**
 * Contrato Zod de los PROYECTOS de desarrollo (F8-E2, D13/R16 — Desarrollo y Cotización).
 *
 * Un `Proyecto` = 1 cliente + 1 departamento, con nombre/tema (joggers, Disney, básicos…). Es la
 * capa PREVIA a la cotización: agrupa `Desarrollo`s (cada uno un modelo). El folio es consecutivo
 * POR EMPRESA (A3/A9). El dominio valida que el departamento PERTENEZCA al cliente (A1). Archivar
 * es un borrado suave reversible (`archivado`). Varios proyectos del MISMO cliente+departamento+
 * temporada con tema distinto SE PERMITEN (sólo el folio es único por empresa).
 *
 * Reglas de captura (las repite el dominio, A1): `idCliente`/`idClienteDepartamento`/`nombre`
 * obligatorios; `idTemporada`/`notas` opcionales. El folio, la empresa y la auditoría los pone el
 * dominio. Semántica del PATCH parcial (M1): omitir (`undefined`) = no tocar; `null` = vaciar.
 */

/** Nombre/tema del proyecto (clave de negocio del proyecto, obligatorio). */
const nombreProyecto = z
  .string({ error: 'El nombre es obligatorio' })
  .trim()
  .min(1, { error: 'El nombre es obligatorio' })
  .max(150, { error: 'El nombre no puede tener más de 150 caracteres' });

/** Notas libres del proyecto. */
const notasProyecto = z
  .string()
  .trim()
  .max(2000, { error: 'Las notas no pueden tener más de 2000 caracteres' });

// ── Alta / edición ─────────────────────────────────────────────────────────────────

/**
 * Alta de un proyecto de desarrollo (D13/R16). El cliente + su departamento + el nombre/tema, y
 * (opcional) la temporada y notas. El dominio valida que el departamento pertenezca al cliente.
 */
export const esquemaProyectoCrear = z.object({
  idCliente: z
    .number({ error: 'El cliente es obligatorio' })
    .int({ error: 'El id del cliente debe ser entero' })
    .positive({ error: 'El id del cliente debe ser positivo' })
    .describe('Cliente dueño del proyecto.'),
  idClienteDepartamento: z
    .number({ error: 'El departamento es obligatorio' })
    .int({ error: 'El id del departamento debe ser entero' })
    .positive({ error: 'El id del departamento debe ser positivo' })
    .describe('Departamento del cliente (debe pertenecer al cliente).'),
  nombre: nombreProyecto.describe('Nombre/tema del proyecto (joggers, Disney, básicos…).'),
  idTemporada: z
    .number({ error: 'El id de la temporada debe ser un número' })
    .int({ error: 'El id de la temporada debe ser entero' })
    .positive({ error: 'El id de la temporada debe ser positivo' })
    .optional()
    .describe('Temporada del proyecto (opcional).'),
  notas: notasProyecto.optional().describe('Notas del proyecto (opcional).'),
});

/** Datos validados de alta de proyecto. */
export type DatosProyectoCrear = z.infer<typeof esquemaProyectoCrear>;

/**
 * Edición de un proyecto: nombre/departamento/temporada/notas. El CLIENTE no se cambia (un proyecto
 * es de un cliente; para otro cliente se crea uno nuevo). Si cambia el departamento, el dominio
 * valida que el nuevo pertenezca al MISMO cliente. `archivado` NO va aquí: archivar/desarchivar es
 * su propia operación. PATCH parcial (M1). El `id` va en la URL.
 */
export const esquemaProyectoEditar = z.object({
  idClienteDepartamento: z
    .number({ error: 'El id del departamento debe ser entero' })
    .int()
    .positive()
    .optional()
    .describe('Departamento del cliente (si se omite, no se toca; debe pertenecer al cliente).'),
  nombre: nombreProyecto.optional().describe('Nombre/tema del proyecto (si se omite, no se toca).'),
  idTemporada: z
    .number({ error: 'El id de la temporada debe ser entero' })
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Temporada (null para vaciarla; omitir para no tocar).'),
  notas: notasProyecto
    .nullable()
    .optional()
    .describe('Notas (null para vaciarlas; omitir para no tocar).'),
});

/** Datos validados de edición de proyecto. */
export type DatosProyectoEditar = z.infer<typeof esquemaProyectoEditar>;

// ── Salida ───────────────────────────────────────────────────────────────────────

/**
 * Conteo de desarrollos del proyecto por ESTADO DERIVADO (para la tarjeta de la lista). `total` es
 * la suma de todos (incluidos los apagados). El dominio calcula el estado de cada desarrollo y
 * agrega aquí.
 */
export const esquemaConteosDesarrollo = z
  .object({
    total: z.number().int().describe('Total de desarrollos (incluidos los apagados).'),
    enDesarrollo: z.number().int().describe('Desarrollos en desarrollo (default).'),
    cotizado: z.number().int().describe('Desarrollos con ≥1 precosto congelado.'),
    enLista: z.number().int().describe('Desarrollos en ≥1 lista de precios.'),
    ligadoProduccion: z.number().int().describe('Desarrollos ligados a ≥1 orden de producción.'),
    apagado: z.number().int().describe('Desarrollos apagados (borrado suave).'),
  })
  .describe('Conteo de desarrollos del proyecto por estado derivado.');

/** Conteo de desarrollos por estado. */
export type ConteosDesarrollo = z.infer<typeof esquemaConteosDesarrollo>;

/** Salida de un proyecto en la LISTA (sin el arreglo de desarrollos; sólo sus conteos). */
export const esquemaProyectoSalida = z
  .object({
    id: z.number().int().describe('Id interno del proyecto.'),
    folio: z.number().int().describe('Folio consecutivo por empresa.'),
    idEmpresa: z.number().int().describe('Empresa dueña del proyecto y del folio.'),
    idCliente: z.number().int().describe('Cliente del proyecto.'),
    cliente: z.string().describe('Nombre del cliente (para la UI).'),
    idClienteDepartamento: z.number().int().describe('Departamento del cliente.'),
    departamento: z.string().describe('Nombre del departamento (para la UI).'),
    nombre: z.string().describe('Nombre/tema del proyecto.'),
    idTemporada: z.number().int().nullable().describe('Temporada del proyecto, o null.'),
    temporada: z.string().nullable().describe('Nombre de la temporada, o null.'),
    notas: z.string().nullable().describe('Notas del proyecto, o null.'),
    archivado: z.boolean().describe('Archivado (borrado suave reversible).'),
    conteos: esquemaConteosDesarrollo,
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Proyecto de desarrollo (encabezado + conteos de desarrollos).');

/** Forma de un proyecto en la lista de la API. */
export type ProyectoSalida = z.infer<typeof esquemaProyectoSalida>;

/** Salida del DETALLE de un proyecto: el encabezado + el arreglo de sus desarrollos. */
export const esquemaProyectoDetalleSalida = esquemaProyectoSalida
  .extend({
    desarrollos: z
      .array(esquemaDesarrolloSalida)
      .describe('Desarrollos del proyecto (con su estado derivado).'),
  })
  .describe('Detalle de un proyecto de desarrollo (con sus desarrollos).');

/** Forma del detalle de un proyecto en la API. */
export type ProyectoDetalleSalida = z.infer<typeof esquemaProyectoDetalleSalida>;

// ── Listado ─────────────────────────────────────────────────────────────────────

/** Parámetros del listado de proyectos EN LA URL (querystring, coacciona desde texto). */
export const esquemaProyectosQuery = z
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
      .max(200)
      .optional()
      .describe('Texto a buscar (folio o nombre del proyecto).'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    idClienteDepartamento: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por departamento del cliente.'),
    idTemporada: z.coerce.number().int().positive().optional().describe('Filtra por temporada.'),
    incluirArchivados: z
      .stringbool()
      .default(false)
      .describe('Incluye los proyectos archivados ("true"/"false").'),
    ordenarPor: z
      .enum(['folio', 'nombre', 'creadoEn'])
      .default('folio')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('desc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de proyectos.');

/** Parámetros de listado de proyectos ya coaccionados desde la URL. */
export type ProyectosQuery = z.infer<typeof esquemaProyectosQuery>;

/** Respuesta paginada del listado de proyectos (forma estándar `Pagina<T>`). */
export const esquemaProyectosPagina = z
  .object({
    datos: z.array(esquemaProyectoSalida).describe('Proyectos de la página.'),
    total: z.number().int().describe('Total de proyectos que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de proyectos.');

/** Forma de la respuesta paginada de proyectos. */
export type ProyectosPagina = z.infer<typeof esquemaProyectosPagina>;
