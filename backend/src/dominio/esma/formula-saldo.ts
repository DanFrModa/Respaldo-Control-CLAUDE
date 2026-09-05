/**
 * ⭐ LA FÓRMULA DEL SALDO DE UN MAQUILERO — **DEFINICIÓN ÚNICA** (V1, fila 0.115).
 *
 *   `saldo = Σcargos + Σabonos − Σpagos − Σdescuentos`
 *
 * Los CUATRO conceptos tienen estado de revisión y los CUATRO lo respetan: al saldo sólo entra lo
 * que YA fue revisado (cargo `validado`, movimiento plano `revisado`). Lo capturado y todavía sin
 * revisar NO suma — pero tampoco desaparece: se devuelve aparte como PENDIENTE DE REVISIÓN, con su
 * desglose y su neto (mismo signo que el saldo), para que nadie vea un número más chico sin razón.
 *
 * ⭐ El CUARTO concepto entró al pendiente en la fila 0.111: los cargos `propuesto` (los recibos que
 * esperan que alguien fije cantidad y precio) faltaban, y por eso un maquilero con diez recibos sin
 * validar y nada más era invisible en las tres pantallas del dinero. Su importe no está guardado: se
 * DERIVA con la regla única de `cargo-propuesto.ts`.
 *
 * ## Por qué existe este archivo
 *
 * La fórmula estaba escrita TRES veces —`saldos.ts` (Prisma), y dos SQL crudos en `saldos-todos.ts`
 * (el tablero y el lote de CxP)— con cuatro agregaciones cada una. El estado de revisión sólo se
 * había puesto en los CARGOS: abonos, pagos y descuentos `capturado` movían el saldo aunque nadie
 * los hubiera autorizado, y el detalle del estado de cuenta ya los marcaba «pendiente» mientras la
 * suma los contaba. Como cada pantalla usaba SU copia, arreglar un archivo habría pasado en verde y
 * dejado mal los otros dos (y con ellos CxP/terceros, que reusan los dos de EsMa).
 *
 * ## La regla, sin excepciones
 *
 * **NINGÚN otro archivo escribe a mano el criterio de un concepto.** Quien sume saldo —con Prisma o
 * con SQL crudo, hoy o en la quinta suma que haga falta— pide aquí su cláusula:
 *
 *  • Prisma → {@link WHERE_CUENTA_CARGO} / `_ABONO` / `_PAGO` / `_DESCUENTO` (y sus `WHERE_PENDIENTE_*`).
 *  • SQL crudo → {@link sqlCuenta} / {@link sqlPendiente}.
 *  • Un renglón suelto (marcar «pendiente» en el detalle) → {@link pendienteDeRevisionPlano} /
 *    {@link pendienteDeRevisionCargo} / {@link cuentaAlSaldoPlano} / {@link cuentaAlSaldoCargo}.
 *  • Los signos y el redondeo → {@link SIGNO_SALDO}, {@link saldoDeTotales}, {@link netoPendiente},
 *    {@link redondear2}.
 *
 * Las dos formas (objeto Prisma y fragmento SQL) NO se escriben por separado: el SQL se GENERA
 * recorriendo el MISMO objeto de {@link DEFINICION} y traduciendo cada campo con su columna. Agregar
 * una condición al criterio la mete en las dos automáticamente, y si falta su columna el generador
 * TRUENA en vez de emitir un SQL más laxo que el Prisma.
 *
 * Innegociables que este archivo sostiene: A1 (la regla vive en el dominio), D3 (el saldo se DERIVA
 * por suma, jamás se persiste).
 */
import { Prisma, type EstadoCargoEsMa, type EstadoRevisionEsMa } from '../../datos/index.js';

/** Redondeo monetario a 2 decimales (evita artefactos de coma flotante en las sumas de productos). */
export function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Los cuatro conceptos que forman el saldo de un maquilero. */
export const CONCEPTOS_SALDO = ['cargo', 'abono', 'pago', 'descuento'] as const;

/** Un concepto del saldo. */
export type ConceptoSaldo = (typeof CONCEPTOS_SALDO)[number];

/**
 * Signo con el que cada concepto entra al saldo (y al pendiente): cargo y abono SUMAN, pago y
 * descuento RESTAN. (Convención propia de EsMa: aquí el «abono» es un cargo EXTRA al maquilero.)
 */
