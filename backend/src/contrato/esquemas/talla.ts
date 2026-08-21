import { z } from 'zod';

/**
 * Contrato Zod de Tallas + Curvas (F1-E2, PIEZA B — D4). Maestro-detalle ORDENADO:
 * una `Talla` es un catálogo simple (como Cortador) y una `CurvaTalla` es un conjunto
 * ORDENADO de tallas (como Proveedor↔roles, pero con orden). Catálogo GLOBAL (ADR-0007,
 * decisión A9): la unicidad de clave es global. Decimal: N/A.
 *
 * Tallas ilimitadas (D4 — PLANMAESTRO §4; MEJORAS A6: anchos fijos T1..T8 → catálogo).
 * El orden del arreglo `items` define la `posicion` de cada talla dentro de la curva (lo
 * asigna el dominio en UNA transacción A2). La SALIDA de la curva trae sus `items`
 * ORDENADOS por posición, cada uno `{ idTalla, etiqueta, posicion }`.
 *
 * Doc funcional: `Documentacion_MJD/DECISIONES.md` D4; `MEJORAS.md` A6; el viejo usaba
 * columnas fijas `T1..T8`/`TC1..TC8` (doc 02-Pedidos, campo `Tallas` de `Ordenes`).
 */

// ── Talla ─────────────────────────────────────────────────────────────────────

/** Alta de talla (catálogo global F1-E2). La `etiqueta` es la clave de negocio (única global). */
export const esquemaTallaCrear = z.object({
  etiqueta: z
    .string({ error: 'La etiqueta es obligatoria' })
    .trim()
    .min(1, { error: 'La etiqueta es obligatoria' })
    .max(50, { error: 'La etiqueta no puede tener más de 50 caracteres' }),
  /*
   * ⭐ V1-E3r (§Post-F9.81) — el orden capturado a mano arranca en **1**, no en 0.
   *
   * `Talla.orden` tiene `@default(0)` y el 0 es el **sentinela**: significa "nadie le puso orden"
   * (es lo que dejaron las 94 tallas que migró el ETL). Desde esta etapa, omitir el campo hace que
   * el dominio DEDUZCA el orden de la etiqueta; si el 0 siguiera siendo capturable, un 0 puesto a
   * propósito y un 0 heredado serían indistinguibles y la reparación del seed pisaría el primero.
   * Exigir `min(1)` deja el 0 como sentinela PURO y sin ambigüedad.
   */
  orden: z
    .number({ error: 'El orden debe ser un número' })
    .int({ error: 'El orden debe ser entero' })
    .min(1, {
      error: 'El orden debe ser 1 o más (déjalo vacío para que se deduzca de la etiqueta)',
    })
    .optional(),
});

/** Datos validados de alta de talla. */
export type DatosTallaCrear = z.infer<typeof esquemaTallaCrear>;

