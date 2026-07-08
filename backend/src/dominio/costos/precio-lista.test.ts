/**
 * Tests UNITARIOS del PRECIO DE LISTA (F8-E4, D13/R20a; D2 #4 = redondeo al alza). Fórmula PURA en
 * CASCADA (decisión de fase (b)); el cuadre contra listas/precostos reales vive en los `*.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  calcularPrecioLista,
  simularMargenNegociacion,
  type FactoresLista,
} from './precio-lista.js';

/** Factores base para variar en cada caso (evita repetir el objeto completo). */
function factores(parcial: Partial<FactoresLista> = {}): FactoresLista {
  return {
    margenPct: 0,
    descuentosPct: 0,
    regaliasPct: 0,
    costoVentasPct: 0,
    ...parcial,
  };
}

describe('calcularPrecioLista (cascada de factores sobre la venta, redondeo al alza)', () => {
  it('solo margen: costo / (1 − margen/100), al alza', () => {
    // 100 / (1 − 0.5) = 200 exacto → ceil 200.
    expect(calcularPrecioLista(100, factores({ margenPct: 50 }))).toBe(200);
    // 100 / (1 − 0.4) = 166.66… → ceil 167.
    expect(calcularPrecioLista(100, factores({ margenPct: 40 }))).toBe(167);
  });

  it('cascada completa: base por margen, luego dividido por la suma de los otros tres', () => {
    // costo 100, margen 50 → base 200; suma(10+5+5)=20 → 200/(1−0.20)=250 exacto → ceil 250.
    const precio = calcularPrecioLista(
      100,
      factores({ margenPct: 50, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 }),
    );
    expect(precio).toBe(250);
  });

  it('la suma de descuentos+regalías+costoVentas actúa EN CONJUNTO (una sola división)', () => {
    // margen 0 → base = costo 100; suma 25 → 100/(1−0.25)=133.33… → ceil 134.
    const juntos = calcularPrecioLista(
      100,
      factores({ descuentosPct: 10, regaliasPct: 10, costoVentasPct: 5 }),
    );
    expect(juntos).toBe(134);
    // Da igual cómo se repartan los 25 puntos entre los tres: misma suma ⇒ mismo precio.
    const repartido = calcularPrecioLista(
      100,
      factores({ descuentosPct: 25, regaliasPct: 0, costoVentasPct: 0 }),
    );
    expect(repartido).toBe(juntos);
  });

  it('todos en cero ⇒ el precio es el costo (redondeado al alza)', () => {
    expect(calcularPrecioLista(100, factores())).toBe(100);
    expect(calcularPrecioLista(100.4, factores())).toBe(101); // ceil
  });

  it('redondea SIEMPRE hacia arriba (techo), aunque la fracción sea mínima', () => {
    // 100 / (1 − 0.3) = 142.857… → ceil 143.
    expect(calcularPrecioLista(100, factores({ margenPct: 30 }))).toBe(143);
  });

  it('costo 0 (o negativo) ⇒ precio 0 (no hay costo que marginar)', () => {
    expect(calcularPrecioLista(0, factores({ margenPct: 50 }))).toBe(0);
    expect(calcularPrecioLista(-10, factores({ margenPct: 50 }))).toBe(0);
  });

  it('margen ≥ 100 lanza RangeError (dividiría por ≤ 0)', () => {
    expect(() => calcularPrecioLista(100, factores({ margenPct: 100 }))).toThrow(RangeError);
    expect(() => calcularPrecioLista(100, factores({ margenPct: 150 }))).toThrow(RangeError);
  });

  it('la suma de los otros tres ≥ 100 lanza RangeError', () => {
    expect(() =>
      calcularPrecioLista(
        100,
        factores({ descuentosPct: 50, regaliasPct: 30, costoVentasPct: 20 }),
      ),
    ).toThrow(RangeError);
  });

  it('un porcentaje negativo o no finito lanza RangeError', () => {
    expect(() => calcularPrecioLista(100, factores({ margenPct: -1 }))).toThrow(RangeError);
    expect(() => calcularPrecioLista(100, factores({ descuentosPct: -0.01 }))).toThrow(RangeError);
    expect(() => calcularPrecioLista(100, factores({ regaliasPct: Number.NaN }))).toThrow(
      RangeError,
    );
  });
});

describe('simularMargenNegociacion (inversa de la cascada: margen a partir de un precio objetivo)', () => {
  it('es la INVERSA exacta de calcularPrecioLista: al precio de lista, el margen bruto = el objetivo', () => {
    // Sin redondeo (200 es exacto): objetivo = precio de lista ⇒ margen bruto = margen objetivo.
    const f = factores({ margenPct: 50, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 });
    const precioLista = calcularPrecioLista(100, f); // 250 exacto
    const sim = simularMargenNegociacion(100, precioLista, f);
    expect(sim.precioNeto).toBeCloseTo(200, 6); // 250 × (1 − 0.20)
    expect(sim.margenBrutoPct).toBeCloseTo(50, 6); // (200 − 100) / 200 × 100
    expect(sim.margenObjetivoPct).toBe(50);
    expect(sim.cumpleObjetivo).toBe(true);
  });

  it('precio objetivo por DEBAJO del de lista ⇒ margen bruto < objetivo ⇒ NO cumple (rojo)', () => {
    const f = factores({ margenPct: 50, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 });
    const sim = simularMargenNegociacion(100, 205, f); // 250 sería el "cumple"; 205 queda corto
    expect(sim.precioNeto).toBeCloseTo(164, 6); // 205 × 0.80
    expect(sim.margenBrutoPct).toBeLessThan(50);
    expect(sim.cumpleObjetivo).toBe(false);
  });

  it('sin factores sobre la venta: neto = objetivo y margen = (objetivo − costo)/objetivo', () => {
    const sim = simularMargenNegociacion(60, 100, factores({ margenPct: 40 }));
    expect(sim.precioNeto).toBe(100);
    expect(sim.margenBrutoPct).toBeCloseTo(40, 6); // (100 − 60) / 100
    expect(sim.cumpleObjetivo).toBe(true); // 40 ≥ 40
  });

  it('costo mayor que el neto ⇒ margen bruto NEGATIVO (pérdida), no cumple', () => {
    const sim = simularMargenNegociacion(120, 100, factores({ margenPct: 30 }));
    expect(sim.margenBrutoPct).toBeLessThan(0);
    expect(sim.cumpleObjetivo).toBe(false);
  });

  it('precio objetivo 0 (neto ≤ 0) ⇒ margen 0 y no cumple (caso degenerado)', () => {
    const sim = simularMargenNegociacion(50, 0, factores({ margenPct: 20 }));
    expect(sim.precioNeto).toBe(0);
    expect(sim.margenBrutoPct).toBe(0);
    expect(sim.cumpleObjetivo).toBe(false);
  });

  it('valida los porcentajes y el objetivo igual que la cascada (RangeError)', () => {
    expect(() => simularMargenNegociacion(100, 200, factores({ margenPct: 100 }))).toThrow(
      RangeError,
    );
    expect(() =>
      simularMargenNegociacion(100, 200, factores({ descuentosPct: 60, regaliasPct: 40 })),
    ).toThrow(RangeError);
    expect(() => simularMargenNegociacion(100, -5, factores({ margenPct: 20 }))).toThrow(
      RangeError,
    );
    expect(() => simularMargenNegociacion(100, Number.NaN, factores())).toThrow(RangeError);
  });
});
