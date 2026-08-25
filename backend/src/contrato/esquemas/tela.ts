import { z } from 'zod';

/**
 * Contrato Zod de Tela + TelaCategoria + ComposicionTela + TelaColor (F1-E3, PIEZA A —
 * Telas unificadas, D5 — ADR-0009; reestructura A1 §Post-F9.11).
 *
 * Una sola entidad `Tela` sirve al BOM (doc `01-Modelos.md` §2, `TelasDis`) Y al
 * inventario (doc `04-Inventarios.md` §B.2, `Telas`): corrige la dualidad Telas/TelasDis
 * del viejo. Catálogo GLOBAL (ADR-0007, A9): la unicidad de `nombre` es global. Sus
 * COLORES (`TelaColor`, HIJOS de la tela con nombre LIBRE, §Post-F9.11) viajan INLINE
 * como `colores: { nombre, precio?, precioComplemento?, pantone? }[]` (igual que los
 * `tipos` del Maquilero o los `roles` del Proveedor, pero cada renglón lleva sus datos;
 * el catálogo global `Color` es SOLO el color de la PRENDA y aquí no participa). La
 * `TelaCategoria` (en la UI, "Tipo de tela") y la `ComposicionTela` son catálogos simples
 * (como Cortador) sin permiso propio: se gobiernan con `telas.administrar`.
 *
 * IDENTIDAD EN 4 DATOS (Daniel, 6-ago-2026 §Post-F9.11): tipo (= la categoría) ·
 * composición (catálogo nuevo) · proveedor DUEÑO del artículo · nombre del proveedor
 * ("Felpa Suiza"). El `idProveedor` es OBLIGATORIO en el ALTA (este contrato lo exige);
 * en las 877 telas MIGRADAS viene NULL (la base lo permite) y al editarlas NO se exige.
 * El COMPLEMENTO (cardigan) es PARTE de la misma tela: `nombreCuerpo`/`nombreComplemento`
 * (NULL en `nombreComplemento` = no lleva) y cada color lleva su `pantone` y sus DOS
 * precios (cuerpo y complemento).
 *
 * Reglas de captura (las repite el dominio, A1): `nombre` único global; el nombre de un
 * color NO se repite dentro de la misma tela (dos telas sí pueden tener cada una su
 * "Negro"); `idCategoria`/`idComposicion` opcionales (si vienen,
 * deben existir y estar activas); el proveedor debe existir y estar activo;
 * `tipoComponente` ∈ {CUERPO, CARDIGAN, OTRO}; `unidadMedida` ∈ {KG, M} y es
 * OBLIGATORIA en el alta (de ella dependen el stock, el consumo y el costo por prenda).
 * Semántica del PATCH parcial (M1, igual que Proveedor): omitir un
 * campo (`undefined`) = no tocar; mandar `null`/`''` en un opcional de texto = vaciarlo
 * (se guarda `null`, nunca `''`). Decimales (`precioSugerido`, `precio` y
 * `precioComplemento` por color) entran como `number` y salen como `number` (Prisma los
 * guarda como `Decimal`).
 */

// ── Tipo de componente de la tela (D5) ────────────────────────────────────────

/** Tipos de componente de una tela dentro del lote (D5). Alineado con `TipoComponenteTela` de src/datos. */
export const TIPOS_COMPONENTE_TELA = ['CUERPO', 'CARDIGAN', 'OTRO'] as const;

/**
 * Unidades en las que se compra Y se consume una tela (Daniel, 30-jul-2026: *"solo kilos y metros,
 * no hay otras medidas"*). El sistema viejo ya lo llevaba así (`Telas.Medida`: -1 = Kilos, 0 =
 * Metros). Es OBLIGATORIA: sin ella el stock, el consumo y el costo por prenda no significan nada.
 */
export const UNIDADES_TELA = ['KG', 'M'] as const;

/** Unidad de una tela. */
export type UnidadTela = (typeof UNIDADES_TELA)[number];

/**
 * Cómo se escribe cada unidad donde la lee una persona (impresos, renglones de OC…). Se usa como
 * la `unidad` de un renglón de tela en la orden de compra: ahí NO se captura, la manda la tela
 * (§Post-F9.18 — *"la unidad de las telas va ligado a la tela; no puede ser una tela que se compra
 * en kilos y en la OC la unidad sea piezas"*).
 */
export const ETIQUETA_UNIDAD_TELA: Record<UnidadTela, string> = { KG: 'kg', M: 'm' };

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