export const SIGNO_SALDO = {
  cargo: 1,
  abono: 1,
  pago: -1,
  descuento: -1,
} as const satisfies Record<ConceptoSaldo, 1 | -1>;

/**
 * Criterio declarativo: campo del modelo Prisma → valor exacto que debe tener para calificar.
 *
 * `null` significa *«esa columna tiene que estar VACÍA»* (`IS NULL` en SQL, `null` en Prisma). Entró
 * con la fila 0.109 para el DESCUENTO CANCELADO: un descuento que un deshacer canceló no cuenta al
 * saldo **ni** cuenta como pendiente de revisión, y eso tenía que decirse aquí —en la definición
 * única— y no en cada una de las cinco sumas que existen.
 */
type Criterio = Readonly<Record<string, string | boolean | null>>;

/** Definición de un concepto: cómo se traduce a SQL y sus dos criterios (cuenta / pendiente). */
interface DefinicionConcepto {
  /** Campo del modelo Prisma → columna física, para generar el SQL desde el MISMO criterio. */
  readonly columnas: Readonly<Record<string, string>>;
  /** Renglones que SÍ entran al saldo. */
  readonly cuenta: Criterio;
  /** Renglones capturados que AÚN esperan revisión (ni suman ni se pierden de vista). */
  readonly pendiente: Criterio;
}

/**
 * ⭐ Los VALORES del criterio, nombrados una sola vez. De aquí salen tanto las cláusulas (Prisma y
 * SQL) como los predicados de un renglón suelto: es imposible que la suma y la marca del detalle
 * digan cosas distintas porque leen la MISMA constante.
 */
const REVISADO: EstadoRevisionEsMa = 'revisado';
const CAPTURADO: EstadoRevisionEsMa = 'capturado';
const CARGO_VALIDADO: EstadoCargoEsMa = 'validado';
const CARGO_PROPUESTO: EstadoCargoEsMa = 'propuesto';
/**
 * El cargo YA REVISADO, con costo o sin él: es lo que cuenta al saldo *antes* de descontar las
 * segundas sin costo, y es también el filtro del DETALLE imprimible (que sí lista las sin costo,
 * en 0). Se nombra aparte para que ese detalle no tenga que escribir `'validado'` por su cuenta.
 */
const CARGO_REVISADO = { estado: CARGO_VALIDADO };
/** Las segundas SIN COSTO no se le pagan al maquilero (decisión (f) de F6): fuera del saldo. */
const CARGO_SIN_COSTO_CUENTA = false;

/**
 * Los tres movimientos PLANOS (abono/pago/descuento) comparten forma y estado de revisión, así que
 * comparten definición: un solo lugar donde dice qué es «revisado» y qué es «pendiente».
 */
const PLANO: DefinicionConcepto = {
  columnas: { estadoRevision: 'estado_revision' },
  cuenta: { estadoRevision: REVISADO },
  pendiente: { estadoRevision: CAPTURADO },
};

/**
 * ⭐ EL DESCUENTO tiene UNA condición más que sus dos hermanos (V1, fila 0.109): estar VIVO. Es el
 * único de los tres movimientos planos que se puede cancelar, porque es el que puede nacer de un
 * acto reversible — el CIERRE de una orden con un maquilero, que propone cobrarle el faltante y que
 * se puede DESHACER mientras nadie lo haya revisado.
 *
 * 🔴 LA CONDICIÓN VA EN LOS **DOS** CRITERIOS, y el segundo es el que casi se olvida: un descuento
 * cancelado obviamente no puede sumar al saldo (`cuenta`), pero tampoco puede seguir apareciendo
 * como *«esperando tu decisión»* (`pendiente`) — si no, el tablero de EsMa y la bandeja de CxP
 * enseñarían para siempre una partida por revisar que ya no existe. Al vivir aquí, la condición
 * viaja sola a las cinco sumas: `saldos.ts` (Prisma), los dos SQL crudos de `saldos-todos.ts`, y de
 * ahí a CxP y a terceros.
 */
