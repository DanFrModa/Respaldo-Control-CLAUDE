import { z } from 'zod';

/**
 * Esquemas Zod de la RECEPCIÓN de compras (F4-E3 — doc `Documentacion_MJD/03-Produccion.md` §OC;
 * R7). UNA sola definición de reglas para UI y servidor (alimenta el OpenAPI). La recepción recibe
 * (parcial o total) el material de una OC AUTORIZADA y registra la ENTRADA al kardex con la
 * cantidad y el costo TAL CUAL vienen de la línea de OC — que va SIEMPRE en unidad de consumo
 * (§Post-F9.97; el porqué, en la cabecera de `dominio/compras/recepciones.ts`). DECISIÓN
 * (b): SOLO se recibe contra una OC `autorizada`/`recibida_parcial` (lo refuerza el dominio,
 * server-side, A4).
 *
 * ⚠️ CAMBIO DE B1 — las TELAS entran por COLOR/PARTIDA, no por lote. El inventario de telas opera
 * por TELA+COLOR desde la etapa A2 (§Post-F9.11) y arranca desde cero: recibir contra una OC por el
 * flujo viejo de `Lote` alimentaría el inventario LEGADO —el que la vista nueva no ve; «muerto» no,
 * que su histórico se consulta (fila 0.098)—. Ahora cada renglón de TELA trae su bloque
 * `telaColor` (color + complemento + lote del proveedor) y el dominio crea SU PARTIDA. El bloque
 * `lote` (D5) queda SÓLO para consultar las recepciones históricas: ya no se acepta en la captura.
 * REGLA EXPLÍCITA del color: la línea de OC NO determina el color (la OC se pide por tela), así que
 * el color se EXIGE en la pantalla de recepción — el dominio rechaza la línea de tela sin
 * `telaColor` en vez de adivinar.
 *
 * Captura por LÍNEA DE OC: cada renglón de recepción referencia un `idOrdenCompraLinea` y la
 * `cantidadRecibida` en UNIDAD DE CONSUMO — metro, pieza, kilo: la misma unidad de la línea de OC,
 * del BOM y del costeo de Desarrollo. No hay una segunda unidad ni conversión. El dominio:
 *  • Para TELAS, exige `telaColor` y crea la PARTIDA en la misma tx (cuerpo = `cantidad` de la
 *    línea; el COMPLEMENTO viaja junto en `telaColor.cantidadComplemento`).
 *  • Para AVÍOS, no hay lote (el lote del avío es opcional y no entra en la dimensión, R4).
 *  • Para líneas LIBRES (la OC no tiene tela/avío), registra la cantidad pero NO mueve kardex.
 */

const idPositivo = (campo: string) =>
  z
    .number({ error: `El id de ${campo} es obligatorio` })
    .int({ error: `El id de ${campo} debe ser entero` })
    .positive({ error: `El id de ${campo} debe ser positivo` });

// ── Bloque de TELA por COLOR de la recepción (B1) ────────────────────────────────────────────────

/**
 * Datos POR COLOR de una línea de TELA de la recepción (B1): el color que llegó, el complemento
 * (cardigan) que viaja junto y el lote del proveedor de la partida que se creará. El CUERPO va en
 * la `cantidad` de la línea (la que se compara contra lo pedido en la OC, R7); el complemento NO
 * cuenta contra la cantidad pedida (es el acompañante del mismo renglón).
 */
export const esquemaRecepcionTelaColorEntrada = z
  .object({
    idTelaColor: idPositivo('el color de tela').describe(
      'Color (hijo de la tela) que llegó. Se EXIGE: la OC no determina el color.',
    ),
    cantidadComplemento: z
      .number()
      .nonnegative({ error: 'La cantidad de complemento no puede ser negativa' })
      .optional()
      .describe('Cantidad del COMPLEMENTO (sólo telas que lo llevan).'),
    precioUnitComplemento: z
      .number()
      .nonnegative({ error: 'El precio del complemento no puede ser negativo' })
      .optional()
      .describe(
        'Precio por unidad del COMPLEMENTO (el cardigan tiene su propio precio y la OC sólo trae ' +
          'uno por línea). Viaja al kardex como `costoUnitComplemento`; si no se captura, NULL.',
      ),
    loteProveedor: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Número de lote del proveedor de la partida (opcional).'),
  })
  .describe('Color, complemento y lote del proveedor de una línea de tela recibida (B1).');

/** Datos validados del bloque por color de una línea de tela recibida. */
export type DatosRecepcionTelaColorEntrada = z.infer<typeof esquemaRecepcionTelaColorEntrada>;

