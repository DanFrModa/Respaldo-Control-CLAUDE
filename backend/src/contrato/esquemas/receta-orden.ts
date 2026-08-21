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

import { esquemaEstadoOrden } from './orden.js';

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
    .describe(
      'El material NO está en el BOM del modelo, así que este renglón solo existe en esta orden. ' +
        'NO significa "lo tecleó una persona": traer al pedido un material que el modelo SÍ tiene ' +
        'crea un renglón heredado del modelo (con su precio, banderas, amarre y medidas por talla) ' +
        'y esta bandera queda en false, para que su desviación se siga avisando.',
    ),
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
  /**
   * ⭐ V1-E3h (§Post-F9.72) — CUÁNDO firmó Desarrollo ESTE renglón (ISO), o `null` = todavía no.
   * La firma bajó de la receta al renglón porque Daniel pidió liberar POR PARTES: *"podría haber
   * algún cierre que aún no autoriza el cliente, pero ya podríamos ir comprando lo demás"*.
   */
  liberadoEn: z
    .string()
    .nullable()
    .describe('Cuándo se liberó ESTE renglón (ISO). null = sin liberar: no se compra.'),
  /** Quién firmó este renglón. `null` con fecha presente = lo firmó la migración. */
  liberadoPor: z.string().nullable().describe('Quién firmó este renglón, o null.'),
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
    consumo: z
      .number()
      .nullable()
      .describe(
        'Medida del avío para esta talla EN ESTA ORDEN, o `null` si TODAVÍA NO SE CAPTURÓ. El ' +
          '`null` NO es un 0: el 0 es un cero puesto a propósito (el MRP lo respeta), mientras ' +
          'que el null solo existe para pintar la matriz (misma regla que V1-E3c en el modelo).',
      ),
    enLaOrden: z
      .boolean()
      .describe(
        '¿La talla se produce en ESTA orden (está en su matriz color×talla)? `false` = medida ' +
          'capturada que la orden ya no lleva; se enseña para no perderla en silencio.',
      ),
    idAvioMedida: z.number().int().nullable().describe('Amarre medida×talla (R5/B11), o null.'),
    medidaAmarrada: z.string().nullable().describe('Etiqueta de la medida amarrada ("15 cm").'),
    precioMedida: z.number().nullable().describe('Precio de la medida amarrada, o null.'),
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
    modoCaptura: z
      .enum(['consumo', 'medida'])
      .describe(
        '⭐ V1-E3g (§Post-F9.66): ¿qué se captura POR TALLA en este avío? `consumo` = CUÁNTO se ' +
          'gasta, en `unidad` (0.75 m de elástico). `medida` = QUÉ se pide, eligiendo del catálogo ' +
          'de medidas del avío (el cierre de 53 cm); ahí la cantidad no varía por talla. Lo deriva ' +
          'el servidor de si el avío tiene medidas ACTIVAS — el MISMO hecho con el que el precosto ' +
          'decide promediarlas. Nunca se capturan las dos cosas a la vez.',
      ),
    unidadMedida: z
      .string()
      .nullable()
      .describe('Unidad de las MEDIDAS del avío (cm, mm…), distinta de `unidad` (la de consumo).'),
    avisoCaptura: z
      .string()
      .nullable()
      .describe(
        'Advertencia que NO bloquea sobre la captura por talla de este renglón (contradicción ' +
          'heredada entre modo y toggle, o un número absurdo para la unidad), o null.',
      ),
    idAvioProveedor: z
      .number()
      .int()
      .nullable()
      .describe('Proveedor del par `AvioProveedor` amarrado, o null.'),
    proveedorAmarrado: z.string().nullable(),
    tallas: z
      .array(esquemaRecetaOrdenAvioTalla)
      .describe(
        'Medidas por talla: UNA FILA POR TALLA DE LA ORDEN (aunque no se haya capturado, con ' +
          '`consumo: null`) más las capturadas que la orden ya no lleva. Extiende a la OP lo que ' +
          'V1-E3c resolvió en el modelo: antes solo salían las filas que YA existían, así que un ' +
          'avío por talla sin medidas capturadas no se podía capturar desde la orden.',
      ),
    tieneTallas: z
      .boolean()
      .describe('¿La orden tiene tallas en su matriz? (sin ellas no hay matriz que capturar).'),
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
    idModeloArte: z
      .number()
      .int()
      .nullable()
      .describe(
        'Traza al arte del modelo y, desde V1-E3f, IDENTIDAD del renglón dentro de la orden ' +
          '(al retirarse el `nombre`). null = agregado a mano.',
      ),
    descripcion: z.string().describe('Descripción del arte EN ESTA ORDEN (el campo visible).'),
    posicion: z.string().nullable().describe('Dónde va en la prenda (texto libre), o null.'),
    puntadas: z.number().int().nullable(),
    idTipoArte: z.number().int().describe('Id del tipo de arte (catálogo TipoProceso).'),
    tipoArte: z.string().describe('Nombre del tipo de arte, resuelto.'),
    codigoTipoArte: z.string().describe('Código estable del tipo de arte (ej. "bordado").'),
    usaPuntadas: z.boolean().describe('¿El tipo de este arte usa puntadas? (§Post-F9.52.6).'),
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
    /**
     * ⭐ V1-E3h (§Post-F9.73): el id del material EN EL MODELO (`idTela`/`idAvio`/`idModeloArte`
     * según `tipo`), presente SOLO en los cambios `agregado`. Es lo que le permite al botón
     * «traer del modelo» señalar UN faltante — un faltante no tiene `idRenglon` porque no existe
     * todavía en la orden, así que sin este id solo se podría traer todo de un jalón.
     */
    idMaterialModelo: z
      .number()
      .int()
      .nullable()
      .describe('Id del material en el BOM del modelo (solo en `agregado`), o null.'),
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
    /** V1-E3h: renglones VIVOS ya firmados por Desarrollo (los que sí se compran). */
    liberados: z.number().int().describe('Renglones vivos ya liberados (se pueden comprar).'),
    /** V1-E3h: renglones VIVOS que Desarrollo todavía no firma (lo que el comprador NO ve). */
    porLiberar: z.number().int().describe('Renglones vivos SIN liberar (no se compran todavía).'),
  })
  .describe('Conteo de renglones de la receta por estado y por firma.');

