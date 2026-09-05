/**
 * ⭐ CUÁNTO VALE UN CARGO TODAVÍA **PROPUESTO** — **DEFINICIÓN ÚNICA** (V1, fila 0.111).
 *
 *   `importe propuesto = (Σ cantidad de los detalles del recibo) × precio de referencia`
 *
 * El cargo `propuesto` es el recibo de maquila que espera que alguien lo VALIDE fijando cantidad y
 * precio reales. Mientras tanto no tiene importe persistido —`cantidadReal`/`precioReal` son NULL—,
 * así que su valor se **DERIVA**: la cantidad, de las piezas del recibo; el precio, de la ORDEN
 * (decisión (e) de F6-E4) con caída al `precioPactado` del envío.
 *
 * ## Por qué existe este archivo
 *
 * Esa derivación estaba escrita en UN solo sitio —la proyección de la cola de validación
 * (`cargos.ts::aCargoSalida`)— y la fila 0.111 necesitaba el MISMO número en otros dos: el bloque
 * «por revisar» del saldo, que se calcula con Prisma (`saldos.ts`) y con SQL agregado
 * (`saldos-todos.ts`, que alimenta el tablero, la bandeja de CxP y la corrida semanal). Tres copias
 * de una regla de dinero es exactamente el defecto que `formula-saldo.ts` vino a matar para el
 * saldo; aquí se evita de entrada.
 *
 * ## La regla, sin excepciones
 *
 * **NADIE vuelve a escribir «costura → maquilaOrd, lo demás → aplicacionOrd» ni el fallback.**
 *
 *  • TypeScript (una fila a la vez) → {@link precioDeReferenciaDelCargo} / {@link valuarCargoPropuesto}.
 *  • SQL agregado (todos los maquileros de un tiro) → {@link sqlCargosPropuestosPorMaquilero}.
 *  • El `select` de Prisma que trae lo que la regla necesita → {@link SELECT_VALUACION_PROPUESTA}.
 *
 * Las dos formas comparten la constante {@link CODIGO_PROCESO_COSTURA} y el mismo orden de caída.
 * `cargo-propuesto.test.ts` mide la FORMA sin base de datos (mismas columnas, misma constante,
 * mismo orden de caída) y `saldo-fuente-unica.int.test.ts` las cruza sobre los MISMOS datos —
 * compara el pendiente del saldo de uno en uno (Prisma) con el del tablero (SQL) con `toEqual`—: si
 * una cambia y la otra no, se pone rojo.
 *
 * ⚠️ El precio puede ser **NULL** (orden sin precio y envío sin `precioPactado`, o un cargo migrado
 * sin recibo): entonces el cargo **no se puede valuar** pero **SÍ cuenta como partida** esperando
 * decisión. Los dos caminos lo dicen igual: el importe deja de sumar y el cargo se cuenta aparte en
 * `cargosSinPrecio`. Nunca se inventa un precio (REGLA 0-B: lo que falta se tolera, no se rellena).
 *
 * Innegociables: A1 (la regla vive en el dominio), A9 (el agregado se acota a la empresa activa).
 */
import { Prisma, type ServicioOrden } from '../../datos/index.js';

import { sqlPendiente } from './formula-saldo.js';

/**
 * Código del `TipoProceso` de COSTURA. Es el ÚNICO proceso que se valúa con el precio de costura de
 * la orden (`maquilaOrd`); estampado, aplicación y todos los demás van con `aplicacionOrd`.
 * (Decisión (e) de F6-E4, que corrige el defecto de v1: `EsMaRecibosSemEstCon` usaba `MaquilaOrd`
 * también para el estampado y le pagaba de más al taller de estampado.)
 */
export const CODIGO_PROCESO_COSTURA = 'costura';