// ── Composición de tela (catálogo simple, sin permiso propio — §Post-F9.11) ────

/**
 * Alta de composición de tela ("50% Algodón, 50% Poliéster"). Catálogo NUEVO, no texto
 * libre (petición textual de Daniel: *"de un catálogo de composiciones para mantener misma
 * congruencia"*). El nombre es la clave de negocio (único global, ADR-0007).
 */
export const esquemaComposicionTelaCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
});

/** Datos validados de alta de composición de tela. */
export type DatosComposicionTelaCrear = z.infer<typeof esquemaComposicionTelaCrear>;

/**
 * Edición de composición de tela: el nombre es opcional (edición parcial) más `activo`
 * para el borrado suave (plan §4: nada se borra físicamente).
 */
export const esquemaComposicionTelaEditar = esquemaComposicionTelaCrear.partial().extend({
  id: z
    .number({ error: 'El id de la composición es obligatorio' })
    .int({ error: 'El id de la composición debe ser entero' })
    .positive({ error: 'El id de la composición debe ser positivo' }),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/** Datos validados de edición de composición de tela. */
export type DatosComposicionTelaEditar = z.infer<typeof esquemaComposicionTelaEditar>;

/** Salida de una composición de tela en la API. */
export const esquemaComposicionTelaSalida = z
  .object({
    id: z.number().int().describe('Id de la composición.'),
    nombre: z.string().describe('Nombre de la composición (único global).'),
    activo: z.boolean().describe('Falso si está desactivada (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Composición de tela del catálogo (global).');

/** Forma de una composición de tela tal como la devuelve la API. */
export type ComposicionTelaSalida = z.infer<typeof esquemaComposicionTelaSalida>;

/** Parámetros del listado de composiciones de tela EN LA URL (querystring). */
export const esquemaComposicionesTelaQuery = z
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
      .max(150)
      .optional()
      .describe('Texto a buscar en el nombre (insensible a mayúsculas).'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye las desactivadas ("true"/"false").'),
    ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre').describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de composiciones de tela.');

/** Parámetros de listado de composiciones de tela ya coaccionados desde la URL. */
export type ComposicionesTelaQuery = z.infer<typeof esquemaComposicionesTelaQuery>;

/** Respuesta paginada del listado de composiciones de tela (forma estándar `Pagina<T>`). */
export const esquemaComposicionesTelaPagina = z
  .object({
    datos: z.array(esquemaComposicionTelaSalida).describe('Composiciones de la página.'),
    total: z.number().int().describe('Total de composiciones que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de composiciones de tela.');

/** Forma de la respuesta paginada de composiciones de tela. */
export type ComposicionesTelaPagina = z.infer<typeof esquemaComposicionesTelaPagina>;

// ── Color de la tela (puente N:N con precio) ───────────────────────────────────

/**
 * Precio opcional de un renglón tela↔color: número no negativo (Prisma lo guarda como
 * `Decimal`). `null`/omitido = sin precio capturado.
 */
const esquemaPrecioColor = z
  .number({ error: 'El precio debe ser un número' })
  .nonnegative({ error: 'El precio no puede ser negativo' });

/**
 * Renglón de captura del grid de colores de una tela — HIJOS de la tela, NO catálogo
 * global (§Post-F9.11 punto 3): `nombre` LIBRE ("Marino Alsa 3040") + PANTONE (texto
 * buscable) + DOS precios (cuerpo y complemento — *"el cardigan es otro precio que la
 * tela"*). El catálogo global `Color` es SOLO el color de la PRENDA y aquí NO participa.
 * Reutilizado por el alta y la edición de la tela. La unicidad del nombre DENTRO de la
 * tela la valida el dominio (insensible a mayúsculas) y la respalda el unique
 * `[idTela, nombre]`. El grid se REEMPLAZA completo al editar, así que cada renglón
 * viaja con todos sus datos ('' en pantone = sin pantone, se guarda `null`).
 */
export const esquemaTelaColorEntrada = z.object({
  /**
   * Identidad de la FILA (R3-1): al editar, mandar el `id` de un color existente hace que
   * RENOMBRARLO sea un update en sitio que conserva su liga legacy, pantone y auditoría —
   * sin `id`, un renombre real se vería como quitar+crear y destruiría la fila. Las filas
   * NUEVAS van sin `id`. Un `id` que no pertenece a esa tela se rechaza (A1).
   */
  id: z
    .number({ error: 'El id del color de tela debe ser un número' })
    .int({ error: 'El id del color de tela debe ser entero' })
    .positive({ error: 'El id del color de tela debe ser positivo' })
    .optional()
    .describe('Id de la fila existente (renombrar sin destruirla); omitir en filas nuevas.'),
  nombre: z
    .string({ error: 'El nombre del color es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre del color es obligatorio' })
    .max(80, { error: 'El nombre del color no puede tener más de 80 caracteres' }),
  precio: esquemaPrecioColor.optional(),
  /** Precio del COMPLEMENTO en este color. Solo válido si la tela lleva complemento (A1). */
  precioComplemento: esquemaPrecioColor.optional(),
  /** Código PANTONE del color de ESTA tela (texto libre, buscable). Vacío/omitido = sin pantone. */
  pantone: z
    .string()
    .trim()
    .max(50, { error: 'El pantone no puede tener más de 50 caracteres' })
    .optional(),
});

/** Datos validados de un renglón de color de tela. */
export type DatosTelaColorEntrada = z.infer<typeof esquemaTelaColorEntrada>;

/**
 * Lista de colores de una tela (cada uno con precios/pantone opcionales). Puede ir VACÍA:
 * una tela sin colores capturados es válida (a diferencia de los `tipos` del maquilero,
 * que exigen ≥1). Sin nombres repetidos DENTRO de la tela — insensible a mayúsculas
 * ("Negro" y "NEGRO" son el mismo color de esta tela) — lo refina el esquema y lo
 * re-valida el dominio. Dos telas DISTINTAS sí pueden tener cada una su "Negro".
 */
export const esquemaTelaColores = z
  .array(esquemaTelaColorEntrada)
  .max(200, { error: 'Demasiados colores en la tela' })
  .refine(
    (items) => new Set(items.map((i) => i.nombre.trim().toLowerCase())).size === items.length,
    { error: 'Hay colores repetidos en la tela' },
  );

/** Salida de un renglón de color de una tela (hijo de la tela, §Post-F9.11). */
export const esquemaTelaColorSalida = z
  .object({
    id: z.number().int().describe('Id del color de tela (hijo de la tela).'),
    nombre: z.string().describe('Nombre libre del color de esta tela (único por tela).'),
    precio: z.number().nullable().describe('Precio del CUERPO en este color, o null.'),
    precioComplemento: z
      .number()
      .nullable()
      .describe('Precio del COMPLEMENTO (cardigan) en este color, o null.'),
    pantone: z.string().nullable().describe('Código PANTONE del color de esta tela, o null.'),
    idColor: z
      .number()
      .int()
      .nullable()
      .describe(
        'LEGACY: id del color de PRENDA al que colgaba la fila migrada (F1-E6), o null en las nuevas.',
      ),
  })
  .describe('Renglón de color de una tela (con sus precios y pantone).');

/** Forma de un renglón de color de tela tal como lo devuelve la API. */
export type TelaColorSalida = z.infer<typeof esquemaTelaColorSalida>;

/**
 * ⭐⭐ **V1-E6b (§Post-F9.106) — AGREGAR **UN** COLOR A UNA TELA, SIN TOCAR LOS DEMÁS.**
 *
 * Daniel, probando las OP 5562/5563/5564: *"ya jaló los pantones desde la OC del cliente… **me
 * gustaría que acá pueda yo poner los colores que voy a comprar**"*. Hasta hoy la única forma de
 * dar de alta un color era el **grid completo** del alta/edición de la tela
 * (`esquemaTelaColores`), que es un **SET-COMPLETO**: lo que no viaja en la lista, el dominio lo
 * BORRA. Mandar un color solo por ese camino desde la pantalla de compra habría borrado todos los
 * demás colores de esa tela.
 *
 * Por eso este cuerpo es **el renglón suelto** (el mismo de siempre, sin `id`: una fila nueva no
 * tiene id que renombrar) y su endpoint es **aditivo**: crea uno y no mira a los otros. El nombre
 * repetido DENTRO de la tela lo rechaza el dominio (409) — no se sobrescribe en silencio lo que ya
 * existe, porque ahí es donde se perderían el pantone y el precio que alguien más capturó.
 */
export const esquemaTelaColorAgregar = esquemaTelaColorEntrada
  .omit({ id: true })
  .describe('Un color NUEVO para una tela (alta aditiva: no toca los colores que ya tiene).');

/** Datos validados del alta aditiva de un color de tela. */
export type DatosTelaColorAgregar = z.infer<typeof esquemaTelaColorAgregar>;

// ── Tela ───────────────────────────────────────────────────────────────────────

/** Campos opcionales de la tela (mismas reglas de longitud en alta y edición). */
const camposOpcionalesTela = {
  descripcion: z
    .string()
    .trim()
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' })
    .optional(),
  /** Cómo le llama el PROVEEDOR a esta tela ("Felpa Suiza"). Buscable (§Post-F9.11). */
  nombreProveedor: z
    .string()
    .trim()
    .max(150, { error: 'El nombre del proveedor no puede tener más de 150 caracteres' })
    .optional(),
  /** Nombre del componente CUERPO ("Felpa"). Opcional. */
  nombreCuerpo: z
    .string()
    .trim()
    .max(100, { error: 'El nombre del cuerpo no puede tener más de 100 caracteres' })
    .optional(),
  /**
   * Nombre del COMPLEMENTO ("Cardigan"). NULL/omitido = esta tela NO lleva complemento —
   * esa es la bandera (§Post-F9.11: el complemento se declara desde el alta).
   */
  nombreComplemento: z
    .string()
    .trim()
    .max(100, { error: 'El nombre del complemento no puede tener más de 100 caracteres' })
    .optional(),
} as const;

/**
 * Variante de EDICIÓN de los campos de texto opcionales: aceptan además `null` para poder
 * VACIAR un dato ya capturado (M1). Omitir (`undefined`) = no tocar; `null`/'' = borrar.
 */
const camposOpcionalesTelaEditar = {
  descripcion: camposOpcionalesTela.descripcion.nullable(),
  nombreProveedor: camposOpcionalesTela.nombreProveedor.nullable(),
  nombreCuerpo: camposOpcionalesTela.nombreCuerpo.nullable(),
  nombreComplemento: camposOpcionalesTela.nombreComplemento.nullable(),
} as const;

/**
 * Alta de tela UNIFICADA (catálogo global F1-E3, D5; reestructura §Post-F9.11). El
 * `nombre` es la clave de negocio (único global); `colores` es el grid de colores HIJOS
 * de la tela (nombre libre + pantone + precios; puede ir vacío). El dominio exige que la
 * categoría/composición (si vienen) existan y estén activas, que el proveedor exista y
 * esté activo, y escribe la tela + sus colores en UNA transacción A2.
 */
export const esquemaTelaCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
  /** Categoría / "Tipo de tela" (opcional). Si viene, el dominio exige que exista y esté activa. */
  idCategoria: z
    .number({ error: 'El id de la categoría debe ser un número' })
    .int({ error: 'El id de la categoría debe ser entero' })
    .positive({ error: 'El id de la categoría debe ser positivo' })
    .optional(),
  /** Composición del catálogo (opcional). Si viene, el dominio exige que exista y esté activa. */
  idComposicion: z
    .number({ error: 'El id de la composición debe ser un número' })
    .int({ error: 'El id de la composición debe ser entero' })
    .positive({ error: 'El id de la composición debe ser positivo' })
    .optional(),
  /**
   * Proveedor DUEÑO del artículo — OBLIGATORIO en el alta (§Post-F9.11: la felpa de
   * Alsatex y la de otro proveedor son telas DISTINTAS). Las telas MIGRADAS vienen sin él
   * (la base lo permite NULL): eso solo aplica al ETL ({@link esquemaTelaCrearMigracion}),
   * nunca a un alta por el API.
   */
  idProveedor: z
    .number({ error: 'El proveedor es obligatorio' })
    .int({ error: 'El id del proveedor debe ser entero' })
    .positive({ error: 'El id del proveedor debe ser positivo' }),
  tipoComponente: z.enum(TIPOS_COMPONENTE_TELA).default('OTRO'),
  /**
   * OBLIGATORIA en el alta, a propósito y sin default: si se dejara caer al default de la base
   * (KG), una tela que se compra en metros nacería mal etiquetada EN SILENCIO y arrastraría el
   * error al stock, al consumo y al costo por prenda. Quien da de alta la tela lo sabe; el sistema
   * no lo adivina.
   */
  unidadMedida: z.enum(UNIDADES_TELA, { error: 'Elige la unidad: kilos (KG) o metros (M)' }),
  favorito: z.boolean().default(false),
  paraProduccion: z.boolean().default(true),
  /** Precio de referencia por unidad (informativo). Opcional, no negativo. */
  precioSugerido: z
    .number({ error: 'El precio sugerido debe ser un número' })
    .nonnegative({ error: 'El precio sugerido no puede ser negativo' })
    .optional(),
  /**
   * Peso de la tela en gr/m² (A1.1). Informativo, opcional, no negativo. El tope respeta el
   * DECIMAL(8,2) de la base (como las puntadas del bordado): sin él, un valor de 1,000,000
   * desbordaría la columna y daría un 500 opaco en vez de un 400 legible.
   */
  peso: z
    .number({ error: 'El peso debe ser un número' })
    .nonnegative({ error: 'El peso no puede ser negativo' })
    .max(99999.99, { error: 'El peso no puede ser más de 99,999.99 gr/m²' })
    .optional(),
  /** Ancho de la tela en metros (A1.1). Informativo, opcional, no negativo. Mismo tope que el peso. */
  ancho: z
    .number({ error: 'El ancho debe ser un número' })
    .nonnegative({ error: 'El ancho no puede ser negativo' })
    .max(99999.99, { error: 'El ancho no puede ser más de 99,999.99 m' })
    .optional(),
  /** Grid de colores (cada uno con precio opcional). Puede ir vacío. */
  colores: esquemaTelaColores.default([]),
  ...camposOpcionalesTela,
});

/** Datos validados de alta de tela. */
export type DatosTelaCrear = z.infer<typeof esquemaTelaCrear>;

/**
 * Variante de alta SOLO PARA EL ETL de migración (F1-E6 / F10): idéntica al alta normal
 * pero con `idProveedor` OPCIONAL, porque el sistema viejo no traía el proveedor como
 * campo (lo embebía en el nombre, "FelpaAlsa") y las 877 telas migradas quedan sin él
 * hasta depurarse a mano (§Post-F9.11). NO se expone en ninguna ruta REST: el API de alta
 * usa {@link esquemaTelaCrear}, donde el proveedor es obligatorio.
 */
export const esquemaTelaCrearMigracion = esquemaTelaCrear.extend({
  idProveedor: z
    .number({ error: 'El id del proveedor debe ser un número' })
    .int({ error: 'El id del proveedor debe ser entero' })
    .positive({ error: 'El id del proveedor debe ser positivo' })
    .optional(),
});

/** Datos validados del alta de tela en modo migración (ETL). */
export type DatosTelaCrearMigracion = z.infer<typeof esquemaTelaCrearMigracion>;

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
    /** `null` quita la composición; un id la fija; omitir = no tocar. */
    idComposicion: z
      .number({ error: 'El id de la composición debe ser un número' })
      .int({ error: 'El id de la composición debe ser entero' })
      .positive({ error: 'El id de la composición debe ser positivo' })
      .nullable()
      .optional(),
    /**
     * Proveedor dueño: OPCIONAL en edición (§Post-F9.11: a una MIGRADA sin proveedor no se
     * le exige; ponérselo es parte de la depuración). NO es nullable a propósito: el
     * proveedor es identidad de la tela — se corrige a otro, pero no se "quita" (una tela
     * nueva bien capturada no debe poder degradarse a sin-proveedor).
     */
    idProveedor: z
      .number({ error: 'El id del proveedor debe ser un número' })
      .int({ error: 'El id del proveedor debe ser entero' })
      .positive({ error: 'El id del proveedor debe ser positivo' })
      .optional(),
    tipoComponente: z.enum(TIPOS_COMPONENTE_TELA).optional(),
    /** Omitir = no tocar. NO es nullable: una tela sin unidad no existe. */
    unidadMedida: z
      .enum(UNIDADES_TELA, { error: 'La unidad debe ser kilos (KG) o metros (M)' })
      .optional(),
    favorito: z.boolean({ error: 'Favorito debe ser verdadero o falso' }).optional(),
    paraProduccion: z.boolean({ error: 'Para producción debe ser verdadero o falso' }).optional(),
    /** `null` quita el precio sugerido; un número lo fija; omitir = no tocar. */
    precioSugerido: z
      .number({ error: 'El precio sugerido debe ser un número' })
      .nonnegative({ error: 'El precio sugerido no puede ser negativo' })
      .nullable()
      .optional(),
    /** `null` quita el peso (gr/m²); un número lo fija; omitir = no tocar (A1.1). Tope del DECIMAL(8,2). */
    peso: z
      .number({ error: 'El peso debe ser un número' })
      .nonnegative({ error: 'El peso no puede ser negativo' })
      .max(99999.99, { error: 'El peso no puede ser más de 99,999.99 gr/m²' })
      .nullable()
      .optional(),
    /** `null` quita el ancho (m); un número lo fija; omitir = no tocar (A1.1). Tope del DECIMAL(8,2). */
    ancho: z
      .number({ error: 'El ancho debe ser un número' })
      .nonnegative({ error: 'El ancho no puede ser negativo' })
      .max(99999.99, { error: 'El ancho no puede ser más de 99,999.99 m' })
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
 * sus colores HIJOS (nombre libre + pantone + precios), ordenados por nombre. Tanto al obtener
 * UNA como en el LISTADO la tela trae sus colores embebidos (igual que el maquilero embebe
 * sus tipos).
 */
export const esquemaTelaSalida = z
  .object({
    id: z.number().int().describe('Id de la tela.'),
    nombre: z.string().describe('Nombre de la tela (único global).'),
    descripcion: z.string().nullable().describe('Descripción, o null.'),
    idCategoria: z
      .number()
      .int()
      .nullable()
      .describe('Id de la categoría ("Tipo de tela"), o null.'),
    categoria: z.string().nullable().describe('Nombre de la categoría ("Tipo de tela"), o null.'),
    idComposicion: z.number().int().nullable().describe('Id de la composición, o null.'),
    composicion: z
      .string()
      .nullable()
      .describe('Nombre de la composición ("50% Algodón, 50% Poliéster"), o null.'),
    idProveedor: z
      .number()
      .int()
      .nullable()
      .describe('Id del proveedor DUEÑO del artículo (null solo en telas migradas).'),
    proveedor: z.string().nullable().describe('Nombre del proveedor dueño, o null.'),
    proveedorCorto: z
      .string()
      .nullable()
      .describe('Nombre CORTO del proveedor dueño ("Bloom"), o null (A1.1: nombre compuesto).'),
    nombreProveedor: z
      .string()
      .nullable()
      .describe('Cómo le llama el proveedor a esta tela ("Felpa Suiza"), o null.'),
    nombreCuerpo: z.string().nullable().describe('Nombre del componente CUERPO, o null.'),
    nombreComplemento: z
      .string()
      .nullable()
      .describe('Nombre del COMPLEMENTO (cardigan). Null = esta tela NO lleva complemento.'),
    unidadMedida: z
      .enum(UNIDADES_TELA)
      .describe('Unidad en que se compra y se consume: KG (kilos) o M (metros).'),
    tipoComponente: z
      .enum(TIPOS_COMPONENTE_TELA)
      .describe('Rol típico de la tela en el lote (D5).'),
    favorito: z.boolean().describe('¿Tela de uso frecuente?'),
    precioSugerido: z.number().nullable().describe('Precio de referencia por unidad, o null.'),
    peso: z.number().nullable().describe('Peso de la tela en gr/m² (A1.1), o null.'),
    ancho: z.number().nullable().describe('Ancho de la tela en metros (A1.1), o null.'),
    paraProduccion: z.boolean().describe('¿Es tela de producción (vs. muestra/insumo)?'),
    colores: z
      .array(esquemaTelaColorSalida)
      .describe('Colores HIJOS de la tela (nombre libre + pantone + precios).'),
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
      .describe(
        'Texto a buscar en el nombre de la tela, el nombre que le da su proveedor, el nombre ' +
          'del PROVEEDOR dueño, el nombre de sus colores o su PANTONE (insensible a mayúsculas).',
      ),
    idColor: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'LEGACY (§Post-F9.11): solo telas con un color MIGRADO ligado a ese color de PRENDA. ' +
          'Los colores de tela nuevos no cuelgan del catálogo de prenda y no participan.',
      ),
    idCategoria: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por id de categoría.'),
    idProveedor: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Filtra por el PROVEEDOR DUEÑO de la tela (§Post-F9.15). Estricto: las telas migradas ' +
          'sin dueño no aparecen.',
      ),
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

/** Lista de colores de una tela (hijos de la tela; respuesta de `GET /telas/:id/colores`). */
export const esquemaTelaColoresLista = z
  .object({
    datos: z.array(esquemaTelaColorSalida).describe('Colores de la tela con su precio.'),
  })
  .describe('Colores de una tela (hijos de la tela, §Post-F9.11).');

/** Forma de la lista de colores de una tela. */
export type TelaColoresLista = z.infer<typeof esquemaTelaColoresLista>;
