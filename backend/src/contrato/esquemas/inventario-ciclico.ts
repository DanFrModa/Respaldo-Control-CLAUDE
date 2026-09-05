import { z } from 'zod';

/**
 * Esquemas Zod del INVENTARIO CÍCLICO (Módulo Indicadores / Almacén, F7-E5; doc
 * `05-Indicadores.md`; ← forms `Alm_IC_Alta`/`Alm_IC_Cont`/`Alm_IC_Consulta`). Cuenta el físico
 * contra el KARDEX de v2 (D3/D6): el ALTA congela el teórico por artículo, el ajuste se aplica SOLO
 * como MOVIMIENTO de kardex (D3) y el conteo de PT es CIEGO (el capturista NO ve el teórico).
 *
 * ⭐ **FILA 0.099 — TRES DIMENSIONES** (§Post-F9.193 puntos 4·5·6). La misma hoja de conteo cuenta
 * ahora PRODUCTO TERMINADO, TELAS o AVÍOS. Qué cuenta lo manda el **tipo del almacén**
 * ({@link esquemaDimensionCiclico}), nunca un campo que teclee el usuario: un almacén guarda una
 * sola clase de mercancía (fila 0.137), así que un conteo suyo sólo puede ser de ésa. De ahí salen
 * las tres diferencias que el contrato tiene que expresar:
 *
 *  • **Cantidades.** PT cuenta piezas (enteras); telas y avíos, metros y kilos (4 decimales). Los
 *    esquemas usan `z.number()` a secas y la regla del entero la aplica el DOMINIO por dimensión —
 *    el contrato no puede exigir `.int()` sin volver imposible contar 12.5 m.
 *  • **Conteo ciego.** En PT el teórico NO viaja (D6): `cantTeorica` es OPCIONAL y el dominio
 *    sencillamente no lo pone. En telas y avíos SÍ va, porque Daniel decidió capturar «lo contado,
 *    con el saldo del sistema a la vista» (§Post-F9.193 punto 4).
 *  • **Dos componentes.** Una tela puede llevar COMPLEMENTO (el cardigan, D5): cuerpo y complemento
 *    viajan JUNTOS en el mismo renglón y cada uno decide por su lado si falta o sobra.
 *
 * Los renglones se describen con `titulo`/`subtitulo` YA RESUELTOS en el servidor, no con los ids de
 * cada dimensión: así una sola pantalla (y una sola hoja impresa) sirve a las tres sin ramificar por
 * tipo de artículo en el cliente.
 *
 * Una sola definición para UI y servidor (OpenAPI). La lógica vive en
 * `dominio/indicadores/inventario-ciclico.ts` (A1). A9 por empresa.
 */

/** Estado del ciclo de vida (espejo del enum Prisma `EstadoInventarioCiclico`). */
export const esquemaEstadoInventarioCiclico = z
  .enum(['abierto', 'contado', 'cerrado', 'cancelado'])
  .describe('abierto → contado → cerrado (ajuste aplicado); cancelado = abortado antes de cerrar.');

/** Valor del estado de un inventario cíclico. */
export type EstadoInventarioCiclicoValor = z.infer<typeof esquemaEstadoInventarioCiclico>;

/**
 * QUÉ inventario cuenta la hoja (espejo del enum Prisma `DimensionInventarioCiclico`). DERIVADA del
 * `Almacen.tipo` al dar de alta — el usuario elige el almacén, no la dimensión.
 */
export const esquemaDimensionCiclico = z
  .enum(['PT', 'TELA', 'AVIO'])
  .describe('Qué se cuenta; se deriva del tipo del almacén, no se captura.');

/** Valor de la dimensión de un cíclico. */
export type DimensionCiclicoValor = z.infer<typeof esquemaDimensionCiclico>;

// ── Entrada: ALTA ──────────────────────────────────────────────────────────────────────────────

