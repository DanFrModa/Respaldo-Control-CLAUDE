/**
 * PRECIO DE LISTA de un renglón a partir de su COSTO congelado y los FACTORES del cliente (F8-E4,
 * D13/R20a; DECISIONES.md D2 #4 = redondeo AL ALZA). Función PURA (la ejercitan los tests unitarios),
 * SIN dependencias de BD. Es la única aritmética del precio de lista (A1: no se duplica en rutas/front).
 *
 * La composición es una CASCADA de dos pasos (decisión de fase (b) = cascada, resuelta por Daniel):
 *
 *   precioBase = costo / (1 − margenPct/100)                                   // margen sobre la venta
 *   precio     = precioBase / (1 − (descuentosPct + regaliasPct + costoVentasPct)/100)
 *   precioCalculado = Math.ceil(precio)                                        // AL ALZA (D2 #4)
 *
 * Los cuatro factores van SOBRE LA VENTA (estilo margen: se DIVIDE por `1 − %/100`), mismo criterio
 * que `precio-sugerido.ts` (de ahí el `/0.9` histórico de las regalías). El margen absorbe la utilidad;
 * el segundo paso absorbe descuentos + regalías + costo de ventas EN CONJUNTO (una sola división por
 * su suma), que es lo que hace la cascada.
 *
 * ⚠️ NOTA (posible ajuste de una línea): Daniel podría subir un Excel con la composición EXACTA (p. ej.
 * aplicar cada factor por separado, o cambiar cuáles van sobre la venta vs. sobre el costo). Por eso
 * este helper está AISLADO y es PURO: si la fórmula difiere, se cambia SOLO aquí (una línea) sin tocar
 * el dominio, las rutas ni el frontend. No incrustar esta aritmética en ningún otro lado.
 */

/** Los cuatro factores del cliente (o su snapshot en la lista). % en 0–100 (estilo "sobre la venta"). */
export interface FactoresLista {
  /** % de margen/utilidad sobre la venta. Debe ser [0, 100) (se divide por `1 − margen/100`). */
  margenPct: number;
  /** % de descuentos sobre la venta. */
  descuentosPct: number;
  /** % de regalías sobre la venta. */
  regaliasPct: number;
  /** % de costo de ventas sobre la venta. */
  costoVentasPct: number;
}

/** ¿Un porcentaje simple es finito y ≥ 0? (los sueltos pueden ser cualquier no-negativo). */
function porcentajeNoNegativo(p: number): boolean {
  return Number.isFinite(p) && p >= 0;
}

/**
 * Calcula el `precioCalculado` de un renglón: aplica la cascada de factores al `costo` y redondea AL
 * ALZA (D2 #4). Devuelve un entero (pesos MXN, decisión (d): todo en la misma moneda).
 *
 * - `costo ≤ 0` ⇒ `0` (no hay costo que marginar).
 * - `margenPct` fuera de `[0, 100)` ⇒ `RangeError` (dividiría por ≤ 0). El dominio valida ANTES de
 *   llamar aquí; los tests cubren el borde.
 * - `(descuentosPct + regaliasPct + costoVentasPct)` fuera de `[0, 100)` ⇒ `RangeError` (idem).
 * - Un porcentaje negativo o no finito ⇒ `RangeError`.
 */
export function calcularPrecioLista(costo: number, factores: FactoresLista): number {
  const { margenPct, descuentosPct, regaliasPct, costoVentasPct } = factores;

  if (!porcentajeNoNegativo(margenPct) || margenPct >= 100) {
    throw new RangeError(`margenPct fuera de rango [0,100): ${margenPct}`);
  }
  for (const [nombre, valor] of [
    ['descuentosPct', descuentosPct],
    ['regaliasPct', regaliasPct],
    ['costoVentasPct', costoVentasPct],
  ] as const) {
    if (!porcentajeNoNegativo(valor)) {
      throw new RangeError(`${nombre} inválido (debe ser ≥ 0): ${valor}`);
    }
  }
  const sumaVenta = descuentosPct + regaliasPct + costoVentasPct;
  if (sumaVenta >= 100) {
    throw new RangeError(
      `La suma de descuentos + regalías + costo de ventas debe ser < 100: ${sumaVenta}`,
    );
  }

  if (!(costo > 0)) {
    return 0;
  }

  const precioBase = costo / (1 - margenPct / 100);
  const precio = precioBase / (1 - sumaVenta / 100);
  return Math.ceil(precio);
}
