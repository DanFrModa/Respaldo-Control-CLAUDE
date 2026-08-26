import { z } from 'zod';

/**
 * Contrato de Avíos + AvioProveedor (F1-E3, PIEZA B — R1). Una sola definición de las
 * reglas de captura para UI y servidor (fuente del OpenAPI). Calca el patrón N:N de
 * `maquilero.ts`/`proveedor.ts` (los proveedores inline, ≥0, sin repetidos), con UNA
 * diferencia: cada renglón del puente lleva DATOS propios (precio + condiciones), porque
 * el mismo avío se compra a varios proveedores a precios distintos (insight del dueño,
 * base de R3/R7 en F4). Por eso `proveedores` NO es una lista de ids sino de objetos
 * `{ idProveedor, precio?, condiciones? }`.
 *
 * Modelo: `Avio` (ex `Habilitacion` del viejo, doc `01-Modelos.md` §2). `unidad` y
 * `presentacion` son NUEVOS y NULLABLE en BD (ADR-0009): el dominio NO los exige (para
 * que el ETL de E6 cargue los 629 históricos sin esos datos); la obligatoriedad en ALTAS
 * NUEVAS la pone el Zod del formulario del frontend, no este contrato. Aquí solo se acota
 * su longitud cuando vienen. Catálogo GLOBAL (ADR-0007).
 *
 * Reglas de negocio que SÍ van en el contrato (las repite el dominio, A1):
 *  • `clave` única global (clave de negocio).
 *  • favorito ⇒ `cantFav` obligatoria (>0): se valida con un `.refine()` (alta y edición).
 *  • `esGenerico` (R4) y `precioReferencia` (fallback) son opcionales.
 */

// ── Proveedores inline (N:N con datos propios por renglón, R1) ────────────────

/**
 * Un renglón de la captura de proveedores de un avío: a qué proveedor se le compra y a
 * qué precio/condiciones. `precio` es opcional (puede no conocerse aún); `condiciones`
 * es texto libre opcional. El `idProveedor` identifica el renglón (único en la lista).
 */
export const esquemaAvioProveedorEntrada = z
  .object({
    idProveedor: z
      .number({ error: 'El id del proveedor es obligatorio' })
      .int({ error: 'El id del proveedor debe ser entero' })
      .positive({ error: 'El id del proveedor debe ser positivo' }),
    precio: z
      .number({ error: 'El precio debe ser un número' })
      .nonnegative({ error: 'El precio no puede ser negativo' })
      .optional(),
    condiciones: z
      .string()
      .trim()
      .max(500, { error: 'Las condiciones no pueden tener más de 500 caracteres' })
      .optional(),
    /**
     * ⭐ V1-E3m (§Post-F9.82) — ¿es el proveedor HABITUAL del avío? Daniel: *"tener avíos sin
     * proveedor asignado está generando más problemas que beneficios"*. El habitual es el que la
     * explosión propone (arriba del "más barato" de F4). UNO por avío: lo valida la lista, el
     * dominio y —la última palabra— un índice único parcial en la base.
     */
    habitual: z.boolean().optional(),
  })
  .describe('Proveedor de un avío con su precio y condiciones (R1).');

/** Datos validados de un renglón de proveedor de un avío. */
export type DatosAvioProveedorEntrada = z.infer<typeof esquemaAvioProveedorEntrada>;

/**
 * Lista de proveedores de un avío (N:N, R1). Cada renglón con su precio/condiciones. Sin
 * `idProveedor` repetidos (un proveedor aparece UNA vez por avío). A diferencia del
 * maquilero (≥1 tipo), un avío PUEDE no tener proveedores (≥0): puede ser genérico o
 * surtirse por el `precioReferencia` de fallback (ADR-0009).
 */
