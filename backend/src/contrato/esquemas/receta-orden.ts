/**
 * Contrato de la RECETA CONGELADA DE LA ORDEN (V1-E3d pieza B, §Post-F9.43).
 *
 * Daniel (14-ago-2026): *"El BOM debe de vivir en la OP. De hecho así funciona en Control viejo."*
 *
 * La receta se copia del modelo AL CREAR la orden y desde entonces es de la orden: se puede quitar,
 * agregar y editar, y lo tocado queda marcado (`estado: ajustado`) para que un cambio posterior del
 * modelo no lo pise. Desarrollo la LIBERA, y hasta entonces **no se puede explotar el MRP ni generar
 * OC** — cortar y producir NO se bloquean (§Post-F9.43(c): la puerta va antes de *comprar*).
 *
 * ⚠️ La DESALINEACIÓN contra el BOM del modelo se calcula **AL VUELO**, sin evento, sin outbox y sin
 * estado acumulado (§Post-F9.43(d)): la receta está congelada y el BOM está vivo, así que la
 * diferencia sale de compararlos cuando alguien abre la pantalla.
 */
import { z } from 'zod';

// ── Vocabulario ────────────────────────────────────────────────────────────────

/**
 * En qué punto de revisión está un renglón. ⚠️ **NO se fuerza el OK uno por uno**: el 89 % de las
 * órdenes lleva la receta del modelo tal cual, así que hay un botón de *"marcar todo revisado"* y el
 * renglón desviado se pinta distinto para pedir atención solo.
 */
export const esquemaEstadoRenglonReceta = z
  .enum(['sin_revisar', 'revisado', 'ajustado'])
  .describe('Estado de revisión del renglón: sin revisar | revisado | ajustado a mano.');

/** Clave del estado de un renglón de la receta. */
export type EstadoRenglonRecetaClave = z.infer<typeof esquemaEstadoRenglonReceta>;

/** Qué clase de renglón es (las tres secciones de la receta). */
export const esquemaTipoRenglonReceta = z
  .enum(['tela', 'avio', 'arte'])
  .describe('Sección de la receta a la que pertenece el renglón.');

/** Clave del tipo de renglón. */
export type TipoRenglonRecetaClave = z.infer<typeof esquemaTipoRenglonReceta>;

/**
 * QUÉ cambió respecto de lo congelado en la orden (§Post-F9.43(d): el aviso tiene que decir *qué*
 * cambió, no solo que algo cambió).
 *  • `agregado`       — el modelo trae un insumo que la orden no tiene.
 *  • `quitado`        — la orden trae un insumo que el modelo ya no tiene.
 *  • `consumo`        — mismo insumo, cantidad distinta.
 *  • `precio`         — mismo insumo, precio de CATÁLOGO distinto: **alguien tocó el modelo**.
 *  • `precio-mercado` — el precio se movió porque **cambió la última COMPRA REAL** (§Post-F9.48), no
 *    porque nadie tocara el modelo.
 *
 * ⚠️ **Por qué `precio-mercado` existe aparte** (hallazgo del reviewer): desde V1-E3e el precio que
 * costea la receta del modelo ES la última compra real. Sin separarlos, el comprador que ajusta la
 * línea de su propia OC y la autoriza dejaba **su propia orden en rojo** —y con ella todas las demás
 * que llevan esa tela, para siempre— con el cartel *"el modelo cambió"*. El modelo no cambió: cambió
 * el mercado. Un aviso que describe mal su causa es exactamente lo que esta ola vino a corregir.
 */
export const esquemaTipoCambioReceta = z
  .enum(['agregado', 'quitado', 'consumo', 'precio', 'precio-mercado'])
  .describe('Qué cambió respecto de la receta congelada de la orden.');

/** Clave del tipo de cambio. */
export type TipoCambioRecetaClave = z.infer<typeof esquemaTipoCambioReceta>;

// ── Salida: los renglones ──────────────────────────────────────────────────────