/** Resumen por estado de la receta. */
export type ResumenReceta = z.infer<typeof esquemaResumenReceta>;

/** La receta congelada de una orden, completa. */
export const esquemaRecetaOrden = z
  .object({
    idOrden: z.number().int(),
    folio: z.number().int(),
    idModelo: z.number().int(),
    codigoModelo: z.string(),
    /*
     * ⭐ V1-E3j — EL ENCABEZADO DE LA ORDEN, dentro de la receta.
     *
     * La receta dejó de vivir sólo dentro del panel de la OP: tiene PANTALLA PROPIA
     * (`/produccion/ordenes/:id/receta`), a la que se llega también desde la bandeja «Recetas por
     * liberar». Ahí no hay una orden alrededor de la cual leerse, y Daniel pidió *"saber en qué OP
     * estás sin volver atrás"*.
     *
     * Van AQUÍ y no en una segunda llamada a `GET /ordenes/:id` por dos razones:
     *  1. **Permisos.** La pantalla la gobierna `desarrollo.ver` (§Post-F9.72: firmar la receta NO
     *     puede exigir permiso sobre la OP entera). Pedir el encabezado a la ruta de órdenes lo
     *     ataría a `ordenes.ver` y volvería a meter el permiso que la etapa anterior sacó.
     *  2. **A1.** El encabezado lo arma el servidor, en la misma lectura y con la misma regla de
     *     empresa activa (A9): la pantalla no cruza dos respuestas para saber de qué orden habla.
     */
    cliente: z.string().describe('Nombre del cliente de la orden (encabezado de la pantalla).'),
    fechaEntrega: z.iso
      .date()
      .nullable()
      .describe('Fecha de entrega comprometida de la orden, o null.'),
    estado: esquemaEstadoOrden.describe('Estado de la orden (una CANCELADA no se toca).'),
    totalPiezas: z
      .number()
      .int()
      .describe('Total de prendas de la orden (Σ de su matriz color×talla).'),
    liberadaEn: z
      .string()
      .nullable()
      .describe(
        'Cuándo quedó liberada la receta COMPLETA (ISO), o null = queda algo por liberar. ' +
          'DERIVADO de los renglones desde V1-E3h (§Post-F9.72).',
      ),
    liberadaPor: z
      .string()
      .nullable()
      .describe('Quién la dejó completa. null con fecha presente = la liberó la migración.'),
    puedeComprar: z
      .boolean()
      .describe(
        '⭐ V1-E3h: ¿hay AL MENOS UN renglón liberado? La puerta dejó de ser todo-o-nada: se ' +
          'compra lo liberado, y lo que falta se reporta con nombre. `false` = nadie ha firmado ' +
          'nada de esta receta y no hay qué comprar.',
      ),
    todoLiberado: z
      .boolean()
      .describe('¿No queda ningún renglón vivo sin firmar? (= `liberadaEn` no es null).'),
    avisoCurva: z
      .string()
      .nullable()
      .describe(
        '⭐ V1-E3r (§Post-F9.81): aviso REDACTADO POR EL SERVIDOR cuando la curva del modelo y las ' +
          'tallas de esta orden no coinciden — con los nombres de las dos curvas y qué tallas ' +
          'sobran o faltan, en las dos direcciones. `null` = coinciden, el modelo no tiene curva, ' +
          'o la orden todavía no tiene matriz. 🔴 NUNCA BLOQUEA: la curva de la ORDEN manda.',
      ),
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

/**
 * Renglón por talla al capturar (R18). ⭐ V1-E3g: `consumo` es **opcional** porque en un avío "por
 * medida" (cierres) la cantidad no se captura por talla —es la del renglón— y por talla sólo se
 * elige QUÉ medida se pide. El dominio la resuelve: conserva la que ya tenía la fila y, si es
 * nueva, siembra el `consumoPorPrenda` congelado del renglón.
 */
export const esquemaRecetaTallaEntrada = z.object({
  idTalla: z.number().int().positive(),
  consumo: esquemaConsumoReceta.optional(),
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
    /**
     * V1-E3f: la identidad del arte dentro de la orden. Si viene, el renglón se casa con ESE arte
     * del modelo (y revive su lápida si la hay); si se omite, nace AGREGADO A MANO y entonces la
     * `descripcion` y el `idTipoArte` son obligatorios (el renglón no tiene de dónde heredarlos).
     */
    idModeloArte: z.number().int().positive().optional(),
    descripcion: z
      .string({ error: 'La descripción del arte es obligatoria' })
      .trim()
      .min(1, { error: 'La descripción del arte es obligatoria' })
      .max(500)
      .optional(),
    posicion: z.string().trim().max(100).nullable().optional(),
    puntadas: z.number().int().nonnegative().nullable().optional(),
    precio: esquemaPrecioReceta.optional(),
    idTipoArte: z.number().int().positive().optional(),
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
    descripcion: z.string().trim().min(1).max(500).optional(),
    posicion: z.string().trim().max(100).nullable().optional(),
    puntadas: z.number().int().nonnegative().nullable().optional(),
    idTipoArte: z.number().int().positive().optional(),
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

// ── V1-E3h · LIBERAR POR PARTES (§Post-F9.72) · V1-E3k · UNO POR UNO (§Post-F9.80) ─────────────

/** Referencia a un renglón concreto de la receta (tipo + id dentro de la orden). */
export const esquemaReferenciaRenglonReceta = z
  .object({ tipo: esquemaTipoRenglonReceta, id: z.number().int().positive() })
  .describe('Un renglón de la receta de esta orden.');

/** Referencia a un renglón de la receta. */
export type ReferenciaRenglonReceta = z.infer<typeof esquemaReferenciaRenglonReceta>;

/**
 * Cuerpo de LIBERAR. **Hay que NOMBRAR cada renglón que se firma** — no existe ningún alcance en
 * bloque, y ésa es la regla, no una omisión.
 *
 * ⭐ V1-E3k (§Post-F9.80) — DANIEL, 20-ago-2026: *"me parece una mala idea el botón de «Liberar todo
 * lo que falta». Creo que siempre se debe liberar uno por uno, para que se revise lo que se está
 * haciendo. **No tiene sentido liberar las cosas sin ver**."*
 *
 * Hasta V1-E3j este cuerpo llevaba un `alcance` (`todo` / `telas` / `avios` / `artes` / `seleccion`)
 * y una bandera `revisarPendientes`: los dos los agregó el LEAD razonando que *"lo rutinario no
 * cueste veinte clics"*. Ese razonamiento optimiza la prisa, y **la firma no es un trámite: es la
 * puerta que abre la compra**. Los dos SE RETIRAN, y se retiran **aquí** —no solo de la pantalla—
 * porque la decisión es de negocio y las de negocio se cumplen en el servidor (A1/A4, §Post-F9.68:
 * esconder *y* bloquear, las dos capas).
 *
 * Lo que SÍ sobrevive de §Post-F9.72 es lo que Daniel pidió: **liberar POR PARTES**. Se sigue
 * pudiendo firmar una parte de la receta y dejar el resto pendiente; lo que ya no se puede es pedir
 * que **el servidor expanda** un comodín a renglones que quien firma nunca nombró. Quien libera
 * tiene que traer la lista, y para tenerla tuvo que leer la receta.
 *
 * ⚠️ Ojo con el límite: el máximo es una defensa contra un cuerpo absurdo, **no** la regla de
 * negocio. La regla es la de arriba: nada se firma sin nombrarse. Una lista vacía la rechaza el
 * dominio con su motivo (D3: no se libera "nada" en silencio).
 */
export const esquemaLiberarRecetaCuerpo = z
  .object({
    renglones: z
      .array(esquemaReferenciaRenglonReceta)
      .max(500)
      .describe('Los renglones que se firman, uno por uno. No hay comodín: hay que nombrarlos.'),
  })
  .describe('Qué renglones firma Desarrollo (§Post-F9.80: se libera UNO POR UNO, viéndolos).');

/** Datos de una liberación. */
export type DatosLiberarReceta = z.input<typeof esquemaLiberarRecetaCuerpo>;

// ── V1-E3h · TRAER DEL MODELO lo que le falta a la receta (§Post-F9.73) ────────

/**
 * QUÉ material del modelo se quiere traer. Un faltante NO tiene renglón en la orden (por eso se
 * identifica por el MATERIAL, no por un `idRenglon` que no existe).
 */
export const esquemaMaterialDelModelo = z
  .discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('tela'), idTela: z.number().int().positive() }),
    z.object({ tipo: z.literal('avio'), idAvio: z.number().int().positive() }),
    z.object({ tipo: z.literal('arte'), idModeloArte: z.number().int().positive() }),
  ])
  .describe('Material del BOM del modelo que la orden no tiene.');

