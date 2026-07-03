/**
 * Tests UNITARIOS (sin BD) de la fórmula del EDR (F7-E2; doc 06-Costos-y-EDR §4). El comportamiento
 * transaccional (generar idempotente, exclusión de paraEdr/noCostear, costo actual, reconciliación)
 * está cubierto por `edr.int.test.ts` (Postgres efímero).
 */
import { describe, expect, it } from 'vitest';

import { resultadoEdr } from './edr.js';

describe('resultadoEdr (fórmula legacy)', () => {
  it('Resultado = Ventas − Costo − Gastos − Intereses + Bonificaciones + Otros', () => {
    // 1000 − 400 − 100 − 50 + 30 + 0 = 480.
    expect(
      resultadoEdr({
        ventas: 1000,
        costo: 400,
        gastos: 100,
        intereses: 50,
        bonificaciones: 30,
        otros: 0,
      }),
    ).toBe(480);
  });

  it('Bonificaciones SUMA (no resta)', () => {
    const base = { ventas: 500, costo: 0, gastos: 0, intereses: 0, otros: 0 };
    expect(resultadoEdr({ ...base, bonificaciones: 100 })).toBe(600);
  });

  it('Otros es SIGNADO (± al resultado)', () => {
    const base = { ventas: 500, costo: 0, gastos: 0, intereses: 0, bonificaciones: 0 };
    expect(resultadoEdr({ ...base, otros: 25 })).toBe(525);
    expect(resultadoEdr({ ...base, otros: -25 })).toBe(475);
  });

  it('todo en cero da 0 (nulos ya normalizados por el dominio)', () => {
    expect(
      resultadoEdr({ ventas: 0, costo: 0, gastos: 0, intereses: 0, bonificaciones: 0, otros: 0 }),
    ).toBe(0);
  });

  it('redondea a 2 decimales', () => {
    expect(
      resultadoEdr({
        ventas: 100.005,
        costo: 0,
        gastos: 0,
        intereses: 0,
        bonificaciones: 0,
        otros: 0,
      }),
    ).toBe(100.01);
  });
});
