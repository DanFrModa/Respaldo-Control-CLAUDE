import { z } from 'zod';

import { esquemaDesalineacionReceta, esquemaTipoCambioReceta } from './receta-orden.js';

/**
 * Contrato Zod del MRP / EXPLOSIÓN de materiales por orden (F4-E4 — REQUISITOS-NUEVOS.md §R3/R7 +
 * principio Make-to-Order; doc `Documentacion_MJD/01-Modelos.md §2`). Tres operaciones:
 *
 *  • EXPLOSIÓN (R3): cruza el BOM del modelo (telas+avíos `paraProduccion`) con las cantidades
 *    color×talla de la orden → QUÉ y CUÁNTO comprar, agrupado por proveedor sugerido. Persiste un
 *    SNAPSHOT regenerable y, al regenerar, reporta las DIFERENCIAS contra el snapshot anterior.
 *  • GENERAR OC (R3): de la explosión, crea una OC por proveedor con el requerido PENDIENTE
 *    seleccionado, en un clic. El folio/total/estatus los decide el backend (A1/A3/D3).
 *  • ESTATUS de materiales (R7): cruce Requerido (snapshot) vs En-OC vs Recibido → semáforo por
 *    material (pendiente/en-oc/recibido-parcial/completo + 'no identificado').
 *
 * Reglas de captura aquí (las repite el dominio, A1): el `idOrden` viaja en la URL; la empresa la
 * toma el dominio de la sesión; cantidades/estatus las DERIVA el servidor (nunca viajan de entrada).
 */

// ── EXPLOSIÓN (R3) ──────────────────────────────────────────────────────────────────────────────

/** Estado de un material genérico tras netear contra el stock (decisión (d) de Daniel). */
export const esquemaEstadoGenerico = z
  .enum(['no-aplica', 'cubierto-por-stock', 'faltante-parcial'])
  .describe(
    'no-aplica: no es genérico (va completo a compra); cubierto-por-stock: el stock cubre todo lo ' +
      'requerido (no compra); faltante-parcial: el stock cubre parte, solo el faltante va a compra.',
  );

/** Forma del estado de genérico en la API. */
export type EstadoGenerico = z.infer<typeof esquemaEstadoGenerico>;

/** Cómo cambió un renglón respecto al snapshot anterior al regenerar la explosión (R3). */
export const esquemaDiffRequerimiento = z
  .enum(['sin-cambio', 'nuevo', 'eliminado', 'cantidad-cambiada'])
  .describe('Diferencia del renglón contra el snapshot previo (visible en la UI).');

/** Forma del diff de un renglón en la API. */
export type DiffRequerimiento = z.infer<typeof esquemaDiffRequerimiento>;

/**
 * ⭐ V1-E3m (§Post-F9.82) — DE DÓNDE SALIÓ EL PROVEEDOR que la explosión propone. No es adorno: la
 * pantalla necesita distinguir *"esto lo puso Desarrollo/el catálogo"* de *"esto lo asigné yo para
 * esta orden"*, porque solo lo segundo se puede quitar desde ahí — y porque un proveedor que aparece
 * sin decir de dónde viene es exactamente lo que dejó a Daniel sin saber dónde se asignaba.
 */
export const esquemaOrigenProveedor = z
  .enum([
    'amarre-desarrollo',
    'dueno-tela',
    'habitual',
    'mas-barato',
    'asignado-compras',
    'sin-proveedor',
  ])
  .describe(
    'amarre-desarrollo: lo amarró Desarrollo en la receta; dueno-tela: es el proveedor DUEÑO de la ' +
      'tela (§Post-F9.11); habitual: es el proveedor habitual del avío; mas-barato: fallback R1/F4; ' +
      'asignado-compras: lo asignó Compras PARA ESTA ORDEN (§Post-F9.82); sin-proveedor: no hay.',
  );

/** Forma del origen del proveedor en la API. */
export type OrigenProveedor = z.infer<typeof esquemaOrigenProveedor>;

/**
 * ⭐⭐ **V1-E8c (§Post-F9.126) — UNA MEDIDA DEL DESGLOSE de un renglón de avío.** Daniel: *"el cierre
 * lo tengo que comprar por medidas… no me aparece cantidad por medida"*.
 *
 * 🔴 **La medida NO parte el renglón: va en una tablita debajo.** Lo que parte el renglón es lo que
 * se recibe por separado (el COLOR); la medida no se recibe —llegan "3,200 cierres"— así que es
 * información PARA EL PROVEEDOR. Y **no multiplica**: la cantidad sale de cuántas prendas la llevan,
 * jamás del número de la medida (§Post-F9.105, los 133,095 cierres).
 *
 * ⚠️ Se desglosan CANTIDADES, no precios (§Post-F9.113): **un solo precio** para todo el renglón.
 */
const esquemaMedidaDesglose = z
  .object({
    idAvioMedida: z
      .number()
      .int()
      .nullable()
      .describe('Medida del catálogo del avío, o null = la cubeta "Sin medida".'),
    etiqueta: z.string().describe('Etiqueta congelada de la medida ("53 cm") o "Sin medida".'),
    cantidad: z.number().describe('Cuánto de esa medida. Σ del desglose = cantidad del renglón.'),
    orden: z
      .number()
      .int()
      .describe('Orden de despliegue (el del catálogo; "Sin medida" al final).'),
  })
  .describe('Un renglón del desglose por medida de un avío.');

/** Forma de una medida del desglose en la API. */
export type MedidaDesglose = z.infer<typeof esquemaMedidaDesglose>;

/**
 * ⭐ V1-E3q (§Post-F9.86) — LO QUE LE TOCA A CADA OP de un material agrupado. Daniel: *"el reparto
 * es SIEMPRE por OP"*. La OC guarda **una línea por (material, OP)** con este mismo desglose.
 */
export const esquemaRepartoOrden = z
  .object({
    idRequerimiento: z.number().int().describe('Renglón de snapshot de ESA orden.'),
    idOrden: z.number().int().describe('Orden de producción a la que le toca esta cantidad.'),
    folioOrden: z.number().int().describe('Folio de esa orden (para la UI).'),
    cantidadRequerida: z.number().describe('Requerido por ESA orden (R3).'),
    cantidadAComprar: z.number().describe('Requerido − stock genérico, en ESA orden.'),
    cantidadEnOc: z.number().describe('Ya en OC viva ligada a ESA orden (V1-E3q).'),
    cantidadPendiente: z.number().describe('Lo que falta comprar para ESA orden.'),
    precioSugerido: z.number().nullable().describe('Precio unitario con el que nacería su línea.'),
  })
  .describe('Reparto por orden de producción de un material agrupado.');

/** Forma del reparto por OP en la API. */
export type RepartoOrden = z.infer<typeof esquemaRepartoOrden>;