/** Lo que TODO renglón de la receta lleva, sea tela, avío o arte. */
const camposComunesRenglon = {
  id: z.number().int().describe('Id del renglón de la receta de ESTA orden.'),
  tipo: esquemaTipoRenglonReceta,
  estado: esquemaEstadoRenglonReceta,
  agregadoAMano: z
    .boolean()
    .describe('El renglón NO vino del modelo: lo agregó una persona en esta orden.'),
  excluido: z
    .boolean()
    .describe(
      'El renglón vino del modelo y se decidió que ESTA orden no lo lleva (la jareta). Se conserva ' +
        'visible y tachado; ningún consumidor lo cuenta.',
    ),
  notas: z.string().nullable().describe('Por qué se ajustó/excluyó, si se escribió.'),
  /**
   * ¿Este renglón sigue existiendo en el BOM del modelo HOY? Es lo que permite a la pantalla decir
   * si "restaurar" tiene a dónde volver.
   */
  enElModelo: z.boolean().describe('¿El insumo sigue en el BOM del modelo hoy?'),
  /** Cambios del modelo que afectan a ESTE renglón (vacío = alineado o desviado a propósito). */
  cambios: z
    .array(esquemaTipoCambioReceta)
    .describe('Qué cambió en el modelo respecto de este renglón (vacío = nada que avisar).'),
};

/** Renglón de TELA de la receta de la orden. */
export const esquemaRecetaOrdenTela = z
  .object({
    ...camposComunesRenglon,
    idTela: z.number().int().describe('Id de la tela.'),
    nombre: z.string().describe('Nombre de la tela.'),
    unidad: z.string().nullable().describe('Unidad de medida de la tela.'),
    consumoPorPrenda: z.number().describe('Consumo por prenda CONGELADO en esta orden.'),
    precio: z
      .number()
      .nullable()
      .describe(
        'Precio CONGELADO en esta orden. `null` = esta orden no congeló precio (receta de antes de ' +
          'V1-E3d): el costeo cae al catálogo, como hasta hoy.',
      ),
    paraPreCosto: z.boolean(),
    paraProduccion: z.boolean(),
    paraCosto: z.boolean(),
    idTelaProveedor: z
      .number()
      .int()
      .nullable()
      .describe('Amarre proveedor–tela heredado del BOM (R17): a quién se le compra.'),
    proveedorAmarrado: z.string().nullable().describe('Nombre del proveedor amarrado, o null.'),
    consumoModelo: z
      .number()
      .nullable()
      .describe('Consumo que trae HOY el BOM del modelo (null si ya no está).'),
    precioModelo: z
      .number()
      .nullable()
      .describe('Precio que costea HOY la receta del modelo (la cascada única), o null.'),
    precioModeloDeCompra: z
      .boolean()
      .describe(
        '¿`precioModelo` sale de la última COMPRA REAL (§Post-F9.48) y no del catálogo? Si sí, una ' +
          'diferencia contra el precio congelado es del MERCADO, no de que alguien tocara el modelo.',
      ),
  })
  .describe('Renglón de tela de la receta congelada de una orden.');

/** Renglón de tela de la receta de la orden. */
export type RecetaOrdenTela = z.infer<typeof esquemaRecetaOrdenTela>;

/** Medida por talla de un avío de la receta de la orden (R18). */
export const esquemaRecetaOrdenAvioTalla = z
  .object({
    idTalla: z.number().int(),
    etiqueta: z.string().describe('Etiqueta de la talla (CH, M, G…).'),
    consumo: z.number().describe('Medida del avío para esta talla EN ESTA ORDEN.'),
    idAvioMedida: z.number().int().nullable().describe('Amarre medida×talla, o null.'),
  })
  .describe('Medida por talla de un avío de la receta de la orden.');

/** Medida por talla de un avío de la receta. */
export type RecetaOrdenAvioTalla = z.infer<typeof esquemaRecetaOrdenAvioTalla>;

