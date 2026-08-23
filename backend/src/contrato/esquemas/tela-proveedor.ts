import { z } from 'zod';

/**
 * Contrato Zod de TelaProveedor + TelaProveedorColor (F8-E1, D13/R17). Precio de una TELA
 * POR PROVEEDOR, con su grid opcional de precio POR COLOR. ESPEJO del contrato de
 * `AvioProveedor` (`avio.ts`) y del grid de colores con precio de la Tela (`tela.ts`): el
 * mismo proveedor surte varias telas a precios distintos y, para ciertos proveedores, el
 * precio cambia por color (`manejaPrecioPorColor` → el precio fino vive en
 * `TelaProveedorColor`). Es SUB-RECURSO de la Tela: se captura/edita colgado de una tela.
 *
 * Modelo: `TelaProveedor` con surrogate `id` (lo referencian el BOM y el precosto de F8) y
 * unicidad de negocio `[idTela, idProveedor]` (un proveedor aparece UNA vez por tela). El
 * grid `colores` (idColor + precio opcional) viaja INLINE en el body de crear/editar y se
 * sincroniza en la misma transacción A2 (igual que los colores de la Tela).
 *
 * Reglas de captura (las repite el dominio, A1): `idProveedor` obligatorio; unicidad
 * `[idTela, idProveedor]`; un color NO se repite dentro del mismo renglón proveedor;
 * `precio`/`condiciones`/`manejaPrecioPorColor` opcionales. Semántica del PATCH parcial
 * (M1, igual que Avío/Tela): omitir un campo (`undefined`) = no tocar; mandar `null`/`''`
 * en un opcional = vaciarlo (se guarda `null`, nunca `''`). Decimales (`precio`) entran y
 * salen como `number` (Prisma los guarda como `Decimal`).
 */

// ── Precio por color (grid inline, N:N a Color) ────────────────────────────────

/**
 * Un renglón del grid de precio por color de un proveedor de tela: el id del color (del
 * catálogo `Color`) y, opcional, su precio. Solo tiene sentido cuando el renglón proveedor
 * `manejaPrecioPorColor`, pero el contrato NO lo acopla (el dominio permite guardarlo aun
 * si la bandera está en false). La unicidad del color DENTRO del renglón la valida el
 * dominio y la respalda la PK compuesta `[idTelaProveedor, idColor]`.
 */
export const esquemaTelaProveedorColorEntrada = z
  .object({
    idColor: z
      .number({ error: 'El id del color es obligatorio' })
      .int({ error: 'El id del color debe ser entero' })
      .positive({ error: 'El id del color debe ser positivo' }),
    precio: z
      .number({ error: 'El precio debe ser un número' })
      .nonnegative({ error: 'El precio no puede ser negativo' })
      .optional(),
  })
  .describe('Precio de una tela de un proveedor en un color (F8-E1, D13).');

/** Datos validados de un renglón de precio por color. */
export type DatosTelaProveedorColorEntrada = z.infer<typeof esquemaTelaProveedorColorEntrada>;

/**
 * Grid de precio por color (cada color con precio opcional). Puede ir VACÍO. Sin colores
 * repetidos (mismo `idColor` dos veces) — lo refina el esquema y lo re-valida el dominio.
 */
const esquemaColoresLista = z
  .array(esquemaTelaProveedorColorEntrada)
  .max(200, { error: 'Demasiados colores en el proveedor de la tela' })
  .refine((items) => new Set(items.map((i) => i.idColor)).size === items.length, {
    error: 'Hay colores repetidos en el proveedor de la tela',
  });

// ── Alta ────────────────────────────────────────────────────────────────────────

/**
 * Alta de un proveedor de tela (F8-E1, R17). `idProveedor` es obligatorio; el proveedor
 * debe existir y estar ACTIVO, y ser único por tela (lo valida el dominio). `precio`,
 * `manejaPrecioPorColor`, `condiciones` y el grid `colores` son opcionales. El `idTela`
 * NO viaja en el body: lo pone la ruta desde la URL (sub-recurso de la tela).
 */
export const esquemaTelaProveedorCrear = z
  .object({
    idProveedor: z
      .number({ error: 'El id del proveedor es obligatorio' })
      .int({ error: 'El id del proveedor debe ser entero' })
      .positive({ error: 'El id del proveedor debe ser positivo' }),
    /** Precio base al que surte la tela (por unidad de compra). Opcional, no negativo. */
    precio: z
      .number({ error: 'El precio debe ser un número' })
      .nonnegative({ error: 'El precio no puede ser negativo' })
      .optional(),
    /** ¿Este proveedor cotiza distinto por color? Entonces el precio fino va en el grid. */
    manejaPrecioPorColor: z
      .boolean({ error: '¿Maneja precio por color? debe ser verdadero o falso' })
      .default(false),
    /** Condiciones comerciales (texto libre; ej. "USD, LAB Manzanillo"). */
    condiciones: z
      .string()
      .trim()
      .max(500, { error: 'Las condiciones no pueden tener más de 500 caracteres' })
      .optional(),
    /** Grid de precio por color (cada uno con precio opcional). Puede ir vacío. ≥0. */
    colores: esquemaColoresLista.optional(),
  })
  .describe('Alta de un precio de tela por proveedor (F8-E1, R17).');