/** Un renglón de la explosión (un material requerido con su neteo y proveedor sugerido). */
export const esquemaRequerimientoSalida = z
  .object({
    id: z.number().int().describe('Id del renglón de snapshot.'),
    tipo: z.enum(['tela', 'avio']).describe('Tipo de material.'),
    idTela: z.number().int().nullable().describe('Tela del catálogo, o null.'),
    idAvio: z.number().int().nullable().describe('Avío del catálogo, o null.'),
    idTelaColor: z
      .number()
      .int()
      .nullable()
      .describe(
        '⭐⭐ V1-E3u (§Post-F9.89): color de tela de ESTE renglón. `null` = avío —cuyo color es OTRO, ' +
          'el de la PRENDA, en `idColorPrenda` (⭐⭐ V1-E8c §Post-F9.126)— o tela cuyo color todavía ' +
          'nadie dijo (sale además en `pendientesColor`). Dos colores de la misma tela son DOS ' +
          'renglones y acaban en DOS líneas de OC: es lo que hace que quien recibe no tenga que ' +
          'inventar la correspondencia.',
      ),
    telaColor: z.string().nullable().describe('Nombre del color de tela, o null.'),
    idColorPrenda: z
      .number()
      .int()
      .nullable()
      .describe(
        '⭐⭐ V1-E8c (§Post-F9.126): color de PRENDA de ESTE renglón de AVÍO. Daniel: *"cada color ' +
          'es diferente… En la receta no viene definido el color. Eso viene hasta que nos hacen el ' +
          'pedido"*. El avío NO tiene catálogo de color propio (§Post-F9.91): el que lo identifica ' +
          'es el de la prenda que lo lleva. `null` = tela, o avío de una OP sin matriz capturada.',
      ),
    colorPrenda: z.string().nullable().describe('Nombre de ese color de prenda, o null.'),
    medidas: z
      .array(esquemaMedidaDesglose)
      .describe(
        '⭐⭐ V1-E8c (§Post-F9.126): desglose por medida de este renglón, ya repartido contra lo ' +
          'PENDIENTE de comprar. Vacío = el avío no se pide por medida (o es tela).',
      ),
    material: z.string().describe('Nombre/clave del material (para la UI).'),
    cantidadRequerida: z.number().describe('Cantidad requerida en unidad de consumo (R3).'),
    unidad: z.string().nullable().describe('Unidad de consumo, o null.'),
    esGenerico: z.boolean().describe('¿Avío genérico de stock (R4)?'),
    estadoGenerico: esquemaEstadoGenerico,
    existenciaStock: z.number().describe('Existencia real del kardex (Σ movimientos, D3).'),
    cantidadAComprar: z.number().describe('Cantidad que va a compra (requerida − stock neteado).'),
    idProveedorSugerido: z.number().int().nullable().describe('Proveedor sugerido (R1), o null.'),
    proveedorSugerido: z.string().nullable().describe('Nombre del proveedor sugerido, o null.'),
    precioSugerido: z.number().nullable().describe('Precio unitario sugerido (R1), o null.'),
    origenProveedor: esquemaOrigenProveedor,
    proveedorSugeridoInactivo: z
      .boolean()
      .describe(
        '⭐ V1-E3m: el proveedor propuesto está DADO DE BAJA. Se conserva la sugerencia (alguien lo ' +
          'eligió a propósito y la OC es editable) pero la pantalla tiene que poder ofrecer la ' +
          'reasignación JUSTO ahí — es cuando más falta hace desatorar. `false` si no hay proveedor.',
      ),
    diff: esquemaDiffRequerimiento,
    avisos: z
      .array(z.string())
      .describe(
        '⭐⭐ §Post-F9.105 — AVISOS DE ESTE RENGLÓN, para pintarlos **junto al número**. Hoy sólo ' +
          'uno: el avío que se compra POR MEDIDA y arrastra encendido "se consume por talla" de ' +
          'una captura vieja, así que su requerido sale inflado (el cierre de 53 cm capturado como ' +
          'cantidad pedía 53 veces de más, y la explosión lo compraba sin decir nada). Traen la ' +
          'MAGNITUD del descuadre, no sólo la queja. Van AQUÍ y no en `avisos` de la explosión a ' +
          'propósito: esa caja es gris, se titula "notas de precios y proveedores" y vive al pie — ' +
          'meter ahí un "estás pidiendo 53 veces de más" es mostrarlo y esconderlo a la vez. Con ' +
          'varias OP en pantalla cada aviso dice de qué orden es. Vacío = nada que advertir.',
      ),
    cambiosReceta: z
      .array(esquemaTipoCambioReceta)
      .describe(
        'Qué cambió en el modelo respecto de lo que ESTA orden congeló para este material (vacío = ' +
          'nada que avisar). Marca el renglón en el lugar de la decisión, §Post-F9.43(d).',
      ),
    // ⭐⭐ V1-E3q (§Post-F9.85) — EL NETEO CONTRA LO YA COMPRADO.
    cantidadEnOc: z
      .number()
      .describe(
        '⭐ V1-E3q: cuánto de este material YA está en una orden de compra VIVA ligada a esta OP ' +
          '(todas menos las canceladas — el borrador SÍ cuenta, porque la OC que genera esta ' +
          'pantalla nace en borrador). Sale de `comprometidoEnOc`, la única verdad del sistema ' +
          'sobre "cuánto ya compré". NO se persiste: cambia cada vez que alguien crea o cancela ' +
          'una OC, sin que nadie vuelva a explotar.',
      ),
    cantidadEnOcSinColor: z
      .number()
      .describe(
        '⭐⭐ V1-E3u (§Post-F9.89) — cuánto de `cantidadEnOc` viene de una OC que **no dice de qué ' +
          'color** era (las anteriores a la etapa). 🔴 Atribuir esa parte a ESTE color es una ' +
          'ELECCIÓN del sistema, no un dato: cuando el acervo sin color no alcanza para todos los ' +
          'tonos, el orden de las filas decide a quién le toca. La pantalla DEBE marcarlo en vez de ' +
          'pintar "ya en OC" como un hecho plano. 0 = todo el neteo salió de OC que sí dicen su color.',
      ),
    cantidadPendiente: z
      .number()
      .describe(
        '⭐ V1-E3q: lo que DE VERDAD falta comprar = max(0, cantidadAComprar − cantidadEnOc). Es ' +
          'lo único que se compra al generar la OC. Antes se compraba `cantidadAComprar` a secas, ' +
          'y por eso la pantalla dejaba generar la MISMA compra una y otra vez (Daniel, 20-ago).',
      ),
    idsRequerimiento: z
      .array(z.number().int())
      .describe(
        '⭐ V1-E3q (§Post-F9.86): ids de snapshot que este renglón AGRUPA. Con una sola OP es ' +
          '`[id]`; con varias, uno por OP. Es lo que viaja en la selección al generar las OC.',
      ),
    porOrden: z
      .array(esquemaRepartoOrden)
      .describe(
        '⭐ V1-E3q — **SE VE JUNTO, SE GUARDA REPARTIDO** (§Post-F9.86). El desglose por orden de ' +
          'producción de esta cantidad agrupada. Sin él, el "qué tengo / qué falta" de cada OP ' +
          'deja de cuadrar y el costo no cae donde debe; con una sola OP trae un elemento.',
      ),
  })
  .describe('Material requerido (agrupado entre las OP elegidas, con su reparto por OP).');

/** Forma de un renglón de explosión en la API. */
export type RequerimientoSalida = z.infer<typeof esquemaRequerimientoSalida>;

/** Grupo de requerimientos por proveedor sugerido (para comprar en un clic por proveedor). */
export const esquemaGrupoProveedorSalida = z
  .object({
    idProveedor: z.number().int().nullable().describe('Proveedor sugerido del grupo, o null.'),
    proveedor: z
      .string()
      .describe('Nombre del proveedor, o "Sin proveedor sugerido" para el grupo null.'),
    renglones: z.array(esquemaRequerimientoSalida).describe('Materiales del grupo.'),
  })
  .describe('Materiales agrupados por proveedor sugerido.');

/** Forma de un grupo por proveedor en la API. */
export type GrupoProveedorSalida = z.infer<typeof esquemaGrupoProveedorSalida>;

/** Resultado de explosionar una orden: snapshot agrupado + diff + metadatos de la orden. */
/**
 * Un renglón de la receta que la explosión NO trajo porque Desarrollo todavía no lo firma
 * (V1-E3h, §Post-F9.72). Lleva la CANTIDAD que se necesitaría, para que el aviso diga *qué* y
 * *cuánto* falta — no un "no se puede".
 */