/** Renglón de AVÍO de la receta de la orden (el heredero de `OrdenesHab` del viejo). */
export const esquemaRecetaOrdenAvio = z
  .object({
    ...camposComunesRenglon,
    idAvio: z.number().int().describe('Id del avío.'),
    clave: z.string().describe('Clave del avío.'),
    descripcion: z.string().describe('Descripción del avío.'),
    unidad: z.string().nullable(),
    esGenerico: z.boolean().describe('¿Es un avío genérico (se netea contra el stock)?'),
    consumoPorPrenda: z.number().describe('Consumo por prenda CONGELADO (`CantHabOrd` del viejo).'),
    precio: z
      .number()
      .nullable()
      .describe('Precio CONGELADO por unidad de consumo (`PrecioHabOrd` del viejo), o null.'),
    paraPreCosto: z.boolean(),
    paraProduccion: z.boolean(),
    paraCosto: z.boolean(),
    consumoPorTalla: z.boolean().describe('¿El consumo se captura por TALLA (R18)?'),
    idAvioProveedor: z
      .number()
      .int()
      .nullable()
      .describe('Proveedor del par `AvioProveedor` amarrado, o null.'),
    proveedorAmarrado: z.string().nullable(),
    tallas: z.array(esquemaRecetaOrdenAvioTalla).describe('Medidas por talla (si aplica).'),
    consumoModelo: z.number().nullable(),
    precioModelo: z.number().nullable(),
    precioModeloDeCompra: z
      .boolean()
      .describe('¿`precioModelo` sale de la última COMPRA REAL y no del catálogo? (ver tela).'),
  })
  .describe('Renglón de avío de la receta congelada de una orden.');

/** Renglón de avío de la receta de la orden. */
export type RecetaOrdenAvio = z.infer<typeof esquemaRecetaOrdenAvio>;

/** Renglón de ARTE de la receta de la orden (§Post-F9.35: el precio real se define en la OP). */
export const esquemaRecetaOrdenArte = z
  .object({
    ...camposComunesRenglon,
    idModeloArte: z.number().int().nullable().describe('Traza al arte del modelo, o null.'),
    nombre: z.string(),
    descripcion: z.string().nullable(),
    puntadas: z.number().int().nullable(),
    tipo_arte: z.enum(['BORDADO', 'ESTAMPADO']).describe('Bordado o estampado/aplicación.'),
    precio: z
      .number()
      .nullable()
      .describe(
        'Precio del arte EN ESTA ORDEN. ⚠️ Entra UNA vez por orden, SIN multiplicar por cantidad.',
      ),
    idProveedor: z.number().int().nullable(),
    proveedor: z.string().nullable().describe('Proveedor que hace el arte, o null.'),
    precioModelo: z.number().nullable().describe('Precio que trae HOY el arte del modelo, o null.'),
    /** El arte NO tiene cascada de compra: su precio es uno solo (§Post-F9.35). Siempre `false`. */
    precioModeloDeCompra: z.boolean(),
  })
  .describe('Arte congelado de una orden.');

/** Renglón de arte de la receta de la orden. */
export type RecetaOrdenArte = z.infer<typeof esquemaRecetaOrdenArte>;

// ── Salida: los avisos de desalineación ────────────────────────────────────────

/** Un cambio del modelo que la orden NO tiene (calculado al vuelo, §Post-F9.43(d)). */
export const esquemaCambioReceta = z
  .object({
    tipo: esquemaTipoRenglonReceta,
    /** Id del renglón de la receta de la orden, o null cuando el insumo solo existe en el modelo. */
    idRenglon: z.number().int().nullable(),
    material: z.string().describe('Cómo se llama el insumo, para nombrarlo en el aviso.'),
    que: esquemaTipoCambioReceta,
    detalle: z.string().describe('El aviso ya redactado ("la cantidad pasó de 1 a 2").'),
  })
  .describe('Un cambio del BOM del modelo respecto de la receta congelada de la orden.');

/** Un cambio del modelo respecto de la receta. */
export type CambioReceta = z.infer<typeof esquemaCambioReceta>;

/**
 * Los DOS avisos de Daniel, partidos por si ya se comprometió dinero (§Post-F9.43(d)):
 *  • sin OC todavía → rojo en el LUGAR DE LA DECISIÓN (al explotar el MRP / generar la OC);
 *  • con OC ya hecha → aviso visible al abrir la orden.
 * Es el MISMO cálculo; lo que cambia es dónde se enseña, y eso lo decide `conOrdenCompra`.
 */
