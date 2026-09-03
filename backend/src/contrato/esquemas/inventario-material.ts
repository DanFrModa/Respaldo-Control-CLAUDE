import { z } from 'zod';

/**
 * Esquemas Zod del INVENTARIO de TELAS y AVÍOS por kardex (F4-E1; doc 04-Inventarios §B; D5/R4).
 * UNA sola definición de reglas para UI y servidor (alimenta el OpenAPI). La existencia es SIEMPRE
 * Σ de movimientos (D3): aquí NO hay esquema que edite/borre una existencia — la corrección es un
 * movimiento INVERSO auditado (cancelación con motivo).
 *
 * Dimensiones:
 *  • TELA: existencia por tela × LOTE × almacén (D5 — el lote define el teñido/color y agrupa N
 *    telas acompañantes). El movimiento de ajuste puede CREAR el lote (con sus componentes).
 *  • AVÍO: existencia por avío × almacén (R4 — multi-almacén; el lote del avío es opcional y no
 *    entra en la dimensión de existencia).
 *
 * Importes (ex-acceso #7 `telas.ver-totales`): en las consultas de TELAS, los campos de costo/
 * importe son NULLABLE — el servidor los pone en null para quien no tenga el permiso (las
 * cantidades sí se ven). La UI los oculta cuando vienen null. Es ocultamiento server-side (A4), no
 * CSS.
 */

// ── Helpers de campos comunes ──────────────────────────────────────────────────────────────────

const idPositivo = (campo: string) =>
  z
    .number({ error: `El id de ${campo} es obligatorio` })
    .int({ error: `El id de ${campo} debe ser entero` })
    .positive({ error: `El id de ${campo} debe ser positivo` });

const idPositivoOpcionalCoerce = z.coerce.number().int().positive().optional();

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TELAS
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ── Lote (encabezado + componentes) para el ajuste de ENTRADA de tela ────────────────────────────

/** Un componente del lote en la captura de un ajuste de entrada de tela (D5: 1..N por lote). */
export const esquemaLoteComponenteEntrada = z.object({
  idTela: idPositivo('la tela'),
  cantidad: z
    .number({ error: 'La cantidad es obligatoria' })
    .positive({ error: 'La cantidad del componente debe ser mayor que 0' }),
  peso: z.number().nonnegative({ error: 'El peso no puede ser negativo' }).optional(),
});

/** Datos de un componente de lote en la entrada. */
export type DatosLoteComponenteEntrada = z.infer<typeof esquemaLoteComponenteEntrada>;

/**
 * Lote a CREAR en un ajuste de entrada de tela (D5). Define el color (teñido) y trae 1..N
 * componentes del mismo lote y color. La clave se autogenera en el dominio si no se manda.
 */
export const esquemaLoteEntrada = z
  .object({
    clave: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Clave del lote (autogenerada si falta).'),
    idColor: idPositivo('el color'),
    idProveedor: idPositivo('el proveedor').optional(),
    factura: z.string().trim().max(100).optional(),
    fecha: z.iso.date({ error: 'La fecha del lote debe ser YYYY-MM-DD' }).optional(),
    observaciones: z.string().trim().max(1000).optional(),
    componentes: z
      .array(esquemaLoteComponenteEntrada)
      .min(1, { error: 'El lote necesita al menos un componente (tela)' }),
  })
  .describe('Lote de tela a crear con sus componentes (D5).');

/** Datos de un lote a crear en una entrada. */
export type DatosLoteEntrada = z.infer<typeof esquemaLoteEntrada>;

// ── Ajuste de inventario de TELA (entrada o salida) ──────────────────────────────────────────────

/** Una línea de ajuste de tela sobre un lote YA existente (tela×lote×cantidad). */
export const esquemaAjusteTelaLinea = z.object({
  idTela: idPositivo('la tela'),
  idLote: idPositivo('el lote'),
  cantidad: z.number().positive({ error: 'La cantidad del ajuste debe ser mayor que 0' }),
});

/** Datos de una línea de ajuste de tela. */
export type DatosAjusteTelaLinea = z.infer<typeof esquemaAjusteTelaLinea>;

/**
 * Alta de un AJUSTE de inventario de TELA (base del conteo físico — doc 04-Inventarios §B). El tipo
 * de movimiento define la dirección (`ajuste-entrada`/`ajuste-salida`). El motivo es OBLIGATORIO
 * (A7). Una entrada puede CREAR un lote nuevo (`lote`); una salida o un ajuste sobre lo existente
 * usa `lineas` (tela×lote). Exactamente UNO de `lote` / `lineas` (xor) — lo refuerza el dominio.
 */
export const esquemaAjusteTelaCrear = z
  .object({
    idTipoMov: idPositivo('el tipo de movimiento').describe(
      'Tipo de movimiento (dirección entrada o salida; nunca traspaso).',
    ),
    idAlmacen: idPositivo('el almacén'),
    fecha: z.iso.date({ error: 'La fecha del ajuste es obligatoria (YYYY-MM-DD)' }),
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(3, { error: 'Explica el motivo (mínimo 3 caracteres)' })
      .max(500),
    lote: esquemaLoteEntrada
      .optional()
      .describe('Lote nuevo a crear (solo en ajustes de entrada).'),
    lineas: z
      .array(esquemaAjusteTelaLinea)
      .optional()
      .describe('Renglones tela×lote sobre lotes existentes.'),
  })
  .describe('Ajuste de inventario de tela (conteo físico/corrección). Lote nuevo XOR líneas.');

/** Datos validados de un ajuste de tela. */
export type DatosAjusteTelaCrear = z.infer<typeof esquemaAjusteTelaCrear>;

// ── Salida de TELA a una orden de producción ─────────────────────────────────────────────────────

/** Una línea de salida de tela a orden (tela×lote×cantidad). */
export const esquemaSalidaTelaLinea = esquemaAjusteTelaLinea;

/**
 * Alta de una SALIDA de TELA hacia una orden de producción (`Salidas.IdOrdenes` del viejo —
 * 04-Inventarios §B.3/§"Cómo conecta"). Es LA única vía que descuenta tela hacia una orden; la nota
 * de salida (E5) la referencia sin generar segundo movimiento. No deja existencia negativa
 * (validado bajo lock por el dominio).
 */
export const esquemaSalidaTelaCrear = z
  .object({
    idOrden: idPositivo('la orden').describe('Orden de producción que consume la tela.'),
    idAlmacen: idPositivo('el almacén'),
    fecha: z.iso.date({ error: 'La fecha de la salida es obligatoria (YYYY-MM-DD)' }),
    observaciones: z.string().trim().max(1000).optional(),
    lineas: z
      .array(esquemaSalidaTelaLinea)
      .min(1, { error: 'Captura al menos un renglón de tela' }),
  })
  .describe('Salida de tela ligada a una orden de producción.');

