/**
 * Unit del REPARTO entre OP (V1-E3q, §Post-F9.86) — funciones puras, sin BD.
 *
 * Protegen la frase de Daniel (*"el sobrante de compra **se reparte entre las OP de la compra**"*) y
 * su condición innegociable (*"el reparto es SIEMPRE por OP… sin eso el 'qué tengo / qué falta' de
 * cada OP deja de cuadrar"*).
 *
 * 🔴 **Y protegen la lección que costó el rechazo del reviewer (21-ago-2026): la escala manda desde
 * el DESTINO.** Estas cantidades acaban en `OrdenCompraLinea.cantidad Decimal(14,2)`. La primera
 * versión repartía a 4 decimales y la suma de lo GUARDADO no cerraba (100 → 99.99). Por eso la
 * aserción que más importa aquí no es el reparto bonito: es que **Σ del reparto sea EXACTAMENTE el
 * total, en la escala en la que se guarda**.
 */
import { describe, expect, it } from 'vitest';

import { redondear2 } from '../costos/decimales.js';
import {
  ESCALA_CANTIDAD_COMPRA,
  MINIMO_CANTIDAD_COMPRA,
  redondearCantidadCompra,
  repartirEntreOrdenes,
  seGuardaComoAlgo,
} from './reparto-ordenes.js';

/**
 * Suma EN CENTAVOS (enteros). No es cosmética: sumar `[500, 333.33, 166.67]` con `+` da
 * `999.9999999999999` por el polvo de coma flotante **de la suma del test**, no del reparto. La
 * columna es `numeric`, así que la BD suma exacto; sumar en enteros aquí reproduce esa exactitud sin
 * relajar la aserción a un `toBeCloseTo` que dejaría pasar un centavo perdido de verdad.
 * (La suma contra la BD real se asierta en `mrp.int.test.ts` con SQL.)
 */
function sumaExacta(partes: readonly number[]): number {
  return partes.reduce((s, x) => s + Math.round(x * 100), 0) / 100;
}

describe('repartirEntreOrdenes (§Post-F9.86)', () => {
  it('sin ajuste, cada OP se lleva exactamente lo suyo', () => {
    expect(repartirEntreOrdenes([180, 120], 300)).toEqual([180, 120]);
  });

  it('⭐ el SOBRANTE (rollo completo) se reparte EN PROPORCIÓN a lo que cada OP necesita', () => {
    // 100 y 50 → un rollo de 180 va 120/60, no 90/90: repartir en partes iguales dejaría a la
    // primera corta (y su "qué falta" seguiría rojo después de haber comprado).
    expect(repartirEntreOrdenes([100, 50], 180)).toEqual([120, 60]);
  });

  it('comprar de MENOS también se reparte proporcionalmente (compra parcial válida)', () => {
    expect(repartirEntreOrdenes([100, 100], 150)).toEqual([75, 75]);
  });

  /**
   * 🔴 EL CASO DEL RECHAZO. Antes esto daba `[33.3333, 33.3333, 33.3334]`, que la columna guardaba
   * como `[33.33, 33.33, 33.33]` = **99.99**: el documento no cuadraba con sus propios renglones y
   * la revisión previa mentía. Si alguien devuelve la escala a 4, esta prueba se pone roja.
   */
  it('⭐ tres OP iguales y un total de 100: Σ es EXACTAMENTE 100 en la escala que se guarda', () => {
    const partes = repartirEntreOrdenes([1, 1, 1], 100);
    expect(partes).toEqual([33.33, 33.33, 33.34]);
    expect(sumaExacta(partes)).toBe(100);
  });

  it('⭐ bases desiguales y un total feo: 2 decimales y la última absorbe el residuo', () => {
    // bases 180/120/60 (Σ 360) con total 1000 → 500 / 333.33 / 166.67 (no 333.3333/166.6667).
    const partes = repartirEntreOrdenes([180, 120, 60], 1000);
    expect(partes).toEqual([500, 333.33, 166.67]);
    expect(sumaExacta(partes)).toBe(1000);
  });

  it('ninguna parte lleva más decimales de los que la columna puede guardar', () => {
    for (const parte of repartirEntreOrdenes([7, 11, 13], 97.777)) {
      expect(parte).toBe(redondearCantidadCompra(parte));
    }
  });

  it('el TOTAL también se lleva a la escala del destino antes de repartir', () => {
    // 10.004 no existe en una columna de 2 decimales: se pide 10.00, no 10.004.
    expect(repartirEntreOrdenes([1], 10.004)).toEqual([10]);
    expect(sumaExacta(repartirEntreOrdenes([1, 1], 10.006))).toBe(10.01);
  });

  it('con UNA sola OP se lleva todo (no hay nada que repartir)', () => {
    expect(repartirEntreOrdenes([45], 60)).toEqual([60]);
  });

  it('si NADIE necesita nada, se reparte en partes IGUALES (no todo a la primera)', () => {
    // Dejarlo todo en la primera sería una decisión escondida; el empate se resuelve a la vista.
    expect(repartirEntreOrdenes([0, 0], 50)).toEqual([25, 25]);
  });

  it('una base negativa cuenta como cero (una necesidad negativa no existe)', () => {
    expect(repartirEntreOrdenes([-10, 100], 100)).toEqual([0, 100]);
  });

  it('sin OP no reparte nada', () => {
    expect(repartirEntreOrdenes([], 100)).toEqual([]);
  });
});

