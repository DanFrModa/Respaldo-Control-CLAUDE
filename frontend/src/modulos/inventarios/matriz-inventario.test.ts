/**
 * Unit de los helpers de la matriz del inventario PT — en particular el nº de orden de Control
 * viejo (§Post-F9.25), que se captura UNA vez por movimiento y se replica a cada color.
 */
import { describe, expect, it } from 'vitest';

import type { MatrizLinea } from '@/componentes/matriz-color-talla/MatrizColorTalla';

import { aLineasApi, ordenesConExistencia, totalMatriz } from './matriz-inventario';

const matriz: MatrizLinea[] = [
  { idColor: 1, color: 'Marino', cantidades: { 10: 3, 11: 0 } },
  { idColor: 2, color: 'Blanco', cantidades: { 10: 5 } },
  { idColor: 3, color: 'Rojo', cantidades: { 10: 0 } },
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

describe('aLineasApi — la ORDEN del bucket (§Post-F9.40)', () => {
  it('replica el idOrden elegido a TODOS los colores', () => {
    const r = aLineasApi(matriz, undefined, 55);
    expect(r.every((l) => l.idOrden === 55)).toBe(true);
  });

  it('el bucket «sin orden» NO manda el campo (null y ausente significan lo mismo)', () => {
    expect(aLineasApi(matriz, undefined, null)[0]).not.toHaveProperty('idOrden');
    expect(aLineasApi(matriz)[0]).not.toHaveProperty('idOrden');
  });
});

describe('ordenesConExistencia (§Post-F9.40)', () => {
  it('suma por bucket, descarta los que no tienen piezas y pone «sin orden» primero', () => {
    expect(
      ordenesConExistencia([
        { idOrden: 55, folioOrden: 9001, existencia: 10 },
        { idOrden: 55, folioOrden: 9001, existencia: 5 },
        { idOrden: null, folioOrden: null, existencia: 4 },
        { idOrden: 60, folioOrden: 9002, existencia: 0 },
        { idOrden: 61, folioOrden: 9003, existencia: -3 },
      ]),
    ).toEqual([
      { idOrden: null, folioOrden: null, existencia: 4 },
      { idOrden: 55, folioOrden: 9001, existencia: 15 },
    ]);
  });

  it('sin filas no ofrece ninguna orden (la pantalla agrega «sin orden» aparte)', () => {
    expect(ordenesConExistencia([])).toEqual([]);
  });
});

describe('totalMatriz', () => {
  it('suma todas las celdas', () => {
    expect(totalMatriz(matriz)).toBe(8);
  });
});
