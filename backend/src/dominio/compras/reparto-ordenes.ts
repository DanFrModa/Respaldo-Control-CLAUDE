/**
 * ⭐ **SE VE JUNTO, SE GUARDA REPARTIDO** (V1-E3q, §Post-F9.86) — función PURA (sin BD).
 *
 * Daniel: *"¿cómo hacemos cuando una OC cubre varias OP? Es muy muy común… Normalmente compramos
 * varias OP con una sola OC"*, y su condición innegociable: **el reparto es SIEMPRE por OP**,
 * *"sin eso, el 'qué tengo / qué falta' de cada OP deja de cuadrar y el costo no cae donde debe"*.
 *
 * De ahí salen las dos mitades de esta etapa:
 *  • La pantalla **agrupa** las cantidades de un material entre las OP elegidas (lo que el
 *    comprador quiere ver: *"¿cuánta felpa negra pido hoy?"*).
 *  • La orden de compra **guarda una línea por (material, OP)** — cada `OrdenCompraLinea` conserva
 *    su `idOrden`, que es lo que hace que R7 y el costeo sigan cuadrando sin prorrateos inventados.
 *
 * Este módulo resuelve el único punto donde las dos mitades se tocan: **el sobrante de compra**.
 * Daniel lo cerró explícitamente — *"el sobrante de compra se reparte entre las OP de la compra…
 * comprar el rollo completo es una decisión del comprador **en el momento de comprar**: es un hecho
 * entonces, y por eso sí se reparte"*. Cuando el comprador sube el total de un material (compra el
 * rollo entero, o el mínimo del proveedor), ese total hay que volverlo a repartir entre las OP.
 *
 * ⚠️ **Y su contrario, que Daniel TUMBÓ:** el FALTANTE de la recepción NO se reparte (*"los consumos
 * son estimados… a la hora de ir descargando las telas es cuando se va a poder saber a cuál
 * aplica"*). No es contradicción: el sobrante es una decisión tomada AL COMPRAR (un hecho), el
 * faltante es un dato que todavía no existe cuando llega el material. Por eso este archivo vive en
 * `compras/` y no hay nada equivalente en recepciones.
 */

/** Decimales con los que la BD guarda cantidades (`Decimal(_, 4)`): el reparto no inventa más. */
const DECIMALES = 4;

/** Redondea a la precisión de la BD (evita colas de 0.30000000000000004 en el reparto). */
function redondear(valor: number): number {
  return Math.round(valor * 10 ** DECIMALES) / 10 ** DECIMALES;
}

/**
 * Reparte `total` entre las OP en PROPORCIÓN a lo que cada una necesita (`base`), devolviendo un
 * arreglo alineado con la entrada.
 *
 * Reglas, todas deliberadas:
 *  • **Proporcional a la necesidad.** Si la OP A necesita 100 kg y la B 50, un rollo de 180 se
 *    reparte 120/60. Repartir en partes iguales le daría a la B más de lo que consume y a la A
 *    menos de lo que pidió — y el "qué falta" de la A seguiría rojo después de haber comprado.
 *  • **La ÚLTIMA OP absorbe el residuo del redondeo**, para que la suma del reparto sea EXACTAMENTE
 *    `total`. Sin esto, comprar 100 entre tres OP guardaría 99.9999 y el documento no cuadraría con
 *    sus renglones — un descuadre de centésimas que nadie encuentra y todos desconfían.
 *  • **Si nadie necesita nada** (todas las bases en cero, caso del ajuste sobre un material ya
 *    cubierto), se reparte en partes IGUALES: no hay proporción que respetar y dejarlo todo en la
 *    primera OP sería una decisión escondida.
 *  • **Bases negativas se tratan como cero** (una necesidad negativa no existe).
 *
 * @param bases lo que cada OP necesita, en el orden en que se van a escribir las líneas.
 * @param total cantidad total a comprar de ese material a ese proveedor.
 */
export function repartirEntreOrdenes(bases: readonly number[], total: number): number[] {
  if (bases.length === 0) return [];
  if (bases.length === 1) return [redondear(total)];

  const limpias = bases.map((b) => (b > 0 ? b : 0));
  const suma = limpias.reduce((s, b) => s + b, 0);

  const repartido: number[] = [];
  let acumulado = 0;
  for (let i = 0; i < limpias.length - 1; i += 1) {
    const base = limpias[i] ?? 0;
    const parte = suma > 0 ? redondear((total * base) / suma) : redondear(total / limpias.length);
    repartido.push(parte);
    acumulado += parte;
  }
  // La última se lleva EXACTAMENTE lo que falta para cerrar el total (residuo del redondeo incluido).
  repartido.push(redondear(total - acumulado));
  return repartido;
}