const DESCUENTO: DefinicionConcepto = {
  columnas: { estadoRevision: 'estado_revision', canceladoEn: 'cancelado_en' },
  cuenta: { estadoRevision: REVISADO, canceladoEn: null },
  pendiente: { estadoRevision: CAPTURADO, canceladoEn: null },
};

/**
 * El descuento VIVO, a secas (sin decir nada de su revisión). Lo usan las pantallas que LISTAN
 * descuentos —el estado de cuenta, el detalle desglosado, los movimientos del maquilero, la
 * convivencia con terceros—, que no suman saldo pero tampoco pueden enseñar un movimiento que se
 * canceló. Sale de la MISMA constante que los criterios de arriba: si mañana «vivo» cambia de
 * forma, cambia en un solo sitio.
 */
export const WHERE_VIVO_DESCUENTO: Prisma.DescuentoMaquileroWhereInput = { canceladoEn: null };

/**
 * ⭐ EL CRITERIO, UNA SOLA VEZ. Todo lo demás de este módulo se deriva de aquí.
 *
 * El CARGO lleva su propio par de condiciones: `validado` (su equivalente de «revisado», ver el
 * enum `EstadoCargoEsMa`) y `sinCosto = false` (las segundas sin costo no se le pagan al maquilero,
 * decisión (f) de F6). Su «pendiente» es `propuesto`; el `cancelado` no es ni una cosa ni la otra.
 */
const DEFINICION: Readonly<Record<ConceptoSaldo, DefinicionConcepto>> = {
  cargo: {
    columnas: { estado: 'estado', sinCosto: 'sin_costo' },
    cuenta: { ...CARGO_REVISADO, sinCosto: CARGO_SIN_COSTO_CUENTA },
    // ⭐ El pendiente del cargo lleva LAS MISMAS DOS condiciones que el que cuenta, cambiando sólo
    // el estado (V1, fila 0.111). `sin_costo` va en los dos por el mismo motivo que `cancelado_en`
    // en el descuento: una segunda que NO se le va a pagar al maquilero no es dinero esperando una
    // decisión — igual que un cargo `cancelado` no lo es. Hoy ningún cargo nace `sinCosto` (la
    // bandera se fija al VALIDARLO), así que la condición no cambia ni una fila; está aquí para que
    // el día que alguien pueda marcarla antes, las cinco sumas se enteren solas.
    pendiente: { estado: CARGO_PROPUESTO, sinCosto: CARGO_SIN_COSTO_CUENTA },
  },
  abono: PLANO,
  pago: PLANO,
  descuento: DESCUENTO,
};

// ── Cláusulas para PRISMA ────────────────────────────────────────────────────────────────────────
//
// Anotadas con el `WhereInput` de su modelo a propósito: si alguien escribe mal un campo o un valor
// del enum, el criterio NO COMPILA (el generador de SQL de abajo recorre este mismo objeto).

/** Cargos que cuentan al saldo: validados y con costo. */
export const WHERE_CUENTA_CARGO: Prisma.EsMaCargoWhereInput = DEFINICION.cargo.cuenta;
/**
 * Cargos que ya pasaron su revisión, INCLUIDAS las segundas sin costo. No es el criterio del saldo
 * (ésas aportan 0): es el del DETALLE imprimible, que sí las enseña con importe 0 para que el
 * maquilero vea que se recibieron. Vive aquí para que el detalle no re-escriba `'validado'`.
 */
export const WHERE_CARGO_REVISADO: Prisma.EsMaCargoWhereInput = CARGO_REVISADO;
/** Abonos que cuentan al saldo: revisados. */
export const WHERE_CUENTA_ABONO: Prisma.AbonoMaquileroWhereInput = DEFINICION.abono.cuenta;
/** Pagos que cuentan al saldo: revisados. */
export const WHERE_CUENTA_PAGO: Prisma.PagoMaquileroWhereInput = DEFINICION.pago.cuenta;
/** Descuentos que cuentan al saldo: revisados. */
export const WHERE_CUENTA_DESCUENTO: Prisma.DescuentoMaquileroWhereInput =
  DEFINICION.descuento.cuenta;

/**
 * Cargos PROPUESTOS que esperan validación: fuera del saldo, dentro del pendiente (V1, fila 0.111).
 * Su importe no está persistido —se DERIVA con `cargo-propuesto.ts`—, pero la partida existe y
 * alguien tiene que decidir sobre ella.
 */