// ── Renglón de la recepción ──────────────────────────────────────────────────────────────────────

/**
 * Un renglón de recepción: cuánto se recibe contra un renglón de OC. `cantidad` va en UNIDAD DE
 * CONSUMO, la misma de la línea de OC — no se convierte nada (§Post-F9.97).
 * `telaColor` es OBLIGATORIO en las líneas de TELA (B1: el inventario de telas opera por color y
 * cada recepción crea su PARTIDA); en avío/libre va ausente.
 */
export const esquemaRecepcionLineaEntrada = z
  .object({
    idOrdenCompraLinea: idPositivo('el renglón de la orden de compra'),
    cantidad: z
      .number({ error: 'La cantidad recibida es obligatoria' })
      .positive({ error: 'La cantidad recibida debe ser mayor que 0' })
      .describe(
        'Cantidad recibida en UNIDAD DE CONSUMO, la misma de la línea de OC (§Post-F9.97): no se ' +
          'convierte nada. En TELA es el CUERPO y debe ser > 0: por esta vía NO se recibe una ' +
          'entrega de SOLO complemento (se recibe contra lo pedido en la OC, que es cuerpo) — ese ' +
          'caso va por el documento de entrada por factura/remisión (B1), que sí admite cuerpo 0.',
      ),
    /**
     * ⭐⭐ FILA 0.129 — EL PRECIO CON EL QUE NACE LA DEUDA. Daniel (§Post-F9.192): *"la persona que
     * recibe mete las cantidades y precios… **el precio debería de ser el de la OC**, la cantidad
     * puede variar un poco, por eso se mete a mano"*.
     *
     * Si NO viene, manda el precio del renglón de OC (que es lo normal y lo que la pantalla
     * precarga). Si viene DISTINTO se acepta —no se bloquea: el proveedor a veces manda otro precio
     * y quien recibe es quien lo sabe—, se guarda en el renglón, va al kardex como costo (D1) y
     * queda en la BITÁCORA junto al de la OC, para que la corrección se pueda auditar.
     */
    precioUnit: z
      .number()
      .nonnegative({ error: 'El precio no puede ser negativo' })
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
        error: 'El precio va con dos decimales como máximo',
      })
      .optional()
      .describe(
        'Precio por unidad de consumo con el que se recibe. Si se omite, el de la línea de OC.',
      ),
    telaColor: esquemaRecepcionTelaColorEntrada
      .optional()
      .describe('Color + complemento + lote del proveedor (OBLIGATORIO en líneas de tela, B1).'),
  })
  .describe('Renglón de recepción: cuánto se recibe contra un renglón de OC.');

/** Datos validados de un renglón de recepción. */
export type DatosRecepcionLineaEntrada = z.infer<typeof esquemaRecepcionLineaEntrada>;

// ── Alta de una recepción ────────────────────────────────────────────────────────────────────────

/**
 * Alta de una recepción contra una OC (F4-E3). `idOrdenCompra` obligatorio (recepciones v2 siempre
 * ligadas a OC). `idAlmacen` = destino del material. `lineas` = qué renglones de OC se reciben y
 * cuánto (parcial o total). La empresa la toma el dominio de la sesión activa (A9). El estatus de la
 * OC lo recalcula el dominio (parcial/total).
 */
export const esquemaRecepcionCrear = z
  .object({
    idOrdenCompra: idPositivo('la orden de compra'),
    idAlmacen: idPositivo('el almacén destino'),
    factura: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional()
      .describe('Factura del proveedor de esta recepción.'),
    fecha: z.iso.date({ error: 'La fecha de la recepción es obligatoria (YYYY-MM-DD)' }),
    observaciones: z.string().trim().max(2000).nullable().optional(),
    lineas: z
      .array(esquemaRecepcionLineaEntrada)
      .min(1, { error: 'Recibe al menos un renglón' })
      .describe('Renglones de OC que se reciben (parcial o total).'),
  })
  .describe('Recepción de material contra una OC autorizada (decisión b).');

/** Datos validados de alta de recepción. */
export type DatosRecepcionCrear = z.infer<typeof esquemaRecepcionCrear>;

// ── Reverso ──────────────────────────────────────────────────────────────────────────────────────

/** Cuerpo del reverso de una recepción (reverso SUAVE, D3): el motivo es OBLIGATORIO. */
export const esquemaRecepcionReversarCuerpo = z.object({
  motivo: z
    .string({ error: 'El motivo del reverso es obligatorio' })
    .trim()
    .min(1, { error: 'El motivo del reverso es obligatorio' })
    .max(2000, { error: 'El motivo no puede tener más de 2000 caracteres' })
    .describe('Motivo del reverso (obligatorio).'),
});