/** Un material del modelo señalado para traer. */
export type MaterialDelModelo = z.infer<typeof esquemaMaterialDelModelo>;

/**
 * Cuerpo de TRAER DEL MODELO. Sin `materiales` se traen **todos** los faltantes de un jalón
 * (§Post-F9.73 punto 1: *"renglón por renglón, o todos de un jalón"*).
 */
export const esquemaTraerDelModeloCuerpo = z
  .object({ materiales: z.array(esquemaMaterialDelModelo).max(500).optional() })
  .describe('Qué le falta a la receta y se quiere traer del modelo. Vacío = todo lo que falte.');

/** Datos de "traer del modelo". */
export type DatosTraerDelModelo = z.input<typeof esquemaTraerDelModeloCuerpo>;

/**
 * Un material que NO se trajo, y por qué. Daniel: *"no debe de jalarlo en silencio"*.
 *
 * Cubre los DOS motivos por los que algo pedido no entra: **la orden ya decidió otra cosa** (lo
 * quitó a mano, o lo ajustó para ESTA orden) y **el modelo ya no lo lleva** (se pidió por un aviso
 * viejo). Los dos se dicen con nombre; ninguno se resuelve callando (D3).
 *
 * ⚠️ Un renglón que ya está en la orden **idéntico al modelo NO es un choque** y no aparece aquí:
 * nadie decidió nada distinto sobre él. Reportarlo llenaría de "choques" falsos una operación que
 * salió bien (12 avisos por 1 material traído).
 */
