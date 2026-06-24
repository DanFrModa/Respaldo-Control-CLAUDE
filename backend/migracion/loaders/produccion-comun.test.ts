/**
 * Tests unitarios de los helpers PUROS del ETL de producción (F3-E6): `leerCantidadesTC` y
 * `despivotarDetalle`. No tocan BD: validan el despivote color×talla contra un contexto de orden
 * armado a mano y que las incidencias (color/columna/etiqueta sin match) se REPORTAN sin perder la
 * cantidad. El resto de los helpers (resolverContextoOrden, cargas de CSV) se cubren en el int test.
 */
import { describe, expect, it } from 'vitest';

import { Reporte } from '../comun/reporte.js';

import {
  despivotarDetalle,
  leerCantidadesTC,
  type ContextoOrdenV2,
  type RenglonOrdenesDet,
} from './produccion-comun.js';

/** Contexto de orden de prueba: Rojo(idColor=10) con tallas CH(100)/M(101)/G(102), Tallas "CHM G ". */
function ctxOrden(): ContextoOrdenV2 {
  return {
    idOrden: 1,
    idEmpresa: 1,
    idColorPorNombreNorm: new Map([
      ['rojo', 10],
      ['negro', 11],
    ]),
    idTallaPorEtiquetaNorm: new Map([
      ['ch', 100],
      ['m', 101],
      ['g', 102],
    ]),
    // "CHM G " → col1=CH, col2=M, col3=G.
    etiquetaPorColumna: new Map([
      [1, 'CH'],
      [2, 'M'],
      [3, 'G'],
    ]),
  };
}

const renglonRojo: RenglonOrdenesDet = { idOrdenViejo: '100', color: 'Rojo' };

describe('leerCantidadesTC', () => {
  it('lee las 8 columnas TC1..TC8 (vacías → null)', () => {
    const cant = leerCantidadesTC({ TC1: '50', TC2: '0', TC3: '20', TC5: '' });
    expect(cant).toEqual([50, 0, 20, null, null, null, null, null]);
  });
});

describe('despivotarDetalle', () => {
  it('despivota color (del renglón) + talla (por posición TC) a celdas con cantidad >0', () => {
    const reporte = new Reporte();
    const celdas = despivotarDetalle(
      reporte,
      'Corte',
      '1',
      ctxOrden(),
      renglonRojo,
      [50, 0, 20, null, null, null, null, null], // TC1=CH=50, TC2=M=0 (no emite), TC3=G=20
      new Map(),
    );
    expect(celdas).toEqual([
      { idColor: 10, idTalla: 100, cantidad: 50 },
      { idColor: 10, idTalla: 102, cantidad: 20 },
    ]);
    expect(reporte.tieneIncidencias).toBe(false);
  });

  it('color sin match en la orden con cantidades → incidencia, cantidad preservada', () => {
    const reporte = new Reporte();
    const celdas = despivotarDetalle(
      reporte,
      'Corte',
      '2',
      ctxOrden(),
      { idOrdenViejo: '100', color: 'Verde Fosfo' }, // no está en la orden ni en el mapeo F1
      [10, 0, 0, null, null, null, null, null],
      new Map(),
    );
    expect(celdas).toHaveLength(0);
    expect(reporte.totalIncidencias).toBe(1);
  });

  it('respaldo: color resuelto por el mapeo texto→idColor de F1 cuando no está en la orden', () => {
    const reporte = new Reporte();
    const celdas = despivotarDetalle(
      reporte,
      'Corte',
      '3',
      ctxOrden(),
      { idOrdenViejo: '100', color: 'Negro' },
      [5, 0, 0, null, null, null, null, null],
      new Map([['negro', 11]]), // mapeo F1 (también está en la orden, pero probamos el respaldo)
    );
    expect(celdas).toEqual([{ idColor: 11, idTalla: 100, cantidad: 5 }]);
  });

  it('cantidad en columna SIN etiqueta de talla → incidencia, no emite celda', () => {
    const reporte = new Reporte();
    const celdas = despivotarDetalle(
      reporte,
      'Corte',
      '4',
      ctxOrden(),
      renglonRojo,
      [0, 0, 0, 99, null, null, null, null], // TC4 no tiene etiqueta (la cadena solo tiene 3 cols)
      new Map(),
    );
    expect(celdas).toHaveLength(0);
    expect(reporte.totalIncidencias).toBe(1);
  });

  it('etiqueta de talla sin match en la orden → incidencia, no emite celda', () => {
    const reporte = new Reporte();
    const ctx = ctxOrden();
    ctx.idTallaPorEtiquetaNorm.delete('g'); // la orden no tiene la talla G
    const celdas = despivotarDetalle(
      reporte,
      'Corte',
      '5',
      ctx,
      renglonRojo,
      [0, 0, 7, null, null, null, null, null], // TC3=G=7, pero G no está en la orden
      new Map(),
    );
    expect(celdas).toHaveLength(0);
    expect(reporte.totalIncidencias).toBe(1);
  });
});