export const WHERE_PENDIENTE_CARGO: Prisma.EsMaCargoWhereInput = DEFINICION.cargo.pendiente;

/** Abonos capturados que esperan revisión (fuera del saldo, dentro del pendiente). */
export const WHERE_PENDIENTE_ABONO: Prisma.AbonoMaquileroWhereInput = DEFINICION.abono.pendiente;
/** Pagos capturados que esperan revisión. */
export const WHERE_PENDIENTE_PAGO: Prisma.PagoMaquileroWhereInput = DEFINICION.pago.pendiente;
/** Descuentos capturados que esperan revisión. */
export const WHERE_PENDIENTE_DESCUENTO: Prisma.DescuentoMaquileroWhereInput =
  DEFINICION.descuento.pendiente;

// ── Cláusulas para SQL CRUDO (generadas del MISMO criterio) ──────────────────────────────────────

/**
 * Literaliza un valor del criterio. Los valores son CONSTANTES de este módulo (nunca entrada del
 * usuario), y aun así se validan: sólo minúsculas y `_`, para que ningún edit futuro pueda colar
 * algo raro en un `Prisma.raw`.
 */
function literal(valor: string | boolean): string {
  if (typeof valor === 'boolean') {
    return valor ? 'TRUE' : 'FALSE';
  }
  if (!/^[a-z_]+$/.test(valor)) {
    throw new Error(`Valor no literalizable en la fórmula del saldo: "${valor}".`);
  }
  return `'${valor}'`;
}

/**
 * Valida un NOMBRE DE COLUMNA antes de meterlo en un `Prisma.raw`. Igual que {@link literal} con los
 * valores: hoy salen de este archivo, pero lo que entra crudo a un SQL se valida SIEMPRE — no se
 * confía en que el siguiente que edite `DEFINICION` sea igual de cuidadoso.
 *
 * Se exporta sólo para poder aseverar que de verdad rechaza (desde `DEFINICION` no hay forma de
 * alcanzar el caso malo sin romper el tipado).
 */
export function columnaSegura(columna: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(columna)) {
    throw new Error(`Columna no literalizable en la fórmula del saldo: "${columna}".`);
  }
  return columna;
}

/**
 * Traduce un criterio a `("col" = valor AND "col2" = valor2)` usando el mapa de columnas del concepto.
 *
 * ⚠️ El fragmento sale SIEMPRE entre paréntesis. Hoy se intercala en contextos `AND` (`WHERE … AND
 * ${sqlCuenta(…)}`) y `FILTER (WHERE …)`, donde `A AND B` se comportaría igual; pero en cuanto alguien
 * lo meta en un `OR` la precedencia se comería la segunda condición EN SILENCIO —el cargo perdería
 * `sin_costo = FALSE` y el saldo le cobraría al maquilero las segundas que no se le pagan—. Un par de
 * paréntesis cuesta nada y quita la dependencia del contexto del que llama.
 */
function aSql(definicion: DefinicionConcepto, criterio: Criterio): Prisma.Sql {
  const partes = Object.entries(criterio).map(([campo, valor]) => {
    const columna = definicion.columnas[campo];
    if (columna === undefined) {
      throw new Error(
        `La fórmula del saldo no sabe traducir el campo "${campo}" a SQL: falta su columna en ` +
          'DEFINICION (formula-saldo.ts).',
      );
    }
    // `null` es «la columna está vacía»: en SQL eso es `IS NULL`, NUNCA `= NULL` (que no es falso:
    // es DESCONOCIDO, y se comería la fila entera en silencio).
    if (valor === null) {
      return Prisma.raw(`"${columnaSegura(columna)}" IS NULL`);
    }
    return Prisma.raw(`"${columnaSegura(columna)}" = ${literal(valor)}`);
  });
  // Un criterio vacío no debe filtrar nada (y jamás debe quedar en un `WHERE` a medias).
  const condiciones = partes.length === 0 ? Prisma.sql`TRUE` : Prisma.join(partes, ' AND ');
  return Prisma.sql`(${condiciones})`;
}