export const esquemaPendienteLiberar = z
  .object({
    tipo: z.enum(['tela', 'avio']).describe('Sección de la receta (el arte no se compra por MRP).'),
    idRenglon: z.number().int().describe('Id del renglón de la receta de esta orden.'),
    idOrden: z
      .number()
      .int()
      .describe('⭐ V1-E3q: de QUÉ OP es el renglón (la explosión es multi-OP).'),
    folioOrden: z.number().int().describe('Folio de esa OP (para nombrarla en el aviso).'),
    idTela: z.number().int().nullable(),
    idAvio: z.number().int().nullable(),
    material: z.string().describe('Cómo se llama el material.'),
    consumoPorPrenda: z.number().describe('Consumo por prenda congelado en la receta.'),
    unidad: z.string().nullable().describe('Unidad de consumo del material, o null.'),
  })
  .describe('Material de la receta pendiente de que Desarrollo lo libere.');

/** Un material pendiente de liberar. */
export type PendienteLiberar = z.infer<typeof esquemaPendienteLiberar>;

/**
 * ⭐⭐ V1-E3u (§Post-F9.89) — **UNA TELA A LA QUE TODAVÍA NO SE LE HA DICHO DE QUÉ COLOR SE COMPRA.**
 *
 * La explosión NO se para por esto y NO adivina: la cantidad de esos colores se sigue yendo a
 * compra en un renglón **sin color** —para que la OP no se quede corta por un dato que falta
 * capturar— y aquí se dice CUÁL falta, con los nombres de los colores de la orden. Es el mismo
 * trato que §Post-F9.72 le dio a lo que falta liberar: *no desaparece en silencio* (D3).
 *
 * ⚠️ Un renglón sin color **sí se puede comprar** (así funcionó el sistema hasta hoy y así siguen
 * las 7,978 OC migradas), pero quien reciba tendrá que decir el color en la factura sin que la OC
 * lo respalde — que es exactamente la fricción que §Post-F9.89 vino a quitar.
 */
export const esquemaPendienteColor = z
  .object({
    idTela: z.number().int().describe('Tela de la receta a la que le falta decir el color.'),
    tela: z.string().describe('Nombre de la tela.'),
    idOrden: z
      .number()
      .int()
      .describe(
        '⭐ V1-E3u — DE QUÉ ORDEN es este pendiente. El color se captura sobre la receta de UNA OP, ' +
          'y con varias en pantalla (el caso que Daniel llamó *"muy muy común"*) la acción tiene que ' +
          'aterrizar en la que el renglón nombra, no en la primera de la lista.',
      ),
    folioOrden: z.number().int().describe('Folio de esa orden (para nombrarla en la pantalla).'),
    colores: z
      .array(z.string())
      .describe('Colores de la MATRIZ de la orden que todavía no tienen color de tela dicho.'),
    cantidadRequerida: z.number().describe('Tela que piden esos colores (piezas × consumo).'),
    unidad: z.string().nullable().describe('Unidad de consumo de la tela, o null.'),
  })
  .describe('Tela de la receta sin color de tela amarrado (§Post-F9.89).');

/** Forma de una tela pendiente de color. */
export type PendienteColor = z.infer<typeof esquemaPendienteColor>;

/**
 * ⭐ V1-E3q (§Post-F9.86) — UNA de las órdenes de producción que entraron a la explosión. Daniel:
 * *"chance sería bueno que en la pantalla de explosión de materiales podamos incluir ahí varias OP
 * y que vaya agrupando las cantidades"*. El `idPedido` es lo que permite la PRECARGA por pedido
 * interno (*"muchas veces se compran los avíos de un mismo pedido interno… ejemplo 1515"*).
 */
export const esquemaOrdenExplosionada = z
  .object({
    idOrden: z.number().int().describe('Orden de producción.'),
    folio: z.number().int().describe('Folio de la orden.'),
    idModelo: z.number().int().describe('Modelo de la orden.'),
    modelo: z.string().describe('Código del modelo (para la UI).'),
    totalPiezas: z.number().int().describe('Σ piezas color×talla de ESA orden.'),
    idPedido: z.number().int().nullable().describe('Pedido interno del que sale, o null.'),
    folioPedido: z.number().int().nullable().describe('Folio del pedido interno, o null.'),
    fechaEntrega: z.iso
      .date()
      .nullable()
      .describe(
        'Fecha de entrega de la orden al CLIENTE (informativa). NO es la fecha de sus OC ni la ' +
          'alimenta: la de la OC es cuándo debe llegar el material y se captura a mano ' +
          '(§Post-F9.120).',
      ),
  })
  .describe('Orden de producción incluida en la explosión.');

/** Forma de una orden incluida en la explosión. */
export type OrdenExplosionada = z.infer<typeof esquemaOrdenExplosionada>;

export const esquemaExplosionSalida = z
  .object({
    ordenes: z
      .array(esquemaOrdenExplosionada)
      .describe(
        '⭐ V1-E3q (§Post-F9.86) — TODAS las OP que entraron a esta explosión, en el orden en que ' +
          'se calcularon (por folio). Con una sola OP trae un elemento.',
      ),
    idOrden: z
      .number()
      .int()
      .describe('Primera orden del conjunto (compatibilidad: impreso y vista de una sola OP).'),
    folioOrden: z.number().int().describe('Folio de la PRIMERA orden (para la UI y el impreso).'),
    idModelo: z.number().int().describe('Modelo de la PRIMERA orden.'),
    modelo: z.string().describe('Código/nombre del modelo de la PRIMERA orden (para la UI).'),
    totalPiezas: z
      .number()
      .int()
      .describe('Σ piezas color×talla de TODAS las órdenes del conjunto (base del cálculo).'),
    grupos: z
      .array(esquemaGrupoProveedorSalida)
      .describe('Requerimientos agrupados por proveedor sugerido.'),
    huboCambios: z
      .boolean()
      .describe('¿El BOM cambió desde el snapshot anterior (hay renglones con diff ≠ sin-cambio)?'),
    regenerado: z.boolean().describe('¿Se regeneró sobre un snapshot previo (true) o es nuevo?'),
    avisos: z
      .array(z.string())
      .describe(
        'Avisos de la explosión (F8-E6, enganche): tela amarrada multi-color con precios de tela ' +
          'distintos (se usó el precio base) o avío por talla (R18) sin medida capturada para alguna ' +
          'talla (se usó el consumo por prenda). Vacío = nada que advertir. Nada truena en silencio.',
      ),
    desalineacion: esquemaDesalineacionReceta.describe(
      '⭐ PRIMER AVISO de §Post-F9.43(d): la receta CONGELADA de la orden vs. el BOM VIVO del ' +
        'modelo, calculada al vuelo y entregada AQUÍ —el lugar de la decisión— porque es donde se ' +
        'está a punto de gastar. Los renglones afectados lo repiten en `cambiosReceta`.',
    ),
    pendientesLiberar: z
      .array(esquemaPendienteLiberar)
      .describe(
        '⭐ V1-E3h (§Post-F9.72) — QUÉ NO ESTÁ EN ESTA EXPLOSIÓN Y POR QUÉ. Desde que la receta se ' +
          'libera POR PARTES, la explosión sale SOLO de los renglones firmados por Desarrollo; los ' +
          'que faltan no desaparecen en silencio (D3): se listan aquí con nombre y cantidad. Es el ' +
          'requisito textual de Daniel: que el comprador vea *"transparentemente qué le falta de ' +
          'liberar"*. Vacío = no falta nada por firmar.',
      ),
    pendientesColor: z
      .array(esquemaPendienteColor)
      .describe(
        '⭐⭐ V1-E3u (§Post-F9.89) — TELAS A LAS QUE FALTA DECIRLES DE QUÉ COLOR SE COMPRAN. No ' +
          'frena la explosión ni se adivina el color: esa cantidad va a compra en un renglón SIN ' +
          'color y aquí se dice cuál falta, para que se arregle en un clic. Vacío = todo dicho.',
      ),
  })
  .describe('Explosión de materiales de una orden (R3).');