/**
 * 🔴 El corte de *"¿esto existe cuando se guarda?"*. Es lo que separa una compra pendiente de una
 * ASTILLA de redondeo: por debajo de media unidad del último dígito la columna escribe `0.00`, así
 * que ni se puede comprar ni puede quedar pendiente.
 */
describe('la escala es la del DESTINO y GOBIERNA de verdad', () => {
  it('⭐ la escala es 2: la de `OrdenCompraLinea.cantidad Decimal(14,2)`', () => {
    // 🔴 Si alguien la devuelve a 4 "porque el snapshot tiene 4", esta prueba lo dice con letras.
    expect(ESCALA_CANTIDAD_COMPRA).toBe(2);
  });

  it('⭐ el redondeo se DERIVA de la escala (la constante no es de adorno)', () => {
    // A escala 2 coincide con el redondeo monetario — por casualidad, no por parentesco. Se
    // comprueba en vez de afirmarse: así "una sola regla" es un hecho.
    for (const n of [0, 0.004, 0.005, 3.702, 33.335, 166.6667, 999.999]) {
      expect(redondearCantidadCompra(n)).toBe(redondear2(n));
      expect(redondearCantidadCompra(n)).toBe(
        Math.round(n * 10 ** ESCALA_CANTIDAD_COMPRA) / 10 ** ESCALA_CANTIDAD_COMPRA,
      );
    }
  });

  it('el mínimo guardable también se deriva de la escala (no se desincronizan)', () => {
    expect(MINIMO_CANTIDAD_COMPRA).toBe(0.5 / 10 ** ESCALA_CANTIDAD_COMPRA);
  });
});

describe('seGuardaComoAlgo — media unidad del último dígito guardable', () => {
  it('0.002 (la astilla del defecto de Daniel) NO existe: se guardaría como 0.00', () => {
    expect(seGuardaComoAlgo(0.002)).toBe(false);
    expect(redondearCantidadCompra(0.002)).toBe(0);
  });

  it('0.004 tampoco; 0.005 sí (redondea a 0.01) y 0.01 obviamente', () => {
    expect(seGuardaComoAlgo(0.004)).toBe(false);
    expect(seGuardaComoAlgo(MINIMO_CANTIDAD_COMPRA)).toBe(true);
    expect(redondearCantidadCompra(MINIMO_CANTIDAD_COMPRA)).toBe(0.01);
    expect(seGuardaComoAlgo(0.01)).toBe(true);
  });

  it('el cero exacto no es algo', () => {
    expect(seGuardaComoAlgo(0)).toBe(false);
  });
});