/** Datos validados del cuerpo de reversar. */
export type DatosRecepcionReversar = z.infer<typeof esquemaRecepcionReversarCuerpo>;

/**
 * ⭐⭐ FILA 0.129 — CÓMO QUEDÓ LA DEUDA de una recepción. Daniel (§Post-F9.192): *"lo ideal es
 * recibir con la factura. Pero si no fuera el caso, está bien dejarla como pendiente"*.
 *
 *  • `cargo-no-fiscal`   — el proveedor NO factura: el cargo YA nació y está en su estado de cuenta.
 *  • `factura-pendiente` — hay importe pero todavía no hay cargo: la deuda nacerá cuando se importe
 *    el CFDI en Finanzas (mismo trato que la entrada de tela). ⚠️ Es también lo que se lee en las
 *    recepciones ANTERIORES a esta fila, que nunca generaron cargo: describe lo que HAY, no lo que
 *    hoy habría pasado (REGLA 0-B — lo viejo no se repara).
 *  • `sin-importe`       — no hay nada que cobrar (renglones sin precio, o todo a 0).
 *  • `en-entrada-de-tela` — la recepción la generó un documento de ENTRADA DE TELA por factura
 *    (§Post-F9.14): su deuda vive ALLÁ, con su CFDI y su complemento, no aquí. Decirlo evita el
 *    peor error de esta pantalla: creer que a esa factura le falta un cargo y capturarlo dos veces.
 *  • `cancelada`         — la recepción se reversó (o su cargo se canceló en Finanzas): **ya no se
 *    debe nada por ella**. `idMovimientoTercero` SIGUE apuntando al cargo que nació —es la traza
 *    del reverso, D3—, pero la deuda está neteada por su inverso.
 *
 * ⚠️ QUIÉN DECIDE ESTO ES EL SERVIDOR, no la pantalla (hallazgo de la revisión de la 0.129). El
 * campo decía `cargo-no-fiscal` en una recepción ya reversada y era el frontend el que lo tapaba
 * («si está reversada, no pintes la etiqueta»): la regla vivía en la UI, así que cualquier otro
 * consumidor del API —un reporte, otra pantalla, un export— leía una deuda que ya no existe.
 */
export const CLASES_DEUDA_RECEPCION = [
  'cargo-no-fiscal',
  'factura-pendiente',
  'sin-importe',
  'en-entrada-de-tela',
  'cancelada',
] as const;

/** Cómo quedó la deuda de una recepción. Ver {@link CLASES_DEUDA_RECEPCION}. */
export const esquemaDeudaRecepcion = z
  .enum(CLASES_DEUDA_RECEPCION)
  .describe('Cómo quedó la cuenta por pagar de esta recepción (fila 0.129).');

/** Clave de la clase de deuda de una recepción. */
export type ClaseDeudaRecepcion = (typeof CLASES_DEUDA_RECEPCION)[number];

// ── Salidas ──────────────────────────────────────────────────────────────────────────────────────