/** Lo que la regla del precio necesita saber de un cargo (todo ya en `number`, o `null`). */
export interface DatosPrecioCargo {
  /**
   * SERVICIO sobre la orden del cargo (`corte`/`empaque`, 0.114), o `null` si es de maquila.
   * Excluyente con {@link codigoProceso}: el CHECK `esma_cargo_proceso_o_servicio` garantiza que
   * exactamente uno de los dos viene lleno.
   */
  servicio: ServicioOrden | null;
  /** `codigo` del tipo de proceso del cargo (`costura`, `estampado`, …), o `null` si es servicio. */
  codigoProceso: string | null;
  /** Precio de COSTURA de la orden (`Orden.maquilaOrd`), o null si la orden no lo trae. */
  maquilaOrd: number | null;
  /** Precio de APLICACIÓN/ESTAMPADO de la orden (`Orden.aplicacionOrd`), o null. */
  aplicacionOrd: number | null;
  /**
   * Precio pactado de la ETAPA que originó el cargo (`EtapaMovimiento.precioPactado`), o null: el
   * ENVÍO en una maquila, la etapa de CORTE o de EMPAQUE en un servicio.
   */
  precioPactado: number | null;
}

/**
 * ⭐ EL PRECIO DE REFERENCIA de un cargo propuesto, en un solo lugar: el de la ORDEN según el
 * proceso y, si la orden no lo trae, el `precioPactado` de la etapa. `null` = no se puede valuar (y
 * entonces el cargo cuenta como partida sin importe, nunca con un importe inventado).
 *
 * 🔴 UN CARGO DE SERVICIO (corte/empaque, 0.114) VA SÓLO CON SU `precioPactado`. La orden trae
 * `maquilaOrd`/`aplicacionOrd`, que son precios de MAQUILA: no hay en ella un precio de corte ni uno
 * de empaque, y prestarle al cortador el de la costura le propondría un número inventado —peor que
 * no proponerle nada—. Sin precio pactado en su etapa, el cargo simplemente no se puede valuar.
 * (Misma regla que ya aplicaba `cargos.ts` en la cola de validación desde la 0.114; aquí vive una
 * sola vez para que las tres puertas del saldo la hereden.)
 */
export function precioDeReferenciaDelCargo(d: DatosPrecioCargo): number | null {
  if (d.servicio !== null) {
    return d.precioPactado;
  }
  const precioOrden = d.codigoProceso === CODIGO_PROCESO_COSTURA ? d.maquilaOrd : d.aplicacionOrd;
  return precioOrden ?? d.precioPactado;
}

/**
 * IMPORTE propuesto = cantidad × precio, o `null` si no hay precio. **Sin redondear a propósito**:
 * es un producto que después se SUMA, y el redondeo va al final de la suma (misma convención que
 * `totalCargos` en `formula-saldo.ts`, para que los dos caminos no se separen un centavo).
 */
export function importePropuestoDelCargo(cantidad: number, precio: number | null): number | null {
  return precio === null ? null : cantidad * precio;
}

/**
 * `select` de Prisma con TODO lo que la regla necesita de un cargo propuesto. Vive aquí para que
 * quien quiera valuar no tenga que adivinar qué campos pedir (y para que agregar un insumo a la
 * regla no deje a un consumidor leyendo de menos).
 *
 * ⚠️ `detalles.cantidad` es lo que se PAGA. `cantidadIncompletas` NO se pide a propósito
 * (§Post-F9.136: *«tampoco se pagan»*): toda pieza que entrara aquí acabaría multiplicada por un
 * precio.
 */
export const SELECT_VALUACION_PROPUESTA = {
  idMaquilero: true,
  orden: { select: { maquilaOrd: true, aplicacionOrd: true } },
  // 0.114: el proceso es NULLABLE (un cargo de corte/empaque no tiene) y el `servicio` es lo que
  // ocupa su lugar. Se piden LOS DOS porque la regla del precio los mira a los dos.
  servicio: true,
  tipoProceso: { select: { codigo: true } },
  etapaRecibo: { select: { precioPactado: true, detalles: { select: { cantidad: true } } } },
} satisfies Prisma.EsMaCargoSelect;