export const esquemaDesalineacionReceta = z
  .object({
    hayCambios: z.boolean().describe('¿Algo se movió respecto de esta receta congelada?'),
    conOrdenCompra: z
      .boolean()
      .describe('¿La orden ya tiene OC (dinero comprometido)? Decide DÓNDE se enseña el aviso.'),
    critico: z
      .boolean()
      .describe(
        'Aviso ROJO: hay OC hecha **y** el cambio lo provocó una PERSONA tocando el modelo. Un ' +
          'movimiento de `precio-mercado` (la última compra real) NO enciende el rojo: no es que ' +
          'alguien haya cambiado el modelo, y encenderlo volvería ruido de fondo la alerta.',
      ),
    cambios: z.array(esquemaCambioReceta),
  })
  .describe('Desalineación receta-de-la-orden vs. BOM del modelo, calculada al vuelo.');

/** Desalineación de la receta contra el modelo. */
export type DesalineacionReceta = z.infer<typeof esquemaDesalineacionReceta>;

// ── Salida: la receta completa ─────────────────────────────────────────────────

/** Conteos por estado, para el encabezado de la pantalla y el botón de "marcar todo revisado". */
export const esquemaResumenReceta = z
  .object({
    sinRevisar: z.number().int(),
    revisados: z.number().int(),
    ajustados: z.number().int(),
    excluidos: z.number().int(),
    total: z.number().int().describe('Renglones vivos (los excluidos NO cuentan).'),
  })
  .describe('Conteo de renglones de la receta por estado.');

/** Resumen por estado de la receta. */
export type ResumenReceta = z.infer<typeof esquemaResumenReceta>;

/** La receta congelada de una orden, completa. */
export const esquemaRecetaOrden = z
  .object({
    idOrden: z.number().int(),
    folio: z.number().int(),
    idModelo: z.number().int(),
    codigoModelo: z.string(),
    liberadaEn: z
      .string()
      .nullable()
      .describe('Cuándo la liberó Desarrollo (ISO), o null = sin liberar.'),
    liberadaPor: z
      .string()
      .nullable()
      .describe('Quién la liberó. null con fecha presente = la liberó la migración.'),
    puedeComprar: z
      .boolean()
      .describe('¿Se puede explotar el MRP / generar OC? (= la receta está liberada).'),
    resumen: esquemaResumenReceta,
    telas: z.array(esquemaRecetaOrdenTela),
    avios: z.array(esquemaRecetaOrdenAvio),
    artes: z.array(esquemaRecetaOrdenArte),
    desalineacion: esquemaDesalineacionReceta,
  })
  .describe('Receta CONGELADA de una orden de producción (V1-E3d, §Post-F9.43).');

/** Receta congelada de una orden. */
export type RecetaOrden = z.infer<typeof esquemaRecetaOrden>;

// ── Entrada ────────────────────────────────────────────────────────────────────

/** Consumo (cantidad por prenda) — mismo rango que el BOM del modelo. */
const esquemaConsumoReceta = z
  .number({ error: 'El consumo es obligatorio' })
  .nonnegative({ error: 'El consumo no puede ser negativo' })
  .max(999999, { error: 'El consumo es demasiado grande' });

/** Precio congelado (opcional; `null` = sin precio congelado → el costeo cae al catálogo). */
const esquemaPrecioReceta = z
  .number({ error: 'El precio debe ser un número' })
  .nonnegative({ error: 'El precio no puede ser negativo' })
  .max(99999999, { error: 'El precio es demasiado grande' })
  .nullable();

/** Medida por talla al capturar (R18). */
export const esquemaRecetaTallaEntrada = z.object({
  idTalla: z.number().int().positive(),
  consumo: esquemaConsumoReceta,
  idAvioMedida: z.number().int().positive().nullable().optional(),
});

/**
 * Cuerpo para AGREGAR un renglón a la receta de la orden (discriminado por `tipo`).
 *
 * ⚠️ **Las banderas y el precio son OPCIONALES SIN default, a propósito.** Agregar también REVIVE un
 * renglón EXCLUIDO (la lápida), y en ese caso lo que el cuerpo no trae **no se toca**: un default
 * silencioso pisaría el precio congelado, las banderas y el amarre que esa orden ya tenía — el dato
 * que esta etapa existe para proteger. Los defaults (`true`/`false`/`BORDADO`) los aplica el dominio
 * **solo al CREAR**, que es donde sí hay que inventarlos.
 */
