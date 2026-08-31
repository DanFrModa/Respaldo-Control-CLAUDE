import { z } from 'zod';

import { esquemaArteSalida } from './arte.js';

/**
 * Contrato Zod del Módulo 2 — Modelos (F1-E4): el modelo (ex `Modelos`), su receta/BOM
 * (telas/avíos/arte) y sus fotos en R2. Una sola definición de las reglas de captura
 * para UI y servidor (fuente del OpenAPI). Doc funcional: `Documentacion_MJD/01-Modelos.md`.
 * Catálogo GLOBAL (ADR-0007): la unicidad de `codigo` es global.
 *
 * Decisiones cerradas con Gabriel:
 *  • `Genero` es un catálogo SEMBRADO con un solo selector (`GET /api/generos`, bajo
 *    `modelos.ver`); aquí solo su salida. `Modelo.idGenero` es FK nullable (ETL E7).
 *  • BOM telas/avíos: cada renglón con `consumoPorPrenda` + las TRES banderas 🔑
 *    `paraPreCosto`/`paraProduccion`/`paraCosto` (doc 01-Modelos §2 — se conservan).
 *  • ARTE (bordados/estampados): desde V1-E3d (§Post-F9.35) NO es un renglón que apunte a un
 *    catálogo, sino un HIJO del modelo con sus propios datos. Su contrato vive aparte, en
 *    `esquemas/arte.ts`; aquí solo se embebe su salida en la ficha.
 *
 * Semántica del PATCH parcial (M1, igual que Tela/Avio): omitir un campo (`undefined`) = no
 * tocar; mandar `null`/'' en un opcional de texto = vaciarlo (se guarda `null`, nunca '').
 * Decimales entran como `number` y salen como `number` (Prisma los guarda como `Decimal`).
 */

// ── Género (catálogo selector, sin permiso propio) ─────────────────────────────