const esquemaProveedoresLista = z
  .array(esquemaAvioProveedorEntrada)
  .max(50, { error: 'Demasiados proveedores' })
  .refine((items) => new Set(items.map((p) => p.idProveedor)).size === items.length, {
    error: 'Hay proveedores repetidos',
  })
  // ⭐ §Post-F9.82: el HABITUAL es UNO. Dos habituales harían que "a quién le compramos siempre"
  // dependiera del orden de las filas — que es justo la ambigüedad que la bandera vino a matar.
  .refine((items) => items.filter((p) => p.habitual === true).length <= 1, {
    error: 'Solo un proveedor puede ser el habitual del avío',
  });

// ── Campos del avío ────────────────────────────────────────────────────────────

/**
 * Regla de captura compartida por crear/editar: si es favorito, exige `cantFav` > 0. En
 * edición `favorito`/`cantFav` pueden venir o no; la regla solo aplica cuando, con lo
 * capturado, `favorito` queda en `true`. Para el alta `favorito` siempre es boolean.
 *
 * OJO edición parcial: si el payload NO trae `favorito` (omitido), no podemos validar la
 * regla contra el estado en BD desde aquí (el contrato no conoce el registro) — esa
 * coherencia la garantiza el dominio (A1). Aquí solo cubrimos lo que viene en el payload:
 * si `favorito === true`, `cantFav` debe venir y ser > 0.
 */
function favoritoExigeCantFav(datos: {
  favorito?: boolean | null | undefined;
  cantFav?: number | null | undefined;
}): boolean {
  return datos.favorito !== true || (typeof datos.cantFav === 'number' && datos.cantFav > 0);
}

/** Mensaje único de la regla favorito ⇒ cantFav (para no repetirlo). */
const MENSAJE_FAVORITO = {
  error: 'Si el avío es favorito, captura la cantidad preestablecida (mayor a 0)',
  path: ['cantFav'] as PropertyKey[],
};

/**
 * Alta de avío (catálogo global F1-E3, R1). `clave` y `descripcion` son obligatorias;
 * `unidad`/`presentacion` son opcionales en el CONTRATO (NULLABLE en BD, ADR-0009): la
 * obligatoriedad en altas nuevas la pone el form del frontend. `proveedores` (≥0) van
 * inline con su precio/condiciones (misma transacción A2). favorito ⇒ cantFav (>0).
 */
export const esquemaAvioCrear = z
  .object({
    clave: z
      .string({ error: 'La clave es obligatoria' })
      .trim()
      .min(1, { error: 'La clave es obligatoria' })
      .max(50, { error: 'La clave no puede tener más de 50 caracteres' }),
    descripcion: z
      .string({ error: 'La descripción es obligatoria' })
      .trim()
      .min(1, { error: 'La descripción es obligatoria' })
      .max(300, { error: 'La descripción no puede tener más de 300 caracteres' }),
    /** Unidad de medida (pza, m, kg…). Opcional en el contrato; el form la exige (ADR-0009). */
    unidad: z
      .string()
      .trim()
      .max(50, { error: 'La unidad no puede tener más de 50 caracteres' })
      .optional(),
    /** Presentación/empaque (caja, rollo…). Opcional en el contrato; el form la exige. */
    presentacion: z
      .string()
      .trim()
      .max(50, { error: 'La presentación no puede tener más de 50 caracteres' })
      .optional(),
    favorito: z.boolean({ error: '¿Favorito? debe ser verdadero o falso' }).default(false),
    /** Cantidad preestablecida si es favorito (el dominio la exige > 0 si `favorito`). */
    cantFav: z
      .number({ error: 'La cantidad preestablecida debe ser un número' })
      .positive({ error: 'La cantidad preestablecida debe ser mayor a 0' })
      .optional(),
    /** Avío genérico de stock (R4 / Make-to-Order). */
    esGenerico: z.boolean({ error: '¿Genérico? debe ser verdadero o falso' }).default(false),
    /** Precio de referencia (fallback de precio sin proveedor mapeable — ADR-0009). */
    precioReferencia: z
      .number({ error: 'El precio de referencia debe ser un número' })
      .nonnegative({ error: 'El precio de referencia no puede ser negativo' })
      .optional(),
    /** Proveedores que surten el avío con su precio/condiciones (R1). ≥0 (puede no tener). */
    proveedores: esquemaProveedoresLista.optional(),
  })
  .refine(favoritoExigeCantFav, MENSAJE_FAVORITO);

