import { z } from 'zod';

/**
 * Contrato Zod de Tela + TelaCategoria + TelaColor (F1-E3, PIEZA A — Telas unificadas,
 * D5 — ADR-0009).
 *
 * Una sola entidad `Tela` sirve al BOM (doc `01-Modelos.md` §2, `TelasDis`) Y al
 * inventario (doc `04-Inventarios.md` §B.2, `Telas`): corrige la dualidad Telas/TelasDis
 * del viejo. Catálogo GLOBAL (ADR-0007, A9): la unicidad de `nombre` es global. Sus
 * COLORES con precio (`TelaColor`, N:N a `Color` de F1-E1) viajan INLINE como
 * `colores: { idColor, precio? }[]` (igual que los `tipos` del Maquilero o los `roles`
 * del Proveedor, pero cada renglón lleva su `precio`). La `TelaCategoria` es un catálogo
 * simple (como Cortador) sin permiso propio: se gobierna con `telas.administrar`.
 *
 * Reglas de captura (las repite el dominio, A1): `nombre` único global; un color NO se
 * repite dentro de la misma tela; `idCategoria` opcional (si viene, debe existir y estar
 * activa); `tipoComponente` ∈ {CUERPO, CARDIGAN, OTRO}; `unidadMedida` texto libre (la UI
 * sugiere una lista). Semántica del PATCH parcial (M1, igual que Proveedor): omitir un
 * campo (`undefined`) = no tocar; mandar `null`/`''` en un opcional de texto = vaciarlo
 * (se guarda `null`, nunca `''`). Decimales (`precioSugerido`, `precio` por color) entran
 * como `number` y salen como `number` (Prisma los guarda como `Decimal`).
 */

// ── Tipo de componente de la tela (D5) ────────────────────────────────────────

/** Tipos de componente de una tela dentro del lote (D5). Alineado con `TipoComponenteTela` de src/datos. */
export const TIPOS_COMPONENTE_TELA = ['CUERPO', 'CARDIGAN', 'OTRO'] as const;

/** Clave de tipo de componente de tela. */
export type TipoComponenteTelaClave = (typeof TIPOS_COMPONENTE_TELA)[number];

// ── Categoría de tela (catálogo simple, sin permiso propio) ────────────────────

/** Alta de categoría de tela (catálogo global F1-E3). El nombre es la clave de negocio (único global). */
export const esquemaTelaCategoriaCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
});

/** Datos validados de alta de categoría de tela. */
export type DatosTelaCategoriaCrear = z.infer<typeof esquemaTelaCategoriaCrear>;

/**
 * Edición de categoría de tela: el nombre es opcional (edición parcial) más `activo` para
 * el borrado suave (plan §4: nada se borra físicamente).
 */