/** Un cargo propuesto tal como lo devuelve {@link SELECT_VALUACION_PROPUESTA}. */
export type CargoPropuestoCrudo = Prisma.EsMaCargoGetPayload<{
  select: typeof SELECT_VALUACION_PROPUESTA;
}>;

/** Valuación de un cargo propuesto: sus piezas, su precio de referencia y su importe. */
export interface ValuacionPropuesta {
  cantidad: number;
  precio: number | null;
  /** `cantidad × precio`, o `null` cuando no hay precio (el cargo cuenta, el importe no). */
  importe: number | null;
}

/**
 * VALÚA un cargo propuesto leído con {@link SELECT_VALUACION_PROPUESTA}. Es la forma TypeScript de
 * la misma regla que emite {@link sqlCargosPropuestosPorMaquilero} en SQL.
 *
 * Un cargo MIGRADO del Access no tiene recibo (`idEtapaRecibo` NULL): su cantidad es 0 y su precio,
 * el de la orden si lo hay. Eso NO es un defecto — es el histórico llegando con huecos, y se tolera
 * sin rellenarlo (REGLA 0-B).
 */
export function valuarCargoPropuesto(c: CargoPropuestoCrudo): ValuacionPropuesta {
  const cantidad = (c.etapaRecibo?.detalles ?? []).reduce((s, d) => s + d.cantidad, 0);
  const precio = precioDeReferenciaDelCargo({
    servicio: c.servicio,
    codigoProceso: c.tipoProceso?.codigo ?? null,
    maquilaOrd: c.orden.maquilaOrd?.toNumber() ?? null,
    aplicacionOrd: c.orden.aplicacionOrd?.toNumber() ?? null,
    precioPactado: c.etapaRecibo?.precioPactado?.toNumber() ?? null,
  });
  return { cantidad, precio, importe: importePropuestoDelCargo(cantidad, precio) };
}

/**
 * Valida un ALIAS de tabla antes de meterlo en un `Prisma.raw`. Igual que `columnaSegura` en
 * `formula-saldo.ts`: hoy los alias salen de este archivo, pero lo que entra crudo a un SQL se
 * valida SIEMPRE.
 */
function aliasSeguro(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) {
    throw new Error(`Alias no literalizable en la valuación del cargo propuesto: "${alias}".`);
  }
  return alias;
}

/**
 * El precio de referencia EN SQL, con los alias de las cuatro tablas que lo alimentan. Sale de la
 * MISMA constante {@link CODIGO_PROCESO_COSTURA} y respeta el MISMO orden de caída que
 * {@link precioDeReferenciaDelCargo} — la diferencia entre los dos caminos es la sintaxis, no la
 * regla.
 *
 * 🔴 EL PRIMER `WHEN` NO ES DECORATIVO. Un cargo de SERVICIO no tiene `id_tipo_proceso`, así que
 * llega por un `LEFT JOIN` con `tp."codigo"` en NULL; sin esa rama, `tp."codigo" = 'costura'` daría
 * NULL —que **no** es TRUE— y el `CASE` caería al `ELSE`, valuando el corte con el precio de
 * APLICACIÓN de la orden. La forma TypeScript sale por `if (d.servicio !== null)` antes de mirar el
 * proceso; ésta tiene que decir exactamente lo mismo.
 *
 * Se exporta para poder aseverarlo sin base de datos (que nombra las columnas y el `COALESCE`).
 */
export function sqlPrecioDeReferencia(
  aliasOrden: string,
  aliasProceso: string,
  aliasRecibo: string,
  aliasCargo: string,
): Prisma.Sql {
  const o = aliasSeguro(aliasOrden);
  const tp = aliasSeguro(aliasProceso);
  const em = aliasSeguro(aliasRecibo);
  const ec = aliasSeguro(aliasCargo);
  return Prisma.sql`COALESCE(
    CASE
      WHEN ${Prisma.raw(`${ec}."servicio"`)} IS NOT NULL THEN NULL
      WHEN ${Prisma.raw(`${tp}."codigo"`)} = ${CODIGO_PROCESO_COSTURA}
        THEN ${Prisma.raw(`${o}."maquila_ord"`)}
      ELSE ${Prisma.raw(`${o}."aplicacion_ord"`)}
    END,
    ${Prisma.raw(`${em}."precio_pactado"`)}
  )`;
}