/** Datos validados de alta de avío. */
export type DatosAvioCrear = z.infer<typeof esquemaAvioCrear>;

/**
 * Edición de avío: todos los campos del alta opcionales (edición parcial) + `activo` para
 * el borrado suave. `clave`/`descripcion` NO son nullable (obligatorias); `unidad`/
 * `presentacion` sí aceptan `null` para VACIARlas (M1). `cantFav`/`precioReferencia`
 * aceptan `null` para borrarlas. `proveedores`: si se omite, NO se tocan; si se manda
 * (aunque sea []), el dominio REEMPLAZA el set (puede quedar en 0).
 */
const baseAvioEditar = z
  .object({
    clave: z
      .string()
      .trim()
      .min(1, { error: 'La clave es obligatoria' })
      .max(50, { error: 'La clave no puede tener más de 50 caracteres' })
      .optional(),
    descripcion: z
      .string()
      .trim()
      .min(1, { error: 'La descripción es obligatoria' })
      .max(300, { error: 'La descripción no puede tener más de 300 caracteres' })
      .optional(),
    // Opcionales nullable (M1): omitir = no tocar; `null` = borrar.
    unidad: z
      .string()
      .trim()
      .max(50, { error: 'La unidad no puede tener más de 50 caracteres' })
      .optional()
      .nullable(),
    presentacion: z
      .string()
      .trim()
      .max(50, { error: 'La presentación no puede tener más de 50 caracteres' })
      .optional()
      .nullable(),
    favorito: z.boolean({ error: '¿Favorito? debe ser verdadero o falso' }).optional(),
    cantFav: z
      .number({ error: 'La cantidad preestablecida debe ser un número' })
      .positive({ error: 'La cantidad preestablecida debe ser mayor a 0' })
      .optional()
      .nullable(),
    esGenerico: z.boolean({ error: '¿Genérico? debe ser verdadero o falso' }).optional(),
    precioReferencia: z
      .number({ error: 'El precio de referencia debe ser un número' })
      .nonnegative({ error: 'El precio de referencia no puede ser negativo' })
      .optional()
      .nullable(),
    /** Reemplaza el set de proveedores si viene; puede quedar en 0. Omitir = no tocar. */
    proveedores: esquemaProveedoresLista.optional(),
    activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
  })
  .extend({
    id: z
      .number({ error: 'El id del avío es obligatorio' })
      .int({ error: 'El id del avío debe ser entero' })
      .positive({ error: 'El id del avío debe ser positivo' }),
  });

export const esquemaAvioEditar = baseAvioEditar.refine(favoritoExigeCantFav, MENSAJE_FAVORITO);

/** Datos validados de edición de avío. */
export type DatosAvioEditar = z.infer<typeof esquemaAvioEditar>;

/**
 * Cuerpo del PATCH de avío (la ruta REST recibe el `id` en la URL, no en el body). Se
 * deriva del esquema OBJETO base (antes del `.refine()`) omitiendo `id` y re-aplicando la
 * regla favorito ⇒ cantFav (igual que hace el proveedor con su regla de factura).
 */
export const esquemaAvioPatchCuerpo = baseAvioEditar
  .omit({ id: true })
  .refine(favoritoExigeCantFav, MENSAJE_FAVORITO);

/** Datos validados del cuerpo del PATCH de avío (sin `id`). */
export type DatosAvioPatchCuerpo = z.infer<typeof esquemaAvioPatchCuerpo>;

// ── Salida ─────────────────────────────────────────────────────────────────────

/**
 * Salida de un proveedor de un avío (renglón del puente, R1): el proveedor y los datos
 * propios del renglón (precio/condiciones). `nombreProveedor` viene embebido para que la
 * UI no tenga que cruzar con el catálogo. Sale embebido en el avío y, suelto, en
 * `GET /api/avios/{id}/proveedores`.
 */