/** Datos validados de una salida de tela a orden. */
export type DatosSalidaTelaCrear = z.infer<typeof esquemaSalidaTelaCrear>;

// ── Traspaso de TELA entre almacenes ─────────────────────────────────────────────────────────────

/** Alta de un TRASPASO de TELA entre dos almacenes (salida del origen + entrada al destino). */
export const esquemaTraspasoTelaCrear = z
  .object({
    idAlmacenOrigen: idPositivo('el almacén de origen'),
    idAlmacenDestino: idPositivo('el almacén de destino'),
    fecha: z.iso.date({ error: 'La fecha del traspaso es obligatoria (YYYY-MM-DD)' }),
    observaciones: z.string().trim().max(1000).optional(),
    lineas: z
      .array(esquemaSalidaTelaLinea)
      .min(1, { error: 'Captura al menos un renglón de tela' }),
  })
  .describe('Traspaso de tela entre almacenes (tela×lote).');

/** Datos validados de un traspaso de tela. */
export type DatosTraspasoTelaCrear = z.infer<typeof esquemaTraspasoTelaCrear>;

// ── Cancelación (motivo) — compartida por tela y avío ────────────────────────────────────────────

/** Cuerpo de la cancelación de un movimiento de material (motivo obligatorio, A7). */
export const esquemaMovimientoMaterialCancelarCuerpo = z
  .object({
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(3, { error: 'Explica el motivo (mínimo 3 caracteres)' })
      .max(500),
  })
  .describe('Motivo de la cancelación del movimiento de material.');

/** Datos validados de la cancelación. */
export type DatosMovimientoMaterialCancelar = z.infer<
  typeof esquemaMovimientoMaterialCancelarCuerpo
>;

// ── Salida de un movimiento de TELA (encabezado + renglones) ─────────────────────────────────────

/** Un renglón de la salida de un movimiento de tela. Costo/importe nullables (ex-acceso #7). */
const esquemaMovTelaRenglonSalida = z.object({
  idTela: z.number().int().describe('Id de la tela.'),
  tela: z.string().describe('Nombre de la tela.'),
  idLote: z.number().int().nullable().describe('Id del lote o null.'),
  loteClave: z.string().nullable().describe('Clave del lote o null.'),
  cantidad: z.number().describe('Cantidad del renglón (positiva; la dirección da el signo).'),
  costoUnit: z.number().nullable().describe('Costo unitario o null (sin permiso de importes).'),
  importe: z.number().nullable().describe('Importe (cantidad × costoUnit) o null.'),
});

/** Salida de un movimiento de TELA: encabezado + renglones. */
export const esquemaMovimientoTelaSalida = z
  .object({
    id: z.number().int(),
    folio: z.number().int().describe('Folio consecutivo por empresa (A3).'),
    idEmpresa: z.number().int(),
    idTipoMov: z.number().int(),
    tipoMov: z.string(),
    direccion: z.enum(['entrada', 'salida', 'traspaso']),
    idAlmacen: z.number().int(),
    almacen: z.string(),
    fecha: z.string().describe('Fecha (YYYY-MM-DD).'),
    origenTipo: z.string().nullable(),
    origenId: z.string().nullable().describe('Id del hecho de origen (p. ej. orden) o null.'),
    observaciones: z.string().nullable(),
    cancelado: z.boolean(),
    idMovimientoInverso: z.number().int().nullable(),
    renglones: z.array(esquemaMovTelaRenglonSalida),
    totalCantidad: z.number().describe('Suma de las cantidades del movimiento (derivada).'),
    totalImporte: z.number().nullable().describe('Suma de importes o null (sin permiso).'),
    creadoEn: z.iso.datetime(),
    creadoPorId: z.string().nullable(),
  })
  .describe('Movimiento de inventario de tela con sus renglones (tela×lote).');

/** Forma de un movimiento de tela tal como lo devuelve la API. */
export type MovimientoTelaSalida = z.infer<typeof esquemaMovimientoTelaSalida>;

/** Resultado de un traspaso de tela: las dos patas. */
export const esquemaTraspasoTelaSalida = z
  .object({
    salida: esquemaMovimientoTelaSalida.describe('Pata de SALIDA del almacén origen.'),
    entrada: esquemaMovimientoTelaSalida.describe('Pata de ENTRADA al almacén destino.'),
  })
  .describe('Las dos patas de un traspaso de tela.');

/** Forma del resultado de un traspaso de tela. */
export type TraspasoTelaSalida = z.infer<typeof esquemaTraspasoTelaSalida>;

// ── Existencias de TELA ──────────────────────────────────────────────────────────────────────────

/** Filtros de la consulta de existencias de tela (querystring). */
export const esquemaExistenciasTelaQuery = z
  .object({
    idTela: idPositivoOpcionalCoerce.describe('Filtra por una tela.'),
    idLote: idPositivoOpcionalCoerce.describe('Filtra por un lote.'),
    idColor: idPositivoOpcionalCoerce.describe('Filtra por el color del lote.'),
    idAlmacen: idPositivoOpcionalCoerce.describe('Filtra por un almacén.'),
    incluirCeros: z
      .stringbool()
      .default(false)
      .describe('Incluye filas con existencia 0. Por defecto se omiten.'),
  })
  .describe('Filtros de la consulta de existencias de tela.');

/** Parámetros de existencias de tela ya coaccionados. */
export type ExistenciasTelaQuery = z.infer<typeof esquemaExistenciasTelaQuery>;

/** Un componente del lote en la fila de existencias (para expandir en la UI). */
const esquemaExistenciaTelaComponente = z.object({
  idTela: z.number().int(),
  tela: z.string(),
  cantidad: z.number().describe('Cantidad ORIGINAL que entró del componente (dato del lote).'),
  peso: z.number().nullable(),
});

/** Una fila de existencia de tela: tela×lote×almacén con su cantidad + datos del lote. */
const esquemaExistenciaTelaFila = z.object({
  idTela: z.number().int(),
  tela: z.string(),
  idLote: z.number().int().nullable().describe('Id del lote o null (ajuste sin lote).'),
  loteClave: z.string().nullable(),
  idColor: z.number().int().nullable(),
  color: z.string().nullable(),
  idProveedor: z.number().int().nullable(),
  proveedor: z.string().nullable(),
  factura: z.string().nullable(),
  idAlmacen: z.number().int(),
  almacen: z.string(),
  existencia: z.number().describe('Existencia actual (Σ de movimientos, D3).'),
  componentes: z
    .array(esquemaExistenciaTelaComponente)
    .describe('Componentes del lote (D5: para expandir en la UI; vacío si no hay lote).'),
});

/** Una fila de existencia de tela tal como la devuelve la API. */
export type ExistenciaTelaFila = z.infer<typeof esquemaExistenciaTelaFila>;