/** Fragmento SQL con el criterio de lo que CUENTA al saldo, para intercalar en un `WHERE ... AND`. */
export function sqlCuenta(concepto: ConceptoSaldo): Prisma.Sql {
  const definicion = DEFINICION[concepto];
  return aSql(definicion, definicion.cuenta);
}

/** Fragmento SQL con el criterio de lo PENDIENTE de revisión. */
export function sqlPendiente(concepto: ConceptoSaldo): Prisma.Sql {
  const definicion = DEFINICION[concepto];
  return aSql(definicion, definicion.pendiente);
}

// ── Criterio aplicado a UN renglón (para marcar el detalle con el MISMO criterio de la suma) ─────

/** ¿Este movimiento plano (abono/pago/descuento) cuenta al saldo? */
export function cuentaAlSaldoPlano(estadoRevision: EstadoRevisionEsMa): boolean {
  return estadoRevision === REVISADO;
}

/** ¿Este movimiento plano está capturado y esperando revisión? */
export function pendienteDeRevisionPlano(estadoRevision: EstadoRevisionEsMa): boolean {
  return estadoRevision === CAPTURADO;
}

/** ¿Este cargo cuenta al saldo? (validado y con costo — el mismo par de condiciones de la suma). */
export function cuentaAlSaldoCargo(cargo: { estado: EstadoCargoEsMa; sinCosto: boolean }): boolean {
  return cargo.estado === CARGO_VALIDADO && cargo.sinCosto === CARGO_SIN_COSTO_CUENTA;
}

/**
 * ¿Este cargo está esperando validación? Las MISMAS dos condiciones que {@link WHERE_PENDIENTE_CARGO}
 * (propuesto y con costo), para que la marca del renglón y la suma no puedan decir cosas distintas.
 *
 * Su importe todavía no está persistido: se DERIVA con `cargo-propuesto.ts` (cantidad del recibo ×
 * precio de la orden), y puede no poder calcularse — la partida cuenta igual.
 */
export function pendienteDeRevisionCargo(cargo: {
  estado: EstadoCargoEsMa;
  sinCosto: boolean;
}): boolean {
  return cargo.estado === CARGO_PROPUESTO && cargo.sinCosto === CARGO_SIN_COSTO_CUENTA;
}

/**
 * APORTE de UN cargo al saldo, para pintar su renglón en el detalle con el MISMO criterio que usa la
 * suma. Tres casos, y sólo tres:
 *
 *  • cuenta al saldo → su `importeReal` (o `null` si el dato no está);
 *  • segunda SIN COSTO ya validada → `0` (el renglón existe y vale cero, decisión (f) de F6);
 *  • cualquier otro (propuesto, cancelado) → `null`: todavía no se sabe cuánto será.
 */
export function aporteCargoAlSaldo(
  cargo: { estado: EstadoCargoEsMa; sinCosto: boolean },
  importeReal: number | null,
): number | null {
  if (cuentaAlSaldoCargo(cargo)) {
    return importeReal;
  }
  return cargo.estado === CARGO_VALIDADO && cargo.sinCosto ? 0 : null;
}

// ── Aritmética de la fórmula (signos y redondeo, también en un solo lugar) ───────────────────────

/** Totales por concepto, ya redondeados a 2 decimales. */
export interface TotalesSaldo {
  totalCargos: number;
  totalAbonos: number;
  totalPagos: number;
  totalDescuentos: number;
}

/**
 * LO PENDIENTE DE REVISIÓN: lo capturado que todavía no entra al saldo. Se devuelve junto al saldo
 * para que el dinero excluido se vea (y se entienda que espera una decisión), no para sumarlo.
 *
 * ⭐ LOS CUATRO CONCEPTOS ESTÁN AQUÍ (V1, fila 0.111). La 0.115 metió los tres PLANOS —abonos, pagos
 * y descuentos capturados— pero dejó fuera los CARGOS `propuesto`, con el argumento de que «aún no
 * tienen importe». El resultado era el hueco que Daniel describió: un
 * maquilero con diez recibos sin validar y nada más tenía saldo 0, pendiente 0 y era **invisible**
 * en el tablero, en la bandeja de CxP y en la corrida — justo lo que él tiene que decidir cada
 * semana (*«cada semana me pueda meter a algún lugar donde estén todos los maquileros que tengan
 * algo pendiente por pagar o por descontar»*).
 *
 * El importe del cargo propuesto no está persistido, pero **se DERIVA** (`cargo-propuesto.ts`:
 * cantidad del recibo × precio de la orden). Cuando ni eso se puede —orden sin precio y envío sin
 * precio pactado—, la partida cuenta igual y el cargo se anota en {@link cargosSinPrecio}: se dice
 * que no se puede valuar, no se inventa un número ni se esconde la partida.
 */
