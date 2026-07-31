import { describe, expect, it } from 'vitest';

import { Prisma } from '../../datos/index.js';

import { requeridoAvioReceta, type AvioRecetaR18 } from './receta-avios.js';

const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);

/** Avío base (6/prenda, sin talla), sobrescribible. */
function avio(over: Partial<AvioRecetaR18> = {}): AvioRecetaR18 {
  return { consumoPorPrenda: D(6), consumoPorTalla: false, tallas: [], ...over };
}

// Orden de 30 pzas: CH 10 + M 20.
const piezasPorTalla = new Map<number, number>([
  [1, 10],
  [2, 20],
]);

describe('requeridoAvioReceta (R18 — helper compartido MRP ↔ Habilitación)', () => {
  it('sin consumo por talla: consumoPorPrenda × totalPiezas', () => {
    const r = requeridoAvioReceta(avio(), 30, piezasPorTalla);
    expect(r.requerido).toBe(180);
    expect(r.tallasSinMedida).toEqual([]);
  });

  it('con consumo por talla: Σ(medida × piezas de esa talla)', () => {
    const r = requeridoAvioReceta(
      avio({
        consumoPorTalla: true,
        tallas: [
          { idTalla: 1, consumo: D(3) },
          { idTalla: 2, consumo: D(4) },
        ],
      }),
      30,
      piezasPorTalla,
    );
    expect(r.requerido).toBe(110); // 3×10 + 4×20
    expect(r.tallasSinMedida).toEqual([]);
  });

  it('talla presente en la orden SIN medida: cae a consumoPorPrenda y la reporta', () => {
    const r = requeridoAvioReceta(
      avio({ consumoPorTalla: true, tallas: [{ idTalla: 1, consumo: D(3) }] }),
      30,
      piezasPorTalla,
    );
    expect(r.requerido).toBe(150); // 3×10 (CH con medida) + 6×20 (M sin medida → consumoPorPrenda)
    expect(r.tallasSinMedida).toEqual([2]);
  });
});
