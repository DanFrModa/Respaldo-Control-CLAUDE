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
  })
  .describe('Material requerido por la orden (snapshot de explosión).');

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
    idTela: z.number().int().nullable(),
    idAvio: z.number().int().nullable(),
    material: z.string().describe('Cómo se llama el material.'),
    consumoPorPrenda: z.number().describe('Consumo por prenda congelado en la receta.'),
    unidad: z.string().nullable().describe('Unidad de consumo del material, o null.'),
  })
  .describe('Material de la receta pendiente de que Desarrollo lo libere.');

/** Un material pendiente de liberar. */
export type PendienteLiberar = z.infer<typeof esquemaPendienteLiberar>;

export const esquemaExplosionSalida = z
  .object({
    idOrden: z.number().int().describe('Orden de producción explosionada.'),
    folioOrden: z.number().int().describe('Folio de la orden (para la UI).'),
    idModelo: z.number().int().describe('Modelo de la orden.'),
    modelo: z.string().describe('Código/nombre del modelo (para la UI).'),
    totalPiezas: z.number().int().describe('Σ piezas color×talla de la orden (base del cálculo).'),
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

// ── GENERAR OC desde la explosión (R3) ────────────────────────────────────────────────────────────

/**
 * Cuerpo de "generar OC desde la explosión": la SELECCIÓN de renglones de snapshot a comprar. El
 * dominio agrupa los seleccionados por proveedor sugerido y crea UNA OC por proveedor (con el
 * requerido PENDIENTE de cada uno). Vacío = generar para TODO lo pendiente.
 */
export const esquemaGenerarOcCuerpo = z
  .object({
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

/** Respuesta de generar OC: la lista de OC creadas (una por proveedor). */
export const esquemaGenerarOcResultado = z
  .object({
    ordenesCompra: z
      .array(esquemaOcGeneradaSalida)
      .describe('OC creadas (una por proveedor con pendiente seleccionado).'),
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
