/**
 * Unit de los helpers de la matriz del inventario PT — en particular el nº de orden de Control
 * viejo (§Post-F9.25), que se captura UNA vez por movimiento y se replica a cada color.
 */
import { describe, expect, it } from 'vitest';

import { aLineasApi, totalMatriz } from './matriz-inventario';

const matriz = [
  { idColor: 1, cantidades: { 10: 3, 11: 0 } },
  { idColor: 2, cantidades: { 10: 5 } },
  { idColor: 3, cantidades: { 10: 0 } },
];

describe('aLineasApi', () => {
  it('descarta ceros y los colores que quedan sin tallas', () => {
    const r = aLineasApi(matriz);
    expect(r).toEqual([
      { idColor: 1, tallas: [{ idTalla: 10, cantidad: 3 }] },
      { idColor: 2, tallas: [{ idTalla: 10, cantidad: 5 }] },
    ]);
  });

  it('replica el nº de orden de Control viejo a TODOS los colores', () => {
    const r = aLineasApi(matriz, ' 12345 ');
    expect(r.every((l) => l.numOrdenV1 === '12345')).toBe(true);
  });

  it('sin nº de orden no manda el campo (no inventa una referencia vacía)', () => {
    expect(aLineasApi(matriz, '   ')[0]).not.toHaveProperty('numOrdenV1');
    expect(aLineasApi(matriz)[0]).not.toHaveProperty('numOrdenV1');
  });
});

describe('totalMatriz', () => {
  it('suma todas las celdas', () => {
    expect(totalMatriz(matriz)).toBe(8);
  });
});