/**
 * Alta de un inventario cíclico. El ALTA congela el teórico (D6): enumera los artículos con
 * existencia ≠ 0 del almacén y guarda su Σ de movimientos EN ESE INSTANTE.
 *
 * El ALCANCE se acota con la lista que corresponde al tipo del almacén (`idsModelo` para PT,
 * `idsTela` para telas, `idsAvio` para avíos); vacío/ausente = TODO el almacén. Mandar la lista de
 * OTRA dimensión se rechaza en el dominio: sería un filtro que no filtra nada y dejaría al usuario
 * creyendo que acotó su conteo.
 */
export const esquemaInventarioCiclicoCrear = z.object({
  idAlmacen: z.number().int().positive({ error: 'El almacén es obligatorio' }),
  idsModelo: z
    .array(z.number().int().positive())
    .max(500, { error: 'Demasiados modelos en el alcance' })
    .optional()
    .describe('Solo almacenes de PT: modelos a revisar; vacío/ausente = todo el almacén.'),
  idsTela: z
    .array(z.number().int().positive())
    .max(500, { error: 'Demasiadas telas en el alcance' })
    .optional()
    .describe('Solo almacenes de TELA: telas a revisar; vacío/ausente = todo el almacén.'),
  idsAvio: z
    .array(z.number().int().positive())
    .max(500, { error: 'Demasiados avíos en el alcance' })
    .optional()
    .describe('Solo almacenes de AVÍO: avíos a revisar; vacío/ausente = todo el almacén.'),
  observaciones: z.string().trim().max(300).optional(),
});

/** Datos validados del alta de un cíclico. */
export type DatosInventarioCiclicoCrear = z.infer<typeof esquemaInventarioCiclicoCrear>;

// ── Entrada: AGREGAR un renglón que la enumeración no trajo ────────────────────────────────────

/**
 * Agrega a la hoja un artículo que el alta NO enumeró — es decir, mercancía que el sistema cree que
 * NO tiene (§Post-F9.193 punto 6: *«se puede anotar mercancía con existencia cero»*). Se manda la
 * llave de la dimensión de la hoja y ninguna otra: `idModelo`+`idColor`+`idTalla` (+`idOrden`
 * opcional) para PT, `idTelaColor` para telas, `idAvio` para avíos.
 */
export const esquemaCiclicoRenglonAgregar = z.object({
  idModelo: z.number().int().positive().optional(),
  idColor: z.number().int().positive().optional(),
  idTalla: z.number().int().positive().optional(),
  idOrden: z
    .number()
    .int()
    .positive()
    .nullish()
    .describe('PT: orden dueña de las prendas; ausente/null = bucket «sin orden».'),
  idTelaColor: z.number().int().positive().optional(),
  idAvio: z.number().int().positive().optional(),
});

/** Datos validados del alta de un renglón a mano. */
export type DatosCiclicoRenglonAgregar = z.infer<typeof esquemaCiclicoRenglonAgregar>;

// ── Entrada: CONTEO ────────────────────────────────────────────────────────────────────────────

/**
 * Un renglón capturado del conteo: LO CONTADO (nunca una diferencia). No lleva `.int()` — PT sí
 * cuenta piezas enteras, pero telas y avíos se miden en metros y kilos; el entero de PT lo exige el
 * dominio, que es quien sabe la dimensión de la hoja.
 */
export const esquemaConteoRenglonEntrada = z.object({
  idDet: z.number().int().positive(),
  cantReal: z
    .number({ error: 'La cantidad contada debe ser un número' })
    .min(0, { error: 'La cantidad contada no puede ser negativa' }),
  cantRealComplemento: z
    .number({ error: 'La cantidad contada del complemento debe ser un número' })
    .min(0, { error: 'La cantidad contada del complemento no puede ser negativa' })
    .optional()
    .describe('Solo telas CON complemento (D5): lo contado del cardigan.'),
});