/** Forma del resultado de explosión en la API. */
export type ExplosionSalida = z.infer<typeof esquemaExplosionSalida>;

/**
 * ⭐ V1-E3q (§Post-F9.86) — EL CONJUNTO DE OP QUE SE VA A COMPRAR. La raíz del rediseño está en
 * *qué pregunta hace la pantalla*: hoy preguntaba *"¿qué necesita ESTA OP?"* y el comprador hace
 * otra, *"¿qué necesito comprar hoy?"*, que casi nunca cabe en una sola OP. Se llena de DOS
 * maneras, con el mismo control: **precargado** con las OP del pedido interno (los avíos del 1515)
 * o **a mano**, agregando OP sueltas (las cajas, que cruzan pedidos).
 */
export const esquemaExplosionCuerpo = z
  .object({
    idsOrden: z
      .array(z.number().int().positive())
      .min(1, { error: 'Elige al menos una orden de producción' })
      .max(50, { error: 'Son demasiadas órdenes para una sola compra (máximo 50)' })
      .describe('Órdenes de producción a explotar juntas (mínimo 1).'),
  })
  .describe('Órdenes de producción que entran a la explosión (§Post-F9.86).');

/** Datos validados del cuerpo de la explosión. */
export type DatosExplosion = z.infer<typeof esquemaExplosionCuerpo>;

// ── OP del mismo PEDIDO INTERNO (precarga de §Post-F9.86) ──────────────────────────────────────

/** Una OP hermana (del mismo pedido interno) que la pantalla ofrece precargada. */
export const esquemaOrdenDelPedido = z
  .object({
    idOrden: z.number().int(),
    folio: z.number().int(),
    modelo: z.string().describe('Código del modelo.'),
    cliente: z.string().describe('Cliente de la orden.'),
    cancelada: z.boolean().describe('Las canceladas se listan pero NO se precargan.'),
  })
  .describe('Orden de producción del mismo pedido interno.');

/** Forma de una OP hermana en la API. */
export type OrdenDelPedido = z.infer<typeof esquemaOrdenDelPedido>;

/**
 * Las OP del pedido interno de una orden — la PRECARGA de §Post-F9.86 (*"muchas veces se compran
 * los avíos de un mismo pedido interno (que incluyen varias OP), ejemplo 1515"*). Si la orden no
 * cuelga de un pedido (histórico migrado), `idPedido` es null y la lista trae solo a la propia.
 */
export const esquemaOrdenesDelPedidoSalida = z
  .object({
    idPedido: z
      .number()
      .int()
      .nullable()
      .describe('Pedido interno, o null si la orden no cuelga de uno.'),
    folioPedido: z.number().int().nullable().describe('Folio del pedido interno, o null.'),
    ordenes: z.array(esquemaOrdenDelPedido).describe('OP del pedido (incluida la de la consulta).'),
  })
  .describe('Órdenes de producción del mismo pedido interno (precarga de la explosión).');

/** Forma de la precarga por pedido en la API. */
export type OrdenesDelPedidoSalida = z.infer<typeof esquemaOrdenesDelPedidoSalida>;

// ── GENERAR OC desde la explosión (R3) ────────────────────────────────────────────────────────────

/**
 * Cuerpo de "generar OC desde la explosión": la SELECCIÓN de renglones de snapshot a comprar. El
 * dominio agrupa los seleccionados por proveedor sugerido y crea UNA OC por proveedor (con el
 * requerido PENDIENTE de cada uno). Vacío = generar para TODO lo pendiente.
 */