export const esquemaRecetaAgregarCuerpo = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('tela'),
    idTela: z.number().int().positive({ error: 'El id de la tela debe ser positivo' }),
    consumoPorPrenda: esquemaConsumoReceta,
    precio: esquemaPrecioReceta.optional(),
    paraPreCosto: z.boolean().optional(),
    paraProduccion: z.boolean().optional(),
    paraCosto: z.boolean().optional(),
    idTelaProveedor: z.number().int().positive().nullable().optional(),
    notas: z.string().max(2000).nullable().optional(),
  }),
  z.object({
    tipo: z.literal('avio'),
    idAvio: z.number().int().positive({ error: 'El id del avío debe ser positivo' }),
    consumoPorPrenda: esquemaConsumoReceta,
    precio: esquemaPrecioReceta.optional(),
    paraPreCosto: z.boolean().optional(),
    paraProduccion: z.boolean().optional(),
    paraCosto: z.boolean().optional(),
    consumoPorTalla: z.boolean().optional(),
    idAvioProveedor: z.number().int().positive().nullable().optional(),
    tallas: z.array(esquemaRecetaTallaEntrada).max(60).optional(),
    notas: z.string().max(2000).nullable().optional(),
  }),
  z.object({
    tipo: z.literal('arte'),
    nombre: z
      .string({ error: 'El nombre del arte es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre del arte es obligatorio' })
      .max(120),
    descripcion: z.string().max(500).nullable().optional(),
    puntadas: z.number().int().nonnegative().nullable().optional(),
    precio: esquemaPrecioReceta.optional(),
    tipoArte: z.enum(['BORDADO', 'ESTAMPADO']).optional(),
    idProveedor: z.number().int().positive().nullable().optional(),
    notas: z.string().max(2000).nullable().optional(),
  }),
]);

/** Datos de alta de un renglón de receta (tal como llegan, antes de aplicar defaults). */
export type DatosRecetaAgregar = z.input<typeof esquemaRecetaAgregarCuerpo>;

/**
 * Cuerpo para EDITAR un renglón. Todos los campos son opcionales (PATCH): lo que no venga NO se
 * toca. Editar cualquier cosa deja el renglón en `ajustado` — es la marca que hace que un cambio
 * posterior del modelo no lo pise (mismo patrón que `PrecostoLinea.ajustado` del precosteo de F8).
 */
export const esquemaRecetaEditarCuerpo = z
  .object({
    consumoPorPrenda: esquemaConsumoReceta.optional(),
    precio: esquemaPrecioReceta.optional(),
    paraPreCosto: z.boolean().optional(),
    paraProduccion: z.boolean().optional(),
    paraCosto: z.boolean().optional(),
    consumoPorTalla: z.boolean().optional(),
    idTelaProveedor: z.number().int().positive().nullable().optional(),
    idAvioProveedor: z.number().int().positive().nullable().optional(),
    tallas: z.array(esquemaRecetaTallaEntrada).max(60).optional(),
    // Solo arte:
    nombre: z.string().trim().min(1).max(120).optional(),
    descripcion: z.string().max(500).nullable().optional(),
    puntadas: z.number().int().nonnegative().nullable().optional(),
    idProveedor: z.number().int().positive().nullable().optional(),
    notas: z.string().max(2000).nullable().optional(),
  })
  .describe('Campos a cambiar de un renglón de la receta. Editar lo deja en `ajustado`.');

/** Datos de edición de un renglón de receta. */
export type DatosRecetaEditar = z.input<typeof esquemaRecetaEditarCuerpo>;

/** Motivo opcional al QUITAR un renglón (viaja a la bitácora y a `notas` si el renglón sobrevive). */
export const esquemaRecetaQuitarCuerpo = z
  .object({ motivo: z.string().trim().max(2000).optional() })
  .describe('Por qué esta orden no lleva ese insumo (queda en la bitácora).');

/** Datos al quitar un renglón. */
export type DatosRecetaQuitar = z.input<typeof esquemaRecetaQuitarCuerpo>;

/** Parámetro de ruta `:tipo` de un renglón de receta. */
export const esquemaRecetaTipoParam = z.object({ tipo: esquemaTipoRenglonReceta });