export interface PendienteRevision {
  /** Σ abonos capturados (suman al neto). */
  abonos: number;
  /** Σ pagos capturados (restan del neto). */
  pagos: number;
  /** Σ descuentos capturados (restan del neto). */
  descuentos: number;
  /**
   * Σ del importe PROPUESTO de los cargos que esperan validación y SÍ se pueden valuar (suman al
   * neto, con el mismo signo que un cargo en el saldo: es dinero que se le va a deber al maquilero).
   */
  cargos: number;
  /** Neto con el MISMO signo del saldo: `cargos + abonos − pagos − descuentos`. */
  neto: number;
  /**
   * CUÁNTAS partidas están esperando revisión: los tres planos capturados **más** los cargos
   * propuestos. Es un CONTEO, no dinero: es lo que decide si hay algo que enseñar, porque los
   * importes pueden netear cero —o no poder calcularse— y aun así haber partidas. Ver
   * {@link hayPendiente}.
   */
  partidas: number;
  /** Cuántas de esas {@link partidas} son cargos propuestos (los «recibos por validar»). */
  cargosPartidas: number;
  /**
   * De los {@link cargosPartidas}, cuántos NO se pueden valuar (sin precio de referencia). Cuentan
   * como partida pero no aportan un peso a {@link cargos}: sin este número, un maquilero con tres
   * recibos sin precio enseñaría «$0.00» y parecería que no hay nada que decidir.
   */
  cargosSinPrecio: number;
}

/**
 * ¿Este saldo es distinto de cero? Con tolerancia de MEDIO CENTAVO: el saldo ya viene redondeado a 2
 * decimales por {@link saldoDeTotales}, pero comparar contra `0` a secas deja la puerta abierta a que
 * el día que alguien sume sin redondear un `-1.1102230246251565e-16` se cuele como "sí debe".
 *
 * Es el criterio con el que el tablero de EsMa y la bandeja de CxP deciden si una fila se ve (junto
 * con {@link hayPendiente}). Estaba escrito tres veces —dos de ellas distintas entre sí, `saldo !== 0`
 * y `Math.abs(saldo) >= 0.005`— que es exactamente el patrón contra el que existe este archivo.
 */
export function tieneSaldo(saldo: number): boolean {
  return Math.abs(saldo) >= 0.005;
}

/** El saldo a partir de los cuatro totales, con los signos de {@link SIGNO_SALDO}. */
export function saldoDeTotales(t: TotalesSaldo): number {
  return redondear2(
    SIGNO_SALDO.cargo * t.totalCargos +
      SIGNO_SALDO.abono * t.totalAbonos +
      SIGNO_SALDO.pago * t.totalPagos +
      SIGNO_SALDO.descuento * t.totalDescuentos,
  );
}

/** Los CUATRO importes del pendiente, sin el neto ni los conteos (entrada de {@link netoPendiente}). */
export type ImportesPendientes = Pick<
  PendienteRevision,
  'abonos' | 'pagos' | 'descuentos' | 'cargos'
>;

/**
 * El neto pendiente a partir de sus cuatro importes, con los MISMOS signos del saldo — incluido el
 * de los CARGOS propuestos, que suman igual que un cargo validado (`SIGNO_SALDO.cargo`): un recibo
 * sin validar es dinero que se le va a DEBER al maquilero, no que se le va a descontar.
 */
export function netoPendiente(p: ImportesPendientes): number {
  return redondear2(
    SIGNO_SALDO.cargo * p.cargos +
      SIGNO_SALDO.abono * p.abonos +
      SIGNO_SALDO.pago * p.pagos +
      SIGNO_SALDO.descuento * p.descuentos,
  );
}