export const esquemaGenerarOcCuerpo = z
  .object({
    // ⭐ V1-E3q (§Post-F9.86): la compra ya no es de UNA orden — es del conjunto que el comprador
    // armó en la pantalla. Va en el cuerpo y no en la URL justamente porque son varias.
    idsOrden: z
      .array(z.number().int().positive())
      .min(1, { error: 'Elige al menos una orden de producción' })
      .max(50, { error: 'Son demasiadas órdenes para una sola compra (máximo 50)' })
      .describe('Órdenes de producción que entran a esta compra (§Post-F9.86).'),
    idsRequerimiento: z
      .array(z.number().int().positive())
      .default([])
      .describe('Ids de renglones de snapshot a comprar (vacío = todo lo pendiente).'),
    // §Post-F9.18: toda OC nace con fecha de entrega y dirección del catálogo. La DIRECCIÓN es
    // opcional porque el dominio la saca del catálogo sin inventar nada (la FAVORITA).
    // 🔴 La FECHA es opcional aquí sólo porque puede venir por proveedor (`fechasPorProveedor`,
    // §Post-F9.71): **el dominio ya no la hereda de la orden de producción** (§Post-F9.120). Si no
    // llega ninguna de las dos, la generación se RECHAZA nombrando a los proveedores sin fecha.
    fechaEntrega: z.iso
      .date({ error: 'La fecha de entrega no es válida' })
      .optional()
      .describe(
        'Fecha de entrega inicial para TODAS las OC generadas. Sin ella (y sin la de cada ' +
          'proveedor) la generación se rechaza: no se hereda de la orden (§Post-F9.120).',
      ),
    idDireccionEntrega: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Dirección de entrega de las OC generadas; por omisión, la favorita del catálogo.'),
    // ⭐ §Post-F9.71 (opción A de Daniel): CADA OC LLEVA SU PROPIA FECHA. Esta pantalla crea una OC
    // POR PROVEEDOR de un clic, y la tela se necesita semanas antes que los avíos: una sola fecha
    // para todas convierte el dato en decorativo — y un dato que nadie cree no sirve para reclamar.
    // La fecha de arriba (`fechaEntrega`) es el VALOR INICIAL; lo que venga aquí GANA para ese
    // proveedor. Un proveedor sin entrada propia usa la de arriba — y si tampoco hay, NO se compra:
    // la fecha no se hereda de ningún lado (§Post-F9.120).
    fechasPorProveedor: z
      .array(
        z.object({
          idProveedor: z.number().int().positive().describe('Proveedor al que aplica la fecha.'),
          fechaEntrega: z.iso
            .date({ error: 'La fecha de entrega del proveedor no es válida' })
            .describe('Fecha de entrega de la OC de ESE proveedor (YYYY-MM-DD).'),
        }),
      )
      .optional()
      .describe(
        'Fecha de entrega POR PROVEEDOR (§Post-F9.71): gana sobre `fechaEntrega` para ese ' +
          'proveedor. Vacío = todas las OC toman la fecha de arriba; sin ninguna de las dos, la ' +
          'generación se rechaza (§Post-F9.120).',
      ),
    // ⭐ V1-E3q (§Post-F9.86) — EL SOBRANTE DE COMPRA. Daniel: *"el sobrante de compra se reparte
    // entre las OP de la compra… comprar el rollo completo es una decisión del comprador EN EL
    // MOMENTO de comprar: es un hecho entonces, y por eso sí se reparte"*. Aquí el comprador fija
    // el TOTAL de un material a un proveedor (el rollo entero, el mínimo del proveedor) y el
    // servidor lo reparte proporcionalmente entre las OP (`repartirEntreOrdenes`). La pantalla NO
    // reparte: manda el total y el dominio decide (A1).
    ajustes: z
      .array(
        z.object({
          tipo: z.enum(['tela', 'avio']).describe('Clase de material.'),
          idMaterial: z.number().int().positive().describe('Tela o avío del catálogo.'),
          idColor: z
            .number()
            .int()
            .positive()
            .nullable()
            .optional()
            .describe(
              '⭐⭐ V1-E3u (§Post-F9.89) — COLOR al que aplica el ajuste. Es la decisión (a) de ' +
                'Daniel: *"que ponga el cálculo el sistema de lo que se requiere pero que compras ' +
                'capture cada cantidad"* — y se captura POR COLOR, porque un color es un renglón. ' +
                'Omitir/`null` = el renglón sin color (lo que ya se compraba así). ' +
                '⭐⭐ V1-E8c: se llamaba `idTelaColor` y hoy es el color del RENGLÓN: de tela en las ' +
                'telas (`TelaColor`) y **de prenda en los avíos** (`Color`, §Post-F9.126). Nunca se ' +
                'confunden: viaja junto a `tipo`+`idMaterial`, que ya separan los dos mundos.',
            ),
          idProveedor: z.number().int().positive().describe('Proveedor al que se le compra.'),
          cantidadTotal: z
            .number()
            .positive({ error: 'La cantidad a comprar debe ser mayor que cero' })
            // 🔴 EL TECHO DE LA COLUMNA, dicho con palabras. `OrdenCompraLinea.cantidad` es
            // `Decimal(14, 2)`: 12 enteros + 2 decimales, o sea 999_999_999_999.99 como máximo.
            // Sin este tope un `1e13` tecleado en «Comprar» pasaba contrato y dominio y reventaba
            // en Postgres como *numeric field overflow* → un 500 genérico en la última pantalla
            // antes de comprometer dinero, en vez de una frase que diga qué pasó. (Mismo criterio
            // —y misma cuenta— que el `max` del precio de aquí abajo, `Decimal(12, 2)`.)
            .max(999_999_999_999.99, { error: 'La cantidad no cabe en la orden de compra' })
            .optional()
            .describe(
              'Total a comprar de ese material a ese proveedor (se reparte entre las OP). ' +
                'Omitir = el comprador NO tocó la cantidad y se compra la que propuso el sistema.',
            ),
          // ⭐⭐ V1-E3z (§Post-F9.94) — EL PRECIO, editable en la REVISIÓN PREVIA. Daniel:
          // *"acuérdate que al final puedo modificar precio o cantidad antes de generar la OC"*.
          // Hasta aquí el ajuste sólo llevaba cantidad, así que la última pantalla antes de
          // comprometer el dinero no podía corregir el número que MÁS importa.
          //
          // ⚠️ **NO toca el catálogo** (§Post-F9.88 lo prohíbe expresamente): el precio vive en la
          // línea de OC y nada más. Y no hace falta que lo toque: el costeo lee el último precio de
          // la línea de OC AUTORIZADA (`costos/ultimo-precio-compra.ts`, §Post-F9.48), así que un
          // precio corregido aquí se vuelve solo el "último precio de compra" en cuanto la OC se
          // autorice.
          precioUnitario: z
            .number()
            .min(0, { error: 'El precio no puede ser negativo' })
            .max(9_999_999_999.99, { error: 'El precio no cabe en la orden de compra' })
            .optional()
            .describe(
              'Precio unitario que el comprador fijó para ese material+color+proveedor (§Post-F9.94). ' +
                'Omitir = no lo tocó y manda el que resolvió el servidor. **0 SÍ es un ajuste**: ' +
                'significa que la línea nace SIN precio (se captura después en la OC), que es lo ' +
                'mismo que ya pasaba cuando la cascada no encontraba ninguno.',
            ),
          // ⭐⭐ V1-E8c (§Post-F9.126) — EL COLOR DEL AVÍO, EDITABLE ANTES DE GENERAR. Daniel:
          // *"poner 4 veces el cierre y en la descripción del avío ponerle el color"*. El sistema
          // PROPONE el nombre del color de la prenda; la persona lo corrige aquí cuando el avío va
          // en CONTRASTE — igual que ya pasa con la cantidad y el precio (§Post-F9.94).
          colorTexto: z
            .string()
            .trim()
            .max(120, { error: 'El color del avío no puede tener más de 120 caracteres' })
            .optional()
            .describe(
              '⭐⭐ V1-E8c (§Post-F9.126): el color que se va a escribir en las líneas de ese ' +
                'renglón de AVÍO, como TEXTO (el avío no lleva catálogo de color, §Post-F9.91). ' +
                'Omitir = se usa el nombre del color de la prenda. Vacío se trata igual que omitir: ' +
                'borrarlo del todo no es una instrucción, es un descuido.',
            ),
        }),
      )
      // Un ajuste que no trae ni cantidad ni precio no dice nada: aceptarlo callado dejaría al
      // comprador creyendo que cambió algo. Se rechaza con todas las letras.
      .refine(
        (items) =>
          items.every(
            (a) =>
              a.cantidadTotal !== undefined ||
              a.precioUnitario !== undefined ||
              // ⭐⭐ V1-E8c: el color también cuenta como ajuste — se puede corregir SOLO el color.
              (a.colorTexto !== undefined && a.colorTexto !== ''),
          ),
        {
          error: 'Cada ajuste tiene que traer la cantidad, el precio, el color, o varios',
        },
      )
      .optional()
      .describe(
        'Lo que el comprador ajustó a mano (§Post-F9.86 la cantidad, §Post-F9.94 el precio). Cada ' +
          'entrada REEMPLAZA lo que el sistema propuso para ese material+color+proveedor: la ' +
          'cantidad se reparte entre sus OP en proporción a lo que cada una necesita y el precio se ' +
          'aplica a TODAS sus líneas. Vacío = se compra exactamente lo pendiente, al precio resuelto.',
      ),
  })
  .describe(
    'Selección de la explosión para generar OC (una OC por proveedor, cada una con su fecha).',
  );

/** Datos validados del cuerpo de generar OC. */
export type DatosGenerarOc = z.infer<typeof esquemaGenerarOcCuerpo>;

/** Resultado de generar OC: las OC creadas (folio + proveedor + total) para confirmar al usuario. */
export const esquemaOcGeneradaSalida = z
  .object({
    idOrdenCompra: z.number().int().describe('Id de la OC creada.'),
    numCompra: z.number().int().describe('Folio de la OC creada.'),
    idProveedor: z.number().int().describe('Proveedor de la OC.'),
    proveedor: z.string().describe('Nombre del proveedor.'),
    renglones: z.number().int().describe('Número de renglones de la OC.'),
    total: z.number().describe('Total derivado de la OC.'),
  })
  .describe('Orden de compra generada desde la explosión.');

/** Forma de una OC generada en la API. */
export type OcGeneradaSalida = z.infer<typeof esquemaOcGeneradaSalida>;

// ── ⭐⭐ REVISIÓN PREVIA antes de generar (V1-E3q, §Post-F9.85) ──────────────────────────────────

/**
 * ⭐ Daniel, palabra por palabra: *"me gustaría que al darle «generar OC desde la explosión», te
 * mande a una pantalla previa, antes de generar la OC. **Una revisión previa es indispensable**"*.
 *
 * POR QUÉ un renglón se queda FUERA de la compra. Hasta V1-E3q los renglones sin proveedor se
 * omitían **en silencio** y sólo se sabía después, contando las OC que salieron. Un documento que
 * no se emite sin decir por qué es indistinguible de un error del sistema — y fue exactamente lo
 * que dejó a Daniel sin saber si su compra se había hecho.
 */
export const esquemaMotivoOmision = z
  .enum([
    'sin-proveedor',
    'ya-en-oc',
    'menor-al-minimo',
    'cubierto-por-stock',
    'no-seleccionado',
    'sin-cantidad',
  ])
  .describe(
    'sin-proveedor: no hay a quién comprárselo; ya-en-oc: la cantidad ya está en una OC viva ' +
      '(V1-E3q); menor-al-minimo: falta algo, pero menos de lo que la orden de compra puede pedir ' +
      '(0.01) y NO hay ninguna OC detrás; cubierto-por-stock: genérico que el kardex cubre; ' +
      'no-seleccionado: el usuario no lo marcó; sin-cantidad: el requerido es cero.',
  );

