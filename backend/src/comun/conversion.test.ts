import { describe, expect, it } from 'vitest';

import {
  cantidadAUnidadConsumo,
  convertirLineaCompra,
  precioAUnidadConsumo,
  resolverFactor,
  validarFactor,
} from './conversion.js';
import { ErrorValidacion } from './errores.js';

/**
 * Unit del motor de conversión presentación→unidad de consumo (F4-E1, R1). Matemática pura.
 * Lo clave: la INVARIANTE de valuación (el importe total no cambia al convertir cantidad y precio).
 */
describe('motor de conversión (F4-E1, R1)', () => {
  describe('resolverFactor', () => {
    it('prioriza el factor del proveedor sobre el del avío', () => {
      expect(resolverFactor(50, 100)).toBe(50);
    });
    it('cae al factor del avío si el del proveedor es null', () => {
      expect(resolverFactor(null, 100)).toBe(100);
      expect(resolverFactor(undefined, 100)).toBe(100);
    });
    it('asume 1:1 cuando ninguno está definido', () => {
      expect(resolverFactor(null, null)).toBe(1);
      expect(resolverFactor()).toBe(1);
    });
    it('rechaza un factor presente ≤ 0', () => {
      expect(() => resolverFactor(0)).toThrow(ErrorValidacion);
      expect(() => resolverFactor(-5)).toThrow(ErrorValidacion);
    });
  });

  describe('validarFactor', () => {
    it('acepta factores finitos positivos', () => {
      expect(validarFactor(50)).toBe(50);
      expect(validarFactor(0.5)).toBe(0.5);
    });
    it('rechaza 0, negativos e infinito/NaN', () => {
      expect(() => validarFactor(0)).toThrow(ErrorValidacion);
      expect(() => validarFactor(-1)).toThrow(ErrorValidacion);
      expect(() => validarFactor(Number.POSITIVE_INFINITY)).toThrow(ErrorValidacion);
      expect(() => validarFactor(Number.NaN)).toThrow(ErrorValidacion);
    });
  });

  describe('cantidad', () => {
    it('15 rollos × 50 m/rollo = 750 m', () => {
      expect(cantidadAUnidadConsumo(15, 50)).toBe(750);
    });
    it('rechaza cantidad negativa', () => {
      expect(() => cantidadAUnidadConsumo(-1, 50)).toThrow(ErrorValidacion);
    });
  });

  describe('precio', () => {
    it('$500/rollo ÷ 50 m/rollo = $10/m', () => {
      expect(precioAUnidadConsumo(500, 50)).toBe(10);
    });
    it('rechaza precio negativo', () => {
      expect(() => precioAUnidadConsumo(-1, 50)).toThrow(ErrorValidacion);
    });
  });

  describe('convertirLineaCompra — INVARIANTE de valuación', () => {
    it('el caso del dueño: 15 rollos a $500 (50 m/rollo) → 750 m a $10/m, mismo importe', () => {
      const r = convertirLineaCompra(15, 500, 50);
      expect(r.cantidadConsumo).toBe(750);
      expect(r.costoUnitConsumo).toBe(10);
      expect(r.importe).toBe(7500);
      // El importe convertido == cantidad×precio en presentación (no se infla por el factor).
      expect(r.importe).toBe(15 * 500);
    });

    it('con factor 1:1 (sin factores) la conversión es la identidad', () => {
      const r = convertirLineaCompra(7, 3.5);
      expect(r.cantidadConsumo).toBe(7);
      expect(r.costoUnitConsumo).toBe(3.5);
      expect(r.importe).toBeCloseTo(24.5, 10);
      expect(r.factor).toBe(1);
    });

    it('para factores arbitrarios, cantidadConsumo × costoUnit ≈ cantidad × precio', () => {
      for (const [cant, precio, factor] of [
        [12, 240, 24],
        [3, 1000, 7.5],
        [100, 12.34, 0.25],
      ] as const) {
        const r = convertirLineaCompra(cant, precio, factor);
        expect(r.importe).toBeCloseTo(cant * precio, 6);
      }
    });

    it('con factor que fuerza error de redondeo float la invariante es APROXIMADA, no exacta', () => {
      // 10/3 no es exacto en binario: importe = (1×3) × (10÷3) ≈ 10 con épsilon. Se documenta que la
      // igualdad NO es exacta — E3 debe REDONDEAR al guardar en la columna Decimal (no asumir
      // `importe === cant×precio`).
      const r = convertirLineaCompra(1, 10, 3);
      expect(r.cantidadConsumo).toBe(3);
      expect(r.importe).toBeCloseTo(10, 6); // aproximada, no exacta
      expect(Math.abs(r.importe - 10)).toBeLessThan(1e-9);
    });

    it('usa el factor del avío como fallback', () => {
      const r = convertirLineaCompra(2, 100, null, 25);
      expect(r.factor).toBe(25);
      expect(r.cantidadConsumo).toBe(50);
      expect(r.costoUnitConsumo).toBe(4);
    });
  });
});