/**
 * ¿Hay algo capturado esperando revisión? Lo decide el CONTEO de partidas, no los importes.
 *
 * Mirar el neto no alcanza —un abono y un pago capturados del mismo importe lo dejan en 0— pero
 * mirar los tres subtotales TAMPOCO: el ETL carga a propósito montos NEGATIVOS (`esma/migracion.ts`,
 * los "saldo anterior" del Access), así que dos abonos de +500 y −500 suman 0 y volverían a
 * esconder dos partidas reales. Con el conteo la respuesta es exacta en todos los casos.
 *
 * Es el criterio con el que el tablero decide si un maquilero se ve, el que usa el papel para
 * imprimir el renglón «Por revisar» y el que usa la pantalla para anunciarlo. Uno solo.
 */
export function hayPendiente(p: Pick<PendienteRevision, 'partidas'>): boolean {
  return p.partidas > 0;
}

/**
 * Lo que hay que MEDIR para armar un bloque de pendiente. Va como objeto y no como lista de
 * argumentos a propósito (V1, fila 0.111): al entrar los cargos serían SEIS números seguidos del
 * mismo tipo, y equivocarse de posición no lo caza el compilador — pero sí cambia el dinero que ve
 * Daniel.
 */
export interface EntradaPendiente {
  /** Σ abonos capturados. */
  abonos: number;
  /** Σ pagos capturados. */
  pagos: number;
  /** Σ descuentos capturados. */
  descuentos: number;
  /** Σ del importe propuesto de los cargos que SÍ se pueden valuar. */
  cargos: number;
  /** Cuántas partidas PLANAS (abonos + pagos + descuentos) esperan revisión. */
  partidasPlanas: number;
  /** Cuántos CARGOS propuestos esperan validación (se puedan valuar o no). */
  cargosPartidas: number;
  /** De ésos, cuántos no se pueden valuar por falta de precio. */
  cargosSinPrecio: number;
}

/**
 * Arma el bloque de pendiente (sus cuatro importes redondeados + el neto + los conteos) de una vez.
 *
 * ⭐ El CONTEO TOTAL se suma AQUÍ (`partidasPlanas + cargosPartidas`), no en quien llama: es la
 * garantía de que los cargos propuestos entren en `partidas` en los tres caminos —Prisma, el SQL del
 * tablero y el SQL del lote de CxP— sin que ninguno se pueda olvidar. Y `partidas` es lo que decide
 * si el maquilero se ve ({@link hayPendiente}).
 */
export function armarPendiente(e: EntradaPendiente): PendienteRevision {
  const partes = {
    abonos: redondear2(e.abonos),
    pagos: redondear2(e.pagos),
    descuentos: redondear2(e.descuentos),
    cargos: redondear2(e.cargos),
  };
  return {
    ...partes,
    neto: netoPendiente(partes),
    partidas: e.partidasPlanas + e.cargosPartidas,
    cargosPartidas: e.cargosPartidas,
    cargosSinPrecio: e.cargosSinPrecio,
  };
}

/** Un bloque de pendiente VACÍO (nada esperando decisión): el neutro de {@link armarPendiente}. */
export const PENDIENTE_VACIO: EntradaPendiente = {
  abonos: 0,
  pagos: 0,
  descuentos: 0,
  cargos: 0,
  partidasPlanas: 0,
  cargosPartidas: 0,
  cargosSinPrecio: 0,
};

/** El bloque de pendiente tal como VIAJA al cliente: importes en `null` si se ocultan; los conteos siempre. */
export interface PendienteRevisionSalida {
  abonos: number | null;
  pagos: number | null;
  descuentos: number | null;
  cargos: number | null;
  neto: number | null;
  partidas: number;
  cargosPartidas: number;
  cargosSinPrecio: number;
}

/**
 * Prepara el pendiente para salir por el API respetando `consultas.ver-importes`: los CUATRO importes
 * se ocultan, los TRES CONTEOS no (`partidas`, `cargosPartidas`, `cargosSinPrecio`). No es un importe, y sin él quien no puede ver dinero tampoco sabría que
 * hay partidas esperando decisión — que es justo lo que esta fila vino a destapar. Un solo lugar para
 * esa regla: el saldo de uno, el tablero de EsMa y la bandeja de CxP la aplican igual.
 */
