/**
 * Tests UNITARIOS del PRECIO SUGERIDO (F7-E1; doc 06-Costos-y-EDR §5, D2 #3–#5). Fórmula PURA; el
 * cuadre contra órdenes/receta reales vive en los `*.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { calcularPrecioSugerido } from './precio-sugerido.js';

describe('calcularPrecioSugerido (utilidad + regalías sobre la venta, redondeo al alza)', () => {
  it('con 50/10 reproduce el (costo×2)/0.9 del viejo, pero redondeando AL ALZA', () => {
    // costo 100 → base 100/(1−0.5)=200 → +regalías 200/(1−0.1)=222.22 → ceil 223.
    const r = calcularPrecioSugerido(100, { utilidadSugerida: 50, regaliasBase: 10 });
    expect(r.precioBase).toBeCloseTo(200, 6);
    expect(r.precioSugerido).toBe(223); // ceil(222.22), NO el CInt(222) del viejo
    expect(r.utilidad).toBeCloseTo(100, 6); // 200 − 100
    expect(r.regalias).toBeCloseTo(22.2222, 3); // 222.22 − 200
  });

  it('la utilidad es PARAMETRIZADA: 0% de utilidad = solo regalías sobre el costo', () => {
    // utilidad 0 → base = costo; regalías 10 → 100/0.9 = 111.11 → ceil 112.
    const r = calcularPrecioSugerido(100, { utilidadSugerida: 0, regaliasBase: 10 });
    expect(r.precioBase).toBeCloseTo(100, 6);
    expect(r.precioSugerido).toBe(112);
  });

  it('las regalías son PARAMETRIZADAS: 0% de regalías = solo utilidad', () => {
    // utilidad 50, regalías 0 → 100/0.5 = 200 → ceil 200.
    const r = calcularPrecioSugerido(100, { utilidadSugerida: 50, regaliasBase: 0 });
    expect(r.precioSugerido).toBe(200);
    expect(r.regalias).toBeCloseTo(0, 6);
  });

  it('cambiar la utilidad CAMBIA el precio (ya no hay ×2 fijo)', () => {
    const a = calcularPrecioSugerido(100, { utilidadSugerida: 50, regaliasBase: 10 });
    const b = calcularPrecioSugerido(100, { utilidadSugerida: 60, regaliasBase: 10 });
    expect(b.precioSugerido).toBeGreaterThan(a.precioSugerido);
  });

  it('cambiar las regalías CAMBIA el precio (ya no hay /0.9 fijo)', () => {
    const a = calcularPrecioSugerido(100, { utilidadSugerida: 50, regaliasBase: 10 });
    const b = calcularPrecioSugerido(100, { utilidadSugerida: 50, regaliasBase: 20 });
    expect(b.precioSugerido).toBeGreaterThan(a.precioSugerido);
  });

  it('costo 0 (o negativo) ⇒ precio 0 (no hay costo que marginar)', () => {
    expect(
      calcularPrecioSugerido(0, { utilidadSugerida: 50, regaliasBase: 10 }).precioSugerido,
    ).toBe(0);
    expect(
      calcularPrecioSugerido(-5, { utilidadSugerida: 50, regaliasBase: 10 }).precioSugerido,
    ).toBe(0);
  });

  it('un porcentaje fuera de [0,100) lanza RangeError (no divide por ≤0)', () => {
    expect(() => calcularPrecioSugerido(100, { utilidadSugerida: 100, regaliasBase: 10 })).toThrow(
      RangeError,
    );
    expect(() => calcularPrecioSugerido(100, { utilidadSugerida: 50, regaliasBase: -1 })).toThrow(
      RangeError,
    );
  });

  it('redondea SIEMPRE hacia arriba (techo), aunque la fracción sea mínima', () => {
    // Elige costo que dé un precio con decimal pequeño.
    const r = calcularPrecioSugerido(45, { utilidadSugerida: 50, regaliasBase: 10 });
    // 45/0.5=90 → 90/0.9=100 exacto → ceil 100.
    expect(r.precioSugerido).toBe(100);
    const r2 = calcularPrecioSugerido(45.01, { utilidadSugerida: 50, regaliasBase: 10 });
    expect(r2.precioSugerido).toBe(101); // 100.02… → ceil 101
  });
});