/** Captura de conteo (uno o varios renglones a la vez). */
export const esquemaInventarioCiclicoConteo = z.object({
  renglones: z.array(esquemaConteoRenglonEntrada).min(1, { error: 'Captura al menos un renglón' }),
});

/** Datos validados de captura de conteo. */
export type DatosInventarioCiclicoConteo = z.infer<typeof esquemaInventarioCiclicoConteo>;

// ── Entrada: CANCELAR ──────────────────────────────────────────────────────────────────────────

/** Cancelación (suave) de un cíclico con motivo (A7). */
export const esquemaInventarioCiclicoCancelar = z.object({
  motivo: z
    .string({ error: 'El motivo es obligatorio' })
    .trim()
    .min(3, { error: 'El motivo debe tener al menos 3 caracteres' })
    .max(300, { error: 'El motivo no puede tener más de 300 caracteres' }),
});

/** Datos validados de cancelación de cíclico. */
export type DatosInventarioCiclicoCancelar = z.infer<typeof esquemaInventarioCiclicoCancelar>;

// ── Entrada: GENERAR AJUSTE ────────────────────────────────────────────────────────────────────

/**
 * Cuerpo del ajuste. `confirmarMovimiento` es la respuesta del usuario al AVISO de la decisión 6
 * (§Post-F9.193): si el almacén se movió entre el alta y el cierre, el servidor **avisa y deja
 * decidir, NO bloquea** — el primer intento vuelve con el aviso y sin aplicar nada, y el segundo,
 * con esta bandera en `true`, aplica.
 */
export const esquemaInventarioCiclicoAjuste = z.object({
  confirmarMovimiento: z
    .boolean()
    .default(false)
    .describe('true = ya vi el aviso de que el almacén se movió y aun así quiero aplicar.'),
});

/** Datos validados de la generación del ajuste. */
export type DatosInventarioCiclicoAjuste = z.infer<typeof esquemaInventarioCiclicoAjuste>;

// ── Salida: RESUMEN (encabezado + contadores; sin teórico) ───────────────────────────────────────

/** Resumen (encabezado) de un inventario cíclico: para el listado y la cabecera de las pantallas. */
export const esquemaInventarioCiclicoResumen = z
  .object({
    id: z.number().int(),
    folio: z.number().int(),
    idEmpresa: z.number().int(),
    idAlmacen: z.number().int(),
    almacen: z.string(),
    dimension: esquemaDimensionCiclico,
    fecha: z.iso.date(),
    estado: esquemaEstadoInventarioCiclico,
    observaciones: z.string().nullable(),
    totalRenglones: z.number().int().describe('Artículos enumerados en el conteo.'),
    renglonesContados: z.number().int().describe('Artículos con conteo físico capturado.'),
    canceladoEn: z.iso.datetime().nullable(),
    motivoCancelacion: z.string().nullable(),
    creadoEn: z.iso.datetime(),
    creadoPorId: z.string().nullable(),
  })
  .describe('Encabezado de un inventario cíclico (sin el teórico — no filtra el conteo ciego).');

/** Forma del resumen de un cíclico. */
export type InventarioCiclicoResumen = z.infer<typeof esquemaInventarioCiclicoResumen>;

/** Filtros/paginación del listado de cíclicos. */
export const esquemaInventariosCiclicosQuery = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  estado: esquemaEstadoInventarioCiclico.optional(),
  idAlmacen: z.coerce.number().int().positive().optional(),
  dimension: esquemaDimensionCiclico.optional(),
});

/** Parámetros del listado ya coaccionados. */
export type InventariosCiclicosQuery = z.infer<typeof esquemaInventariosCiclicosQuery>;

/** Página de cíclicos. */
export const esquemaInventariosCiclicosPagina = z.object({
  datos: z.array(esquemaInventarioCiclicoResumen),
  total: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  totalPaginas: z.number().int(),
});

/** Forma de la página de cíclicos. */
export type InventariosCiclicosPagina = z.infer<typeof esquemaInventariosCiclicosPagina>;