/** Datos validados de alta de proveedor de tela. */
export type DatosTelaProveedorCrear = z.infer<typeof esquemaTelaProveedorCrear>;

// ── Edición ───────────────────────────────────────────────────────────────────

/**
 * Cuerpo base de la edición: todos los campos del alta opcionales (edición parcial) +
 * `activo` para el borrado suave. `precio`/`condiciones` aceptan `null` para VACIARlas
 * (M1). `idProveedor` opcional: si cambia, el dominio revalida que exista/activo y que la
 * pareja `[idTela, idProveedor]` quede libre. `colores`: si se omite, NO se toca; si viene
 * (incluso `[]`), REEMPLAZA el grid completo (el dominio hace el diff).
 */
const baseTelaProveedorEditar = z.object({
  idProveedor: z
    .number({ error: 'El id del proveedor debe ser un número' })
    .int({ error: 'El id del proveedor debe ser entero' })
    .positive({ error: 'El id del proveedor debe ser positivo' })
    .optional(),
  precio: z
    .number({ error: 'El precio debe ser un número' })
    .nonnegative({ error: 'El precio no puede ser negativo' })
    .nullable()
    .optional(),
  manejaPrecioPorColor: z
    .boolean({ error: '¿Maneja precio por color? debe ser verdadero o falso' })
    .optional(),
  condiciones: z
    .string()
    .trim()
    .max(500, { error: 'Las condiciones no pueden tener más de 500 caracteres' })
    .nullable()
    .optional(),
  /** Reemplaza el grid de colores si viene (incluso vacío); omitir = no tocar. */
  colores: esquemaColoresLista.optional(),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/**
 * Edición de proveedor de tela: el cuerpo base + `id` (el del renglón `TelaProveedor`). El
 * `idTela` NO viaja aquí: lo pone la ruta desde la URL (y el dominio exige que el renglón
 * PERTENEZCA a esa tela).
 */
export const esquemaTelaProveedorEditar = baseTelaProveedorEditar.extend({
  id: z
    .number({ error: 'El id del proveedor de la tela es obligatorio' })
    .int({ error: 'El id del proveedor de la tela debe ser entero' })
    .positive({ error: 'El id del proveedor de la tela debe ser positivo' }),
});

/** Datos validados de edición de proveedor de tela. */
export type DatosTelaProveedorEditar = z.infer<typeof esquemaTelaProveedorEditar>;

/**
 * Cuerpo del PATCH (la ruta REST recibe el `id` en la URL, no en el body). Es el cuerpo
 * base SIN `id` (igual criterio que `esquemaAvioPatchCuerpo`).
 */
export const esquemaTelaProveedorPatchCuerpo = baseTelaProveedorEditar;

/** Datos validados del cuerpo del PATCH (sin `id`). */
export type DatosTelaProveedorPatchCuerpo = z.infer<typeof esquemaTelaProveedorPatchCuerpo>;

// ── Salida ─────────────────────────────────────────────────────────────────────

/** Salida de un renglón de precio por color (color + precio). */
export const esquemaTelaProveedorColorSalida = z
  .object({
    idColor: z.number().int().describe('Id del color.'),
    nombre: z.string().describe('Nombre del color.'),
    precio: z.number().nullable().describe('Precio de la tela en este color, o null.'),
  })
  .describe('Renglón de precio por color de un proveedor de tela.');

/** Forma de un renglón de precio por color tal como lo devuelve la API. */
export type TelaProveedorColorSalida = z.infer<typeof esquemaTelaProveedorColorSalida>;

/**
 * Salida de un proveedor de tela en la API (proyección del modelo `TelaProveedor` a JSON):
 * a qué proveedor se le compra la tela, su precio base/condiciones, si maneja precio por
 * color y su grid de colores con precio, la auditoría y los decimales serializados a
 * `number`. `nombreProveedor` viene embebido para que la UI no cruce con el catálogo.
 */
export const esquemaTelaProveedorSalida = z
  .object({
    id: z.number().int().describe('Id del renglón tela–proveedor.'),
    idTela: z.number().int().describe('Id de la tela.'),
    idProveedor: z.number().int().describe('Id del proveedor.'),
    nombreProveedor: z.string().describe('Nombre del proveedor (para la UI).'),
    precio: z.number().nullable().describe('Precio base al que surte la tela, o null.'),
    manejaPrecioPorColor: z.boolean().describe('¿El precio cambia por color (grid abajo)?'),
    condiciones: z.string().nullable().describe('Condiciones comerciales, o null.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    colores: z
      .array(esquemaTelaProveedorColorSalida)
      .describe('Grid de precio por color (si maneja precio por color).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Precio de una tela por proveedor (F8-E1, R17), con su grid de precio por color.');

/** Forma de un proveedor de tela tal como lo devuelve la API. */
export type TelaProveedorSalida = z.infer<typeof esquemaTelaProveedorSalida>;

/** Lista de proveedores de una tela (`GET /telas/{idTela}/proveedores`). */
export const esquemaTelaProveedoresLista = z
  .object({
    datos: z
      .array(esquemaTelaProveedorSalida)
      .describe('Proveedores de la tela con su precio (y precio por color).'),
  })
  .describe('Proveedores de una tela con su precio (F8-E1, R17).');

/** Forma de la lista de proveedores de una tela. */
export type TelaProveedoresLista = z.infer<typeof esquemaTelaProveedoresLista>;