/** Edición de talla: campos del alta opcionales + `id` y `activo` (borrado suave). */
export const esquemaTallaEditar = esquemaTallaCrear.partial().extend({
  id: z
    .number({ error: 'El id de la talla es obligatorio' })
    .int({ error: 'El id de la talla debe ser entero' })
    .positive({ error: 'El id de la talla debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de talla. */
export type DatosTallaEditar = z.infer<typeof esquemaTallaEditar>;

/** Salida de una talla en la API. */
export const esquemaTallaSalida = z
  .object({
    id: z.number().int().describe('Id de la talla.'),
    etiqueta: z.string().describe('Etiqueta de la talla (XCH, CH, M…).'),
    orden: z.number().int().describe('Orden canónico de despliegue.'),
    activo: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Talla del catálogo (global).');

/** Forma de una talla tal como la devuelve la API. */
export type TallaSalida = z.infer<typeof esquemaTallaSalida>;

/** Parámetros del listado de tallas EN LA URL (querystring): todo llega como texto. */
export const esquemaListarTallas = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    busqueda: z.string().trim().max(50).optional().describe('Texto a buscar en la etiqueta.'),
    incluirInactivos: z.stringbool().default(false).describe('Incluye las desactivadas.'),
    ordenarPor: z
      .enum(['etiqueta', 'orden', 'creadoEn'])
      .default('orden')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de tallas.');

/** Parámetros de listado de tallas ya coaccionados desde la URL. */
export type ListarTallas = z.infer<typeof esquemaListarTallas>;

/** Respuesta paginada del listado de tallas (forma estándar `Pagina<T>`). */
export const esquemaTallasPagina = z
  .object({
    datos: z.array(esquemaTallaSalida).describe('Tallas de la página.'),
    total: z.number().int().describe('Total de tallas que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de tallas.');

/** Forma de la respuesta paginada de tallas. */
export type TallasPagina = z.infer<typeof esquemaTallasPagina>;

// ── Curva (maestro-detalle ordenado) ────────────────────────────────────────────

/**
 * Lista ORDENADA de ids de talla de una curva (≥1, sin repetidos). El ORDEN del arreglo
 * define la `posicion` de cada talla dentro de la curva (lo asigna el dominio en la tx
 * A2). Reutilizada por el alta y la edición.
 */
const esquemaItemsCurva = z
  .array(z.number().int().positive())
  .min(1, { error: 'La curva debe tener al menos una talla' })
  .refine((ids) => new Set(ids).size === ids.length, {
    error: 'Hay tallas repetidas en la curva',
  });

/**
 * Alta de curva (D4): nombre (único global) + lista ORDENADA de ids de talla (≥1). El
 * orden del arreglo define la `posicion`; el dominio exige que las tallas existan y
 * estén ACTIVAS, y crea los items en UNA transacción A2 (como proveedor+roles).
 */
export const esquemaCurvaCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
  items: esquemaItemsCurva,
});

/** Datos validados de alta de curva. */
export type DatosCurvaCrear = z.infer<typeof esquemaCurvaCrear>;

/**
 * Edición de curva: campos del alta opcionales + `id` y `activo` (borrado suave). Si
 * `items` viene, REEMPLAZA el conjunto completo (≥1, sin repetidos); si se omite, no se
 * toca. La validación `.partial()` conserva la regla de `items` (min(1)/sin repetidos)
 * porque solo se aplica cuando el arreglo está presente.
 */
export const esquemaCurvaEditar = esquemaCurvaCrear.partial().extend({
  id: z
    .number({ error: 'El id de la curva es obligatorio' })
    .int({ error: 'El id de la curva debe ser entero' })
    .positive({ error: 'El id de la curva debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de curva. */
export type DatosCurvaEditar = z.infer<typeof esquemaCurvaEditar>;

/** Salida de un renglón de curva (talla + posición). */
export const esquemaCurvaTallaItemSalida = z
  .object({
    idTalla: z.number().int().describe('Id de la talla.'),
    etiqueta: z.string().describe('Etiqueta de la talla.'),
    posicion: z.number().int().describe('Posición de la talla dentro de la curva (0-based).'),
  })
  .describe('Renglón de una curva (talla ordenada).');

/** Forma de un renglón de curva tal como lo devuelve la API. */
export type CurvaTallaItemSalida = z.infer<typeof esquemaCurvaTallaItemSalida>;

/** Salida de una curva en la API (con sus items ORDENADOS por posición). */
export const esquemaCurvaSalida = z
  .object({
    id: z.number().int().describe('Id de la curva.'),
    nombre: z.string().describe('Nombre de la curva.'),
    activo: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    items: z.array(esquemaCurvaTallaItemSalida).describe('Tallas de la curva, en orden.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Curva de tallas (global).');

/** Forma de una curva tal como la devuelve la API. */
export type CurvaSalida = z.infer<typeof esquemaCurvaSalida>;

/** Parámetros del listado de curvas EN LA URL (querystring). */
export const esquemaListarCurvas = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    busqueda: z.string().trim().max(150).optional().describe('Texto a buscar en el nombre.'),
    incluirInactivos: z.stringbool().default(false).describe('Incluye las desactivadas.'),
    ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre').describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de curvas.');

/** Parámetros de listado de curvas ya coaccionados desde la URL. */
export type ListarCurvas = z.infer<typeof esquemaListarCurvas>;

/** Respuesta paginada del listado de curvas (forma estándar `Pagina<T>`). */
export const esquemaCurvasPagina = z
  .object({
    datos: z.array(esquemaCurvaSalida).describe('Curvas de la página.'),
    total: z.number().int().describe('Total de curvas que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de curvas.');

/** Forma de la respuesta paginada de curvas. */
export type CurvasPagina = z.infer<typeof esquemaCurvasPagina>;