// ── Salida: CONTEO ─────────────────────────────────────────────────────────────────────────────

/**
 * Un renglón de la vista de CONTEO. El artículo viene YA DESCRITO (`titulo`/`subtitulo`) para que
 * la pantalla no tenga que saber si cuenta prendas, telas o avíos.
 *
 * ⚠️ `cantTeorica` es OPCIONAL y eso es la REGLA DEL CONTEO CIEGO, no una comodidad: en PT el
 * dominio ni siquiera selecciona la columna, así que la clave NO EXISTE en la respuesta (defensa en
 * profundidad, D6). En telas y avíos sí va, y es la columna «Sistema» de la pantalla.
 */
export const esquemaConteoRenglon = z
  .object({
    idDet: z.number().int(),
    titulo: z.string().describe('El artículo: código del modelo, nombre de la tela o clave del avío.'),
    subtitulo: z
      .string()
      .nullable()
      .describe('Lo que lo distingue: color·talla·orden, el color de la tela, la descripción del avío.'),
    unidad: z.string().nullable().describe('Unidad de la cantidad (m, kg, pza…); null si no aplica.'),
    cantTeorica: z
      .number()
      .optional()
      .describe('Saldo del sistema al abrir la hoja. AUSENTE en PT (conteo ciego, D6).'),
    cantReal: z.number().nullable().describe('Cantidad física capturada; null si no se ha contado.'),
    nombreComplemento: z
      .string()
      .nullable()
      .describe('Nombre del segundo componente de la tela (D5); null si el artículo no lleva.'),
    cantTeoricaComplemento: z.number().optional(),
    cantRealComplemento: z.number().nullable(),
    contado: z.boolean(),
  })
  .describe('Renglón de conteo (con el saldo a la vista en telas/avíos; ciego en PT).');

/** Vista de CONTEO de un cíclico (encabezado + renglones). */
export const esquemaConteoSalida = z
  .object({
    id: z.number().int(),
    folio: z.number().int(),
    idAlmacen: z.number().int(),
    almacen: z.string(),
    dimension: esquemaDimensionCiclico,
    fecha: z.iso.date(),
    estado: esquemaEstadoInventarioCiclico,
    renglones: z.array(esquemaConteoRenglon),
  })
  .describe('Vista de captura de conteo (doc 05 §Almacén / D6).');

/** Forma de la vista de conteo. */
export type ConteoSalida = z.infer<typeof esquemaConteoSalida>;

// ── Salida: EXACTITUD (teórico vs real; permiso de consulta) ────────────────────────────────────

/** Un movimiento de kardex que reconcilió un renglón (D3). */
export const esquemaAjusteEnlazado = z.object({
  id: z.number().int(),
  folio: z.number().int(),
  direccion: z.enum(['entrada', 'salida']),
});

/**
 * Un renglón de la vista de EXACTITUD: teórico, real, exactitud (= real − teórico) y los
 * movimientos de ajuste que lo reconciliaron. Un renglón de tela puede tener DOS (una entrada por
 * el componente que faltó y una salida por el que sobró).
 */
export const esquemaExactitudRenglon = z
  .object({
    idDet: z.number().int(),
    titulo: z.string(),
    subtitulo: z.string().nullable(),
    unidad: z.string().nullable(),
    cantTeorica: z.number(),
    cantReal: z.number().nullable(),
    exactitud: z
      .number()
      .nullable()
      .describe('cantReal − cantTeorica; null si el renglón no se ha contado.'),
    nombreComplemento: z.string().nullable(),
    cantTeoricaComplemento: z.number().nullable(),
    cantRealComplemento: z.number().nullable(),
    exactitudComplemento: z.number().nullable(),
    ajustes: z.array(esquemaAjusteEnlazado),
  })
  .describe('Renglón de exactitud (teórico vs real).');

