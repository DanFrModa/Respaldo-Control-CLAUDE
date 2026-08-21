/**
 * ⭐ **SE VE JUNTO, SE GUARDA REPARTIDO** (V1-E3q, §Post-F9.86) — funciones PURAS (sin BD).
 *
 * Daniel: *"¿cómo hacemos cuando una OC cubre varias OP? Es muy muy común… Normalmente compramos
 * varias OP con una sola OC"*, y su condición innegociable: **el reparto es SIEMPRE por OP**,
 * *"sin eso, el 'qué tengo / qué falta' de cada OP deja de cuadrar y el costo no cae donde debe"*.
 *
 * De ahí las dos mitades de la etapa:
 *  • La pantalla **agrupa** las cantidades de un material entre las OP elegidas (lo que el comprador
 *    quiere ver: *"¿cuánta felpa negra pido hoy?"*).
 *  • La orden de compra **guarda una línea por (material, OP)** — cada `OrdenCompraLinea` conserva
 *    su `idOrden`, que es lo que hace que R7 y el costeo sigan cuadrando sin prorrateos inventados.
 *
 * Este módulo resuelve el punto donde las dos mitades se tocan: **el sobrante de compra**. Daniel lo
 * cerró explícitamente — *"el sobrante de compra se reparte entre las OP de la compra… comprar el
 * rollo completo es una decisión del comprador **en el momento de comprar**: es un hecho entonces, y
 * por eso sí se reparte"*.
 *
 * ⚠️ **Y su contrario, que Daniel TUMBÓ:** el FALTANTE de la recepción NO se reparte (*"los consumos
 * son estimados… a la hora de ir descargando las telas es cuando se va a poder saber a cuál
 * aplica"*). No es contradicción: el sobrante es una decisión tomada AL COMPRAR (un hecho), el
 * faltante es un dato que todavía no existe cuando llega el material. Por eso este archivo vive en
 * `compras/` y no hay nada equivalente en recepciones.
 */
import { redondear2 } from '../costos/decimales.js';

/**
 * 🔴 **LA ESCALA MANDA DESDE EL DESTINO, NO DESDE EL ORIGEN** (corrección del reviewer, 21-ago-2026).
 *
 * La cantidad repartida acaba en **`OrdenCompraLinea.cantidad Decimal(14, 2)`** — DOS decimales—,
 * aunque venga de columnas con cuatro (`RequerimientoOrden.cantidadAComprar Decimal(14,4)`, el BOM
 * `Decimal(12,4)`). La primera versión de este módulo redondeaba a **4** y decía en un comentario que
 * ésa era "la precisión con la que la BD guarda cantidades": **era falso para el destino real de
 * estos números**, y de esa mentira salieron tres defectos medidos, no teóricos:
 *
 *  1. **El renglón REAPARECÍA** — la queja literal de Daniel. Requerido `3.7020` → la línea guarda
 *     `3.70` → al recalcular quedaba `0.002` pendiente, por encima de la tolerancia de 1e-6, y el
 *     material volvía a salir comprable.
 *  2. **Cadena de OC basura**: cada vuelta generaba otra OC con la línea en `0.00`, **quemando un
 *     folio** (A3) por documento vacío. Peor que el defecto original, que al menos era visible.
 *  3. **Σ(líneas) ≠ lo comprado**: 100 entre tres OP iguales guardaba `[33.33, 33.33, 33.33]` =
 *     **99.99**, así que la revisión previa **mentía** — justo lo que §Post-F9.85 vino a impedir.
 *
 * La regla, escrita para que no se vuelva a torcer: **se redondea a la escala de la columna donde el
 * número va a vivir**, y quien reparte cierra la suma EN ESA escala. Es la misma regla que ya
 * explicaba `costos/decimales.ts` en su escala (*"lo que se guarda y lo que se usa para derivar
 * tienen que ser EL MISMO número"*); aquí sólo cambia cuál es la columna de destino.
 */
export const ESCALA_CANTIDAD_COMPRA = 2;

