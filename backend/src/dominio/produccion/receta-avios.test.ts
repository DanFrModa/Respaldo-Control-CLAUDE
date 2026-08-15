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

  it('⭐ "sin medida" y "medida CERO" NO son lo mismo (V1-E3c)', () => {
    // Sin fila para la talla 2 (así queda una talla dejada en blanco en el editor): cae al
    // consumo por prenda Y se reporta, que es justo el aviso que el MRP le enseña al usuario.
    const sinFila = requeridoAvioReceta(
      avio({ consumoPorTalla: true, tallas: [{ idTalla: 1, consumo: D(3) }] }),
      30,
      piezasPorTalla,
    );
    expect(sinFila.requerido).toBe(150);
    expect(sinFila.tallasSinMedida).toEqual([2]);

    // Con una fila de CERO capturada a propósito: requiere cero para esa talla y NO avisa. Si el
    // editor guardara las tallas en blanco como 0, TODAS caerían aquí y el aviso desaparecería.
    const conCero = requeridoAvioReceta(
      avio({
        consumoPorTalla: true,
        tallas: [
          { idTalla: 1, consumo: D(3) },
          { idTalla: 2, consumo: D(0) },
        ],
      }),
      30,
      piezasPorTalla,
    );
    expect(conCero.requerido).toBe(30); // 3×10 + 0×20
    expect(conCero.tallasSinMedida).toEqual([]);
  });
});
