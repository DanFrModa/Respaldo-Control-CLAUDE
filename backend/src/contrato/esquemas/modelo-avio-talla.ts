import { z } from 'zod';

/**
 * Contrato Zod del sub-recurso MEDIDAS POR TALLA de un avío del BOM (F8-E1, R18).
 *
 * Para CIERTOS avíos (cierres, elástico…) el consumo NO es único por prenda: se captura POR
 * TALLA. Este contrato modela el toggle `ModeloAvio.consumoPorTalla` + la tabla de medidas
 * `ModeloAvioTalla` (una fila por talla). Doc funcional:
 * `Documentacion_MJD/PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md` (R18).
 *
 * El endpoint de guardado es SET-COMPLETO (como los renglones del BOM en F1-E4): la lista de
 * `tallas` SIEMPRE reemplaza el set actual (el dominio sincroniza agrega/quita/actualiza en una
 * transacción A2). El toggle y las medidas van JUNTOS en el mismo payload.
 *
 * ⚠️ Por eso una talla SIN capturar NO se manda: el set-completo significa "lo que no viene, no
 * está". Mandarla con `consumo: 0` crearía una fila real de cero que el precosto mete al promedio
 * y que el MRP toma como requerimiento cero (matando su aviso de talla sin medida). Un `0` en el
 * payload es siempre un cero CAPTURADO a propósito.
 *
 * Decisiones cerradas (D13):
 *  • El precosto (E3) usa el PROMEDIO SIMPLE de estas medidas (decisión (g)); el MRP (E6) compra
 *    por medida×curva. Aquí solo se captura/lee; el consumo del precosto no se calcula en este
 *    contrato.
 *  • `consumo` decimal ≥ 0 (Prisma lo guarda como `Decimal(12,4)`); sale como `number`.
 *  • Al apagar el toggle, la lista de tallas sigue reemplazando el set: si se manda `tallas:[]` se
 *    vacían las medidas; si se mandan tallas con `consumoPorTalla=false`, quedan LATENTES (se
 *    guardan aunque el toggle esté off — se reusan si se vuelve a encender).
 *
 * ⭐ **V1-E3g (§Post-F9.66) — hay DOS modos de captura y nunca los dos a la vez.** Daniel lo
 * encontró capturando un cierre: el número por talla no siempre significa lo mismo.
 *
 *  • `modoCaptura: 'consumo'` — el avío se gasta por talla (elástico, jareta): se captura CUÁNTO,
 *    en `Avio.unidad` (0.75 m en CH, 0.80 en M). Se multiplica por piezas y por precio.
 *  • `modoCaptura: 'medida'`  — el avío tiene un CATÁLOGO de medidas (cierres): por talla se elige
 *    QUÉ se pide (el cierre de 53 cm). La cantidad no varía —es `consumoPorPrenda`, 1 pza— así que
 *    `consumoPorTalla` queda en **false** y el requerido se calcula por prenda, no por talla.
 *
 * Por eso `consumo` es OPCIONAL en la entrada: en modo `medida` ni se captura ni se muestra.
 */

/** Consumo por talla: número ≥ 0 (Prisma lo guarda como `Decimal(12,4)`). */
const esquemaConsumoTalla = z
  .number({ error: 'El consumo debe ser un número' })
  .nonnegative({ error: 'El consumo no puede ser negativo' });

/**
 * Renglón de captura de una medida por talla: la talla del catálogo y su `consumo`. La unicidad
 * de la talla DENTRO del avío la valida el esquema del set (sin repetir) y la respalda la PK
 * compuesta `[idModelo, idAvio, idTalla]`.
 */