/** Forma del motivo de omisión en la API. */
export type MotivoOmision = z.infer<typeof esquemaMotivoOmision>;

/** Un material que NO va a entrar en las OC, con su razón dicha con todas las letras. */
export const esquemaOmitidoPlan = z
  .object({
    idRequerimiento: z.number().int().describe('Renglón de snapshot omitido.'),
    idOrden: z.number().int().describe('Orden de producción del renglón.'),
    folioOrden: z.number().int().describe('Folio de esa orden.'),
    tipo: z.enum(['tela', 'avio']).describe('Clase de material.'),
    material: z.string().describe('Nombre/clave del material.'),
    unidad: z.string().nullable(),
    cantidadAComprar: z.number().describe('Lo que pedía el snapshot (requerido − stock).'),
    cantidadEnOc: z.number().describe('Lo que ya está en OC viva (V1-E3q).'),
    cantidadEnOcSinColor: z
      .number()
      .describe(
        '⭐⭐ V1-E3u (§Post-F9.89) — cuánto de `cantidadEnOc` viene de una OC que **no dice de qué ' +
          'color** era. 🔴 En un omitido por `ya-en-oc` esto es grave: el renglón se queda FUERA de ' +
          'la compra por ese número, y si la atribución fue una elección del sistema el material ' +
          'podría quedarse sin comprar. El `detalle` lo dice cuando pasa de 0.',
      ),
    motivo: esquemaMotivoOmision,
    detalle: z.string().describe('La razón en una frase, lista para pintar.'),
  })
  .describe('Material que se queda fuera de la compra, y por qué.');

/** Forma de un omitido en la API. */
export type OmitidoPlan = z.infer<typeof esquemaOmitidoPlan>;

/** Reparto por OP de UN renglón de la OC que se va a crear (una línea real por cada uno). */
export const esquemaPlanLineaOrden = z
  .object({
    idRequerimiento: z.number().int(),
    idOrden: z.number().int(),
    folioOrden: z.number().int().describe('⭐ DE QUÉ OP es esta cantidad (§Post-F9.86).'),
    cantidad: z.number().describe('Cantidad que se va a escribir en SU línea de OC.'),
    cantidadPropuesta: z
      .number()
      .describe(
        '⭐ V1-E3u (§Post-F9.89(a)): lo que el SISTEMA calculó para ESA línea, antes de cualquier ' +
          'ajuste del comprador. Se guarda en la línea de OC (`cantidadSugerida`) y es contra lo ' +
          'que la bandeja de autorización mide el desvío. El desvío AVISA, no bloquea.',
      ),
    precio: z.number().describe('Precio unitario con el que nace esa línea.'),
    importe: z.number().describe('cantidad × precio.'),
    medidas: z
      .array(esquemaMedidaDesglose)
      .describe(
        '⭐⭐ V1-E8c (§Post-F9.126): el desglose por medida que se va a GUARDAR en esta línea de OC. ' +
          '**Σ de sus cantidades = `cantidad` de la línea, exactamente** (se reparte con la misma ' +
          'función que reparte la compra entre las OP). Vacío = el avío no se pide por medida.',
      ),
    seEscribe: z
      .boolean()
      .describe(
        '⭐ V1-E3z — ¿esta línea SÍ se va a escribir? `false` = su cantidad no llega al mínimo que ' +
          'la orden de compra puede guardar (0.01), así que la generación la salta (una línea en ' +
          '`0.00` no es una compra). Viaja porque desde §Post-F9.94 la cantidad se edita AQUÍ: al ' +
          'bajar un total, alguna OP puede quedarse en cero, y la previa tiene que decirlo en vez ' +
          'de prometer una línea que nadie va a escribir.',
      ),
  })
  .describe('Línea de OC que le corresponde a una OP (el reparto que sí se guarda).');

/** Forma de una línea repartida en la API. */
export type PlanLineaOrden = z.infer<typeof esquemaPlanLineaOrden>;

/** Un material dentro de la OC que se va a crear: el total agrupado + su reparto por OP. */
export const esquemaPlanRenglon = z
  .object({
    tipo: z.enum(['tela', 'avio']),
    idMaterial: z.number().int().describe('Tela o avío del catálogo (según `tipo`).'),
    idTelaColor: z
      .number()
      .int()
      .nullable()
      .describe(
        '⭐⭐ V1-E3u: color de tela que se va a pedir en esta línea (§Post-F9.89), o null.',
      ),
    telaColor: z.string().nullable().describe('Nombre del color, o null.'),
    idColorPrenda: z
      .number()
      .int()
      .nullable()
      .describe('⭐⭐ V1-E8c (§Post-F9.126): color de PRENDA del renglón de AVÍO, o null.'),
    colorPrenda: z
      .string()
      .nullable()
      .describe('Nombre de ese color de prenda — lo que el sistema PROPONE como texto, o null.'),
    colorTexto: z
      .string()
      .nullable()
      .describe(
        '⭐⭐ V1-E8c (§Post-F9.126): el color que se va a ESCRIBIR en las líneas de este renglón — ' +
          'lo que el proveedor lee. Nace del color de la prenda y el comprador lo puede corregir ' +
          'aquí (el avío puede ir en contraste). `null` = no hay color que decir.',
      ),
    colorAjustado: z.boolean().describe('¿El comprador cambió el color propuesto (§Post-F9.126)?'),
    medidas: z
      .array(esquemaMedidaDesglose)
      .describe(
        '⭐⭐ V1-E8c (§Post-F9.126): el desglose por medida del renglón = Σ de los de las líneas que ' +
          'SÍ se escriben (mismo criterio que `importe`). Vacío = no se pide por medida.',
      ),
    cantidadEnOcSinColor: z
      .number()
      .describe(
        '⭐⭐ V1-E3u (§Post-F9.89) — de lo ya comprado que se le restó a este renglón, cuánto vino ' +
          'de una OC que **no dice de qué color** era. Viaja hasta la previa porque **es la última ' +
          'pantalla antes de comprometer el dinero**: la cantidad que se va a comprar salió de ' +
          'restar ese número, y atribuirlo a este color fue una ELECCIÓN del sistema, no un dato ' +
          'de la orden. 0 = nada que advertir.',
      ),
    material: z.string(),
    unidad: z.string().nullable(),
    cantidadTotal: z.number().describe('Lo que se va a pedir de este material (Σ del reparto).'),
    cantidadPropuesta: z
      .number()
      .describe('Lo que el sistema propuso antes de cualquier ajuste del comprador.'),
    ajustado: z.boolean().describe('¿El comprador cambió el total (sobrante de compra)?'),
    // ── ⭐⭐ V1-E3z (§Post-F9.94) — EL PRECIO DEL RENGLÓN, para poder editarlo aquí ──
    precioUnitario: z
      .number()
      .nullable()
      .describe(
        'Precio unitario con el que va a nacer este renglón — el número que la previa pinta en su ' +
          'campo editable. `null` = sus líneas traen precios DISTINTOS entre sí (no hay uno solo ' +
          'que enseñar); fijar uno aquí se lo pone a todas.',
      ),
    precioPropuesto: z
      .number()
      .nullable()
      .describe(
        'Lo que el SISTEMA resolvió antes de que el comprador tocara nada (`null` = sus líneas ' +
          'traían precios distintos). Es contra lo que se lee «precio ajustado».',
      ),
    precioAjustado: z
      .boolean()
      .describe('¿El comprador fijó el precio de este renglón a mano (§Post-F9.94)?'),
    importe: z.number().describe('Σ de los importes del reparto.'),
    porOrden: z.array(esquemaPlanLineaOrden).describe('El reparto por OP (§Post-F9.86).'),
  })
  .describe('Material de la OC que se va a crear (se ve junto, se guarda repartido).');