/**
 * Redondea una cantidad a la escala de `OrdenCompraLinea.cantidad`. Reusa `redondear2` para que
 * exista **una sola** rutina de redondeo en el sistema (la escala coincide con la monetaria por
 * casualidad, no por parentesco: el nombre de aquí dice de qué columna hablamos).
 *
 * Postgres redondea *half away from zero* al escribir; `Math.round` lo hace *half up*. Coinciden en
 * los no-negativos, que es todo lo que puede ser una cantidad a comprar.
 */
export function redondearCantidadCompra(n: number): number {
  return redondear2(n);
}

/**
 * Media unidad del último dígito que la columna puede guardar (`0.005` a dos decimales): **por
 * debajo de esto la cantidad NO EXISTE en la base** — se guardaría como `0.00`.
 *
 * Es el corte correcto para *"¿queda algo por comprar?"* y para *"¿esta línea vale la pena?"*. La
 * `TOLERANCIA` de 1e-6 de `mrp.ts` sigue siendo la buena para comparar valores de las columnas de
 * **4** decimales (el snapshot, el semáforo R7); usarla contra una cantidad que va a una columna de
 * 2 es lo que dejaba pasar astillas de `0.002` como si fueran compras pendientes.
 */
export const MINIMO_CANTIDAD_COMPRA = 0.005;

/** ¿Esta cantidad sobrevive al guardarse (≥ 0.01), o se volvería `0.00`? */
export function seGuardaComoAlgo(cantidad: number): boolean {
  return cantidad >= MINIMO_CANTIDAD_COMPRA;
}

/**
 * Reparte `total` entre las OP en PROPORCIÓN a lo que cada una necesita (`bases`), devolviendo un
 * arreglo alineado con la entrada **ya redondeado a la escala en la que se va a guardar**.
 *
 * Reglas, todas deliberadas:
 *  • **Proporcional a la necesidad.** Si la OP A necesita 100 kg y la B 50, un rollo de 180 se
 *    reparte 120/60. Repartir en partes iguales le daría a la B más de lo que consume y a la A menos
 *    de lo que pidió — y el "qué falta" de la A seguiría rojo después de haber comprado.
 *  • **La ÚLTIMA OP absorbe el residuo, EN LA ESCALA DEL DESTINO**, para que la suma de lo GUARDADO
 *    sea exactamente el total comprado. Ésta es la mitad que faltaba: absorber el residuo a 4
 *    decimales y luego dejar que la BD recortara a 2 devolvía documentos que no cuadraban con sus
 *    propios renglones (`99.99` de un total de `100`).
 *  • **Si nadie necesita nada** (todas las bases en cero, caso del ajuste sobre un material ya
 *    cubierto), se reparte en partes IGUALES: no hay proporción que respetar y dejarlo todo en la
 *    primera sería una decisión escondida.
 *  • **Bases negativas se tratan como cero** (una necesidad negativa no existe).
 *
 * @param bases lo que cada OP necesita, en el orden en que se van a escribir las líneas.
 * @param total cantidad total a comprar de ese material a ese proveedor.
 */
export function repartirEntreOrdenes(bases: readonly number[], total: number): number[] {
  if (bases.length === 0) return [];
  // El total también se lleva a la escala del destino: repartir un número que la columna no puede
  // guardar sería empezar a mentir desde la primera operación.
  const totalGuardable = redondearCantidadCompra(total);
  if (bases.length === 1) return [totalGuardable];

  const limpias = bases.map((b) => (b > 0 ? b : 0));
  const suma = limpias.reduce((s, b) => s + b, 0);

  const repartido: number[] = [];
  let acumulado = 0;
  for (let i = 0; i < limpias.length - 1; i += 1) {
    const base = limpias[i] ?? 0;
    const parte =
      suma > 0
        ? redondearCantidadCompra((totalGuardable * base) / suma)
        : redondearCantidadCompra(totalGuardable / limpias.length);
    repartido.push(parte);
    acumulado += parte;
  }
  // La última se lleva EXACTAMENTE lo que falta para cerrar el total (residuo del redondeo incluido).
  repartido.push(redondearCantidadCompra(totalGuardable - acumulado));
  return repartido;
}