export const esquemaChoqueTraerDelModelo = z
  .object({
    tipo: esquemaTipoRenglonReceta,
    material: z.string().describe('Cómo se llama el material, para nombrarlo.'),
    motivo: z.string().describe('Por qué NO se trajo, ya redactado.'),
  })
  .describe('Material que NO se trajo del modelo, con su motivo (§Post-F9.73).');

/** Un choque al traer del modelo. */
export type ChoqueTraerDelModelo = z.infer<typeof esquemaChoqueTraerDelModelo>;

/**
 * Resultado de traer del modelo: la receta ya recargada + el resumen de **qué se trajo** y **qué se
 * respetó** (§Post-F9.73 punto 4: nunca en silencio y nunca pisando lo ajustado).
 */
export const esquemaTraerDelModeloResultado = z
  .object({
    receta: esquemaRecetaOrden,
    traidos: z
      .array(z.object({ tipo: esquemaTipoRenglonReceta, material: z.string() }))
      .describe('Lo que sí entró a la receta (SIN LIBERAR: pasa por la misma firma).'),
    respetados: z
      .array(esquemaChoqueTraerDelModelo)
      .describe(
        'Lo que NO se trajo, con su motivo: la orden ya decidió otra cosa (lápida o ajuste ' +
          'propio), o el modelo ya no lo lleva. Lo que ya estaba IDÉNTICO no se reporta.',
      ),
  })
  .describe('Qué se trajo del modelo y qué se respetó (§Post-F9.73).');

