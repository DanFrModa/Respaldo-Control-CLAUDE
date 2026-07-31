/**
 * Tests UNIT del cálculo de SOBRE-PEDIDO por packs (`sobrepedido-cya.ts`). Se cementan los números
 * canónicos de la OC real 620884 (petición Daniel): el 7% se aplica al NÚMERO de packs (round), la
 * corrida se reconstruye con la proporción del pack, y las piezas sueltas (SKU) se redondean por talla.
 */
import { describe, expect, it } from 'vitest';

import { calcularSobrepedidoCya, type GrupoPackEntrada } from './sobrepedido-cya.js';

/** Tabla SKU/Talla/Piezas de la OC 620884 (lo que pidió el cliente). */
const TALLAS_620884 = [
  { talla: '5-6', piezas: 305 },
  { talla: '6-7', piezas: 126 },
  { talla: '7-8', piezas: 129 },
  { talla: '9-10', piezas: 488 },
  { talla: '11-12', piezas: 490 },
  { talla: '13-14', piezas: 365 },
];

/** Grupos "Detalles PACK / SKU" de la OC 620884 (A/B packs, C sueltas). */
const GRUPOS_620884: GrupoPackEntrada[] = [
  {
    grupo: 'A',
    tipo: 'PACK',
    totalPacks: 119,
    desglose: [
      { talla: '5-6', cantidad: 238 },
      { talla: '6-7', cantidad: 119 },
      { talla: '7-8', cantidad: 119 },
      { talla: '9-10', cantidad: 357 },
      { talla: '11-12', cantidad: 357 },
      { talla: '13-14', cantidad: 238 },
    ],
  },
  {
    grupo: 'B',
    tipo: 'PACK',
    totalPacks: 57,
    desglose: [
      { talla: '5-6', cantidad: 57 },
      { talla: '9-10', cantidad: 114 },
      { talla: '11-12', cantidad: 114 },
      { talla: '13-14', cantidad: 114 },
    ],
  },
  {
    grupo: 'C',
    tipo: 'SKU',
    totalPacks: 1,
    desglose: [
      { talla: '5-6', cantidad: 10 },
      { talla: '6-7', cantidad: 7 },
      { talla: '7-8', cantidad: 10 },
      { talla: '9-10', cantidad: 17 },
      { talla: '11-12', cantidad: 19 },
      { talla: '13-14', cantidad: 13 },
    ],
  },
];

describe('calcularSobrepedidoCya', () => {
  it('7% sobre la OC 620884: packs A 119→127, B 57→61, SKU +7% → totales 326-134-138-521-523-390 = 2032', () => {
    const p = calcularSobrepedidoCya(TALLAS_620884, GRUPOS_620884, 7);

    // Packs propuestos (round sobre el NÚMERO de packs, no por talla).
    expect(p.grupos.map((g) => [g.grupo, g.packsPropuestos])).toEqual([
      ['A', 127],
      ['B', 61],
      ['C', 1],
    ]);
    // Pack A: 127 × proporción [2,1,1,3,3,2].
    expect(p.grupos[0]?.desglose.map((c) => c.propuesta)).toEqual([254, 127, 127, 381, 381, 254]);
    // Pack B: 61 × [1,2,2,2] (tallas 5-6, 9-10, 11-12, 13-14).
    expect(p.grupos[1]?.desglose.map((c) => c.propuesta)).toEqual([61, 122, 122, 122]);
    // SKU C: round(×1.07) por talla.
    expect(p.grupos[2]?.desglose.map((c) => c.propuesta)).toEqual([11, 7, 11, 18, 20, 14]);

    // Totales por talla = suma de los grupos.
    expect(p.totalPorTalla).toEqual([
      { talla: '5-6', original: 305, propuesta: 326 },
      { talla: '6-7', original: 126, propuesta: 134 },
      { talla: '7-8', original: 129, propuesta: 138 },
      { talla: '9-10', original: 488, propuesta: 521 },
      { talla: '11-12', original: 490, propuesta: 523 },
      { talla: '13-14', original: 365, propuesta: 390 },
    ]);
    expect(p.totalOriginal).toBe(1903);
    expect(p.totalPropuesta).toBe(2032);
    // La corrida cuadra con la tabla SKU → sin advertencias.
    expect(p.advertencias).toEqual([]);
  });

  it('con pct=0 la propuesta iguala a lo pedido (sin sobre-pedido)', () => {
    const p = calcularSobrepedidoCya(TALLAS_620884, GRUPOS_620884, 0);
    expect(p.totalPropuesta).toBe(1903);
    expect(p.totalPorTalla.every((c) => c.original === c.propuesta)).toBe(true);
    expect(p.grupos.map((g) => g.packsPropuestos)).toEqual([119, 57, 1]);
  });

  it('sin grupos: redondea por talla sobre la tabla SKU', () => {
    const p = calcularSobrepedidoCya([{ talla: 'CH', piezas: 100 }], [], 7);
    expect(p.grupos).toEqual([]);
    expect(p.totalPorTalla).toEqual([{ talla: 'CH', original: 100, propuesta: 107 }]);
    expect(p.totalPropuesta).toBe(107);
  });

  it('avisa (sin reventar) cuando la proporción de un pack no es entera', () => {
    const grupos: GrupoPackEntrada[] = [
      { grupo: 'A', tipo: 'PACK', totalPacks: 10, desglose: [{ talla: 'CH', cantidad: 25 }] }, // 25/10 = 2.5
    ];
    const p = calcularSobrepedidoCya([{ talla: 'CH', piezas: 25 }], grupos, 7);
    expect(p.advertencias.some((a) => a.includes('proporción entera'))).toBe(true);
    // Fallback a redondeo por talla: round(25 × 1.07) = 27.
    expect(p.totalPorTalla[0]?.propuesta).toBe(27);
    expect(p.grupos[0]?.advertencia).not.toBeNull();
  });

  it('avisa cuando la suma de los packs no cuadra con la tabla SKU', () => {
    const grupos: GrupoPackEntrada[] = [
      { grupo: 'A', tipo: 'PACK', totalPacks: 5, desglose: [{ talla: 'CH', cantidad: 50 }] },
    ];
    // La tabla SKU dice 40, pero el pack suma 50.
    const p = calcularSobrepedidoCya([{ talla: 'CH', piezas: 40 }], grupos, 0);
    expect(p.advertencias.some((a) => a.includes('tabla SKU'))).toBe(true);
  });
});