/** Forma de un renglón del plan en la API. */
export type PlanRenglon = z.infer<typeof esquemaPlanRenglon>;

/** Una OC completa tal como quedaría — el corazón de la revisión previa. */
export const esquemaPlanProveedor = z
  .object({
    idProveedor: z.number().int(),
    proveedor: z.string(),
    fechaEntrega: z.iso.date().nullable().describe('Fecha con la que nacería (null = falta).'),
    renglones: z.array(esquemaPlanRenglon),
    total: z.number().describe('Total de la OC (Σ importes).'),
    ordenes: z
      .array(z.number().int())
      .describe('Folios de las OP que esta OC va a surtir (§Post-F9.86).'),
  })
  .describe('Orden de compra que se va a crear, completa, ANTES de crearla.');

/** Forma del plan de una OC en la API. */
export type PlanProveedor = z.infer<typeof esquemaPlanProveedor>;

/**
 * ⭐ **LA REVISIÓN PREVIA** (§Post-F9.85). Enseña, ANTES de comprometer nada: qué OC va a salir, a
 * qué proveedor, con qué renglones y cantidades, **de qué OP es cada cantidad**, y lo que se va a
 * OMITIR con su razón. Lo calcula EXACTAMENTE el mismo código que luego genera (`planearCompra`):
 * una revisión previa que no fuera el mismo cálculo sería una promesa que el sistema no cumple.
 */
export const esquemaPlanCompra = z
  .object({
    ordenes: z.array(esquemaOrdenExplosionada).describe('Las OP que entran a esta compra.'),
    proveedores: z.array(esquemaPlanProveedor).describe('Una entrada por OC que se va a crear.'),
    omitidos: z
      .array(esquemaOmitidoPlan)
      .describe('Lo que NO va a entrar, con su razón (nada se omite en silencio, D3).'),
    bloqueos: z
      .array(z.string())
      .describe(
        'Lo que IMPIDE generar (falta la dirección de entrega, falta la fecha de un proveedor…). ' +
          'Vacío = se puede confirmar. Si se intenta generar con bloqueos, el servidor lo rechaza ' +
          'con estas mismas frases: la pantalla no decide, sólo las pinta antes de tiempo.',
      ),
    avisos: z
      .array(z.string())
      .describe(
        '⭐⭐ V1-E4c/V1-E4d — LO QUE NO IMPIDE COMPRAR PERO HAY QUE SABER ANTES DE FIRMAR: las telas ' +
          'que se van a pedir SIN decir de qué color, y los materiales que NO entran porque ' +
          'Desarrollo todavía no los libera. Daniel, 23-ago-2026: *"primero que dé la ' +
          'opción de meterlo, y si no se hace, entonces que mande los mensajes en amarillo"* — por ' +
          'eso el aviso vive AQUÍ, en el paso de avanzar, y no en la entrada de la explosión (donde ' +
          'nueve avisos apilados hacían parecer que capturar era un error). Sólo trae lo que de ' +
          'verdad quedó sin llenar **y sí se va a escribir**: un renglón que no genera línea no ' +
          'produce aviso. Vacío = nada que advertir. NO bloquea (una tela sin color se ha comprado ' +
          'así siempre, y así siguen las 7,978 OC migradas).',
      ),
    totalGeneral: z.number().describe('Σ de los totales de todas las OC del plan.'),
  })
  .describe('Revisión previa de las órdenes de compra que se van a generar (§Post-F9.85).');

/** Forma del plan completo en la API. */
export type PlanCompra = z.infer<typeof esquemaPlanCompra>;

/** Respuesta de generar OC: la lista de OC creadas (una por proveedor). */
export const esquemaGenerarOcResultado = z
  .object({
    ordenesCompra: z
      .array(esquemaOcGeneradaSalida)
      .describe('OC creadas (una por proveedor con pendiente seleccionado).'),
    omitidos: z
      .array(esquemaOmitidoPlan)
      .describe(
        '⭐ V1-E3q: lo que se quedó FUERA de las OC creadas, con su razón. Antes se omitía en ' +
          'silencio y el usuario no tenía cómo saberlo.',
      ),
  })
  .describe('Resultado de generar OC desde la explosión.');

/** Forma del resultado de generar OC en la API. */
export type GenerarOcResultado = z.infer<typeof esquemaGenerarOcResultado>;

// ── ⭐ ASIGNAR PROVEEDOR desde la explosión (V1-E3m, §Post-F9.82) ────────────────────────────────

/**
 * ⭐ **EL COMPRADOR DESATORA DESDE SU PANTALLA — SOLO PARA ESA OP.** Daniel: *"el comprador podría
 * asignarle un proveedor y no esperar a que la gente de desarrollo se lo asigne"*, con la
 * restricción textual e innegociable: *"asigna un proveedor **para esa OP en particular**… no para
 * siempre ni para todo. **El proveedor puede seguir viniendo desde desarrollo**"*.
 *
 * Por eso este cuerpo **no lleva nada del catálogo**: identifica el MATERIAL (tela XOR avío) dentro
 * de UNA orden —la de la URL— y la asignación se guarda en la receta congelada de esa orden. El
 * catálogo no se toca nunca. `idProveedor: null` = QUITAR la asignación (volver a lo que diga el
 * catálogo); es una acción explícita y no un borrado silencioso.
 */
export const esquemaAsignarProveedorCuerpo = z
  .object({
    tipo: z.enum(['tela', 'avio']).describe('Qué clase de material se está asignando.'),
    idMaterial: z
      .number({ error: 'El id del material es obligatorio' })
      .int({ error: 'El id del material debe ser entero' })
      .positive({ error: 'El id del material debe ser positivo' })
      .describe('Id de la TELA o del AVÍO del catálogo (según `tipo`).'),
    idProveedor: z
      .number({ error: 'El id del proveedor debe ser un número' })
      .int({ error: 'El id del proveedor debe ser entero' })
      .positive({ error: 'El id del proveedor debe ser positivo' })
      .nullable()
      .describe('Proveedor a asignar PARA ESTA ORDEN, o null para quitar la asignación.'),
    precio: z
      .number({ error: 'El precio debe ser un número' })
      .nonnegative({ error: 'El precio no puede ser negativo' })
      .nullable()
      .optional()
      .describe(
        'Precio por unidad de consumo con el que se va a comprar (opcional). Si viene, MANDA sobre ' +
          'la última compra real: lo tecleó alguien para esta compra. Si no, se resuelve solo.',
      ),
  })
  .describe('Asignación de proveedor de un material PARA UNA ORDEN (§Post-F9.82).');

/** Datos validados de la asignación de proveedor. */
export type DatosAsignarProveedor = z.infer<typeof esquemaAsignarProveedorCuerpo>;

/** Cómo quedó la asignación (para confirmar en pantalla lo que se guardó). */
export const esquemaAsignarProveedorSalida = z
  .object({
    idOrden: z.number().int().describe('Orden de producción donde vive la asignación.'),
    tipo: z.enum(['tela', 'avio']).describe('Clase de material.'),
    idMaterial: z.number().int().describe('Tela o avío asignado.'),
    material: z.string().describe('Nombre/clave del material (para el mensaje).'),
    idProveedor: z.number().int().nullable().describe('Proveedor asignado, o null si se quitó.'),
    proveedor: z.string().nullable().describe('Nombre del proveedor asignado, o null.'),
    precio: z.number().nullable().describe('Precio capturado por Compras, o null.'),
  })
  .describe('Resultado de asignar (o quitar) el proveedor de un material en una orden.');