/** Resultado de traer del modelo. */
export type TraerDelModeloResultado = z.infer<typeof esquemaTraerDelModeloResultado>;

// ── V1-E3h · LA BANDEJA «Recetas por liberar» (§Post-F9.72) ────────────────────

/**
 * Una ORDEN con receta pendiente de firma, tal como la recorre Desarrollo.
 *
 * ⭐ **Una fila por ORDEN, no por material**: así trabaja Daniel. Y **ordenada por FECHA DE
 * ENTREGA**, no por folio: lo que estorba primero, arriba. Los conteos y el `conOrdenCompra` los
 * agrega el SERVIDOR (misma regla que el concentrado de F5-E7: nunca se suma en el cliente).
 */
export const esquemaRecetaPorLiberar = z
  .object({
    idOrden: z.number().int(),
    folio: z.number().int().describe('Folio de la orden de producción.'),
    idModelo: z.number().int(),
    modelo: z.string().describe('Código del modelo.'),
    cliente: z.string(),
    fechaEntrega: z
      .string()
      .nullable()
      .describe('Fecha de entrega comprometida (YYYY-MM-DD), o null. Es el orden de la bandeja.'),
    telas: z.number().int().describe('Telas vivas sin liberar.'),
    avios: z.number().int().describe('Avíos vivos sin liberar.'),
    artes: z.number().int().describe('Artes vivos sin liberar.'),
    porLiberar: z.number().int().describe('Total de renglones vivos sin liberar (Σ de los tres).'),
    conOrdenCompra: z
      .boolean()
      .describe(
        '⭐ YA ESTÁ FRENANDO DINERO: la orden ya tiene OC (no cancelada) por OTRA parte de su ' +
          'receta, así que alguien está comprando y esperando el resto. No es lo mismo que una ' +
          'orden recién nacida a la que todavía nadie le pide nada.',
      ),
  })
  .describe('Una orden con renglones de receta pendientes de liberar (§Post-F9.72).');

/** Fila de la bandeja «Recetas por liberar». */
export type RecetaPorLiberar = z.infer<typeof esquemaRecetaPorLiberar>;

/** Filtros de la bandeja «Recetas por liberar» (querystring): paginación estándar + búsqueda. */
export const esquemaRecetasPorLiberarQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página (tope 100).'),
    /** Solo las que YA tienen OC: lo que está frenando dinero, primero. */
    soloConOrdenCompra: z
      .stringbool()
      .default(false)
      .describe('Solo órdenes que ya tienen OC por otra parte de su receta.'),
    busqueda: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Folio, modelo o cliente (contiene, sin acentos-sensible).'),
  })
  .describe('Filtros de la bandeja «Recetas por liberar».');

/**
 * Filtros de la bandeja **en su forma NATIVA** (números y booleanos ya resueltos) — lo que recibe el
 * dominio. En la URL todo es texto, así que el esquema de la ruta coacciona
 * (`esquemaRecetasPorLiberarQuery`) y el dominio re-valida con `esquemaRecetasPorLiberarDominio`.
 * Mismo patrón que la bandeja de la Ruta Crítica: sin él, re-validar la salida de la ruta con el
 * esquema de la URL tira un 400 espurio (cicatriz del hotfix F2, PR #56).
 */
export const esquemaRecetasPorLiberarDominio = z.object({
  pagina: z.number().int().min(1).default(1),
  porPagina: z.number().int().min(1).max(100).default(20),
  soloConOrdenCompra: z.boolean().default(false),
  busqueda: z.string().trim().max(200).optional(),
});

/** Filtros de la bandeja (forma nativa, no la de la URL). */
export type FiltrosRecetasPorLiberar = z.input<typeof esquemaRecetasPorLiberarDominio>;

/** Respuesta paginada de la bandeja «Recetas por liberar» (forma estándar `Pagina<T>`). */
export const esquemaRecetasPorLiberarPagina = z
  .object({
    datos: z.array(esquemaRecetaPorLiberar),
    total: z.number().int(),
    pagina: z.number().int(),
    porPagina: z.number().int(),
    totalPaginas: z.number().int(),
  })
  .describe('Página de la bandeja «Recetas por liberar».');

/** Página de la bandeja. */
export type RecetasPorLiberarPagina = z.infer<typeof esquemaRecetasPorLiberarPagina>;