/** Salida de un género en la API (selector `GET /api/generos`). */
export const esquemaGeneroSalida = z
  .object({
    id: z.number().int().describe('Id del género.'),
    nombre: z.string().describe('Nombre del género (único global).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
  })
  .describe('Género del catálogo (selector).');

/** Forma de un género tal como lo devuelve la API. */
export type GeneroSalida = z.infer<typeof esquemaGeneroSalida>;

// ── BOM: telas y avíos (consumo + 3 banderas 🔑) ───────────────────────────────

/** Consumo por prenda: número positivo (Prisma lo guarda como `Decimal(12,4)`). */
const esquemaConsumo = z
  .number({ error: 'El consumo debe ser un número' })
  .positive({ error: 'El consumo debe ser mayor a 0' });

/**
 * Id de un AMARRE de precio del renglón del BOM (R17/D13): entero positivo, `null` = sin amarre.
 * Es opcional en la captura y su default es `null` — el PUT del BOM es SET-COMPLETO: lo que no
 * viene, no está (un renglón que se manda sin amarre queda sin amarre, no conserva el anterior).
 */
const esquemaAmarre = z
  .number({ error: 'El id del amarre debe ser un número' })
  .int({ error: 'El id del amarre debe ser entero' })
  .positive({ error: 'El id del amarre debe ser positivo' })
  .nullable()
  .default(null);

/**
 * Renglón de captura del BOM de TELAS de un modelo (doc 01-Modelos §2, `ModelosTela`): la
 * tela del catálogo, su consumo por prenda y las TRES banderas de uso. Las banderas tienen
 * default `true` en el alta; la unicidad de la tela DENTRO del modelo la valida el dominio
 * (rechazo claro) y la respalda la PK compuesta `[idModelo, idTela]`.
 */
export const esquemaModeloTelaEntrada = z.object({
  idTela: z
    .number({ error: 'El id de la tela es obligatorio' })
    .int({ error: 'El id de la tela debe ser entero' })
    .positive({ error: 'El id de la tela debe ser positivo' }),
  consumoPorPrenda: esquemaConsumo,
  paraPreCosto: z.boolean().default(true),
  paraProduccion: z.boolean().default(true),
  paraCosto: z.boolean().default(true),
  /**
   * AMARRE DE PRECIO (R17/D13): `TelaProveedor.id` del renglón proveedor–tela–precio que eligió
   * Desarrollo. `null` = sin amarre → la cascada de precios cae a color/sugerido
   * (`dominio/costos/resolucion-precios.ts`). El dominio valida que el renglón sea DE ESA tela y
   * esté activo. Omitirlo equivale a `null` (el set-completo no conserva amarres implícitos).
   */
  idTelaProveedor: esquemaAmarre,
});

/** Datos validados de un renglón de tela del BOM. */
export type DatosModeloTelaEntrada = z.infer<typeof esquemaModeloTelaEntrada>;

/**
 * Renglón de captura del BOM de AVÍOS de un modelo (doc 01-Modelos §2, `ModelosHab`): misma
 * forma que la tela (consumo + 3 banderas), referenciando un avío del catálogo.
 */
export const esquemaModeloAvioEntrada = z.object({
  idAvio: z
    .number({ error: 'El id del avío es obligatorio' })
    .int({ error: 'El id del avío debe ser entero' })
    .positive({ error: 'El id del avío debe ser positivo' }),
  consumoPorPrenda: esquemaConsumo,
  paraPreCosto: z.boolean().default(true),
  paraProduccion: z.boolean().default(true),
  paraCosto: z.boolean().default(true),
  /**
   * AMARRE DE PRECIO (R17/D13): el PROVEEDOR del par `AvioProveedor` elegido por Desarrollo —
   * `(idAvio de este renglón, idAvioProveedor)`, mismo criterio y nombre que
   * `OrdenCompraLinea.idAvioProveedor` de F4. `null` = sin amarre → el precio cae a "más barato" /
   * `Avio.precioReferencia`. El dominio valida que el par exista.
   */
  idAvioProveedor: esquemaAmarre,
});

/** Datos validados de un renglón de avío del BOM. */
export type DatosModeloAvioEntrada = z.infer<typeof esquemaModeloAvioEntrada>;

/**
 * Lista de telas del BOM (sin `idTela` repetido — un componente aparece UNA vez). Puede ir
 * VACÍA (un modelo nuevo puede no tener BOM aún). Lo refina el esquema y lo re-valida el dominio.
 */
export const esquemaModeloTelas = z
  .array(esquemaModeloTelaEntrada)
  .max(200, { error: 'Demasiadas telas en el modelo' })
  .refine((items) => new Set(items.map((i) => i.idTela)).size === items.length, {
    error: 'Hay telas repetidas en el modelo',
  });

/** Lista de avíos del BOM (sin `idAvio` repetido; puede ir vacía). */
export const esquemaModeloAvios = z
  .array(esquemaModeloAvioEntrada)
  .max(200, { error: 'Demasiados avíos en el modelo' })
  .refine((items) => new Set(items.map((i) => i.idAvio)).size === items.length, {
    error: 'Hay avíos repetidos en el modelo',
  });

// ── Secuencia de estampado (rediseño R4/R5, B10) ───────────────────────────────

/** Secuencia del estampado/bordado respecto a la costura (por modelo). Espejo del enum de BD. */
export const esquemaSecuenciaEstampado = z
  .enum(['antes', 'despues', 'flexible'])
  .describe('Secuencia del estampado respecto a la costura: antes | después | flexible.');

/** Clave de la secuencia de estampado. */
export type SecuenciaEstampadoClave = z.infer<typeof esquemaSecuenciaEstampado>;

// ── ¿La prenda LLEVA arte? (decisión de Daniel, 26-jul-2026) ────────────────────

/**
 * ¿El modelo LLEVA arte (bordado/estampado)? Decisión de Daniel: *"por default sí lleva; a menos
 * que la marques como que no lleva… si no meten la información del arte, o no desmarcan la
 * casilla, está como incompleto"*. Es el requisito ARTE del estado automático de la orden: con
 * `true` la orden no se completa hasta que el modelo tenga su arte capturado; con `false` el arte
 * no aplica. Default `true` en BD (también para lo migrado).
 */
export const esquemaLlevaArte = z
  .boolean({ error: '"Lleva arte" debe ser verdadero o falso' })
  .describe(
    '¿La prenda lleva arte (bordado/estampado)? Default true: si lo lleva y no se captura, la orden queda incompleta.',
  );

// ── Dificultad DERIVADA del # de operaciones (rediseño R5, B7) ──────────────────

/** Querystring del resolvedor de dificultad: el # de operaciones a evaluar. */
export const esquemaDificultadQuery = z
  .object({
    ops: z.coerce
      .number({ error: 'El # de operaciones debe ser un número' })
      .int({ error: 'El # de operaciones debe ser entero' })
      .nonnegative({ error: 'El # de operaciones no puede ser negativo' })
      .describe('# de operaciones de costura a evaluar contra la tabla de rangos.'),
  })
  .describe('Parámetros del resolvedor de dificultad por # de operaciones.');

/** Forma del rango de dificultad que casó con el # de operaciones (o null si ninguno). */
export const esquemaDificultadResuelta = z
  .object({
    numOperaciones: z.number().int().describe('# de operaciones evaluado.'),
    rango: z
      .object({
        id: z.number().int().describe('Id del rango de dificultad.'),
        nombre: z.string().describe('Nombre del nivel (ej. "Muy complejo").'),
        diasCostura: z.number().int().describe('Días de costura del CPM para este nivel.'),
        opsDesde: z.number().int().describe('Límite inferior del rango.'),
        opsHasta: z
          .number()
          .int()
          .nullable()
          .describe('Límite superior del rango (null = abierto).'),
      })
      .nullable()
      .describe('El rango que casó, o null si ningún rango cubre ese # de operaciones.'),
  })
  .describe('Dificultad derivada del # de operaciones (R5, B7).');

/** Forma de la dificultad resuelta. */
export type DificultadResuelta = z.infer<typeof esquemaDificultadResuelta>;

// ── Modelo (datos generales) ───────────────────────────────────────────────────

/**
 * Campo `# de operaciones de costura` (rediseño R4/R5, B7): dato objetivo que deriva la DIFICULTAD
 * contra la tabla `RangoDificultad` (y de ahí los días de costura del CPM). Entero no negativo.
 */
const esquemaNumOperaciones = z
  .number({ error: 'El # de operaciones debe ser un número' })
  .int({ error: 'El # de operaciones debe ser entero' })
  .nonnegative({ error: 'El # de operaciones no puede ser negativo' });

/** Costo de CORTE por prenda (rediseño R5, B8): separado de la maquila, sin proveedor. No negativo. */
const esquemaCorteBase = z
  .number({ error: 'El corte debe ser un número' })
  .nonnegative({ error: 'El corte no puede ser negativo' });

/** Maquilero (costura) cotizado (rediseño R5, B9): id de un Proveedor. */
const esquemaIdMaquilero = z
  .number({ error: 'El id del maquilero debe ser un número' })
  .int({ error: 'El id del maquilero debe ser entero' })
  .positive({ error: 'El id del maquilero debe ser positivo' });

/**
 * COMPOSICIÓN textil del modelo (decisión de Daniel, 24-jul-2026): se captura en la ficha del
 * modelo (el desarrollo) y toda orden de ese modelo la HEREDA sola. Mismo tope que la composición
 * de la orden (2000 caracteres) para que la herencia nunca se trunque.
 */
const esquemaComposicionModelo = z
  .string()
  .trim()
  .max(2000, { error: 'La composición no puede tener más de 2000 caracteres' });

/** Campos opcionales del modelo (mismas reglas de longitud en alta y edición). */
const camposOpcionalesModelo = {
  descripcion: z
    .string()
    .trim()
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' })
    .optional(),
  composicion: esquemaComposicionModelo.optional(),
} as const;

/**
 * Alta de modelo (catálogo global F1-E4). El `codigo` es la clave de negocio (único global).
 * `maquilaBase` (costo de maquila base, doc 01-Modelos §4) y las FK temporada/curva/género
 * son OPCIONALES (el ETL E7 las poblará). El BOM no va aquí: se captura con los endpoints de
 * BOM tras crear el modelo (igual que la foto del arte). Nace activo y sin BOM/fotos.
 */
// ⭐ V1-E7d — declarado AQUÍ y no junto a sus endpoints porque `esquemaModeloSalida` lo usa: un
// `const` no se iza, y declararlo después reventaría el módulo al evaluarse (TDZ).
/**
 * Estado de la REVISIÓN de la receta de una versión. `null` en el modelo (no un cuarto valor
 * aquí) significa **no aplica**: el modelo no nació de una negociación.
 */
export const esquemaEstadoRevisionModelo = z
  .enum(['pendiente', 'aprobada', 'rechazada'])
  .describe('Estado de la revisión de la receta de una versión de modelo.');

/** Clave del estado de revisión. */
export type EstadoRevisionModeloClave = z.infer<typeof esquemaEstadoRevisionModelo>;

/**
 * ORIGEN del modelo (§Post-F9.34, V1-E3n): en qué catálogo vive y de qué serie salió su número.
 * Ver `Modelo.origen` en el esquema Prisma.
 */
export const esquemaOrigenModelo = z
  .enum(['desarrollo', 'produccion'])
  .describe('Origen del modelo: "desarrollo" (código CYA-26-71-001) o "produccion" (5 dígitos).');

/** Clave del origen del modelo. */
export type OrigenModeloClave = z.infer<typeof esquemaOrigenModelo>;

/**
 * Filtro de ORIGEN del catálogo y de la galería. ⭐ **El DEFAULT es `todos` desde V1-E8j**
 * (§Post-F9.134). Nació como `produccion` —Daniel pidió *"no llenar de basura el catálogo"* con los
 * modelos de desarrollo que nunca salen (§Post-F9.34 punto 2)—, pero junto con que **todo modelo
 * nace en desarrollo** ese default escondía por omisión justo lo recién creado: *"generé dos
 * modelos en precosteo… y no los veo en modelos"*. El motivo viejo se sirve con la **etapa visible
 * en cada renglón**; los filtros `produccion` y `desarrollo` siguen a un clic.
 */
export const esquemaFiltroOrigenModelo = z
  .enum(['produccion', 'desarrollo', 'todos'])
  .describe('Filtro de origen: solo producción, solo desarrollo, o todos (default).');

/** Clave del filtro de origen. */
export type FiltroOrigenModeloClave = z.infer<typeof esquemaFiltroOrigenModelo>;

export const esquemaModeloCrear = z.object({
  codigo: z
    .string({ error: 'El código es obligatorio' })
    .trim()
    .min(1, { error: 'El código es obligatorio' })
    .max(50, { error: 'El código no puede tener más de 50 caracteres' }),
  /** Costo de maquila base (informativo en el catálogo; lo heredan las órdenes). Opcional, no negativo. */
  maquilaBase: z
    .number({ error: 'La maquila base debe ser un número' })
    .nonnegative({ error: 'La maquila base no puede ser negativa' })
    .optional(),
  /** Temporada (opcional). Si viene, el dominio exige que exista y esté activa. */
  idTemporada: z
    .number({ error: 'El id de la temporada debe ser un número' })
    .int({ error: 'El id de la temporada debe ser entero' })
    .positive({ error: 'El id de la temporada debe ser positivo' })
    .optional(),
  /** Curva de tallas (opcional, D4). Si viene, el dominio exige que exista y esté activa. */
  idCurvaTalla: z
    .number({ error: 'El id de la curva de tallas debe ser un número' })
    .int({ error: 'El id de la curva de tallas debe ser entero' })
    .positive({ error: 'El id de la curva de tallas debe ser positivo' })
    .optional(),
  /**
   * Género — ⭐ **OBLIGATORIO desde V1-E8j** (§Post-F9.134). Antes era opcional. Junto con el tipo de
   * prenda da los DOS DÍGITOS con los que el sistema arma el nº de producción del modelo
   * (§Post-F9.83), y desde que **todo modelo nace en desarrollo** un modelo sin ellos **no se puede
   * promover**: su OP no se puede generar. El alta de Desarrollo ya los exigía; esto alinea la
   * segunda puerta con la primera en vez de inventar una regla.
   * ⚠️ El **modo migración** entra por `esquemaModeloCrearMigracion`, donde siguen siendo opcionales.
   */
  idGenero: z
    .number({ error: 'El género es obligatorio' })
    .int({ error: 'El id del género debe ser entero' })
    .positive({ error: 'El id del género debe ser positivo' }),
  /**
   * Tipo de producto (ex «tipo de prenda» para Calidad, F6-E1) — ⭐ **OBLIGATORIO desde V1-E8j**, por
   * la misma razón que el género: es el dígito de CONCEPTO del nº de producción.
   */
  idTipoProducto: z
    .number({ error: 'El tipo de prenda es obligatorio' })
    .int({ error: 'El id del tipo de producto debe ser entero' })
    .positive({ error: 'El id del tipo de producto debe ser positivo' }),
  /** # de operaciones de costura (R5/B7): deriva la dificultad → días de costura del CPM. Opcional. */
  numOperaciones: esquemaNumOperaciones.optional(),
  /** Costo de corte por prenda (R5/B8), separado de la maquila, sin proveedor. Opcional. */
  corteBase: esquemaCorteBase.optional(),
  /** Maquilero (costura) cotizado (R5/B9). Si viene, el dominio exige Proveedor existente/activo. */
  idMaquileroCotizado: esquemaIdMaquilero.optional(),
  /** Secuencia de estampado (R5/B10): antes | después | flexible. Opcional (default 'antes' en BD). */
  secuenciaEstampado: esquemaSecuenciaEstampado.optional(),
  /** ¿La prenda lleva arte? Opcional; omitir = `true` (default de Daniel, ver el esquema de salida). */
  llevaArte: esquemaLlevaArte.optional(),
  ...camposOpcionalesModelo,
});

/** Datos validados de alta de modelo. */
export type DatosModeloCrear = z.infer<typeof esquemaModeloCrear>;

/**
 * Alta de modelo en **MODO MIGRACIÓN** (V1-E8j) — el ETL del histórico de Access y NADA MÁS.
 *
 * Es el mismo esquema del alta con los DOS DÍGITOS de vuelta en opcionales. No es un descuido: los
 * ~4,987 modelos del Access **no traen género** (`Modelos.csv` ni siquiera tiene la columna) y ya son
 * de producción con su número puesto, así que no hay nada que numerar. La obligatoriedad existe para
 * que un modelo NUEVO no nazca sin poder promoverse; el histórico no tiene ese problema.
 *
 * ⚠️ **La regla vive en UNA sola capa.** Este esquema lo usa exclusivamente `crearModeloMigrado`
 * (`dominio/modelos/migracion.ts`), que **no pasa por `crearModelo`**: los dos comparten el núcleo
 * `crearModeloNucleo`, y la exigencia de los dígitos está en `crearModelo`, por ENCIMA del núcleo.
 * Así la migración entra por debajo sin que nadie tenga que acordarse de una bandera.
 */
export const esquemaModeloCrearMigracion = esquemaModeloCrear.extend({
  idGenero: esquemaModeloCrear.shape.idGenero.optional(),
  idTipoProducto: esquemaModeloCrear.shape.idTipoProducto.optional(),
});

/** Datos validados de alta de modelo en modo migración (los dos dígitos, opcionales). */
export type DatosModeloCrearMigracion = z.infer<typeof esquemaModeloCrearMigracion>;

/**
 * Edición de modelo: `id` + todos los campos del alta opcionales (edición parcial) +
 * `activo` para descontinuar/reactivar. Los textos opcionales son nullable (M1: `null`/'' =
 * borrar). Las FK aceptan `null` para QUITAR la relación; omitir = no tocar. El BOM NO se
 * toca aquí (tiene sus propios endpoints, como la foto del arte).
 */
export const esquemaModeloEditar = z
  .object({
    codigo: z
      .string()
      .trim()
      .min(1, { error: 'El código es obligatorio' })
      .max(50, { error: 'El código no puede tener más de 50 caracteres' })
      .optional(),
    /** `null` quita el valor; un número lo fija; omitir = no tocar. */
    maquilaBase: z
      .number({ error: 'La maquila base debe ser un número' })
      .nonnegative({ error: 'La maquila base no puede ser negativa' })
      .nullable()
      .optional(),
    /** `null` quita la temporada; un id la fija; omitir = no tocar. */
    idTemporada: z
      .number({ error: 'El id de la temporada debe ser un número' })
      .int({ error: 'El id de la temporada debe ser entero' })
      .positive({ error: 'El id de la temporada debe ser positivo' })
      .nullable()
      .optional(),
    /** `null` quita la curva; un id la fija; omitir = no tocar. */
    idCurvaTalla: z
      .number({ error: 'El id de la curva de tallas debe ser un número' })
      .int({ error: 'El id de la curva de tallas debe ser entero' })
      .positive({ error: 'El id de la curva de tallas debe ser positivo' })
      .nullable()
      .optional(),
    /**
     * `null` quita el género; un id lo fija; omitir = no tocar. ⚠️ **Sólo en modelos de PRODUCCIÓN:**
     * a uno de DESARROLLO el dominio le rechaza tanto el `null` como un género sin dígito capturado
     * (`exigirNoDesnumerar`), porque lo dejaría sin poder recibir su nº de producción (V1-E8j·H9).
     */
    idGenero: z
      .number({ error: 'El id del género debe ser un número' })
      .int({ error: 'El id del género debe ser entero' })
      .positive({ error: 'El id del género debe ser positivo' })
      .nullable()
      .optional(),
    /**
     * `null` quita el tipo de producto; un id lo fija; omitir = no tocar (F6-E1). ⚠️ Mismo corte que
     * el género: en un modelo de DESARROLLO el dominio rechaza vaciarlo o poner uno sin dígito.
     */
    idTipoProducto: z
      .number({ error: 'El id del tipo de producto debe ser un número' })
      .int({ error: 'El id del tipo de producto debe ser entero' })
      .positive({ error: 'El id del tipo de producto debe ser positivo' })
      .nullable()
      .optional(),
    /** `null` quita el # de operaciones; un número lo fija; omitir = no tocar (R5/B7). */
    numOperaciones: esquemaNumOperaciones.nullable().optional(),
    /** `null` quita el corte; un número lo fija; omitir = no tocar (R5/B8). */
    corteBase: esquemaCorteBase.nullable().optional(),
    /** `null` quita el maquilero cotizado; un id lo fija; omitir = no tocar (R5/B9). */
    idMaquileroCotizado: esquemaIdMaquilero.nullable().optional(),
    /** Cambia la secuencia de estampado; omitir = no tocar (R5/B10). No es nullable (tiene default). */
    secuenciaEstampado: esquemaSecuenciaEstampado.optional(),
    /** Marca/desmarca "lleva arte"; omitir = no tocar. No es nullable (tiene default `true`). */
    llevaArte: esquemaLlevaArte.optional(),
    descripcion: camposOpcionalesModelo.descripcion.nullable(),
    /** `null`/'' borra la composición del modelo; omitir = no tocar. */
    composicion: camposOpcionalesModelo.composicion.nullable(),
    activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
  })
  .extend({
    id: z
      .number({ error: 'El id del modelo es obligatorio' })
      .int({ error: 'El id del modelo debe ser entero' })
      .positive({ error: 'El id del modelo debe ser positivo' }),
  });

/** Datos validados de edición de modelo. */
export type DatosModeloEditar = z.infer<typeof esquemaModeloEditar>;

/** Cuerpo del PATCH de modelo (la ruta REST recibe el `id` en la URL, no en el body). */
export const esquemaModeloPatchCuerpo = esquemaModeloEditar.omit({ id: true });

/** Datos validados del cuerpo del PATCH de modelo (sin `id`). */
export type DatosModeloPatchCuerpo = z.infer<typeof esquemaModeloPatchCuerpo>;

// ── Salida del BOM (renglones embebidos en la ficha) ───────────────────────────

/**
 * De dónde salió el precio con el que se va a COSTEAR un renglón de la receta. Es el escalón de la
 * cascada (`dominio/costos/resolucion-precios.ts`) que ganó, dicho con las palabras de la pantalla:
 *
 *  • `ultimo-precio-compra` — ⭐ **el escalón 1 desde V1-E3e** (§Post-F9.48): el precio de la última
 *                         COMPRA REAL (OC autorizada) de ese material. Con amarre, es la última
 *                         compra **a ese proveedor**: el amarre elige al proveedor y el precio sale
 *                         de la realidad más reciente con él.
 *  • `amarre`           — el proveedor amarrado por Desarrollo (su precio negociado de catálogo):
 *                         aplica cuando a ese proveedor todavía no se le ha comprado el material.
 *  • `mas-barato`       — sin amarre (o con un amarre SIN precio) y sin compras: el proveedor más
 *                         barato del avío, en unidad de consumo (§Post-F9.97). NO está negociado.
 *  • `promedio-medidas` — avío "por medida" (R5/B11): promedio de los precios de sus medidas. Este
 *                         escalón GANA sobre todos (una compra es de UNA medida: no representa al
 *                         resto).
 *  • `referencia`       — último recurso del catálogo (`Tela.precioSugerido` /
 *                         `Avio.precioReferencia`): **solo lo nuevo que nunca se ha comprado**.
 *  • `sin-precio`       — no hay precio en ningún escalón: el costeo lo tomaría como 0.
 *
 * 🔑 Regla de la receta (Daniel, 15-ago-2026): **la pantalla nunca muestra una cifra distinta de la
 * que va a costear**; muestra la que costea y dice de dónde salió. Por eso este campo viaja: sin él
 * la UI tendría que adivinar la cascada, y adivinaba mal (enseñaba el precio de catálogo mientras
 * el motor costeaba con el más barato).
 */
export const esquemaOrigenPrecioBom = z
  .enum([
    'ultimo-precio-compra',
    'amarre',
    'mas-barato',
    'promedio-medidas',
    'referencia',
    'sin-precio',
  ])
  .describe('Escalón de la cascada del que salió el precio que va a costear.');

/**
 * Salida de un renglón de tela del BOM (con el nombre de la tela embebido para la UI) + el
 * AMARRE de precio (R17) y —lo importante— el precio que VA A COSTEAR con su procedencia
 * (`precioCosteo`/`origenPrecio`/`proveedorPrecio`). `precioReferencia` sigue viajando porque es el
 * último escalón de la cascada (`Tela.precioSugerido`), pero SOLO es lo que costea cuando
 * `origenPrecio === 'referencia'`.
 */
export const esquemaModeloTelaSalida = z
  .object({
    idTela: z.number().int().describe('Id de la tela.'),
    nombre: z.string().describe('Nombre de la tela (para la UI).'),
    consumoPorPrenda: z.number().describe('Consumo de tela por prenda.'),
    paraPreCosto: z.boolean().describe('¿Entra en el pre-costeo?'),
    paraProduccion: z.boolean().describe('¿Se considera al producir?'),
    paraCosto: z.boolean().describe('¿Entra en el costeo real?'),
    idTelaProveedor: z
      .number()
      .int()
      .nullable()
      .describe('Amarre R17: renglón proveedor–tela–precio elegido, o null.'),
    proveedorAmarrado: z.string().nullable().describe('Nombre del proveedor amarrado, o null.'),
    precioPorColor: z
      .boolean()
      .describe('¿El proveedor amarrado cotiza por COLOR? (el precio fino sale del color).'),
    precioCosteo: z
      .number()
      .nullable()
      .describe('El precio con el que se va a costear esta tela, o null si no hay ninguno.'),
    origenPrecio: esquemaOrigenPrecioBom,
    proveedorPrecio: z
      .string()
      .nullable()
      .describe('Proveedor del que salió `precioCosteo`, o null si no salió de un proveedor.'),
    amarreIgnorado: z
      .boolean()
      .describe(
        'Hay amarre (R17) pero el precio que costea NO lo firmó el proveedor amarrado: la pantalla ' +
          'debe gritarlo. Lo decide el servidor comparando ids de proveedor, nunca nombres.',
      ),
    precioReferencia: z
      .number()
      .nullable()
      .describe('Último escalón: precio de catálogo de la tela (precioSugerido).'),
  })
  .describe('Renglón de tela del BOM del modelo.');

/**
 * Salida de un renglón de avío del BOM (con la clave/descripción del avío embebidas) + el AMARRE
 * de precio (R17) y el precio que VA A COSTEAR con su procedencia. `precioCosteo` va en UNIDAD DE
 * CONSUMO —metro, pieza, kilo— porque desde V1-E8a (§Post-F9.97) el sistema tiene una sola unidad y
 * no hay nada que normalizar: el precio del catálogo YA está en ella. Sale de la MISMA función que
 * usa el precosto
 * (`resolverPrecioAvioCatalogo`), así que el número de la pantalla y el del costeo son el mismo:
 * promedio de medidas (si el avío es "por medida") → amarre → más barato → referencia.
 */
export const esquemaModeloAvioSalida = z
  .object({
    idAvio: z.number().int().describe('Id del avío.'),
    clave: z.string().describe('Clave del avío (para la UI).'),
    descripcion: z.string().describe('Descripción del avío (para la UI).'),
    consumoPorPrenda: z.number().describe('Consumo de avío por prenda.'),
    paraPreCosto: z.boolean().describe('¿Entra en el pre-costeo?'),
    paraProduccion: z.boolean().describe('¿Se considera al producir?'),
    paraCosto: z.boolean().describe('¿Entra en el costeo real?'),
    consumoPorTalla: z.boolean().describe('¿El consumo de este avío se captura por talla (R18)?'),
    idAvioProveedor: z
      .number()
      .int()
      .nullable()
      .describe('Amarre R17: proveedor del par AvioProveedor elegido, o null.'),
    proveedorAmarrado: z.string().nullable().describe('Nombre del proveedor amarrado, o null.'),
    precioCosteo: z
      .number()
      .nullable()
      .describe('El precio (por unidad de consumo) con el que se va a costear este avío.'),
    origenPrecio: esquemaOrigenPrecioBom,
    proveedorPrecio: z
      .string()
      .nullable()
      .describe('Proveedor del que salió `precioCosteo`, o null si no salió de un proveedor.'),
    amarreIgnorado: z
      .boolean()
      .describe(
        'Hay amarre (R17) pero el precio que costea NO lo firmó el proveedor amarrado: la pantalla ' +
          'debe gritarlo. Lo decide el servidor comparando ids de proveedor, nunca nombres.',
      ),
    precioReferencia: z
      .number()
      .nullable()
      .describe('Último escalón: precio de referencia del avío (catálogo).'),
  })
  .describe('Renglón de avío del BOM del modelo.');

/** Salida de una talla de la CURVA del modelo (para armar la matriz de medidas por talla, R18). */
export const esquemaModeloTallaCurvaSalida = z
  .object({
    idTalla: z.number().int().describe('Id de la talla.'),
    etiqueta: z.string().describe('Etiqueta de la talla (CH, M, G…).'),
    posicion: z.number().int().describe('Posición dentro de la curva (orden de captura).'),
  })
  .describe('Talla de la curva de tallas del modelo.');

// ── Salida del modelo (ficha con BOM + conteo de fotos) ────────────────────────

/**
 * Salida de un modelo en la API. En el LISTADO trae los datos generales + conteo de fotos +
 * el nombre de temporada/género (sin el BOM, que es voluminoso); la FICHA
 * (`GET /api/modelos/:id`) trae además el BOM completo embebido. Los decimales se serializan
 * a `number`; la auditoría va incluida.
 */
export const esquemaModeloSalida = z
  .object({
    id: z.number().int().describe('Id del modelo.'),
    codigo: z
      .string()
      .describe(
        'Código VIGENTE del modelo (único global): el de desarrollo mientras lo es, el de 5 dígitos en producción.',
      ),
    origen: esquemaOrigenModelo,
    codigoDesarrollo: z
      .string()
      .nullable()
      .describe(
        'Nº de DESARROLLO (`CYA-26-71-001`), CONSERVADO tras pasar a producción, o null si el modelo nunca fue de desarrollo.',
      ),
    numeroProduccion: z
      .number()
      .int()
      .nullable()
      .describe(
        'Nº de PRODUCCIÓN de 5 dígitos (concepto+género+consecutivo), o null (modelo de desarrollo, o migrado con código no numérico).',
      ),
    idModeloPadre: z
      .number()
      .int()
      .nullable()
      .describe(
        'Id del modelo PADRE del que nació esta versión (V1-E7b), o null si el modelo es raíz.',
      ),
    codigoPadre: z
      .string()
      .nullable()
      .describe('Código del modelo padre (para enseñar el linaje con liga), o null.'),
    versionDesarrollo: z
      .number()
      .int()
      .nullable()
      .describe(
        'Nº del sufijo de versión del código (`-01` → 1), o null si el modelo no es una versión.',
      ),
    // ⭐⭐ V1-E9a (§Post-F9.135) — LINAJE 1:N. Molde idéntico al de `idModeloPadre`/`codigoPadre`:
    // el id para preguntar, el código para enseñarlo con liga. Son EJES DISTINTOS y no se mezclan —
    // una VERSIÓN copia la receta del padre y lleva revisión propia; un HIJO de producción la
    // COMPARTE y no lleva ninguna. La ficha los necesita separados para no enseñarle a un hijo el
    // chip de revisión de una versión (§Post-F9.167 punto 2).
    idModeloDesarrollo: z
      .number()
      .int()
      .nullable()
      .describe(
        'Id del modelo de DESARROLLO del que nació este modelo de PRODUCCIÓN (linaje 1:N, V1-E9a) y de quien es su receta, o null = la receta es la suya.',
      ),
    codigoModeloDesarrollo: z
      .string()
      .nullable()
      .describe('Código del modelo de desarrollo del que nació (para enseñar el linaje), o null.'),
    // ⭐ V1-E7d (§Post-F9.110) — LA REVISIÓN antes de mandar a producir. Sólo la llevan las
    // VERSIONES; en cualquier otro modelo los cuatro campos vienen en null (= no aplica) y su
    // conducta no cambió.
    //
    // ⚠️ V1-E7e (§Post-F9.116): estos campos NO los mueven sólo las dos firmas. Cualquier cambio a
    // la receta de una versión APROBADA la devuelve a `pendiente` sola, suelta a `revisadoPor` /
    // `revisadoEn` (nadie ha revisado la receta que hay AHORA) y deja el porqué en `revisionNota`.
    // Quien pinte esto tiene que enseñar la nota TAMBIÉN en `pendiente`: es lo único que le dice al
    // que vuelve a revisar por qué se cayó la firma anterior.
    revisionEstado: esquemaEstadoRevisionModelo
      .nullable()
      .describe(
        'Estado de la REVISIÓN de la receta de esta versión, o null si el modelo no lleva revisión (no es una versión).',
      ),
    idRevisadoPor: z.string().nullable().describe('Id de quien firmó la revisión, o null.'),
    revisadoPor: z
      .string()
      .nullable()
      .describe('Nombre de quien firmó la revisión (para la pantalla), o null.'),
    revisadoEn: z
      .string()
      .nullable()
      .describe('Fecha/hora ISO-8601 en que se firmó la revisión, o null.'),
    revisionNota: z
      .string()
      .nullable()
      .describe(
        'Motivo del rechazo, nota de la aprobación, o —desde V1-E7e (§Post-F9.116)— el porqué de la INVALIDACIÓN automática: qué parte de la receta cambió después de firmarse y de cuándo era la firma que se cayó. Null si se firmó sin escribir nada.',
      ),
    descripcion: z.string().nullable().describe('Descripción, o null.'),
    composicion: z
      .string()
      .nullable()
      .describe('Composición textil del modelo (la heredan sus órdenes), o null.'),
    maquilaBase: z.number().nullable().describe('Costo de maquila base, o null.'),
    idTemporada: z.number().int().nullable().describe('Id de la temporada, o null.'),
    temporada: z.string().nullable().describe('Nombre de la temporada, o null.'),
    idCurvaTalla: z.number().int().nullable().describe('Id de la curva de tallas, o null.'),
    curvaTalla: z.string().nullable().describe('Nombre de la curva de tallas, o null.'),
    idGenero: z.number().int().nullable().describe('Id del género, o null.'),
    genero: z.string().nullable().describe('Nombre del género, o null.'),
    idTipoProducto: z
      .number()
      .int()
      .nullable()
      .describe('Id del tipo de producto, o null (F6-E1).'),
    tipoProducto: z.string().nullable().describe('Nombre del tipo de producto, o null.'),
    numOperaciones: z
      .number()
      .int()
      .nullable()
      .describe('# de operaciones de costura (R5/B7), o null si no se capturó.'),
    corteBase: z.number().nullable().describe('Costo de corte por prenda (R5/B8), o null.'),
    idMaquileroCotizado: z
      .number()
      .int()
      .nullable()
      .describe('Id del maquilero (costura) cotizado (R5/B9), o null.'),
    maquileroCotizado: z
      .string()
      .nullable()
      .describe('Nombre del maquilero cotizado (R5/B9), o null.'),
    secuenciaEstampado: esquemaSecuenciaEstampado.describe(
      'Secuencia de estampado del modelo (R5/B10; default "antes").',
    ),
    llevaArte: esquemaLlevaArte,
    cantidadFotos: z.number().int().describe('Cantidad de fotos del modelo.'),
    /**
     * URL GET prefirmada de la FOTO PRINCIPAL del modelo (la primera por orden, luego id), o
     * `null` si el modelo no tiene fotos. La resuelve el listado para que la galería pinte la
     * miniatura SIN una petición por celda (sin N+1). Vida corta: se regenera en cada listado.
     */
    urlFotoPrincipal: z
      .string()
      .nullable()
      .describe('URL prefirmada de la foto principal del modelo, o null si no tiene fotos.'),
    /**
     * Nombre de la TELA PRINCIPAL del modelo = el PRIMER renglón del BOM de telas (mismo orden
     * que la ficha: por nombre de tela). Solo el LISTADO lo resuelve (columna del proto
     * `vModelos`, sin N+1); en las demás salidas viene `null` (igual que `urlFotoPrincipal`).
     */
    telaPrincipal: z
      .string()
      .nullable()
      .describe('Nombre de la tela principal (primer renglón del BOM), o null.'),
    /**
     * Existencia TOTAL de PT del modelo en la EMPRESA ACTIVA (Σ de movimientos de kardex, D3,
     * vía la vista `existencia_pt`; suma de todos los almacenes/órdenes). Solo el LISTADO lo
     * resuelve; en las demás salidas viene `null` (la ficha usa la consulta de existencias).
     */
    stockPt: z
      .number()
      .int()
      .nullable()
      .describe('Existencia total de PT del modelo (Σ kardex, D3), o null fuera del listado.'),
    /**
     * Costo UNITARIO del ÚLTIMO costeo (F7) de una orden del modelo en la empresa activa =
     * `costoTotal / cantidadDeBase(baseProrrateo)` — EXACTAMENTE el criterio de la Lista de
     * costos. `null` si el modelo no tiene costeo guardado, si la base de prorrateo es 0, o fuera
     * del listado.
     *
     * ⭐ §Post-F9.137 — es un costo REAL («cómo terminamos»), no del plan: exige `costos.ver` **y**
     * `consultas.ver-importes` (`puedeVerCostoRealDeModelo`). Sin ellos el servidor NO lo manda —no
     * es que el front lo esconda— y la columna del listado desaparece.
     */
    costoActual: z
      .number()
      .nullable()
      .describe('Costo unitario del último costeo del modelo (F7), o null.'),
    activo: z.boolean().describe('Falso si está descontinuado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Modelo del catálogo (global).');

/** Forma de un modelo (listado) tal como lo devuelve la API. */
export type ModeloSalida = z.infer<typeof esquemaModeloSalida>;

/** Salida de la FICHA de un modelo: datos generales + BOM completo embebido. */
export const esquemaModeloFichaSalida = esquemaModeloSalida
  .extend({
    telas: z.array(esquemaModeloTelaSalida).describe('Telas del BOM.'),
    avios: z.array(esquemaModeloAvioSalida).describe('Avíos del BOM.'),
    artes: z.array(esquemaArteSalida).describe('Arte (bordados/estampados) del modelo.'),
    /**
     * Tallas de la CURVA del modelo, en el orden de la curva. Van SOLO en la ficha (el listado no
     * las paga): son la lista con la que la receta arma el consumo por talla de un avío (R18) —
     * vacía cuando el modelo no tiene curva asignada.
     */
    tallasCurva: z
      .array(esquemaModeloTallaCurvaSalida)
      .describe('Tallas de la curva del modelo (vacía si no tiene curva).'),
    /**
     * ⭐ V1-E3r (§Post-F9.81) — avisos de CURVA DISTINTA, ya redactados por el servidor (A1): la
     * curva del modelo no coincide con las tallas que piden sus órdenes. Uno por cada conjunto
     * distinto que usen (si dos OP piden curvas distintas, salen los dos avisos). Cada texto trae
     * los NOMBRES de las dos curvas y qué tallas sobran o faltan, en las dos direcciones.
     * 🔴 NUNCA bloquean: la curva de la ORDEN manda y la del modelo es una guía (§Post-F9.64).
     */
    avisosCurva: z
      .array(z.string())
      .describe('Avisos de curva distinta contra las órdenes del modelo (no bloquean).'),
  })
  .describe('Ficha de un modelo con su receta (BOM) completa.');

/** Forma de la ficha de un modelo (con BOM) tal como la devuelve la API. */
export type ModeloFichaSalida = z.infer<typeof esquemaModeloFichaSalida>;

/**
 * Parámetros del listado de modelos EN LA URL (querystring): todo llega como texto, así que
 * se coaccionan números y banderas. Búsqueda por `codigo` O `descripcion` (insensible a
 * mayúsculas); filtros opcionales `idTemporada` e `incluirInactivos`. Volumen ~4,987:
 * SIEMPRE en modo servidor.
 */
export const esquemaModelosQuery = z
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
      .describe(
        'Texto a buscar en el código (vigente o de desarrollo) o la descripción (insensible a mayúsculas).',
      ),
    origen: esquemaFiltroOrigenModelo.default('todos'),
    idTemporada: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por id de temporada.'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los descontinuados ("true"/"false").'),
    ordenarPor: z
      .enum(['codigo', 'descripcion', 'creadoEn'])
      .default('codigo')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de modelos.');

/** Parámetros de listado de modelos ya coaccionados desde la URL. */
export type ModelosQuery = z.infer<typeof esquemaModelosQuery>;

/** Respuesta paginada del listado de modelos (forma estándar `Pagina<T>`). */
export const esquemaModelosPagina = z
  .object({
    datos: z.array(esquemaModeloSalida).describe('Modelos de la página.'),
    total: z.number().int().describe('Total de modelos que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de modelos.');

/** Forma de la respuesta paginada de modelos. */
export type ModelosPagina = z.infer<typeof esquemaModelosPagina>;

// ── Pasar a producción (§Post-F9.34 / §Post-F9.46, V1-E3n) ────────────────────

/** Estado de UNA serie de numeración (un par concepto+género). */
export const esquemaSerieProduccion = z
  .object({
    par: z.string().describe('Los dos dígitos de la serie (ej. "71").'),
    libre: z
      .number()
      .int()
      .nullable()
      .describe('Consecutivo libre más bajo (1–999), o null si la serie está llena.'),
    usados: z.number().int().describe('Consecutivos ya usados de la serie.'),
    libres: z.number().int().describe('Consecutivos que quedan libres (de 999).'),
  })
  .describe('Ocupación de una serie de numeración de producción.');

/**
 * Propuesta de nº de producción para un modelo: el campo llega YA LLENO con el siguiente libre
 * (§Post-F9.46) y el usuario lo puede cambiar. Los `avisos` NUNCA bloquean.
 */
export const esquemaPropuestaProduccion = z
  .object({
    numero: z
      .number()
      .int()
      .nullable()
      .describe('Nº de 5 dígitos propuesto, o null si no queda ninguno libre.'),
    codigo: z.string().nullable().describe('El código correspondiente ("71001"), o null.'),
    serie: esquemaSerieProduccion,
    serieContinuada: z
      .boolean()
      .describe('true si se pasó a la serie de continuación del género (Caballero 1→5).'),
    avisos: z.array(z.string()).describe('Avisos para enseñar junto al campo (nunca bloquean).'),
    yaEnProduccion: z.boolean().describe('true si el modelo ya está en el catálogo de producción.'),
  })
  .describe('Propuesta de número de producción para un modelo de desarrollo.');

/** Forma de la propuesta de nº de producción. */
export type PropuestaProduccionSalida = z.infer<typeof esquemaPropuestaProduccion>;

/** Cuerpo de «pasar a producción»: el número, o nada para aceptar el que propone el sistema. */
export const esquemaPasarAProduccionCuerpo = z
  .object({
    numeroProduccion: z
      .number({ error: 'El número de producción debe ser un número' })
      .int({ error: 'El número de producción debe ser entero' })
      .min(10_000, { error: 'El número de producción debe tener 5 dígitos' })
      .max(99_999, { error: 'El número de producción debe tener 5 dígitos' })
      .optional()
      .describe('Nº de 5 dígitos capturado; omitir para tomar el que propone el sistema.'),
  })
  .describe('Cuerpo de la acción «pasar a producción» de un modelo.');

/**
 * ⭐ V1-E7b (§Post-F9.110) — Cuerpo de «crear versión»: casi todo se HEREDA del padre, así que lo
 * único que se puede ajustar al nacer es la descripción (para poder decir qué cambió). Si se
 * omite, la versión hereda también la del padre.
 */
export const esquemaModeloVersionCuerpo = z
  .object({
    descripcion: z
      .string()
      .trim()
      .max(500, { error: 'La descripción no puede tener más de 500 caracteres' })
      .optional()
      .describe('Descripción de la versión; si se omite, hereda la del modelo padre.'),
  })
  .describe('Cuerpo de la acción «crear versión» de un modelo.');

/** Datos validados de «crear versión». */
export type DatosModeloVersion = z.infer<typeof esquemaModeloVersionCuerpo>;

// ── ⭐ V1-E7d (§Post-F9.110): la REVISIÓN antes de mandar a producir ─────────────

/** Cuerpo de «aprobar revisión»: la nota es opcional (la firma es lo que importa). */
export const esquemaRevisionAprobarCuerpo = z
  .object({
    nota: z
      .string()
      .trim()
      .max(500, { error: 'La nota no puede tener más de 500 caracteres' })
      .optional()
      .describe('Nota opcional del aprobador; queda como observación del acto.'),
  })
  .describe('Cuerpo de la acción «aprobar la revisión» de una versión de modelo.');

/** Datos validados de «aprobar revisión». */
export type DatosRevisionAprobar = z.infer<typeof esquemaRevisionAprobarCuerpo>;

/**
 * Cuerpo de «rechazar revisión»: el motivo es OBLIGATORIO. Un rechazo sin motivo no le dice nada
 * a quien tiene que corregir la receta, y el dominio lo vuelve a exigir (A1).
 */
export const esquemaRevisionRechazarCuerpo = z
  .object({
    motivo: z
      .string()
      .trim()
      .min(1, { error: 'Escribe el motivo del rechazo' })
      .max(500, { error: 'El motivo no puede tener más de 500 caracteres' })
      .describe('Qué se observó en la receta y hay que corregir.'),
  })
  .describe('Cuerpo de la acción «rechazar la revisión» de una versión de modelo.');

/** Datos validados de «rechazar revisión». */
export type DatosRevisionRechazar = z.infer<typeof esquemaRevisionRechazarCuerpo>;

/** Cómo quedó la revisión tras firmarla. */
export const esquemaRevisionModeloSalida = z
  .object({
    idModelo: z.number().int().describe('Id del modelo revisado.'),
    codigo: z.string().describe('Código VIGENTE del modelo revisado.'),
    revisionEstado: esquemaEstadoRevisionModelo.nullable().describe('En qué quedó la revisión.'),
    idRevisadoPor: z.string().nullable().describe('Id de quien firmó.'),
    revisadoPor: z.string().nullable().describe('Nombre de quien firmó.'),
    revisadoEn: z.string().nullable().describe('Fecha/hora ISO-8601 de la firma.'),
    revisionNota: z
      .string()
      .nullable()
      .describe(
        'Motivo del rechazo, nota de la aprobación, o el porqué de la invalidación automática.',
      ),
  })
  .describe('Estado de la revisión de la receta de una versión de modelo.');

/** Salida de las dos firmas de revisión. */
export type RevisionModeloSalidaContrato = z.infer<typeof esquemaRevisionModeloSalida>;

/** Datos de «pasar a producción». */
export type DatosPasarAProduccion = z.infer<typeof esquemaPasarAProduccionCuerpo>;

/** Resultado de «pasar a producción»: el modelo ya promovido + los avisos que hubo. */
export const esquemaPasarAProduccionSalida = z
  .object({
    modelo: esquemaModeloSalida,
    numeroProduccion: z.number().int().describe('Nº de producción asignado.'),
    numeroCapturado: z
      .boolean()
      .describe('true si el número lo capturó el usuario en vez de aceptar la propuesta.'),
    avisos: z.array(z.string()).describe('Avisos (congruencia de dígitos, cercanía al tope).'),
  })
  .describe('Resultado de pasar un modelo de desarrollo a producción.');

/** Forma del resultado de «pasar a producción». */
export type PasarAProduccionSalida = z.infer<typeof esquemaPasarAProduccionSalida>;

// ── Cuerpos de los endpoints de BOM (set-completo por sección) ─────────────────

/**
 * Cuerpo para reemplazar el set COMPLETO de telas del BOM (`PUT /api/modelos/:id/bom/telas`):
 * el dominio sincroniza (agrega/quita/actualiza) en UNA transacción A2 (como los colores de
 * la tela o los proveedores del avío en E3). Puede quedar vacío.
 */
export const esquemaModeloBomTelasCuerpo = z
  .object({ telas: esquemaModeloTelas })
  .describe('Set completo de telas del BOM del modelo.');

/** Datos validados del set de telas del BOM. */
export type DatosModeloBomTelas = z.infer<typeof esquemaModeloBomTelasCuerpo>;

/** Cuerpo para reemplazar el set COMPLETO de avíos del BOM (`PUT /api/modelos/:id/bom/avios`). */
export const esquemaModeloBomAviosCuerpo = z
  .object({ avios: esquemaModeloAvios })
  .describe('Set completo de avíos del BOM del modelo.');

/** Datos validados del set de avíos del BOM. */
export type DatosModeloBomAvios = z.infer<typeof esquemaModeloBomAviosCuerpo>;

/** Listas sueltas de cada sección del BOM (respuesta de los `GET /api/modelos/:id/bom/*`). */
export const esquemaModeloBomTelasLista = z
  .object({ datos: z.array(esquemaModeloTelaSalida).describe('Telas del BOM.') })
  .describe('Telas del BOM de un modelo.');
export type ModeloBomTelasLista = z.infer<typeof esquemaModeloBomTelasLista>;

export const esquemaModeloBomAviosLista = z
  .object({ datos: z.array(esquemaModeloAvioSalida).describe('Avíos del BOM.') })
  .describe('Avíos del BOM de un modelo.');
export type ModeloBomAviosLista = z.infer<typeof esquemaModeloBomAviosLista>;

// ── ⭐ V1-E3v (§Post-F9.90) — Avíos FAVORITOS sugeridos para la receta ──────────

/**
 * Un avío FAVORITO tal como lo sugiere el servidor. `cantidadSugerida` es el `Avio.cantFav` del
 * CATÁLOGO —el *"1 pieza por default"* de Daniel es un dato por avío, no una constante—, y viaja ya
 * resuelto para que la pantalla no tenga que ir por él ni inventarlo (A1).
 */
export const esquemaAvioFavoritoSugerido = z
  .object({
    idAvio: z.number().int().describe('Id del avío favorito.'),
    clave: z.string().describe('Clave del avío.'),
    descripcion: z.string().describe('Descripción del avío.'),
    cantidadSugerida: z
      .number()
      .describe('Consumo por prenda que se pondría: es `Avio.cantFav` del catálogo.'),
    unidad: z.string().nullable().describe('Unidad de consumo del avío (pza, m…), o null.'),
  })
  .describe('Avío favorito sugerido para la receta del modelo.');

/**
 * La sugerencia completa (`GET /api/modelos/:id/bom/avios/favoritos`): lo que falta, lo que ya está
 * y lo que NO se puede sugerir por no tener cantidad. Los tres se dicen; ninguno se calla.
 */
export const esquemaAviosFavoritosSugerencia = z
  .object({
    sugeridos: z
      .array(esquemaAvioFavoritoSugerido)
      .describe('Favoritos que le FALTAN a la receta: los que entran al aceptar.'),
    yaEnLaReceta: z
      .array(esquemaAvioFavoritoSugerido)
      .describe('Favoritos que la receta ya tiene (no se vuelven a agregar).'),
    sinCantidad: z
      .array(
        z.object({
          idAvio: z.number().int().describe('Id del avío.'),
          clave: z.string().describe('Clave del avío.'),
          descripcion: z.string().describe('Descripción del avío.'),
        }),
      )
      .describe('Marcados favoritos SIN cantidad preestablecida: no se sugieren, pero se listan.'),
  })
  .describe('Avíos favoritos sugeridos para la receta de un modelo.');
export type AviosFavoritosSugerencia = z.infer<typeof esquemaAviosFavoritosSugerencia>;

/**
 * Respuesta de ACEPTAR los favoritos (`POST /api/modelos/:id/bom/avios/favoritos`): cuántos
 * entraron, con qué claves, y la receta de avíos resultante (misma forma que el PUT del BOM, para
 * que la pantalla se repinte con la verdad del servidor y no con lo que supone).
 */
export const esquemaAviosFavoritosAceptados = z
  .object({
    agregados: z.number().int().describe('Cuántos renglones se agregaron (0 = ya estaban todos).'),
    clavesAgregadas: z.array(z.string()).describe('Claves de los avíos agregados.'),
    datos: z.array(esquemaModeloAvioSalida).describe('La receta de avíos tras aceptar.'),
  })
  .describe('Resultado de aceptar los avíos favoritos de la receta.');
export type AviosFavoritosAceptados = z.infer<typeof esquemaAviosFavoritosAceptados>;

/**
 * Cuerpo para COPIAR el BOM de otro modelo (`POST /api/modelos/:id/copiar-bom`). `idOrigen`
 * es el modelo del que se copian telas/avíos/arte; `reemplazar` decide si se reemplaza
 * el BOM actual (true, por defecto) o se fusiona conservando lo existente (false). Atómico (A2).
 */
export const esquemaModeloCopiarBomCuerpo = z
  .object({
    idOrigen: z
      .number({ error: 'El id del modelo de origen es obligatorio' })
      .int({ error: 'El id del modelo de origen debe ser entero' })
      .positive({ error: 'El id del modelo de origen debe ser positivo' }),
    /** true (por defecto): reemplaza el BOM actual; false: fusiona (conserva lo existente). */
    reemplazar: z.boolean().default(true),
  })
  .describe('Copiar la receta (BOM) de otro modelo.');

/** Datos validados del cuerpo de copiar BOM. */
export type DatosModeloCopiarBom = z.infer<typeof esquemaModeloCopiarBomCuerpo>;

// ── Fotos del modelo (R2: N fotos por modelo, vía presigned) ───────────────────

/** Tipos de foto del modelo (espejo del enum `TipoFotoModelo` de src/datos). */
export const TIPOS_FOTO_MODELO = ['FRENTE', 'ESPALDA', 'OTRO'] as const;

/** Clave de tipo de foto de modelo. */
export type TipoFotoModeloClave = (typeof TIPOS_FOTO_MODELO)[number];

/** Etiquetas para UI de cada tipo de foto. */
export const ETIQUETAS_TIPO_FOTO_MODELO: Record<TipoFotoModeloClave, string> = {
  FRENTE: 'Frente',
  ESPALDA: 'Espalda',
  OTRO: 'Otra',
};

/**
 * Solicitud de subida de UNA foto de un modelo: el navegador manda los metadatos de la imagen
 * y el backend devuelve la URL PUT prefirmada (flujo presigned de F0). Solo imágenes
 * (`image/*`). `tipo` (frente/espalda/otra) y `orden` opcionales (default OTRO / al final).
 */
export const esquemaModeloFotoCrear = z
  .object({
    nombreOriginal: z
      .string({ error: 'El nombre del archivo es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre del archivo es obligatorio' })
      .max(255)
      .describe('Nombre del archivo tal como lo llama el usuario.'),
    tipoMime: z
      .string({ error: 'El tipo de archivo es obligatorio' })
      .trim()
      .regex(/^image\/[\w.+-]+$/, { error: 'La foto debe ser una imagen' })
      .describe('Tipo MIME de la imagen (ej. image/jpeg, image/png, image/webp).'),
    tamanoBytes: z
      .number({ error: 'El tamaño es obligatorio' })
      .int({ error: 'El tamaño debe ser un entero de bytes' })
      .positive({ error: 'El archivo está vacío' })
      .describe('Tamaño exacto en bytes (la URL prefirmada solo acepta este tamaño).'),
    tipo: z.enum(TIPOS_FOTO_MODELO).default('OTRO').describe('Tipo de foto (frente/espalda/otra).'),
  })
  .describe('Datos para preparar la subida de una foto de un modelo.');

/** Datos validados de la solicitud de subida de una foto de un modelo. */
export type DatosModeloFotoCrear = z.infer<typeof esquemaModeloFotoCrear>;

/** Salida tras solicitar la subida de una foto: registro + URL PUT prefirmada para R2. */
export const esquemaModeloFotoSubida = z
  .object({
    idFoto: z.number().int().describe('Id del registro ModeloFoto creado.'),
    idArchivo: z.string().describe('Id del registro Archivo creado para la foto.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida de una foto (URL prefirmada).');

/** Forma de la respuesta al preparar la subida de una foto. */
export type ModeloFotoSubida = z.infer<typeof esquemaModeloFotoSubida>;

/** Salida de UNA foto de un modelo, con su URL GET prefirmada para verla. */
export const esquemaModeloFotoSalida = z
  .object({
    idFoto: z.number().int().describe('Id del registro ModeloFoto.'),
    idArchivo: z.string().describe('Id del registro Archivo de la foto.'),
    tipo: z.enum(TIPOS_FOTO_MODELO).describe('Tipo de foto (frente/espalda/otra).'),
    orden: z.number().int().describe('Orden de despliegue en el carrusel.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    tipoMime: z.string().describe('Tipo MIME de la imagen.'),
    tamanoBytes: z.number().int().describe('Tamaño en bytes.'),
    urlDescarga: z.string().describe('URL GET prefirmada para ver la foto.'),
  })
  .describe('Foto de un modelo con su URL de descarga.');

/** Forma de una foto de un modelo tal como la devuelve la API. */
export type ModeloFotoSalida = z.infer<typeof esquemaModeloFotoSalida>;

/** Lista de fotos de un modelo (respuesta de `GET /api/modelos/:id/fotos`). */
export const esquemaModeloFotosLista = z
  .object({
    datos: z.array(esquemaModeloFotoSalida).describe('Fotos del modelo (ordenadas).'),
  })
  .describe('Fotos de un modelo (N por modelo).');

/** Forma de la lista de fotos de un modelo. */
export type ModeloFotosLista = z.infer<typeof esquemaModeloFotosLista>;

/**
 * Cuerpo para actualizar los metadatos de UNA foto (`PATCH /api/modelos/:id/fotos/:idFoto`):
 * tipo y/o orden. Ambos opcionales (omitir = no tocar). No reemplaza la imagen (eso es subir
 * una foto nueva y quitar la vieja).
 */
export const esquemaModeloFotoEditarCuerpo = z
  .object({
    tipo: z.enum(TIPOS_FOTO_MODELO).optional().describe('Nuevo tipo (frente/espalda/otra).'),
    orden: z
      .number({ error: 'El orden debe ser un número' })
      .int({ error: 'El orden debe ser entero' })
      .min(0, { error: 'El orden no puede ser negativo' })
      .optional()
      .describe('Nuevo orden de despliegue.'),
  })
  .describe('Metadatos a actualizar de una foto del modelo (tipo/orden).');

/** Datos validados de edición de metadatos de una foto. */
export type DatosModeloFotoEditar = z.infer<typeof esquemaModeloFotoEditarCuerpo>;

// ══ ⭐⭐ V1-E8r — BANDEJA «Recetas por revisar» (§Post-F9.140, DANIEL) ════════════════════════════
//
// La COLA de la revisión de V1-E7d. Daniel: *"despues de una negociacion, tiene que haber una
// validadcion de la receta original… de alguna manera deberia de pasar un filtro para ver lo que se
// negocio con el cliente. y como se cerro"*. Es de SOLO LECTURA: la bandeja NO firma, LLEVA a la
// ficha del modelo, donde se revisa viéndola (§Post-F9.80).

/** Una versión cuya revisión todavía no está firmada (§Post-F9.140). */
export const esquemaRecetaPorRevisar = z
  .object({
    idModelo: z.number().int().describe('Id de la VERSIÓN que espera revisión.'),
    codigo: z.string().describe('Código vigente de la versión (ej. `CYA-26-71-001-01`).'),
    descripcion: z.string().nullable().describe('Descripción de la versión, o null.'),
    codigoPadre: z
      .string()
      .nullable()
      .describe(
        'Código del modelo del que nació — «la receta original» que Daniel quiere cotejar.',
      ),
    versionDesarrollo: z
      .number()
      .int()
      .nullable()
      .describe('Nº del sufijo de versión (`-01` → 1), o null si el linaje sólo viene del padre.'),
    estado: esquemaEstadoRevisionModelo.describe(
      'Cómo está la revisión, con el `null` YA PLEGADO a `pendiente` por el servidor (la misma lectura que la ficha del modelo). Nunca llega `aprobada`: eso ya no espera nada.',
    ),
    revisionNota: z
      .string()
      .nullable()
      .describe(
        'Motivo del rechazo o porqué de la invalidación automática — lo que le dice al que va a revisar por qué esto sigue aquí.',
      ),
    creadoEn: z
      .string()
      .describe('Fecha/hora ISO-8601 en que nació la versión (lo que lleva esperando).'),
    cliente: z
      .string()
      .nullable()
      .describe(
        'Cliente con el que se negoció (por el expediente de Desarrollo), o null si la versión no tiene expediente.',
      ),
    proyecto: z.string().nullable().describe('Proyecto de la negociación, o null.'),
    fechaCompromiso: z
      .string()
      .nullable()
      .describe(
        'Fecha comprometida más próxima (AAAA-MM-DD) de los pedidos vivos que esperan esta receta, o null si nadie la ha pedido todavía. Es el criterio de orden: lo que estorba primero, arriba.',
      ),
    piezasPedidas: z
      .number()
      .int()
      .describe(
        'Piezas de pedido vivas que dependen de esta versión (0 si ninguna). Agregado por el SERVIDOR.',
      ),
    conPedido: z
      .boolean()
      .describe(
        '⭐ YA ESTÁ FRENANDO DINERO: el cliente ya pidió esta versión, así que hay piezas comprometidas esperando detrás de esta receta sin revisar — por eso esta fila va primero en la cola. No es lo mismo que una versión recién negociada a la que nadie le pide nada. ⚠️ Decía «su OP no puede nacer hasta que la receta se revise»: fue verdad hasta V1-E9c (§Post-F9.169), que disolvió la compuerta. La OP nace igual, y esta revisión no condiciona ni producir ni comprar: lo que gobierna la compra es OTRA firma, la liberación POR RENGLÓN de la receta de la ORDEN.',
      ),
  })
  .describe('Una versión que espera revisión de receta (§Post-F9.140).');

/** Fila de la bandeja «Recetas por revisar». */
export type RecetaPorRevisar = z.infer<typeof esquemaRecetaPorRevisar>;

/** Filtros de la bandeja «Recetas por revisar» (querystring): paginación + búsqueda + el filtro del dinero. */
export const esquemaRecetasPorRevisarQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página (tope 100).'),
    soloConPedido: z
      .stringbool()
      .default(false)
      .describe('Sólo las versiones que ya tienen pedido vivo esperando.'),
    busqueda: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Código de la versión, código del padre o cliente (contiene).'),
  })
  .describe('Filtros de la bandeja «Recetas por revisar».');

/**
 * Filtros de la bandeja **en su forma NATIVA** (números y booleanos ya resueltos) — lo que recibe el
 * dominio. En la URL todo es texto, así que el esquema de la ruta coacciona y el dominio re-valida
 * con éste. Mismo reparto que la bandeja hermana «Recetas por liberar»: sin él, re-validar la salida
 * de la ruta con el esquema de la URL tira un 400 espurio (cicatriz del hotfix F2, PR #56).
 */
export const esquemaRecetasPorRevisarDominio = z.object({
  pagina: z.number().int().min(1).default(1),
  porPagina: z.number().int().min(1).max(100).default(20),
  soloConPedido: z.boolean().default(false),
  busqueda: z.string().trim().max(200).optional(),
});

/** Filtros de la bandeja (forma nativa, no la de la URL). */
export type FiltrosRecetasPorRevisar = z.input<typeof esquemaRecetasPorRevisarDominio>;

/** Respuesta paginada de la bandeja «Recetas por revisar» (forma estándar `Pagina<T>`). */
export const esquemaRecetasPorRevisarPagina = z
  .object({
    datos: z.array(esquemaRecetaPorRevisar),
    total: z.number().int(),
    pagina: z.number().int(),
    porPagina: z.number().int(),
    totalPaginas: z.number().int(),
  })
  .describe('Página de la bandeja «Recetas por revisar».');

/** Página de la bandeja «Recetas por revisar». */
export type RecetasPorRevisarPagina = z.infer<typeof esquemaRecetasPorRevisarPagina>;
