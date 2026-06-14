import { z } from 'zod';

/**
 * Contrato Zod de Cliente + ClienteCampo (F1-E2, PIEZA C — Clientes, D7).
 *
 * El sistema viejo solo tiene `IdClientes/Cliente/Activo` (doc `02-Pedidos.md` §2;
 * tabla `Clientes.csv`). v2 agrega contacto básico (contacto/teléfono/email/dirección)
 * y, sobre todo, la DEFINICIÓN de campos de referencia POR cliente (D7 — semilla del
 * `Monarch` viejo, `DECISIONES.md` D7; PLANMAESTRO §4). Aquí va el catálogo + la
 * definición de campos; los VALORES se capturan por orden en F2 (`OrdenReferencia`).
 *
 * Reglas de captura (las repite el dominio, A1): `nombre` de cliente único GLOBAL
 * (ADR-0007, sin `idEmpresa`); `etiqueta` de campo única DENTRO del cliente; `tipo`
 * (TEXTO/NUMERO/FECHA) validará el VALOR en F2. Semántica del PATCH parcial (M1, igual
 * que Proveedor): omitir un campo (`undefined`) = no tocar; mandar `null`/`''` en un
 * opcional = vaciarlo (se guarda `null`, nunca `''`). Decimal: N/A.
 */

/** Tipos de dato de un campo de referencia de cliente (D7). Alineado con `TipoCampoCliente` de src/datos. */
export const TIPOS_CAMPO_CLIENTE = ['TEXTO', 'NUMERO', 'FECHA'] as const;

/** Clave de tipo de campo de cliente. */
export type TipoCampoClienteClave = (typeof TIPOS_CAMPO_CLIENTE)[number];

// ── Campo de referencia del cliente (D7) ─────────────────────────────────────────
// (Se define antes que el Cliente porque su salida se embebe en la salida del Cliente.)

/**
 * Alta de un campo de referencia de un cliente (D7). `etiqueta` única DENTRO del
 * cliente (lo valida el dominio); `tipo` valida el VALOR en F2; `orden` da el orden de
 * despliegue (si se omite, el dominio lo asigna al final).
 */
export const esquemaClienteCampoCrear = z.object({
  etiqueta: z
    .string({ error: 'La etiqueta es obligatoria' })
    .trim()
    .min(1, { error: 'La etiqueta es obligatoria' })
    .max(100, { error: 'La etiqueta no puede tener más de 100 caracteres' }),
  tipo: z.enum(TIPOS_CAMPO_CLIENTE).default('TEXTO'),
  orden: z.number({ error: 'El orden debe ser un número' }).int().min(0).optional(),
});

/** Datos validados de alta de campo de cliente. */
export type DatosClienteCampoCrear = z.infer<typeof esquemaClienteCampoCrear>;

/**
 * Edición de un campo de referencia: campos del alta opcionales + `id` y `activo`.
 * Semántica M1: omitir = no tocar. `etiqueta`/`tipo`/`orden` no son nullable (no se
 * "vacían": se editan o se omiten); `activo` permite des/reactivar el campo.
 *
 * IMPORTANTE: `tipo` se re-declara como `.optional()` SIN `.default()`. Zod `.partial()`
 * NO quita los defaults, así que dejarlo heredado del alta haría que omitir `tipo` en
 * una edición lo rellenara con `'TEXTO'` y pisara el valor real (NUMERO/FECHA) en la BD
 * — el mismo bug que el CI atrapó en F1-E1. Aquí omitir `tipo` queda `undefined`.
 */