/** Respuesta de la consulta de existencias de tela (filas + total). */
export const esquemaExistenciasTelaLista = z
  .object({
    filas: z.array(esquemaExistenciaTelaFila),
    totalExistencia: z.number().describe('Suma de la existencia de todas las filas.'),
  })
  .describe('Existencias de tela (consulta de solo lectura, D3).');

/** Forma de la respuesta de existencias de tela. */
export type ExistenciasTelaLista = z.infer<typeof esquemaExistenciasTelaLista>;

// ── Kardex de TELA ───────────────────────────────────────────────────────────────────────────────

/** Filtros del kardex de tela (querystring). `idTela` obligatorio. */
export const esquemaKardexTelaQuery = z
  .object({
    idTela: z.coerce
      .number({ error: 'La tela es obligatoria' })
      .int()
      .positive()
      .describe('Tela del kardex (obligatorio).'),
    idLote: idPositivoOpcionalCoerce.describe('Filtra por un lote.'),
    idAlmacen: idPositivoOpcionalCoerce.describe('Filtra por un almacén.'),
  })
  .describe('Filtros del kardex de una tela.');

/** Parámetros del kardex de tela ya coaccionados. */
export type KardexTelaQuery = z.infer<typeof esquemaKardexTelaQuery>;

/** Un renglón del kardex de tela: un movimiento (su efecto + saldo corrido). */
const esquemaKardexTelaRenglon = z.object({
  idMovimiento: z.number().int(),
  folio: z.number().int(),
  fecha: z.string(),
  idTipoMov: z.number().int(),
  tipoMov: z.string(),
  direccion: z.enum(['entrada', 'salida', 'traspaso']),
  idAlmacen: z.number().int(),
  almacen: z.string(),
  idLote: z.number().int().nullable(),
  loteClave: z.string().nullable(),
  entrada: z.number().describe('Cantidad que entra (0 si es salida).'),
  salida: z.number().describe('Cantidad que sale (0 si es entrada).'),
  saldo: z.number().describe('Saldo corrido de la tela×lote×almacén tras este movimiento.'),
  costoUnit: z.number().nullable().describe('Costo unitario o null (sin permiso de importes).'),
  importe: z.number().nullable().describe('Importe del renglón o null.'),
  origenTipo: z.string().nullable(),
  origenId: z.string().nullable().describe('Id del hecho de origen (p. ej. orden) o null.'),
  cancelado: z.boolean(),
  observaciones: z.string().nullable(),
});

/** Un renglón del kardex de tela tal como lo devuelve la API. */
export type KardexTelaRenglon = z.infer<typeof esquemaKardexTelaRenglon>;

/** Respuesta del kardex de tela (movimientos cronológicos con saldo corrido). */
export const esquemaKardexTelaLista = z
  .object({
    idTela: z.number().int(),
    tela: z.string(),
    renglones: z.array(esquemaKardexTelaRenglon),
  })
  .describe('Kardex de una tela (movimientos con saldo corrido).');