/** Renglón de una recepción en la salida (con nombres y la traza al renglón de OC). */
export const esquemaRecepcionLineaSalida = z
  .object({
    id: z.number().int().describe('Id del renglón de recepción.'),
    idOrdenCompraLinea: z.number().int().describe('Renglón de OC que se recibió.'),
    tipo: z.enum(['tela', 'avio', 'libre']).describe('Tipo del material recibido.'),
    idTela: z.number().int().nullable().describe('Tela del catálogo, o null.'),
    tela: z.string().nullable().describe('Nombre de la tela, o null.'),
    idAvio: z.number().int().nullable().describe('Avío del catálogo, o null.'),
    avio: z.string().nullable().describe('Clave/descripción del avío, o null.'),
    colorAvio: z
      .string()
      .nullable()
      .describe(
        '⭐⭐ V1-E8c (§Post-F9.126): color con el que se PIDIÓ el avío (texto), o null. Es lo que ' +
          'distingue un cierre rojo de uno azul cuando la OC trae los cuatro colores.',
      ),
    descripcionLibre: z.string().nullable().describe('Descripción libre (líneas libres), o null.'),
    cantidadRecibida: z
      .number()
      .describe('Cantidad recibida en unidad de consumo. En tela = CUERPO.'),
    cantidadComplemento: z
      .number()
      .nullable()
      .describe('Cantidad del COMPLEMENTO recibida (telas que lo llevan), o null.'),
    costoUnit: z
      .number()
      .nullable()
      .describe(
        'Costo por unidad de consumo CON EL QUE SE RECIBIÓ (fila 0.129: el de la OC, o el que se ' +
          'corrigió al recibir). Es el que valúa el kardex y el que hace el importe de la deuda.',
      ),
    precioOc: z
      .number()
      .describe(
        '⭐ Fila 0.129: precio VIGENTE del renglón de OC que se recibió, para poder comparar con ' +
          'el de la recepción. Siempre existe: la recepción no puede vivir sin su renglón de OC.',
      ),
    precioDistintoOc: z
      .boolean()
      .describe(
        '⭐ Fila 0.129: verdadero si el precio con el que se recibió NO es el de la OC (quien ' +
          'recibe lo corrigió). La pantalla lo resalta; la bitácora guarda los dos números.',
      ),
    idTelaColor: z.number().int().nullable().describe('Color de tela recibido (B1), o null.'),
    telaColor: z.string().nullable().describe('Nombre del color de tela, o null.'),
    idPartida: z.number().int().nullable().describe('Partida creada (telas, B1), o null.'),
    partidaFolio: z.number().int().nullable().describe('Folio de la partida, o null.'),
    loteProveedor: z.string().nullable().describe('Lote del proveedor de la partida, o null.'),
    idLote: z
      .number()
      .int()
      .nullable()
      .describe('LEGADO: lote creado (recepciones viejas), o null.'),
    loteClave: z.string().nullable().describe('LEGADO: clave del lote, o null.'),
    idMovimiento: z.number().int().nullable().describe('Movimiento de kardex generado, o null.'),
    folioMovimiento: z
      .number()
      .int()
      .nullable()
      .describe('Folio del movimiento de kardex, o null.'),
  })
  .describe('Renglón de una recepción de compra.');

/** Forma de un renglón de recepción en la API. */
export type RecepcionLineaSalida = z.infer<typeof esquemaRecepcionLineaSalida>;

/** Salida de una recepción (encabezado + renglones). */
export const esquemaRecepcionSalida = z
  .object({
    id: z.number().int().describe('Id interno de la recepción.'),
    folio: z.number().int().describe('Folio consecutivo por empresa.'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    idOrdenCompra: z.number().int().describe('OC contra la que se recibió.'),
    numCompra: z.number().int().describe('Folio de la OC (para la UI).'),
    idAlmacen: z.number().int().describe('Almacén destino.'),
    almacen: z.string().describe('Nombre del almacén destino.'),
    factura: z.string().nullable().describe('Factura del proveedor, o null.'),
    fecha: z.iso.date().describe('Fecha de la recepción (YYYY-MM-DD).'),
    observaciones: z.string().nullable().describe('Observaciones, o null.'),
    reversada: z.boolean().describe('¿La recepción fue reversada (D3)?'),
    reversadaEn: z.iso.datetime().nullable().describe('Fecha del reverso (ISO), o null.'),
    reversadaPorId: z.string().nullable().describe('Usuario que reversó, o null.'),
    motivoReverso: z.string().nullable().describe('Motivo del reverso, o null.'),
    importe: z
      .number()
      .describe(
        '⭐ Fila 0.129: lo que esta recepción le debe al proveedor = Σ (cantidad recibida × ' +
          'precio), avíos Y renglones libres. Es el importe con el que nace el cargo. En las ' +
          'recepciones generadas por una ENTRADA DE TELA es sólo el valor del cuerpo recibido: ' +
          'la deuda de verdad (con complemento e impuestos) vive en ese documento.',
      ),
    idMovimientoTercero: z
      .number()
      .int()
      .nullable()
      .describe(
        '⭐ Fila 0.129: cargo de cuenta por pagar que NACIÓ de esta recepción, o null. Sigue ' +
          'apuntando al cargo aunque después se haya cancelado (el reverso lo cancela, D3).',
      ),
    deuda: esquemaDeudaRecepcion,
    lineas: z.array(esquemaRecepcionLineaSalida).describe('Renglones recibidos.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
  })
  .describe('Recepción de compra (encabezado + renglones).');

/** Forma de una recepción en la API. */
export type RecepcionSalida = z.infer<typeof esquemaRecepcionSalida>;

/** Lista de recepciones de una OC (no paginada: son pocas por OC). */
export const esquemaRecepcionesLista = z
  .object({
    recepciones: z
      .array(esquemaRecepcionSalida)
      .describe('Recepciones de la OC (orden cronológico).'),
  })
  .describe('Recepciones de una orden de compra.');

/** Forma de la lista de recepciones de una OC. */
export type RecepcionesLista = z.infer<typeof esquemaRecepcionesLista>;