export const esquemaAvioProveedorSalida = z
  .object({
    idProveedor: z.number().int().describe('Id del proveedor.'),
    nombreProveedor: z.string().describe('Nombre del proveedor (para la UI).'),
    precio: z.number().nullable().describe('Precio al que este proveedor surte el avío, o null.'),
    condiciones: z.string().nullable().describe('Condiciones de este proveedor, o null.'),
    habitual: z
      .boolean()
      .describe(
        '⭐ §Post-F9.82: ¿es el proveedor HABITUAL del avío? Es el que propone la explosión (arriba ' +
          'del "más barato" de F4). Uno por avío.',
      ),
  })
  .describe('Proveedor de un avío con su precio y condiciones (R1).');

/** Forma de un proveedor de avío tal como lo devuelve la API. */
export type AvioProveedorSalida = z.infer<typeof esquemaAvioProveedorSalida>;

/**
 * Salida de un avío en la API (lo que ve el frontend). Proyección del modelo `Avio` a
 * JSON, con sus proveedores (R1), la auditoría (quién/cuándo) y los decimales serializados
 * a `number`. Parte del contrato OpenAPI.
 */
export const esquemaAvioSalida = z
  .object({
    id: z.number().int().describe('Id del avío.'),
    clave: z.string().describe('Clave de negocio del avío (única global).'),
    descripcion: z.string().describe('Descripción del avío.'),
    unidad: z.string().nullable().describe('Unidad de medida (pza, m, kg…), o null.'),
    presentacion: z.string().nullable().describe('Presentación/empaque, o null.'),
    favorito: z.boolean().describe('¿Avío de uso frecuente?'),
    cantFav: z.number().nullable().describe('Cantidad preestablecida si es favorito, o null.'),
    esGenerico: z.boolean().describe('¿Avío genérico de stock (R4)?'),
    precioReferencia: z.number().nullable().describe('Precio de referencia (fallback), o null.'),
    proveedores: z
      .array(esquemaAvioProveedorSalida)
      .describe('Proveedores del avío con su precio y condiciones (R1).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Avío del catálogo (global, R1).');

/** Forma de un avío tal como lo devuelve la API. */
export type AvioSalida = z.infer<typeof esquemaAvioSalida>;

/**
 * Parámetros del listado de avíos EN LA URL (querystring): todo llega como texto, así que
 * se coaccionan números y banderas. Búsqueda por `clave` O `descripcion` (insensible a
 * mayúsculas); filtro opcional `esGenerico` (R4) e `incluirInactivos`.
 */
export const esquemaListarAvios = z
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
      .max(200)
      .optional()
      .describe('Texto a buscar en la clave o la descripción (insensible a mayúsculas).'),
    esGenerico: z
      .stringbool()
      .optional()
      .describe('Filtra por avíos genéricos (R4): "true"/"false". Omitir = todos.'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    ordenarPor: z
      .enum(['clave', 'descripcion', 'creadoEn'])
      .default('clave')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de avíos.');

/** Parámetros de listado de avíos ya coaccionados desde la URL. */
export type ListarAvios = z.infer<typeof esquemaListarAvios>;

/** Respuesta paginada del listado de avíos (forma estándar `Pagina<T>`). */
export const esquemaAviosPagina = z
  .object({
    datos: z.array(esquemaAvioSalida).describe('Avíos de la página.'),
    total: z.number().int().describe('Total de avíos que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de avíos.');

/** Forma de la respuesta paginada de avíos. */
export type AviosPagina = z.infer<typeof esquemaAviosPagina>;

/** Lista de proveedores de un avío (`GET /api/avios/{id}/proveedores`). */
export const esquemaAvioProveedoresLista = z
  .object({
    datos: z.array(esquemaAvioProveedorSalida).describe('Proveedores del avío con su precio.'),
  })
  .describe('Proveedores de un avío (R1).');

/** Forma de la lista de proveedores de un avío. */
export type AvioProveedoresLista = z.infer<typeof esquemaAvioProveedoresLista>;