export const esquemaModeloAvioTallaEntrada = z.object({
  idTalla: z
    .number({ error: 'El id de la talla es obligatorio' })
    .int({ error: 'El id de la talla debe ser entero' })
    .positive({ error: 'El id de la talla debe ser positivo' }),
  /**
   * CANTIDAD que se consume en esta talla, en `Avio.unidad` (R18). **Opcional desde V1-E3g**: en un
   * avío en modo `medida` (cierres) no se captura —la cantidad es la del renglón— y el dominio la
   * rellena solo. En modo `consumo` es OBLIGATORIA y el dominio la exige.
   */
  consumo: esquemaConsumoTalla.optional(),
  /**
   * AMARRE medida×talla (R5/B11): qué `AvioMedida` (tamaño real: "15 cm", "18 cm") usa esta talla,
   * para que la compra/MRP desglose con el precio real de la medida. `null` = sin amarre. El
   * dominio valida que la medida sea DE ESE avío y esté activa.
   */
  idAvioMedida: z
    .number({ error: 'El id de la medida debe ser un número' })
    .int({ error: 'El id de la medida debe ser entero' })
    .positive({ error: 'El id de la medida debe ser positivo' })
    .nullable()
    .default(null),
});

/** Datos validados de un renglón de medida por talla. */
export type DatosModeloAvioTallaEntrada = z.infer<typeof esquemaModeloAvioTallaEntrada>;

/**
 * Cuerpo para GUARDAR (set-completo) las medidas por talla de un avío del BOM
 * (`PUT /api/modelos/:idModelo/avios/:idAvio/medidas`): el toggle `consumoPorTalla` + la lista de
 * `tallas` (sin `idTalla` repetido; puede ir VACÍA). El dominio sincroniza en UNA transacción A2.
 */
export const esquemaMedidasAvioGuardar = z
  .object({
    consumoPorTalla: z.boolean({ error: 'consumoPorTalla debe ser verdadero o falso' }),
    tallas: z
      .array(esquemaModeloAvioTallaEntrada)
      .max(200, { error: 'Demasiadas tallas en las medidas del avío' })
      .refine((items) => new Set(items.map((i) => i.idTalla)).size === items.length, {
        error: 'Hay tallas repetidas en las medidas del avío',
      }),
  })
  .describe('Set completo de medidas por talla de un avío del BOM del modelo.');

/** Datos validados del cuerpo de guardar medidas por talla. */
export type DatosMedidasAvioGuardar = z.infer<typeof esquemaMedidasAvioGuardar>;

/**
 * Salida de UNA medida por talla (con la etiqueta de la talla embebida para la UI) + el AMARRE a
 * la `AvioMedida` (R5/B11). Los renglones NACEN de la CURVA del modelo: una talla de la curva sin
 * medida capturada sale con `consumo: null` (y `enCurva: true`), para que la matriz exista SIEMPRE
 * que haya curva. Una talla capturada que ya NO está en la curva (curva cambiada después) sale con
 * `enCurva: false` para que la UI la muestre marcada en vez de perderla en silencio.
 *
 * 🔑 `consumo` es NULLABLE **a propósito** y la diferencia es de negocio, no cosmética:
 *  • `null` = la talla existe en la curva pero NADIE le ha capturado medida. NO hay fila en BD, no
 *    entra al promedio del precosto y el MRP la reporta en `tallasSinMedida` (cae a
 *    `consumoPorPrenda`).
 *  • `0`    = alguien capturó CERO a propósito (esa talla no lleva el avío). SÍ hay fila, SÍ entra
 *    al promedio y el MRP requiere cero sin avisar.
 * Confundirlos hunde el precosto (un promedio con ceros fantasma) y apaga el aviso del MRP.
 */
