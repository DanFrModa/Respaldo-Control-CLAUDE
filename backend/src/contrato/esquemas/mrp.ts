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
      .describe('Fecha de entrega de la orden (respaldo de la fecha de sus OC).'),
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
    // §Post-F9.18: toda OC nace con fecha de entrega y dirección del catálogo. Aquí son OPCIONALES
    // porque el dominio tiene de dónde sacarlas sin inventar nada: la fecha de entrega de la ORDEN
    // de producción y la dirección FAVORITA del catálogo. Si se manda, gana lo que se manda.
    fechaEntrega: z.iso
      .date({ error: 'La fecha de entrega no es válida' })
      .optional()
      .describe('Fecha de entrega de las OC generadas; por omisión, la de la orden de producción.'),
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
    // proveedor. Un proveedor sin entrada propia usa la de arriba (y si tampoco hay, la de la orden).
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
          'proveedor. Vacío = todas las OC toman la fecha de arriba (o la de la orden).',
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
          idProveedor: z.number().int().positive().describe('Proveedor al que se le compra.'),
          cantidadTotal: z
            .number()
            .positive({ error: 'La cantidad a comprar debe ser mayor que cero' })
            .describe('Total a comprar de ese material a ese proveedor (se reparte entre las OP).'),
        }),
      )
      .optional()
      .describe(
        'Totales ajustados a mano por el comprador (§Post-F9.86). Cada uno REEMPLAZA la suma ' +
          'propuesta de ese material+proveedor y se reparte entre sus OP en proporción a lo que ' +
          'cada una necesita. Vacío = se compra exactamente lo pendiente.',
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
    precio: z.number().describe('Precio unitario con el que nace esa línea.'),
    importe: z.number().describe('cantidad × precio.'),
  })
  .describe('Línea de OC que le corresponde a una OP (el reparto que sí se guarda).');

/** Forma de una línea repartida en la API. */
export type PlanLineaOrden = z.infer<typeof esquemaPlanLineaOrden>;

/** Un material dentro de la OC que se va a crear: el total agrupado + su reparto por OP. */
export const esquemaPlanRenglon = z
  .object({
    tipo: z.enum(['tela', 'avio']),
    idMaterial: z.number().int().describe('Tela o avío del catálogo (según `tipo`).'),
    material: z.string(),
    unidad: z.string().nullable(),
    cantidadTotal: z.number().describe('Lo que se va a pedir de este material (Σ del reparto).'),
    cantidadPropuesta: z
      .number()
      .describe('Lo que el sistema propuso antes de cualquier ajuste del comprador.'),
    ajustado: z.boolean().describe('¿El comprador cambió el total (sobrante de compra)?'),
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