export const esquemaClienteCampoEditar = esquemaClienteCampoCrear.partial().extend({
  tipo: z.enum(TIPOS_CAMPO_CLIENTE).optional(),
  id: z
    .number({ error: 'El id del campo es obligatorio' })
    .int({ error: 'El id del campo debe ser entero' })
    .positive({ error: 'El id del campo debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de campo de cliente. */
export type DatosClienteCampoEditar = z.infer<typeof esquemaClienteCampoEditar>;

/** Salida de un campo de referencia de cliente en la API. */
export const esquemaClienteCampoSalida = z
  .object({
    id: z.number().int().describe('Id del campo.'),
    idCliente: z.number().int().describe('Id del cliente dueño del campo.'),
    etiqueta: z.string().describe('Etiqueta del campo (única por cliente).'),
    tipo: z.enum(TIPOS_CAMPO_CLIENTE).describe('Tipo de dato del valor (D7).'),
    orden: z.number().int().describe('Orden de despliegue dentro del cliente.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Campo de referencia de un cliente (D7).');

/** Forma de un campo de referencia tal como lo devuelve la API. */
export type ClienteCampoSalida = z.infer<typeof esquemaClienteCampoSalida>;

/** Lista de campos de referencia de un cliente (respuesta de `GET /clientes/:id/campos`). */
export const esquemaClienteCamposLista = z
  .object({
    datos: z.array(esquemaClienteCampoSalida).describe('Campos de referencia del cliente.'),
  })
  .describe('Campos de referencia de un cliente (D7).');

/** Forma de la lista de campos de un cliente. */
export type ClienteCamposLista = z.infer<typeof esquemaClienteCamposLista>;

// ── Campos de contacto reutilizables (mismas reglas en alta y edición) ────────────

/** Datos de contacto del cliente (todos opcionales). El `email`, si viene, debe ser válido. */
const camposContacto = {
  contacto: z
    .string()
    .trim()
    .max(150, { error: 'El contacto no puede tener más de 150 caracteres' })
    .optional(),
  telefono: z
    .string()
    .trim()
    .max(100, { error: 'El teléfono no puede tener más de 100 caracteres' })
    .optional(),
  email: z
    .email({ error: 'El email no es válido' })
    .max(200, { error: 'El email no puede tener más de 200 caracteres' })
    .optional(),
  direccion: z
    .string()
    .trim()
    .max(300, { error: 'La dirección no puede tener más de 300 caracteres' })
    .optional(),
} as const;

/**
 * Variante de EDICIÓN de los campos de contacto: cada uno acepta además `null` para
 * poder VACIAR un dato ya capturado (M1). `.nullable()` se aplica SOBRE el `.optional()`
 * ya existente, así que cada campo acepta `undefined | null | <valor válido>`
 * conservando sus reglas. Omitir = no tocar; `null` = borrar.
 */
const camposContactoEditar = {
  contacto: camposContacto.contacto.nullable(),
  telefono: camposContacto.telefono.nullable(),
  email: camposContacto.email.nullable(),
  direccion: camposContacto.direccion.nullable(),
} as const;

// ── Cliente ─────────────────────────────────────────────────────────────────────

/** Alta de cliente (catálogo global F1-E2). El `nombre` es la clave de negocio (único global). */
export const esquemaClienteCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(200, { error: 'El nombre no puede tener más de 200 caracteres' }),
  ...camposContacto,
});

/** Datos validados de alta de cliente. */
export type DatosClienteCrear = z.infer<typeof esquemaClienteCrear>;

/**
 * Edición de cliente: campos del alta opcionales (los de contacto, además, nullable
 * para poder vaciarlos, M1) + `id` y `activo` (borrado suave). `nombre` NO es nullable
 * (clave de negocio obligatoria): si se omite, no se toca.
 */
export const esquemaClienteEditar = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, { error: 'El nombre es obligatorio' })
      .max(200, { error: 'El nombre no puede tener más de 200 caracteres' })
      .optional(),
    ...camposContactoEditar,
    activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
  })
  .extend({
    id: z
      .number({ error: 'El id del cliente es obligatorio' })
      .int({ error: 'El id del cliente debe ser entero' })
      .positive({ error: 'El id del cliente debe ser positivo' }),
  });

/** Datos validados de edición de cliente. */
export type DatosClienteEditar = z.infer<typeof esquemaClienteEditar>;

/**
 * Salida de un cliente en la API (proyección del modelo `Cliente` a JSON). Incluye los
 * datos de contacto, la auditoría (quién/cuándo) y sus campos de referencia (D7)
 * ordenados por `orden`. Tanto al obtener UNO como en el LISTADO el cliente trae sus
 * campos embebidos (igual que el proveedor embebe sus roles).
 */
export const esquemaClienteSalida = z
  .object({
    id: z.number().int().describe('Id del cliente.'),
    nombre: z.string().describe('Nombre del cliente.'),
    contacto: z.string().nullable().describe('Persona de contacto, o null.'),
    telefono: z.string().nullable().describe('Teléfono, o null.'),
    email: z.string().nullable().describe('Email, o null.'),
    direccion: z.string().nullable().describe('Dirección, o null.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
    campos: z
      .array(esquemaClienteCampoSalida)
      .describe('Campos de referencia del cliente (D7), ordenados por `orden`.'),
  })
  .describe('Cliente del catálogo (global), con sus campos de referencia (D7).');

/** Forma de un cliente tal como lo devuelve la API. */
export type ClienteSalida = z.infer<typeof esquemaClienteSalida>;

/** Parámetros del listado de clientes EN LA URL (querystring). */
export const esquemaListarClientes = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    busqueda: z.string().trim().max(200).optional().describe('Texto a buscar en el nombre.'),
    incluirInactivos: z.stringbool().default(false).describe('Incluye los desactivados.'),
    ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre').describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de clientes.');

/** Parámetros de listado de clientes ya coaccionados desde la URL. */
export type ListarClientes = z.infer<typeof esquemaListarClientes>;

/** Respuesta paginada del listado de clientes (forma estándar `Pagina<T>`). */
export const esquemaClientesPagina = z
  .object({
    datos: z.array(esquemaClienteSalida).describe('Clientes de la página.'),
    total: z.number().int().describe('Total de clientes que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de clientes.');

/** Forma de la respuesta paginada de clientes. */
export type ClientesPagina = z.infer<typeof esquemaClientesPagina>;