/** Totales agregados de la vista de exactitud. */
export const esquemaExactitudTotales = z.object({
  total: z.number().int().describe('Artículos enumerados.'),
  contados: z.number().int(),
  exactos: z.number().int().describe('Renglones contados sin diferencia en NINGÚN componente.'),
  diferencias: z.number().int().describe('Renglones contados con diferencia en algún componente.'),
  teorico: z.number(),
  real: z.number().describe('Suma de cantReal (solo renglones contados).'),
});

/** Vista de EXACTITUD de un cíclico (encabezado + renglones con teórico + totales). */
export const esquemaExactitudSalida = z
  .object({
    id: z.number().int(),
    folio: z.number().int(),
    idEmpresa: z.number().int(),
    idAlmacen: z.number().int(),
    almacen: z.string(),
    dimension: esquemaDimensionCiclico,
    fecha: z.iso.date(),
    estado: esquemaEstadoInventarioCiclico,
    observaciones: z.string().nullable(),
    canceladoEn: z.iso.datetime().nullable(),
    motivoCancelacion: z.string().nullable(),
    renglones: z.array(esquemaExactitudRenglon),
    totales: esquemaExactitudTotales,
  })
  .describe('Vista de exactitud + generación del ajuste (permiso de consulta).');

/** Forma de la vista de exactitud. */
export type ExactitudSalida = z.infer<typeof esquemaExactitudSalida>;

// ── Salida: AJUSTE (con el AVISO de la decisión 6) ─────────────────────────────────────────────

/**
 * Un artículo que SE MOVIÓ entre el alta de la hoja y el cierre: lo que el sistema tenía congelado
 * ya no es lo que tiene ahora. No es un error — es información para decidir.
 */
export const esquemaCiclicoArticuloMovido = z.object({
  idDet: z.number().int(),
  titulo: z.string(),
  subtitulo: z.string().nullable(),
  componente: z
    .enum(['cuerpo', 'complemento'])
    .describe('Qué componente se movió (las telas tienen dos; PT y avíos, sólo «cuerpo»).'),
  cantTeorica: z.number().describe('Lo que el sistema tenía CONGELADO al abrir la hoja.'),
  existenciaActual: z.number().describe('Lo que el sistema tiene AHORA (Σ de movimientos, D3).'),
  cantReal: z.number().nullable().describe('Lo que se contó físicamente; null si no se contó.'),
  ajuste: z
    .number()
    .describe('Lo que el ajuste va a mover en este componente (contado − teórico congelado).'),
  existenciaResultante: z
    .number()
    .describe('Existencia que quedará si se aplica: existenciaActual + ajuste.'),
});

/** Forma de un artículo que se movió mientras la hoja estaba abierta. */
export type CiclicoArticuloMovido = z.infer<typeof esquemaCiclicoArticuloMovido>;

/**
 * AVISO de la decisión 6 (§Post-F9.193): el almacén se movió mientras la hoja estaba abierta.
 * **Avisa y deja decidir, NO bloquea**: viaja como DATO de la respuesta (200), nunca como error.
 */
export const esquemaCiclicoAvisoMovimiento = z
  .object({
    articulos: z.array(esquemaCiclicoArticuloMovido),
  })
  .describe('Artículos cuya existencia cambió entre el alta y el cierre de la hoja.');

/** Resultado de pedir el ajuste: si se aplicó, el aviso (si lo hubo) y la exactitud resultante. */
export const esquemaAjusteCiclicoSalida = z
  .object({
    aplicado: z
      .boolean()
      .describe('false = NO se escribió nada: hay un aviso que confirmar antes de aplicar.'),
    aviso: esquemaCiclicoAvisoMovimiento.nullable(),
    exactitud: esquemaExactitudSalida,
  })
  .describe('Ajuste del cíclico: aplicado, o detenido con el aviso de que el almacén se movió.');

/** Forma del resultado del ajuste. */
export type AjusteCiclicoSalida = z.infer<typeof esquemaAjusteCiclicoSalida>;