/**
 * ⭐ EL AGREGADO: por maquilero, cuántos cargos `propuesto` esperan validación, cuánto SUMAN los que
 * se pueden valuar y cuántos NO se pueden valuar. Una subconsulta lista para intercalar en un
 * `LEFT JOIN ( … ) alias ON …`, con estas tres columnas:
 *
 *  • `id_maquilero` · `partidas` (int) · `importe` (numeric) · `sin_precio` (int).
 *
 * 🔴 EL FILTRO NO SE ESCRIBE AQUÍ: sale de `formula-saldo.ts::sqlPendiente('cargo')`, la definición
 * única de «qué cargo está esperando decisión» (propuesto y con costo). Y va dentro de una
 * subconsulta de UNA sola tabla a propósito: ese fragmento emite `"estado"` / `"sin_costo"` sin
 * calificar, y en la consulta de arriba —con `ordenes`, `tipos_proceso` y `etapa_movimiento`
 * unidos— un `"estado"` pelón sería AMBIGUO (o peor: se resolvería a la columna equivocada).
 *
 * ⚠️ El segmento de facturación se pasa entero (`AND (…)` o vacío) y también se aplica dentro de esa
 * subconsulta. CONSECUENCIA REAL, dicha en voz alta: un cargo propuesto tiene `conFactura` NULL
 * (se fija al VALIDARLO), y «sin factura» = `false` **o sin definir**, así que los propuestos caen
 * ENTEROS en la relación SIN factura y ninguno en la CON. Es lo que dice la partición única de
 * `formula-saldo.ts` §segmento, y es lo correcto: nadie ha decidido todavía cómo se le va a pagar.
 */
export function sqlCargosPropuestosPorMaquilero(
  idEmpresa: number,
  factura: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`
    SELECT
      cp."id_maquilero",
      COUNT(*)::int                                      AS "partidas",
      COALESCE(SUM(cp."cantidad" * cp."precio"), 0)      AS "importe",
      (COUNT(*) FILTER (WHERE cp."precio" IS NULL))::int AS "sin_precio"
    FROM (
      SELECT
        ec."id_maquilero",
        COALESCE(det."cantidad", 0)                  AS "cantidad",
        ${sqlPrecioDeReferencia('o', 'tp', 'em', 'ec')} AS "precio"
      FROM (
        SELECT "id_maquilero", "id_etapa_recibo", "id_orden", "id_tipo_proceso", "servicio"
        FROM "esma_cargo"
        WHERE "id_empresa" = ${idEmpresa} AND ${sqlPendiente('cargo')} ${factura}
      ) ec
      JOIN "ordenes" o        ON o."id"  = ec."id_orden"
      -- 🔴 LEFT, no INNER (0.114): un cargo de CORTE o de EMPAQUE trae id_tipo_proceso en NULL, y
      -- un INNER JOIN lo dejaría FUERA del agregado — o sea, borraría del tablero justo a los
      -- servicios que esta fila vino a hacer visibles.
      LEFT JOIN "tipos_proceso" tp ON tp."id" = ec."id_tipo_proceso"
      LEFT JOIN "etapa_movimiento" em ON em."id" = ec."id_etapa_recibo"
      LEFT JOIN (
        SELECT "id_etapa_mov", SUM("cantidad") AS "cantidad"
        FROM "etapa_movimiento_det"
        GROUP BY "id_etapa_mov"
      ) det ON det."id_etapa_mov" = ec."id_etapa_recibo"
    ) cp
    GROUP BY cp."id_maquilero"
  `;
}