/** Forma del resultado de asignar proveedor en la API. */
export type AsignarProveedorSalida = z.infer<typeof esquemaAsignarProveedorSalida>;

// ── ⭐ ASIGNAR PROVEEDOR A VARIOS DE UN GOLPE (V1-E3x, §Post-F9.88) ──────────────────────────────

/**
 * ⭐ **EL MISMO PROVEEDOR PARA VARIOS RENGLONES, EN UN SOLO ACTO** (V1-E3x, §Post-F9.88). Daniel,
 * 21-ago-2026: *"cuando no tengan proveedor los avíos, ya en la pantalla de explosión, podemos hacer
 * una forma de poder poner el proveedor de manera más rápida a varios elementos que lleven el mismo
 * proveedor"*.
 *
 * **Por qué EN BLOQUE aquí sí se vale, y firmar la receta no** (§Post-F9.80): *lo que se puede hacer
 * en bloque es lo que **no compromete dinero***. Asignar proveedor no compra nada — la OC todavía
 * pasa por la revisión previa (§Post-F9.85) y por su autorización.
 *
 * Tres restricciones que este cuerpo hace CUMPLIR por su forma, no por un comentario:
 *  • **cada asignación nombra su ORDEN**: la asignación vive en la receta congelada de UNA orden
 *    (§Post-F9.82) y NUNCA en el catálogo. No hay forma de mandar "para todas las órdenes" ni "para
 *    siempre": el llamador enumera exactamente en qué órdenes escribe;
 *  • **un solo `idProveedor`, y NO nullable**: en bloque sólo se PONE. Quitar sigue siendo renglón
 *    por renglón — es deshacer una decisión puntual, y se lleva el precio con ella;
 *  • **sin precio**: el precio es de CADA material (un número para seis avíos distintos sería
 *    falso). Se captura renglón por renglón, o lo resuelve el catálogo.
 */
export const esquemaAsignarProveedorEnBloqueCuerpo = z
  .object({
    asignaciones: z
      .array(
        z.object({
          idOrden: z
            .number({ error: 'El id de la orden es obligatorio' })
            .int({ error: 'El id de la orden debe ser entero' })
            .positive({ error: 'El id de la orden debe ser positivo' })
            .describe('Orden de producción en cuya receta se guarda la asignación.'),
          tipo: z.enum(['tela', 'avio']).describe('Qué clase de material se está asignando.'),
          idMaterial: z
            .number({ error: 'El id del material es obligatorio' })
            .int({ error: 'El id del material debe ser entero' })
            .positive({ error: 'El id del material debe ser positivo' })
            .describe('Id de la TELA o del AVÍO del catálogo (según `tipo`).'),
        }),
      )
      .min(1, { error: 'Hay que elegir al menos un material.' })
      // Tope alto pero REAL: la explosión más grande no llega ni de lejos, y sin tope un cuerpo
      // enorme mantendría la transacción abierta más de lo sano.
      .max(500, { error: 'Son demasiados renglones para un solo acto (máximo 500).' })
      .describe('Renglones de receta a los que se les pone el MISMO proveedor (orden + material).'),
    idProveedor: z
      .number({ error: 'El proveedor es obligatorio' })
      .int({ error: 'El id del proveedor debe ser entero' })
      .positive({ error: 'El id del proveedor debe ser positivo' })
      .describe('El proveedor que se le pone a TODOS los renglones del acto.'),
  })
  .describe('Asignación EN BLOQUE de un proveedor a varios renglones de receta (§Post-F9.88).');

/** Datos validados de la asignación en bloque. */
export type DatosAsignarProveedorEnBloque = z.infer<typeof esquemaAsignarProveedorEnBloqueCuerpo>;

/** Cómo quedó el acto en bloque (para confirmarlo en pantalla, con nombres y no sólo números). */
export const esquemaAsignarProveedorEnBloqueSalida = z
  .object({
    idLote: z
      .string()
      .describe(
        'Id del ACTO (A7): los N renglones de la bitácora lo comparten, para que se lean como uno.',
      ),
    idProveedor: z.number().int().describe('Proveedor que quedó en todos los renglones.'),
    proveedor: z.string().describe('Nombre del proveedor (para el mensaje).'),
    renglones: z.number().int().describe('Cuántos renglones de receta se escribieron.'),
    ordenes: z.number().int().describe('En cuántas órdenes de producción se escribió.'),
    asignados: z
      .array(
        z.object({
          idOrden: z.number().int().describe('Orden donde quedó la asignación.'),
          folioOrden: z.number().int().describe('Folio de esa orden (para el mensaje).'),
          tipo: z.enum(['tela', 'avio']).describe('Clase de material.'),
          idMaterial: z.number().int().describe('Tela o avío asignado.'),
          material: z.string().describe('Nombre/clave del material.'),
        }),
      )
      .describe('El detalle de lo que se escribió, renglón por renglón.'),
  })
  .describe('Resultado de asignar un proveedor a varios renglones de un golpe.');

/** Forma del resultado de la asignación en bloque en la API. */
export type AsignarProveedorEnBloqueSalida = z.infer<typeof esquemaAsignarProveedorEnBloqueSalida>;

// ── ESTATUS de materiales (R7) ──────────────────────────────────────────────────────────────────

/** Estado del semáforo de un material requerido (cruce requerido/en-oc/recibido, R7). */
export const esquemaEstatusMaterial = z
  .enum(['pendiente', 'en-oc', 'recibido-parcial', 'completo', 'cubierto-por-stock'])
  .describe(
    'pendiente: nada en OC; en-oc: hay OC pero nada recibido; recibido-parcial: algo recibido; ' +
      'completo: recibido ≥ requerido; cubierto-por-stock: genérico cubierto sin compra.',
  );

/** Forma del estatus de un material en la API. */
export type EstatusMaterial = z.infer<typeof esquemaEstatusMaterial>;

/** Renglón del tablero "qué tengo / qué falta" de un material requerido (R7). */
export const esquemaEstatusMaterialFila = z
  .object({
    tipo: z.enum(['tela', 'avio', 'no-identificado']).describe('Tipo de material.'),
    idTela: z.number().int().nullable().describe('Tela del catálogo, o null.'),
    idAvio: z.number().int().nullable().describe('Avío del catálogo, o null.'),
    material: z.string().describe('Nombre/clave del material (para la UI).'),
    unidad: z.string().nullable().describe('Unidad de consumo, o null.'),
    requerido: z.number().describe('Cantidad requerida (snapshot, R3). 0 en no-identificado.'),
    enOc: z.number().describe('Σ cantidades en OC no canceladas ligadas a la orden.'),
    recibido: z.number().describe('Σ recibido (recepciones activas) de esas líneas.'),
    estatus: esquemaEstatusMaterial,
  })
  .describe('Estado de un material requerido por la orden (R7).');

/** Forma de una fila del tablero en la API. */
export type EstatusMaterialFila = z.infer<typeof esquemaEstatusMaterialFila>;

/** Tablero "qué tengo / qué falta" de una orden (R7) — criterio de salida de la fase. */
export const esquemaEstatusMaterialesSalida = z
  .object({
    idOrden: z.number().int().describe('Orden de producción.'),
    folioOrden: z.number().int().describe('Folio de la orden (para la UI).'),
    tieneSnapshot: z
      .boolean()
      .describe('¿La orden ya fue explosionada (hay snapshot)? Si no, el cruce está vacío.'),
    filas: z.array(esquemaEstatusMaterialFila).describe('Materiales con su semáforo.'),
  })
  .describe('Cruce requerido/en-oc/recibido por material de una orden (R7).');

/** Forma del tablero de estatus en la API. */
export type EstatusMaterialesSalida = z.infer<typeof esquemaEstatusMaterialesSalida>;
