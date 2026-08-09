import { z } from 'zod';

/**
 * Contrato Zod del catálogo de DIRECCIONES DE ENTREGA (§Post-F9.18 — petición de Daniel: *"la
 * dirección de entrega debe de ser un catálogo de los que se llenan automáticamente, para que la
 * dirección, que en el 95% es la misma, tenga la dirección correcta y escrita siempre de la misma
 * manera"*). Antes era texto libre en la OC (`entregaEn`) y salía distinta en cada orden.
 *
 * Catálogo GLOBAL (ADR-0007: sin `idEmpresa`), borrado SUAVE, y SIN permiso propio: se gobierna con
 * `compras.ver`/`compras.administrar` (mismo criterio que `TelaCategoria` con `telas.administrar`,
 * ADR-0009) → no hace falta `SEED_ON_START` para estrenarlo.
 */

/** Campos comunes de alta/edición (devueltos por función: no se reusa la misma instancia de Zod). */
function camposDireccionEntrega() {
  return {
    nombre: z
      .string({ error: 'El nombre es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre es obligatorio' })
      .max(100, { error: 'El nombre no puede tener más de 100 caracteres' })
      .describe('Nombre corto con el que se elige ("Naucalpan"). Único global.'),
    direccion: z
      .string({ error: 'La dirección es obligatoria' })
      .trim()
      .min(1, { error: 'La dirección es obligatoria' })
      .max(1000, { error: 'La dirección no puede tener más de 1000 caracteres' })
      .describe('La dirección COMPLETA, tal como debe salir impresa en la OC.'),
    contacto: z
      .string()
      .trim()
      .max(200, { error: 'El contacto no puede tener más de 200 caracteres' })
      .nullable()
      .optional()
      .describe('A quién buscar en esa dirección.'),
    telefono: z
      .string()
      .trim()
      .max(50, { error: 'El teléfono no puede tener más de 50 caracteres' })
      .nullable()
      .optional()
      .describe('Teléfono de contacto.'),
    favorita: z
      .boolean({ error: 'Favorita debe ser verdadero o falso' })
      .optional()
      .describe('La de todos los días: se preselecciona al capturar una OC nueva.'),
  } as const;
}

/** Alta de una dirección de entrega. */
export const esquemaDireccionEntregaCrear = z.object({ ...camposDireccionEntrega() });

/** Datos validados de alta. */
export type DatosDireccionEntregaCrear = z.infer<typeof esquemaDireccionEntregaCrear>;

/** Edición parcial + `activo` para el borrado suave. */
export const esquemaDireccionEntregaEditar = z.object({
  id: z
    .number({ error: 'El id de la dirección es obligatorio' })
    .int({ error: 'El id de la dirección debe ser entero' })
    .positive({ error: 'El id de la dirección debe ser positivo' }),
  ...camposDireccionEntrega(),
  nombre: camposDireccionEntrega().nombre.optional(),
  direccion: camposDireccionEntrega().direccion.optional(),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición. */
export type DatosDireccionEntregaEditar = z.infer<typeof esquemaDireccionEntregaEditar>;

/** Salida de una dirección de entrega en la API. */
export const esquemaDireccionEntregaSalida = z
  .object({
    id: z.number().int().describe('Id de la dirección.'),
    nombre: z.string().describe('Nombre corto con el que se elige.'),
    direccion: z.string().describe('Dirección completa.'),
    contacto: z.string().nullable().describe('A quién buscar.'),
    telefono: z.string().nullable().describe('Teléfono.'),
    favorita: z.boolean().describe('Se preselecciona al capturar una OC nueva.'),
    activo: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Dirección de entrega del catálogo (global).');

/** Forma de una dirección tal como la devuelve la API. */
export type DireccionEntregaSalida = z.infer<typeof esquemaDireccionEntregaSalida>;

/** Parámetros del listado EN LA URL (todo llega como texto → se coacciona). */
export const esquemaDireccionesEntregaQuery = z
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
      .describe('Texto a buscar en nombre o dirección (insensible a mayúsculas).'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye las desactivadas ("true"/"false").'),
    ordenarPor: z
      .enum(['nombre', 'creadoEn'])
      .default('nombre')
      .describe('Columna de ordenamiento.'),
    // Ojo: `direccion` aquí es la DIRECCIÓN DEL ORDEN (asc/desc), como en todos los listados del
    // sistema — no la calle. El campo de la entidad también se llama `direccion`, pero viven en
    // objetos distintos (querystring vs. salida) y romper la convención saldría más caro.
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden (asc/desc).'),
  })
  .describe('Filtros, orden y paginación del listado de direcciones de entrega.');

/** Parámetros de listado ya coaccionados desde la URL. */
export type DireccionesEntregaQuery = z.infer<typeof esquemaDireccionesEntregaQuery>;

/** Respuesta paginada del listado (forma estándar `Pagina<T>`). */
export const esquemaDireccionesEntregaPagina = z
  .object({
    datos: z.array(esquemaDireccionEntregaSalida).describe('Direcciones de la página.'),
    total: z.number().int().describe('Total que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de direcciones de entrega.');

/** Forma de la respuesta paginada. */
export type DireccionesEntregaPagina = z.infer<typeof esquemaDireccionesEntregaPagina>;
