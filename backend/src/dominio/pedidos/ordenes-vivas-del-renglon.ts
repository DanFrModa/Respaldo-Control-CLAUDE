/**
 * ⭐⭐ V1-E3 (§Post-F9.172(b)) — **qué OPs cuentan para un renglón de pedido, y qué nº de producción
 * enseña.** La regla, UNA sola vez, para las dos pantallas que la preguntan.
 *
 * 🔴 **Por qué vive aquí.** La consulta por MES (`consulta-mes.ts`) y el detalle de
 * `/pedidos/administrar` (`pedidos.ts`) contestan la MISMA pregunta sobre el MISMO renglón: *"¿qué
 * órdenes tiene vivas y qué números de 5 dígitos enseño?"*. Nacieron con la regla copiada en los dos
 * sitios —idéntica, y con prueba cada una— y **ése es exactamente el estado desde el que dos copias
 * empiezan a contestar distinto**: basta que alguien afine una (que "viva" excluya algo más, que los
 * números se ordenen de otro modo) para que el mismo pedido enseñe una cosa en el listado del mes y
 * otra en su detalle. Que discrepen es justo lo que la fila 0.089 vino a cerrar, así que la regla se
 * comparte en vez de duplicarse. *(Es el mismo argumento —y el mismo remedio— que el del helper
 * `numerosDeProduccion` del frontend.)*
 *
 * Las tres decisiones que aquí quedan fijadas, y que antes estaban escritas dos veces:
 *  1. **qué OP cuenta** → la que no está `cancelada` ({@link filtroOrdenesVivasDeLineas});
 *  2. **qué número aporta** → el de SU modelo, saltando el que no tiene ({@link
 *     numerosProduccionPorLinea});
 *  3. **cómo se entrega** → sin repetir y en orden ascendente (ídem).
 *
 * ---
 * ## ⚠️ LO QUE ESTE MÓDULO **NO** UNIFICA — dicho aquí para que nadie lo dé por hecho
 *
 * «Viva» está escrito **TRES** veces, no dos. Este módulo absorbió las dos que leen los renglones
 * (las de Prisma); la tercera vive en **SQL crudo** en `consulta-mes.ts` —el `JOIN … AND o.estado
 * <> 'cancelada'` que alimenta **los TOTALES de la página**— y **sigue suelta**.
 *
 * 🔴 **La consecuencia, para que se pueda ver:** si «viva» cambiara aquí y no allá, la tira de
 * totales discreparía de los renglones **de la misma pantalla** ("3 órdenes" arriba, dos filas
 * abajo).
 *
 * 🔑 **Por qué no se absorbió — medido, no por pereza.** (a) En TODO el repo, el SQL crudo compara
 * enums con **literal**, nunca con parámetro ligado: 0 precedentes. Parametrizar `estado` sería el
 * primero, y si la inferencia de tipo del parámetro contra la columna enum no se comportara como se
 * espera, **reventaría sólo en CI/`prueba`** (el `int.test` no corre en local) — mal cambio para una
 * consulta que hoy funciona. (b) Exportar un fragmento `Prisma.Sql` arrastraría el **alias** `o` de
 * esa consulta como contrato oculto, y la variante «alias por argumento» exige `Prisma.raw`, que
 * tiene forma de inyección. Se compraría fragilidad NUEVA para quitar un riesgo de divergencia.
 * (c) No son lo mismo: dos son `where` de Prisma sobre las mismas filas; la tercera es una condición
 * de `JOIN` dentro de un agregado. Una sola expresión no sirve a las dos sin deformar una.
 *
 * ⇒ Queda como **deuda consciente**, con su ancla: el sitio del SQL lleva un comentario que **nombra
 * a `filtroOrdenesVivasDeLineas`**, así que `grep filtroOrdenesVivasDeLineas` saca las TRES
 * codificaciones de una — que es la garantía que de verdad hacía falta.
 */
import type { Prisma } from '../../datos/index.js';

/**
 * Filtro de las OPs **VIVAS** de un conjunto de renglones de pedido.
 *
 * 🔑 "Viva" = no cancelada. Es la definición que comparten el conteo de OPs, el Σ cortado, la OP más
 * reciente y los nº de producción: si divergiera, el mismo renglón diría "3 órdenes" en una pantalla
 * y "2" en la otra.
 */
export function filtroOrdenesVivasDeLineas(idsLinea: number[]): Prisma.OrdenWhereInput {
  return { idPedidoLinea: { in: idsLinea }, estado: { not: 'cancelada' } };
}

/** Lo mínimo que hay que traer de cada OP viva para saber qué número aporta. */
export interface OrdenConNumeroDeProduccion {
  idPedidoLinea: number | null;
  modelo: { numeroProduccion: number | null };
}

/**
 * Agrupa por renglón los nº de producción de los MODELOS de sus OPs vivas: **uno por color/OP, sin
 * repetir y en orden ascendente**.
 *
 * 🔴 **Sin esto las pantallas de Pedidos enseñarían el código de desarrollo y ningún número.** Desde
 * V1-E3 el renglón sigue apuntando a su modelo de DESARROLLO —que ya nunca se promueve—, así que
 * `PedidoLinea.modelo.numeroProduccion` es `null` **para siempre**: el número que Daniel quiere ver
 * vive en el modelo de CADA OP, uno por color.
 *
 * ⚠️ Un modelo SIN número (los 285 del Access con código no numérico, `51783a`/`M-18`) **no aporta
 * un `null`**: el contrato promete `number[]` y un null ahí sería un 500 al serializar.
 * ⚠️ Un renglón sin OPs vivas simplemente no aparece en el mapa ⇒ el llamador enseña `[]`, vacío.
 * No es un cero.
 *
 * El orden ascendente es lo que hace que el mismo renglón enseñe los mismos números en el mismo
 * orden entre recargas (el orden de llegada de las OPs no lo garantiza).
 */
export function numerosProduccionPorLinea(
  ordenesVivas: readonly OrdenConNumeroDeProduccion[],
): Map<number, number[]> {
  const acumulado = new Map<number, Set<number>>();
  for (const orden of ordenesVivas) {
    if (orden.idPedidoLinea === null) continue;
    if (orden.modelo.numeroProduccion === null) continue;
    const numeros = acumulado.get(orden.idPedidoLinea) ?? new Set<number>();
    numeros.add(orden.modelo.numeroProduccion);
    acumulado.set(orden.idPedidoLinea, numeros);
  }
  return new Map(
    [...acumulado].map(([idLinea, numeros]) => [idLinea, [...numeros].sort((a, b) => a - b)]),
  );
}