export const esquemaTelaCategoriaEditar = esquemaTelaCategoriaCrear.partial().extend({
  id: z
    .number({ error: 'El id de la categoría es obligatorio' })
    .int({ error: 'El id de la categoría debe ser entero' })
    .positive({ error: 'El id de la categoría debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de categoría de tela. */
export type DatosTelaCategoriaEditar = z.infer<typeof esquemaTelaCategoriaEditar>;

/** Salida de una categoría de tela en la API. */
export const esquemaTelaCategoriaSalida = z
  .object({
    id: z.number().int().describe('Id de la categoría.'),
    nombre: z.string().describe('Nombre de la categoría (único global).'),
    activo: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Categoría de tela del catálogo (global).');

/** Forma de una categoría de tela tal como la devuelve la API. */
export type TelaCategoriaSalida = z.infer<typeof esquemaTelaCategoriaSalida>;

/** Parámetros del listado de categorías de tela EN LA URL (querystring). */
export const esquemaTelasCategoriasQuery = z
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
      .max(100)
      .optional()
      .describe('Texto a buscar en el nombre (insensible a mayúsculas).'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye las desactivadas ("true"/"false").'),
    ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre').describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de categorías de tela.');

/** Parámetros de listado de categorías de tela ya coaccionados desde la URL. */
export type TelasCategoriasQuery = z.infer<typeof esquemaTelasCategoriasQuery>;

/** Respuesta paginada del listado de categorías de tela (forma estándar `Pagina<T>`). */
export const esquemaTelasCategoriasPagina = z
  .object({
    datos: z.array(esquemaTelaCategoriaSalida).describe('Categorías de la página.'),
    total: z.number().int().describe('Total de categorías que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de categorías de tela.');

/** Forma de la respuesta paginada de categorías de tela. */
export type TelasCategoriasPagina = z.infer<typeof esquemaTelasCategoriasPagina>;

// ── Color de la tela (puente N:N con precio) ───────────────────────────────────

/**
 * Precio opcional de un renglón tela↔color: número no negativo (Prisma lo guarda como
 * `Decimal`). `null`/omitido = sin precio capturado.
 */
const esquemaPrecioColor = z
  .number({ error: 'El precio debe ser un número' })
  .nonnegative({ error: 'El precio no puede ser negativo' });

/**
 * Renglón de captura del grid de colores de una tela: el id del color (del catálogo
 * `Color` de F1-E1) y, opcional, su precio. Reutilizado por el alta y la edición de la
 * tela. La unicidad del color DENTRO de la tela la valida el dominio (rechazo claro) y la
 * respalda la PK compuesta `[idTela, idColor]`.
 */
export const esquemaTelaColorEntrada = z.object({
  idColor: z
    .number({ error: 'El id del color es obligatorio' })
    .int({ error: 'El id del color debe ser entero' })
    .positive({ error: 'El id del color debe ser positivo' }),
  precio: esquemaPrecioColor.optional(),
});

/** Datos validados de un renglón de color de tela. */
export type DatosTelaColorEntrada = z.infer<typeof esquemaTelaColorEntrada>;

/**
 * Lista de colores de una tela (cada uno con precio opcional). Puede ir VACÍA: una tela
 * sin colores capturados es válida (a diferencia de los `tipos` del maquilero, que exigen
 * ≥1). Sin colores repetidos (mismo `idColor` dos veces) — lo refina el esquema y lo
 * re-valida el dominio.
 */
export const esquemaTelaColores = z
  .array(esquemaTelaColorEntrada)
  .max(200, { error: 'Demasiados colores en la tela' })
  .refine((items) => new Set(items.map((i) => i.idColor)).size === items.length, {
    error: 'Hay colores repetidos en la tela',
  });

/** Salida de un renglón de color de una tela (color + precio). */
export const esquemaTelaColorSalida = z
  .object({
    idColor: z.number().int().describe('Id del color.'),
    nombre: z.string().describe('Nombre del color.'),
    precio: z.number().nullable().describe('Precio de la tela en este color, o null.'),
  })
  .describe('Renglón de color de una tela (con su precio).');

/** Forma de un renglón de color de tela tal como lo devuelve la API. */
export type TelaColorSalida = z.infer<typeof esquemaTelaColorSalida>;

// ── Tela ───────────────────────────────────────────────────────────────────────

/** Campos opcionales de la tela (mismas reglas de longitud en alta y edición). */
const camposOpcionalesTela = {
  descripcion: z
    .string()
    .trim()
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' })
    .optional(),
  unidadMedida: z
    .string()
    .trim()
    .max(30, { error: 'La unidad de medida no puede tener más de 30 caracteres' })
    .optional(),
} as const;

/**
 * Variante de EDICIÓN de los campos de texto opcionales: aceptan además `null` para poder
 * VACIAR un dato ya capturado (M1). Omitir (`undefined`) = no tocar; `null`/'' = borrar.
 */
const camposOpcionalesTelaEditar = {
  descripcion: camposOpcionalesTela.descripcion.nullable(),
  unidadMedida: camposOpcionalesTela.unidadMedida.nullable(),
} as const;

/**
 * Alta de tela UNIFICADA (catálogo global F1-E3, D5). El `nombre` es la clave de negocio
 * (único global); `colores` es el grid de colores con precio (puede ir vacío). El dominio
 * exige que la categoría (si viene) y los colores existan y estén ACTIVOS, y escribe la
 * tela + sus colores en UNA transacción A2.
 */
export const esquemaTelaCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
  /** Categoría (opcional). Si viene, el dominio exige que exista y esté activa. */
  idCategoria: z
    .number({ error: 'El id de la categoría debe ser un número' })
    .int({ error: 'El id de la categoría debe ser entero' })
    .positive({ error: 'El id de la categoría debe ser positivo' })
    .optional(),
  tipoComponente: z.enum(TIPOS_COMPONENTE_TELA).default('OTRO'),
  favorito: z.boolean().default(false),
  paraProduccion: z.boolean().default(true),
  /** Precio de referencia por unidad (informativo). Opcional, no negativo. */
  precioSugerido: z
    .number({ error: 'El precio sugerido debe ser un número' })
    .nonnegative({ error: 'El precio sugerido no puede ser negativo' })
    .optional(),
  /** Grid de colores (cada uno con precio opcional). Puede ir vacío. */
  colores: esquemaTelaColores.default([]),
  ...camposOpcionalesTela,
});

/** Datos validados de alta de tela. */
export type DatosTelaCrear = z.infer<typeof esquemaTelaCrear>;

/**
 * Edición de tela: `id` + todos los campos del alta opcionales (edición parcial) +
 * `activo` para el borrado suave. Los textos opcionales son nullable (M1: `null`/'' =
 * borrar). Las banderas (`favorito`, `paraProduccion`) y los enums NO son nullable:
 * omitir basta para "no tocar" (re-declarados como `.optional()` SIN `.default()`, porque
 * `.partial()` NO quita los defaults y rellenarían el valor real en la BD — el bug que el
 * CI atrapó en F1-E1). `idCategoria` acepta `null` para QUITAR la categoría. `colores`:
 * si se omite, NO se toca; si viene (incluso `[]`), REEMPLAZA el grid completo.
 */
export const esquemaTelaEditar = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, { error: 'El nombre es obligatorio' })
      .max(150, { error: 'El nombre no puede tener más de 150 caracteres' })
      .optional(),
    /** `null` quita la categoría; un id la fija; omitir = no tocar. */
    idCategoria: z
      .number({ error: 'El id de la categoría debe ser un número' })
      .int({ error: 'El id de la categoría debe ser entero' })
      .positive({ error: 'El id de la categoría debe ser positivo' })
      .nullable()
      .optional(),
    tipoComponente: z.enum(TIPOS_COMPONENTE_TELA).optional(),
    favorito: z.boolean({ error: 'Favorito debe ser verdadero o falso' }).optional(),
    paraProduccion: z.boolean({ error: 'Para producción debe ser verdadero o falso' }).optional(),
    /** `null` quita el precio sugerido; un número lo fija; omitir = no tocar. */
    precioSugerido: z
      .number({ error: 'El precio sugerido debe ser un número' })
      .nonnegative({ error: 'El precio sugerido no puede ser negativo' })
      .nullable()
      .optional(),
    /** Reemplaza el grid de colores si viene (incluso vacío); omitir = no tocar. */
    colores: esquemaTelaColores.optional(),
    activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
    ...camposOpcionalesTelaEditar,
  })
  .extend({
    id: z
      .number({ error: 'El id de la tela es obligatorio' })
      .int({ error: 'El id de la tela debe ser entero' })
      .positive({ error: 'El id de la tela debe ser positivo' }),
  });

/** Datos validados de edición de tela. */
export type DatosTelaEditar = z.infer<typeof esquemaTelaEditar>;

/**
 * Salida de una tela en la API (proyección del modelo `Tela` a JSON). Incluye la
 * categoría (id + nombre, o null), los decimales serializados a `number`, la auditoría y
 * sus colores con precio (N:N a `Color`), ordenados por nombre de color. Tanto al obtener
 * UNA como en el LISTADO la tela trae sus colores embebidos (igual que el maquilero embebe
 * sus tipos).
 */
export const esquemaTelaSalida = z
  .object({
    id: z.number().int().describe('Id de la tela.'),
    nombre: z.string().describe('Nombre de la tela (único global).'),
    descripcion: z.string().nullable().describe('Descripción, o null.'),
    idCategoria: z.number().int().nullable().describe('Id de la categoría, o null.'),
    categoria: z.string().nullable().describe('Nombre de la categoría, o null.'),
    unidadMedida: z.string().nullable().describe('Unidad de medida (kg, m…), o null.'),
    tipoComponente: z
      .enum(TIPOS_COMPONENTE_TELA)
      .describe('Rol típico de la tela en el lote (D5).'),
    favorito: z.boolean().describe('¿Tela de uso frecuente?'),
    precioSugerido: z.number().nullable().describe('Precio de referencia por unidad, o null.'),
    paraProduccion: z.boolean().describe('¿Es tela de producción (vs. muestra/insumo)?'),
    colores: z.array(esquemaTelaColorSalida).describe('Colores de la tela con su precio (N:N).'),
    activo: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Tela unificada del catálogo (global), con sus colores.');

/** Forma de una tela tal como la devuelve la API. */
export type TelaSalida = z.infer<typeof esquemaTelaSalida>;

/**
 * Parámetros del listado de telas EN LA URL (querystring): todo llega como texto, así que
 * se coaccionan números y banderas. Filtro opcional `idCategoria` e `incluirInactivos`;
 * búsqueda por `nombre` (insensible a mayúsculas).
 */
export const esquemaListarTelas = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(20)
      .describe('Renglones por página (máx 500).'),
    busqueda: z
      .string()
      .trim()
      .max(150)
      .optional()
      .describe('Texto a buscar en el nombre (insensible a mayúsculas).'),
    idCategoria: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por id de categoría.'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye las desactivadas ("true"/"false").'),
    ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre').describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de telas.');

/** Parámetros de listado de telas ya coaccionados desde la URL. */
export type ListarTelas = z.infer<typeof esquemaListarTelas>;

/** Respuesta paginada del listado de telas (forma estándar `Pagina<T>`). */
export const esquemaTelasPagina = z
  .object({
    datos: z.array(esquemaTelaSalida).describe('Telas de la página.'),
    total: z.number().int().describe('Total de telas que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de telas.');

/** Forma de la respuesta paginada de telas. */
export type TelasPagina = z.infer<typeof esquemaTelasPagina>;

/** Lista de colores de una tela (respuesta de `GET /telas/:id/colores`). */
export const esquemaTelaColoresLista = z
  .object({
    datos: z.array(esquemaTelaColorSalida).describe('Colores de la tela con su precio.'),
  })
  .describe('Colores de una tela (N:N a Color).');

/** Forma de la lista de colores de una tela. */
export type TelaColoresLista = z.infer<typeof esquemaTelaColoresLista>;