export function pendienteParaSalida(
  p: PendienteRevision,
  puedeVerImportes: boolean,
): PendienteRevisionSalida {
  const oculto = (v: number): number | null => (puedeVerImportes ? v : null);
  return {
    abonos: oculto(p.abonos),
    pagos: oculto(p.pagos),
    descuentos: oculto(p.descuentos),
    cargos: oculto(p.cargos),
    neto: oculto(p.neto),
    partidas: p.partidas,
    cargosPartidas: p.cargosPartidas,
    cargosSinPrecio: p.cargosSinPrecio,
  };
}

// ── ⭐ EL SEGMENTO CON / SIN FACTURA, TAMBIÉN UNA SOLA VEZ (fila 0.113) ──────────────────────────
//
// El saldo de un maquilero se puede partir en dos: lo que se le paga CON factura y lo que se le paga
// SIN ella. Daniel arma DOS relaciones de pago cada semana, una por segmento (§Post-F9.189(a)), así
// que los dos segmentos tienen que ser una PARTICIÓN EXACTA: cada peso está en uno y sólo uno.
//
// 🔴 **Y no lo eran.** `conFactura` es NULLABLE (así quedaron los movimientos migrados del Access,
// donde la pregunta jamás se hizo) y el criterio del segmento «sin» estaba escrito DOS VECES, con
// dos respuestas distintas:
//   • `esma/estado-cuenta.ts` y `esma/saldos.ts` → `conFactura = false` (los NULL quedaban FUERA);
//   • `terceros/convivencia-esma.ts`             → `false OR null` (los NULL quedaban DENTRO).
// El mismo maquilero, la misma pregunta, dos respuestas — y en medio, dinero: un movimiento sin
// definir no salía en NINGUNA de las dos relaciones y nadie lo hubiera pagado nunca.
//
// **La verdad única es la de la partición: «sin factura» = `false` O SIN DEFINIR.** Es la que ya
// razonó `convivencia-esma.ts` (el encabezado calcula `saldoSinFactura = saldo − saldoFiscal`, así
// que si la lista dejara fuera los NULL el total y los renglones se contradirían), y es la que hace
// que las dos corridas de la semana sumen el total.
//
// 🔴 **NO se escribe `{ not: true }`**, que es lo que parece natural: en lógica de tres valores
// `NULL <> true` evalúa a NULL y la fila se descarta igual que con `= false`. La ÚNICA forma que
// trae los NULL es la explícita.

/** Los dos segmentos de facturación de un movimiento de EsMa. */
export type SegmentoFactura = 'con' | 'sin';

/** Forma de la cláusula Prisma del segmento (los cuatro modelos de EsMa comparten el campo). */
export interface WhereSegmentoFactura {
  conFactura?: boolean;
  OR?: { conFactura: boolean | null }[];
}

/**
 * Cláusula `where` de PRISMA del segmento de facturación, o `{}` si no se segmenta.
 *
 * `con` → `conFactura = true`. `sin` → `false` **o** sin definir (ver el bloque de arriba: es una
 * partición, no un filtro cualquiera). Sirve para los cuatro modelos de EsMa (cargo, abono, pago y
 * descuento comparten el campo `conFactura`).
 */
export function whereSegmentoFactura(segmento: SegmentoFactura | undefined): WhereSegmentoFactura {
  if (segmento === undefined) {
    return {};
  }
  if (segmento === 'con') {
    return { conFactura: true };
  }
  return { OR: [{ conFactura: false }, { conFactura: null }] };
}

/**
 * El MISMO criterio en SQL crudo, para intercalar en un `WHERE … AND ${…}`. Sale siempre entre
 * paréntesis (el `OR` del segmento «sin» se comería la condición de al lado sin ellos — el mismo
 * cuidado que {@link aSql}). Sin segmento devuelve `TRUE`, que es neutro en un `AND`.
 */
export function sqlSegmentoFactura(segmento: SegmentoFactura | undefined): Prisma.Sql {
  if (segmento === undefined) {
    return Prisma.sql`(TRUE)`;
  }
  if (segmento === 'con') {
    return Prisma.sql`("con_factura" = TRUE)`;
  }
  return Prisma.sql`("con_factura" = FALSE OR "con_factura" IS NULL)`;
}