/** Forma de la respuesta del kardex de tela. */
export type KardexTelaLista = z.infer<typeof esquemaKardexTelaLista>;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TELAS POR COLOR (etapa A2 — inventario NUEVO: partidas + existencia por color + kardex)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Daniel (§Post-F9.9 opción B, §Post-F9.11): el inventario de telas opera por TELA+COLOR (el color
// es HIJO de la tela, `TelaColor`); la PARTIDA es la unidad de ENTRADA (folio propio por empresa +
// número de lote del proveedor, texto opcional buscable); el CONSUMO empareja por color (las
// salidas NO piden partida); el CUERPO y el COMPLEMENTO (cardigan) viajan SIEMPRE JUNTOS en el
// mismo renglón (comprar solo complemento = cuerpo en 0). El flujo viejo por Lote queda como
// legado consultable (sus esquemas de arriba NO se tocan).

/** Campos comunes de un renglón por COLOR: tela+color con AMBAS cantidades juntas. */
const camposTelaColorLinea = {
  idTelaColor: idPositivo('el color de tela'),
  cantidad: z
    .number({ error: 'La cantidad de cuerpo es obligatoria (puede ser 0)' })
    .nonnegative({ error: 'La cantidad de cuerpo no puede ser negativa' }),
  cantidadComplemento: z
    .number()
    .nonnegative({ error: 'La cantidad de complemento no puede ser negativa' })
    .optional(),
} as const;

/** Al menos UNA de las dos cantidades debe ser > 0 (cuerpo y complemento viajan juntos). */
const alMenosUnaCantidad = {
  fn: (l: { cantidad: number; cantidadComplemento?: number | undefined }) =>
    l.cantidad > 0 || (l.cantidadComplemento ?? 0) > 0,
  error: 'Captura cantidad de cuerpo o de complemento (al menos una mayor que 0)',
};

/**
 * Un renglón de captura por COLOR para SALIDAS y TRASPASOS: tela+color con ambas cantidades.
 * SIN `loteProveedor`: la partida es la unidad de ENTRADA — el consumo empareja por color y NO
 * lleva partida (contrato honesto: el campo ni siquiera existe aquí — reviewer A2 #4).
 */
export const esquemaTelaColorLineaSalida = z
  .object(camposTelaColorLinea)
  .refine(alMenosUnaCantidad.fn, { error: alMenosUnaCantidad.error });

/** Datos de un renglón de salida/traspaso por color (sin lote del proveedor). */
export type DatosTelaColorLineaSalida = z.infer<typeof esquemaTelaColorLineaSalida>;

/**
 * Un renglón de captura por COLOR para el AJUSTE: además de las cantidades, en ENTRADAS puede
 * traer el número de lote del PROVEEDOR de la partida (el dominio lo RECHAZA en salidas). En una
 * entrada el MISMO tela+color PUEDE repetirse en varios renglones (una factura con dos lotes del
 * mismo color = dos partidas — DECISIONES §Post-F9.11 punto 4).
 */
export const esquemaTelaColorLinea = z
  .object({
    ...camposTelaColorLinea,
    /** Número de lote del PROVEEDOR de la partida (SOLO en ajustes de entrada; opcional). */
    loteProveedor: z.string().trim().max(100).optional(),
  })
  .refine(alMenosUnaCantidad.fn, { error: alMenosUnaCantidad.error });

/** Datos de un renglón de captura por color (ajuste). */
export type DatosTelaColorLinea = z.infer<typeof esquemaTelaColorLinea>;

/**
 * Alta de un AJUSTE de inventario de tela POR COLOR (conteo físico / arranque desde cero /
 * corrección). El tipo de movimiento define la dirección. Una ENTRADA crea UNA PARTIDA por
 * renglón (folio atómico A3 + `loteProveedor` opcional del renglón + `factura`/fecha del
 * encabezado); una SALIDA valida no-negativo de AMBOS componentes bajo lock (D3) y no lleva
 * partida. Motivo OBLIGATORIO (A7).
 */
export const esquemaAjusteTelaColorCrear = z
  .object({
    idTipoMov: idPositivo('el tipo de movimiento').describe(
      'Tipo de movimiento (dirección entrada o salida; nunca traspaso).',
    ),
    idAlmacen: idPositivo('el almacén'),
    fecha: z.iso.date({ error: 'La fecha del ajuste es obligatoria (YYYY-MM-DD)' }),
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(3, { error: 'Explica el motivo (mínimo 3 caracteres)' })
      .max(500),
    /** Factura/remisión de las partidas creadas (solo entradas; opcional). */
    factura: z.string().trim().max(100).optional(),
    lineas: z
      .array(esquemaTelaColorLinea)
      .min(1, { error: 'Captura al menos un renglón de tela y color' }),
  })
  .describe('Ajuste de inventario de tela por COLOR (entrada crea partidas; salida valida).');

/** Datos validados de un ajuste de tela por color. */
export type DatosAjusteTelaColorCrear = z.infer<typeof esquemaAjusteTelaColorCrear>;

/**
 * Alta de una SALIDA de tela POR COLOR hacia una orden de producción. El consumo empareja por
 * TELA+COLOR (NO pide partida); valida no-negativo de AMBOS componentes bajo lock (D3).
 */
export const esquemaSalidaTelaColorCrear = z
  .object({
    idOrden: idPositivo('la orden').describe('Orden de producción que consume la tela.'),
    idAlmacen: idPositivo('el almacén'),
    fecha: z.iso.date({ error: 'La fecha de la salida es obligatoria (YYYY-MM-DD)' }),
    observaciones: z.string().trim().max(1000).optional(),
    lineas: z
      .array(esquemaTelaColorLineaSalida)
      .min(1, { error: 'Captura al menos un renglón de tela y color' }),
  })
  .describe('Salida de tela por color ligada a una orden de producción (sin partida).');

/** Datos validados de una salida de tela por color a orden. */
export type DatosSalidaTelaColorCrear = z.infer<typeof esquemaSalidaTelaColorCrear>;

/** Alta de un TRASPASO de tela POR COLOR entre dos almacenes (ambas cantidades juntas). */
export const esquemaTraspasoTelaColorCrear = z
  .object({
    idAlmacenOrigen: idPositivo('el almacén de origen'),
    idAlmacenDestino: idPositivo('el almacén de destino'),
    fecha: z.iso.date({ error: 'La fecha del traspaso es obligatoria (YYYY-MM-DD)' }),
    observaciones: z.string().trim().max(1000).optional(),
    lineas: z
      .array(esquemaTelaColorLineaSalida)
      .min(1, { error: 'Captura al menos un renglón de tela y color' }),
  })
  .describe('Traspaso de tela por color entre almacenes (dos patas atómicas).');

/** Datos validados de un traspaso de tela por color. */
export type DatosTraspasoTelaColorCrear = z.infer<typeof esquemaTraspasoTelaColorCrear>;

/** Un renglón de la salida de un movimiento por color. Costo/importe nullables (ex-acceso #7). */
const esquemaMovTelaColorRenglonSalida = z.object({
  idTela: z.number().int(),
  tela: z.string().describe('Nombre de la tela.'),
  idTelaColor: z.number().int(),
  telaColor: z.string().describe('Nombre del color de la tela.'),
  pantone: z.string().nullable(),
  idPartida: z.number().int().nullable().describe('Partida de la entrada o null (salidas).'),
  partidaFolio: z.number().int().nullable().describe('Folio de la partida o null.'),
  loteProveedor: z.string().nullable().describe('Lote del proveedor de la partida o null.'),
  cantidad: z.number().describe('Cantidad de CUERPO (≥ 0; el signo lo da la dirección).'),
  cantidadComplemento: z
    .number()
    .nullable()
    .describe('Cantidad de COMPLEMENTO o null (la tela no lleva).'),
  costoUnit: z
    .number()
    .nullable()
    .describe('Costo unitario del CUERPO o null (sin permiso de importes / sin precio).'),
  costoUnitComplemento: z
    .number()
    .nullable()
    .describe('Costo unitario del COMPLEMENTO (B1) o null (el cardigan tiene su propio precio).'),
  importe: z
    .number()
    .nullable()
    .describe('Importe del renglón: cuerpo × costoUnit + complemento × costoUnitComplemento.'),
});

/** Salida de un movimiento de tela POR COLOR: encabezado + renglones. */
export const esquemaMovimientoTelaColorSalida = z
  .object({
    id: z.number().int(),
    folio: z.number().int().describe('Folio consecutivo por empresa (A3).'),
    idEmpresa: z.number().int(),
    idTipoMov: z.number().int(),
    tipoMov: z.string(),
    direccion: z.enum(['entrada', 'salida', 'traspaso']),
    idAlmacen: z.number().int(),
    almacen: z.string(),
    fecha: z.string().describe('Fecha (YYYY-MM-DD).'),
    origenTipo: z.string().nullable(),
    origenId: z.string().nullable().describe('Id del hecho de origen (p. ej. orden) o null.'),
    observaciones: z.string().nullable(),
    cancelado: z.boolean(),
    idMovimientoInverso: z.number().int().nullable(),
    renglones: z.array(esquemaMovTelaColorRenglonSalida),
    totalCuerpo: z.number().describe('Suma de las cantidades de cuerpo (derivada).'),
    totalComplemento: z.number().describe('Suma de las cantidades de complemento (derivada).'),
    totalImporte: z.number().nullable().describe('Suma de importes o null (sin permiso).'),
    creadoEn: z.iso.datetime(),
    creadoPorId: z.string().nullable(),
  })
  .describe('Movimiento de inventario de tela por COLOR con sus renglones.');

/** Forma de un movimiento de tela por color tal como lo devuelve la API. */
export type MovimientoTelaColorSalida = z.infer<typeof esquemaMovimientoTelaColorSalida>;

/** Resultado de un traspaso de tela por color: las dos patas. */
export const esquemaTraspasoTelaColorSalida = z
  .object({
    salida: esquemaMovimientoTelaColorSalida.describe('Pata de SALIDA del almacén origen.'),
    entrada: esquemaMovimientoTelaColorSalida.describe('Pata de ENTRADA al almacén destino.'),
  })
  .describe('Las dos patas de un traspaso de tela por color.');

/** Forma del resultado de un traspaso de tela por color. */
export type TraspasoTelaColorSalida = z.infer<typeof esquemaTraspasoTelaColorSalida>;

// ── CONTEO por COLOR (capturar LO CONTADO, no la resta — fila 0.098) ─────────────────────────────
//
// Daniel: «capturar lo contado, con el saldo del sistema a la vista, y que el sistema calcule y
// aplique la diferencia». Hasta v0.097 «Ajuste de telas por color» —la pantalla con la que se va a
// INICIALIZAR todo el inventario de telas el día del arranque— pedía una ENTRADA o una SALIDA con su
// cantidad, o sea LA RESTA: para ajustar había que ir a otra pantalla, ver la existencia, restar de
// cabeza y volver a capturar la diferencia con el signo correcto.
//
// El patrón se copia del CONTEO CÍCLICO de producto terminado (`indicadores/inventario-ciclico.ts`),
// que ya hace exactamente esto: lee el teórico bajo lock, captura lo contado y aplica la diferencia
// como MOVIMIENTO de kardex (D3) — jamás una escritura de la existencia. Lo que NO se reusa es su
// MOTOR: es de producto terminado (modelo×color×talla×orden, sus tablas y sus estados). Extender el
// cíclico entero a telas y avíos es otra fila (0.099).

/**
 * Filtros de los SALDOS del sistema para el conteo (querystring). Los colores viajan en UNA lista
 * separada por comas —`idTelaColor=11,21,33`— para que la pantalla pida TODOS sus renglones en una
 * sola llamada: pedirlos de uno en uno eran cientos de GET al cargar el inventario del arranque.
 */
export const esquemaSaldosTelaColorQuery = z
  .object({
    idAlmacen: z.coerce
      .number({ error: 'El almacén es obligatorio' })
      .int()
      .positive()
      .describe('Almacén del que se quieren los saldos (obligatorio).'),
    // Se queda como STRING en el contrato (y por tanto en el OpenAPI): un querystring viaja como
    // texto y el cliente generado lo manda tal cual. El troceo por comas y la validación de cada id
    // los hace el DOMINIO (`idsDeColorPedidos`), no el esquema — con un `transform` aquí, la
    // entrada (string) y la salida (number[]) dejaban de encajar cuando la ruta le pasaba al
    // dominio lo que Fastify ya había parseado, y con `preprocess` el OpenAPI acababa declarando un
    // arreglo que el cliente serializaba como parámetro repetido.
    idTelaColor: z
      .string({ error: 'Indica al menos un color de tela' })
      .min(1, { error: 'Indica al menos un color de tela' })
      .max(4000)
      .describe('Ids de color de tela separados por comas (p. ej. "11,21,33").'),
  })
  .describe('Almacén + colores de los que se quiere el saldo del sistema.');

/** Parámetros de los saldos por color ya coaccionados. */
export type SaldosTelaColorQuery = z.infer<typeof esquemaSaldosTelaColorQuery>;

/**
 * SALDO del sistema de un color en un almacén, calculado por Σ de movimientos DIRECTA sobre
 * `MovimientoDetTela` (nunca la vista `existencia_tela_color`): es LA MISMA aritmética que el
 * conteo usa al aplicar la diferencia — el fragmento SQL vive una sola vez en `comun/kardex.ts`.
 */
const esquemaSaldoTelaColorSalida = z.object({
  idTelaColor: z.number().int(),
  idTela: z.number().int(),
  tela: z.string(),
  telaColor: z.string(),
  cuerpo: z.number().describe('Existencia del CUERPO (Σ de movimientos).'),
  complemento: z.number().describe('Existencia del COMPLEMENTO (0 si la tela no lo lleva).'),
  nombreComplemento: z
    .string()
    .nullable()
    .describe('Cómo se llama el complemento ("Cardigan"), o null si la tela no lleva.'),
});

/** Respuesta de los saldos pedidos: uno por color, en el orden de los ids resueltos. */
export const esquemaSaldosTelaColorSalida = z
  .object({
    idAlmacen: z.number().int(),
    saldos: z.array(esquemaSaldoTelaColorSalida),
  })
  .describe('Saldos del sistema de varios tela+color en un almacén (Σ de movimientos, D3).');

/** Forma de los saldos por color. */
export type SaldosTelaColorSalida = z.infer<typeof esquemaSaldosTelaColorSalida>;

/**
 * Un renglón CONTADO: lo que la persona vio en el anaquel. NO es una diferencia — la calcula el
 * servidor contra el saldo que lee bajo lock en el momento de aplicar.
 */
export const esquemaConteoTelaColorLinea = z
  .object({
    idTelaColor: idPositivo('el color de tela'),
    contadoCuerpo: z
      .number({ error: 'La cantidad contada de cuerpo es obligatoria (puede ser 0)' })
      .nonnegative({ error: 'La cantidad contada no puede ser negativa' }),
    contadoComplemento: z
      .number()
      .nonnegative({ error: 'La cantidad contada de complemento no puede ser negativa' })
      .optional()
      .describe('Sólo en telas que llevan complemento; sin capturar se toma como 0.'),
    loteProveedor: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Lote del proveedor de la PARTIDA que se cree si el conteo da de ALTA (faltante).'),
  })
  .describe('Un renglón contado (lo que hay), no una diferencia.');

/** Datos de un renglón contado. */
export type DatosConteoTelaColorLinea = z.infer<typeof esquemaConteoTelaColorLinea>;

/**
 * CONTEO físico del inventario de telas por COLOR: se captura LO CONTADO y el servidor calcula y
 * aplica la diferencia contra el saldo que lee bajo lock (D3). Motivo OBLIGATORIO (A7). Un color no
 * se puede repetir: se cuenta UNA vez por almacén (dos renglones del mismo color restarían dos veces
 * contra el MISMO saldo).
 */
export const esquemaConteoTelaColorCrear = z
  .object({
    idAlmacen: idPositivo('el almacén'),
    fecha: z.iso.date({ error: 'La fecha del conteo es obligatoria (YYYY-MM-DD)' }),
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(3, { error: 'Explica el motivo (mínimo 3 caracteres)' })
      .max(500),
    factura: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Factura/remisión de las partidas que cree el alta por faltante (opcional).'),
    lineas: z
      .array(esquemaConteoTelaColorLinea)
      .min(1, { error: 'Captura al menos un renglón de tela y color' }),
  })
  .describe(
    'Conteo físico de tela por COLOR: se captura lo contado; el sistema aplica la diferencia.',
  );

/** Datos validados de un conteo de tela por color. */
export type DatosConteoTelaColorCrear = z.infer<typeof esquemaConteoTelaColorCrear>;

/** Qué pasó con un renglón del conteo: teórico, contado y diferencia aplicada. */
const esquemaConteoTelaColorRenglonSalida = z.object({
  idTelaColor: z.number().int(),
  idTela: z.number().int(),
  tela: z.string(),
  telaColor: z.string(),
  nombreComplemento: z.string().nullable().describe('Null = la tela no lleva complemento.'),
  teoricoCuerpo: z.number().describe('Saldo del sistema al aplicar (Σ de movimientos bajo lock).'),
  contadoCuerpo: z.number(),
  diferenciaCuerpo: z.number().describe('contado − teórico (positiva = entra, negativa = sale).'),
  teoricoComplemento: z.number(),
  contadoComplemento: z.number(),
  diferenciaComplemento: z.number(),
});

/** Un renglón del resultado del conteo. */
export type ConteoTelaColorRenglonSalida = z.infer<typeof esquemaConteoTelaColorRenglonSalida>;

/**
 * Resultado de un conteo: el detalle renglón por renglón (teórico vs contado vs diferencia) y los
 * DOS movimientos que lo materializan — uno de ENTRADA con todos los faltantes y otro de SALIDA con
 * todos los sobrantes (cualquiera puede ir `null` si no hubo diferencias de ese signo). Un conteo
 * que cuadra en todo no escribe NINGÚN movimiento: `sinDiferencias`.
 */
export const esquemaConteoTelaColorSalida = z
  .object({
    idAlmacen: z.number().int(),
    almacen: z.string(),
    fecha: z.string().describe('Fecha (YYYY-MM-DD).'),
    sinDiferencias: z.boolean().describe('true = el conteo cuadró y no se escribió movimiento.'),
    renglones: z.array(esquemaConteoTelaColorRenglonSalida),
    entrada: esquemaMovimientoTelaColorSalida
      .nullable()
      .describe('Movimiento de ENTRADA con los faltantes, o null si no hubo.'),
    salida: esquemaMovimientoTelaColorSalida
      .nullable()
      .describe('Movimiento de SALIDA con los sobrantes, o null si no hubo.'),
  })
  .describe('Resultado de un conteo físico de tela por color.');

/** Forma del resultado de un conteo por color. */
export type ConteoTelaColorSalida = z.infer<typeof esquemaConteoTelaColorSalida>;

// ── Existencias por COLOR (agrupadas TELA PADRE → colores hijos) ─────────────────────────────────

/** Filtros de la consulta de existencias por color (querystring). */
export const esquemaExistenciasTelaColorQuery = z
  .object({
    idTela: idPositivoOpcionalCoerce.describe('Filtra por una tela.'),
    idTelaColor: idPositivoOpcionalCoerce.describe('Filtra por un color de tela.'),
    idAlmacen: idPositivoOpcionalCoerce.describe('Filtra por un almacén.'),
    idCategoria: idPositivoOpcionalCoerce.describe('Filtra por el tipo/categoría de la tela.'),
    idProveedor: idPositivoOpcionalCoerce.describe('Filtra por el proveedor dueño de la tela.'),
    busqueda: z
      .string()
      .trim()
      .max(150)
      .optional()
      .describe('Busca por nombre de tela/proveedor/color/pantone.'),
    incluirCeros: z
      .stringbool()
      .default(false)
      .describe('Incluye colores con existencia 0. Por defecto se omiten.'),
  })
  .describe('Filtros de la consulta de existencias de tela por color.');

/** Parámetros de existencias por color ya coaccionados. */
export type ExistenciasTelaColorQuery = z.infer<typeof esquemaExistenciasTelaColorQuery>;

/** Existencia de un color en UN almacén (desglose por almacén del renglón de color). */
const esquemaExistenciaColorAlmacen = z.object({
  idAlmacen: z.number().int(),
  almacen: z.string(),
  cuerpo: z.number().describe('Existencia del cuerpo en este almacén (Σ, D3).'),
  complemento: z.number().describe('Existencia del complemento en este almacén (Σ, D3).'),
});

/** Un COLOR (hijo) con su existencia total y el desglose por almacén. */
const esquemaExistenciaTelaColorHijo = z.object({
  idTelaColor: z.number().int(),
  nombre: z.string().describe('Nombre libre del color de esta tela.'),
  pantone: z.string().nullable(),
  existenciaCuerpo: z.number().describe('Σ del cuerpo en todos los almacenes (D3).'),
  existenciaComplemento: z.number().describe('Σ del complemento en todos los almacenes (D3).'),
  almacenes: z.array(esquemaExistenciaColorAlmacen).describe('Desglose por almacén.'),
});

/** Un color con existencia tal como lo devuelve la API. */
export type ExistenciaTelaColorHijo = z.infer<typeof esquemaExistenciaTelaColorHijo>;

/** Una TELA PADRE agrupada con sus colores hijos y totales. */
const esquemaExistenciaTelaAgrupada = z.object({
  idTela: z.number().int(),
  nombre: z.string().describe('Nombre de la tela.'),
  categoria: z.string().nullable().describe('Tipo/categoría de la tela o null.'),
  idProveedor: z.number().int().nullable(),
  proveedor: z.string().nullable().describe('Proveedor dueño de la tela o null.'),
  nombreProveedor: z.string().nullable().describe('Cómo le llama el proveedor o null.'),
  unidadMedida: z.enum(['KG', 'M']).describe('Unidad de compra/consumo (kg o m).'),
  nombreCuerpo: z.string().nullable().describe('Nombre del componente cuerpo ("Felpa") o null.'),
  nombreComplemento: z
    .string()
    .nullable()
    .describe('Nombre del complemento ("Cardigan"); null = la tela NO lleva complemento.'),
  totalCuerpo: z.number().describe('Σ del cuerpo de todos sus colores.'),
  totalComplemento: z.number().describe('Σ del complemento de todos sus colores.'),
  colores: z.array(esquemaExistenciaTelaColorHijo).describe('Colores hijos con existencia.'),
});

/** Una tela agrupada con sus colores tal como la devuelve la API. */
export type ExistenciaTelaAgrupada = z.infer<typeof esquemaExistenciaTelaAgrupada>;

/** Respuesta de existencias por color: telas padre → colores hijos + totales globales. */
export const esquemaExistenciasTelaColorLista = z
  .object({
    telas: z.array(esquemaExistenciaTelaAgrupada),
    totalCuerpo: z.number().describe('Σ global del cuerpo.'),
    totalComplemento: z.number().describe('Σ global del complemento.'),
  })
  .describe('Existencias de tela por color, agrupadas tela padre → colores (D3, solo lectura).');

/** Forma de la respuesta de existencias por color. */
export type ExistenciasTelaColorLista = z.infer<typeof esquemaExistenciasTelaColorLista>;

// ── Kardex por COLOR ─────────────────────────────────────────────────────────────────────────────

/** Filtros del kardex por color (querystring). `idTelaColor` obligatorio. */
export const esquemaKardexTelaColorQuery = z
  .object({
    idTelaColor: z.coerce
      .number({ error: 'El color de tela es obligatorio' })
      .int()
      .positive()
      .describe('Color de tela del kardex (obligatorio).'),
    idAlmacen: idPositivoOpcionalCoerce.describe('Filtra por un almacén.'),
    idPartida: idPositivoOpcionalCoerce.describe('Filtra por una partida (traza de entrada).'),
  })
  .describe('Filtros del kardex de un color de tela.');

/** Parámetros del kardex por color ya coaccionados. */
export type KardexTelaColorQuery = z.infer<typeof esquemaKardexTelaColorQuery>;

/** Un renglón del kardex por color: un movimiento con saldo corrido de AMBOS componentes. */
const esquemaKardexTelaColorRenglon = z.object({
  idMovimiento: z.number().int(),
  folio: z.number().int(),
  fecha: z.string(),
  idTipoMov: z.number().int(),
  tipoMov: z.string(),
  direccion: z.enum(['entrada', 'salida', 'traspaso']),
  idAlmacen: z.number().int(),
  almacen: z.string(),
  idPartida: z.number().int().nullable(),
  partidaFolio: z.number().int().nullable(),
  loteProveedor: z.string().nullable(),
  entradaCuerpo: z.number().describe('Cuerpo que entra (0 si es salida).'),
  salidaCuerpo: z.number().describe('Cuerpo que sale (0 si es entrada).'),
  saldoCuerpo: z.number().describe('Saldo corrido del cuerpo (por color×almacén).'),
  entradaComplemento: z.number().describe('Complemento que entra (0 si es salida).'),
  salidaComplemento: z.number().describe('Complemento que sale (0 si es entrada).'),
  saldoComplemento: z.number().describe('Saldo corrido del complemento (por color×almacén).'),
  costoUnit: z
    .number()
    .nullable()
    .describe('Costo unitario del CUERPO o null (sin permiso de importes / sin precio).'),
  costoUnitComplemento: z
    .number()
    .nullable()
    .describe('Costo unitario del COMPLEMENTO (B1) o null.'),
  importe: z
    .number()
    .nullable()
    .describe('Importe del renglón (ambos componentes con su propio costo) o null.'),
  origenTipo: z.string().nullable(),
  origenId: z.string().nullable(),
  cancelado: z.boolean(),
  observaciones: z.string().nullable(),
});

/** Un renglón del kardex por color tal como lo devuelve la API. */
export type KardexTelaColorRenglon = z.infer<typeof esquemaKardexTelaColorRenglon>;

/** Respuesta del kardex por color (encabezado de la tela/color + renglones cronológicos). */
export const esquemaKardexTelaColorLista = z
  .object({
    idTela: z.number().int(),
    tela: z.string(),
    idTelaColor: z.number().int(),
    telaColor: z.string(),
    pantone: z.string().nullable(),
    unidadMedida: z.enum(['KG', 'M']),
    nombreCuerpo: z.string().nullable(),
    nombreComplemento: z.string().nullable().describe('null = la tela no lleva complemento.'),
    renglones: z.array(esquemaKardexTelaColorRenglon),
  })
  .describe('Kardex de un color de tela (movimientos con saldo corrido de ambos componentes).');

/** Forma de la respuesta del kardex por color. */
export type KardexTelaColorLista = z.infer<typeof esquemaKardexTelaColorLista>;

// ── Partidas (búsqueda para el selector) ─────────────────────────────────────────────────────────

/** Filtros de la búsqueda de partidas (querystring). */
export const esquemaPartidasTelaQuery = z
  .object({
    idTelaColor: idPositivoOpcionalCoerce.describe('Filtra por un color de tela.'),
    idTela: idPositivoOpcionalCoerce.describe('Filtra por una tela.'),
    busqueda: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Busca por folio, lote del proveedor o factura.'),
  })
  .describe('Filtros de la búsqueda de partidas de tela.');

/** Parámetros de la búsqueda de partidas ya coaccionados. */
export type PartidasTelaQuery = z.infer<typeof esquemaPartidasTelaQuery>;

/** Una partida de tela (unidad de entrada) tal como la devuelve la API. */
const esquemaPartidaTelaSalida = z.object({
  id: z.number().int(),
  folio: z.number().int().describe('Folio consecutivo por empresa (A3).'),
  idTelaColor: z.number().int(),
  telaColor: z.string().describe('Nombre del color de la tela.'),
  idTela: z.number().int(),
  tela: z.string().describe('Nombre de la tela.'),
  loteProveedor: z.string().nullable(),
  factura: z.string().nullable(),
  fecha: z.string().nullable().describe('Fecha de la entrada (YYYY-MM-DD) o null.'),
  creadoEn: z.iso.datetime(),
});

/** Una partida de tela tal como la devuelve la API. */
export type PartidaTelaSalida = z.infer<typeof esquemaPartidaTelaSalida>;

/** Respuesta de la búsqueda de partidas (máx. 50, más recientes primero). */
export const esquemaPartidasTelaLista = z
  .object({ datos: z.array(esquemaPartidaTelaSalida) })
  .describe('Partidas de tela que casan con la búsqueda.');

/** Forma de la respuesta de la búsqueda de partidas. */
export type PartidasTelaLista = z.infer<typeof esquemaPartidasTelaLista>;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AVÍOS
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Una línea de ajuste/traspaso de avío (avío×cantidad; lote opcional). */
export const esquemaAjusteAvioLinea = z.object({
  idAvio: idPositivo('el avío'),
  idLote: idPositivo('el lote').optional(),
  cantidad: z.number().positive({ error: 'La cantidad del ajuste debe ser mayor que 0' }),
});

/** Datos de una línea de ajuste de avío. */
export type DatosAjusteAvioLinea = z.infer<typeof esquemaAjusteAvioLinea>;

/**
 * Alta de un AJUSTE de inventario de AVÍO (conteo físico inicial / corrección — R4). El tipo de
 * movimiento define la dirección; motivo OBLIGATORIO (A7). Las entradas no validan existencia; las
 * salidas no dejan negativo (dominio, bajo lock).
 */
export const esquemaAjusteAvioCrear = z
  .object({
    idTipoMov: idPositivo('el tipo de movimiento'),
    idAlmacen: idPositivo('el almacén'),
    fecha: z.iso.date({ error: 'La fecha del ajuste es obligatoria (YYYY-MM-DD)' }),
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(3, { error: 'Explica el motivo (mínimo 3 caracteres)' })
      .max(500),
    lineas: z
      .array(esquemaAjusteAvioLinea)
      .min(1, { error: 'Captura al menos un renglón de avío' }),
  })
  .describe('Ajuste de inventario de avío (R4).');

/** Datos validados de un ajuste de avío. */
export type DatosAjusteAvioCrear = z.infer<typeof esquemaAjusteAvioCrear>;

/** Alta de un TRASPASO de AVÍO entre almacenes. */
export const esquemaTraspasoAvioCrear = z
  .object({
    idAlmacenOrigen: idPositivo('el almacén de origen'),
    idAlmacenDestino: idPositivo('el almacén de destino'),
    fecha: z.iso.date({ error: 'La fecha del traspaso es obligatoria (YYYY-MM-DD)' }),
    observaciones: z.string().trim().max(1000).optional(),
    lineas: z
      .array(esquemaAjusteAvioLinea)
      .min(1, { error: 'Captura al menos un renglón de avío' }),
  })
  .describe('Traspaso de avío entre almacenes (R4).');

/** Datos validados de un traspaso de avío. */
export type DatosTraspasoAvioCrear = z.infer<typeof esquemaTraspasoAvioCrear>;

/** Un renglón de la salida de un movimiento de avío. */
const esquemaMovAvioRenglonSalida = z.object({
  idAvio: z.number().int(),
  avio: z.string().describe('Clave del avío.'),
  descripcion: z.string().describe('Descripción del avío.'),
  esGenerico: z.boolean(),
  idLote: z.number().int().nullable(),
  cantidad: z.number(),
  costoUnit: z.number().nullable(),
  importe: z.number().nullable(),
});

/** Salida de un movimiento de AVÍO: encabezado + renglones. */
export const esquemaMovimientoAvioSalida = z
  .object({
    id: z.number().int(),
    folio: z.number().int(),
    idEmpresa: z.number().int(),
    idTipoMov: z.number().int(),
    tipoMov: z.string(),
    direccion: z.enum(['entrada', 'salida', 'traspaso']),
    idAlmacen: z.number().int(),
    almacen: z.string(),
    fecha: z.string(),
    origenTipo: z.string().nullable(),
    origenId: z.string().nullable(),
    observaciones: z.string().nullable(),
    cancelado: z.boolean(),
    idMovimientoInverso: z.number().int().nullable(),
    renglones: z.array(esquemaMovAvioRenglonSalida),
    totalCantidad: z.number(),
    totalImporte: z.number().nullable(),
    creadoEn: z.iso.datetime(),
    creadoPorId: z.string().nullable(),
  })
  .describe('Movimiento de inventario de avío con sus renglones.');

/** Forma de un movimiento de avío tal como lo devuelve la API. */
export type MovimientoAvioSalida = z.infer<typeof esquemaMovimientoAvioSalida>;

/** Resultado de un traspaso de avío: las dos patas. */
export const esquemaTraspasoAvioSalida = z
  .object({
    salida: esquemaMovimientoAvioSalida,
    entrada: esquemaMovimientoAvioSalida,
  })
  .describe('Las dos patas de un traspaso de avío.');

/** Forma del resultado de un traspaso de avío. */
export type TraspasoAvioSalida = z.infer<typeof esquemaTraspasoAvioSalida>;

/** Filtros de existencias de avío (querystring). */
export const esquemaExistenciasAvioQuery = z
  .object({
    idAvio: idPositivoOpcionalCoerce.describe('Filtra por un avío.'),
    idAlmacen: idPositivoOpcionalCoerce.describe('Filtra por un almacén.'),
    soloGenericos: z.stringbool().default(false).describe('Solo avíos genéricos de stock (R4).'),
    incluirCeros: z
      .stringbool()
      .default(false)
      .describe('Incluye filas con existencia 0. Por defecto se omiten.'),
  })
  .describe('Filtros de la consulta de existencias de avío.');

/** Parámetros de existencias de avío ya coaccionados. */
export type ExistenciasAvioQuery = z.infer<typeof esquemaExistenciasAvioQuery>;

/** Una fila de existencia de avío: avío×almacén con su cantidad. */
const esquemaExistenciaAvioFila = z.object({
  idAvio: z.number().int(),
  avio: z.string().describe('Clave del avío.'),
  descripcion: z.string(),
  unidad: z.string().nullable(),
  esGenerico: z.boolean(),
  idAlmacen: z.number().int(),
  almacen: z.string(),
  existencia: z.number().describe('Existencia actual (Σ de movimientos, D3).'),
});

/** Una fila de existencia de avío tal como la devuelve la API. */
export type ExistenciaAvioFila = z.infer<typeof esquemaExistenciaAvioFila>;

/** Respuesta de la consulta de existencias de avío. */
export const esquemaExistenciasAvioLista = z
  .object({
    filas: z.array(esquemaExistenciaAvioFila),
    totalExistencia: z.number(),
  })
  .describe('Existencias de avío (consulta de solo lectura, D3).');

/** Forma de la respuesta de existencias de avío. */
export type ExistenciasAvioLista = z.infer<typeof esquemaExistenciasAvioLista>;

/** Filtros del kardex de avío (querystring). `idAvio` obligatorio. */
export const esquemaKardexAvioQuery = z
  .object({
    idAvio: z.coerce
      .number({ error: 'El avío es obligatorio' })
      .int()
      .positive()
      .describe('Avío del kardex (obligatorio).'),
    idAlmacen: idPositivoOpcionalCoerce.describe('Filtra por un almacén.'),
  })
  .describe('Filtros del kardex de un avío.');

/** Parámetros del kardex de avío ya coaccionados. */
export type KardexAvioQuery = z.infer<typeof esquemaKardexAvioQuery>;

/** Un renglón del kardex de avío. */
const esquemaKardexAvioRenglon = z.object({
  idMovimiento: z.number().int(),
  folio: z.number().int(),
  fecha: z.string(),
  idTipoMov: z.number().int(),
  tipoMov: z.string(),
  direccion: z.enum(['entrada', 'salida', 'traspaso']),
  idAlmacen: z.number().int(),
  almacen: z.string(),
  idLote: z.number().int().nullable(),
  entrada: z.number(),
  salida: z.number(),
  saldo: z.number(),
  costoUnit: z.number().nullable(),
  importe: z.number().nullable(),
  origenTipo: z.string().nullable(),
  origenId: z.string().nullable(),
  cancelado: z.boolean(),
  observaciones: z.string().nullable(),
});

/** Un renglón del kardex de avío tal como lo devuelve la API. */
export type KardexAvioRenglon = z.infer<typeof esquemaKardexAvioRenglon>;

/** Respuesta del kardex de avío. */
export const esquemaKardexAvioLista = z
  .object({
    idAvio: z.number().int(),
    avio: z.string(),
    descripcion: z.string(),
    renglones: z.array(esquemaKardexAvioRenglon),
  })
  .describe('Kardex de un avío (movimientos con saldo corrido).');

/** Forma de la respuesta del kardex de avío. */
export type KardexAvioLista = z.infer<typeof esquemaKardexAvioLista>;

// ── Parámetro de ruta `:id` (movimiento de material) ─────────────────────────────────────────────

/** Parámetro de ruta `:id` del movimiento de material. */
export const esquemaParamIdMaterial = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int()
    .positive()
    .describe('Id del movimiento de material.'),
});