export const esquemaModeloAvioTallaSalida = z
  .object({
    idTalla: z.number().int().describe('Id de la talla.'),
    etiquetaTalla: z.string().describe('Etiqueta de la talla (para la UI).'),
    consumo: z
      .number()
      .nullable()
      .describe(
        'CANTIDAD capturada del avío para esta talla (en `Avio.unidad`); null = sin capturar (no ' +
          'hay fila). NO es la medida/especificación: eso es `idAvioMedida`.',
      ),
    enCurva: z.boolean().describe('¿La talla pertenece a la curva vigente del modelo?'),
    idAvioMedida: z
      .number()
      .int()
      .nullable()
      .describe('Amarre R5/B11: medida del avío que usa esta talla, o null.'),
    medidaAmarrada: z.string().nullable().describe('Etiqueta de la medida amarrada, o null.'),
    precioMedida: z.number().nullable().describe('Precio de la medida amarrada, o null.'),
  })
  .describe('Renglón por talla de un avío del BOM: su CANTIDAD y/o su MEDIDA amarrada.');

/** Forma de una medida por talla tal como la devuelve la API. */
export type ModeloAvioTallaSalida = z.infer<typeof esquemaModeloAvioTallaSalida>;

/**
 * MODO DE CAPTURA por talla de un avío (V1-E3g, §Post-F9.66). Lo DERIVA el servidor de un solo
 * hecho: ¿el avío tiene medidas ACTIVAS en su catálogo (`AvioMedida`)?
 *
 *  • `medida`  — sí las tiene ⇒ es un avío "por medida" (un cierre): por talla se elige QUÉ se
 *    pide. La cantidad no varía por talla, así que `consumoPorTalla` se mantiene en false.
 *  • `consumo` — no las tiene ⇒ por talla se captura CUÁNTO se gasta, en `Avio.unidad`.
 *
 * Es el mismo hecho con el que el precosto decide usar el PROMEDIO de las medidas
 * (`resolucion-precios.ts`): una sola definición de "avío por medida" en todo el sistema.
 */
export const esquemaModoCapturaTalla = z
  .enum(['consumo', 'medida'])
  .describe('¿Por talla se captura la CANTIDAD (consumo) o la ESPECIFICACIÓN (medida)?');

/** Modo de captura por talla de un avío. */
export type ModoCapturaTalla = z.infer<typeof esquemaModoCapturaTalla>;

/**
 * Salida completa de las medidas por talla de un avío del BOM (respuesta de los endpoints GET y
 * PUT): el renglón (modelo, avío), el toggle `consumoPorTalla` y las `tallas` con su medida,
 * ordenadas por el orden canónico de la talla y luego por etiqueta.
 */
export const esquemaModeloAvioMedidasSalida = z
  .object({
    idModelo: z.number().int().describe('Id del modelo.'),
    idAvio: z.number().int().describe('Id del avío (renglón del BOM).'),
    consumoPorTalla: z.boolean().describe('¿Este avío se consume por talla (R18)?'),
    /**
     * ¿El MODELO tiene curva de tallas asignada? Es el dato con el que la UI decide si puede
     * ofrecer la matriz o debe pedir que se le asigne una curva: antes se deducía —mal— de que la
     * lista viniera vacía, y el aviso "el modelo no tiene curva" salía incluso con curva puesta.
     */
    tieneCurva: z.boolean().describe('¿El modelo tiene curva de tallas asignada?'),
    modoCaptura: esquemaModoCapturaTalla,
    unidadConsumo: z
      .string()
      .nullable()
      .describe('`Avio.unidad` — la unidad del CONSUMO (m, pza…). La UI la pega al campo.'),
    unidadMedida: z
      .string()
      .nullable()
      .describe('`Avio.unidadMedida` — la unidad de las MEDIDAS del avío (cm, mm…), o null.'),
    avisos: z
      .array(z.string())
      .describe('Advertencias que NO bloquean (números absurdos para la unidad, unidad faltante).'),
    tallas: z.array(esquemaModeloAvioTallaSalida).describe('Medidas por talla del avío.'),
  })
  .describe('Medidas por talla de un avío del BOM de un modelo.');

/** Forma de las medidas por talla de un avío tal como las devuelve la API. */
export type ModeloAvioMedidasSalida = z.infer<typeof esquemaModeloAvioMedidasSalida>;
