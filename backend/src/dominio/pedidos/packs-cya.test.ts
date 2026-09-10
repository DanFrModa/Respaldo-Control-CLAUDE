/**
 * Tests UNIT del agrupado de renglones-PACK de una OC de C&A en los renglones de su OP
 * (§Post-F9.10; antes §Post-F9.129 los fundía TODOS en uno solo).
 *
 * Reglas cementadas: **un renglón por pack**, cada uno con su corrida propia; dentro de un pack se
 * SUMA talla por talla; el orden es el de primera aparición (packs y tallas); las variantes de
 * mayúsculas/espacios de una misma talla caen en UNA sola celda (si no, `sincronizarMatriz` aborta
 * la importación con "Una talla no puede aparecer dos veces en el mismo color"); una talla que
 * queda en 0 no genera celda y un pack entero en 0 no genera renglón; y dos renglones con la MISMA
 * letra se funden (si no, `sincronizarMatriz` abortaría con "Un mismo color y pack no pueden
 * aparecer dos veces en la misma orden").
 */
import { describe, expect, it } from 'vitest';

import { agruparPacksEnRenglones } from './packs-cya.js';

describe('agruparPacksEnRenglones', () => {
  it('deja UN RENGLÓN POR PACK, cada uno con su corrida (Negro A y Negro B, no su suma)', () => {
    const renglones = agruparPacksEnRenglones([
      {
        letra: 'A',
        tallas: [
          { talla: '5-6', cantidad: 254 },
          { talla: '9-10', cantidad: 381 },
        ],
      },
      {
        letra: 'B',
        tallas: [
          { talla: '5-6', cantidad: 61 },
          { talla: '9-10', cantidad: 122 },
        ],
      },
    ]);

    expect(renglones).toEqual([
      {
        pack: 'A',
        tallas: [
          { talla: '5-6', cantidad: 254 },
          { talla: '9-10', cantidad: 381 },
        ],
      },
      {
        pack: 'B',
        tallas: [
          { talla: '5-6', cantidad: 61 },
          { talla: '9-10', cantidad: 122 },
        ],
      },
    ]);
  });

  it('conserva el orden de PRIMERA aparición de los PACKS y de las tallas dentro de cada uno', () => {
    const renglones = agruparPacksEnRenglones([
      {
        letra: 'B',
        tallas: [
          { talla: '9-10', cantidad: 10 },
          { talla: '5-6', cantidad: 20 },
        ],
      },
      {
        letra: 'A',
        tallas: [
          { talla: '13-14', cantidad: 30 },
          { talla: '5-6', cantidad: 5 },
        ],
      },
    ]);

    // Los packs NO se ordenan alfabéticamente: la matriz se lee como el papel de la OC.
    expect(renglones.map((r) => r.pack)).toEqual(['B', 'A']);
    expect(renglones[0]?.tallas.map((c) => c.talla)).toEqual(['9-10', '5-6']);
    expect(renglones[1]?.tallas.map((c) => c.talla)).toEqual(['13-14', '5-6']);
  });

  it('funde la MISMA talla escrita distinto (mayúsculas/espacios) DENTRO de un pack, con la 1ª etiqueta', () => {
    const renglones = agruparPacksEnRenglones([
      {
        letra: 'A',
        tallas: [
          { talla: ' CH ', cantidad: 100 },
          { talla: 'ch', cantidad: 40 },
          { talla: 'Ch', cantidad: 1 },
        ],
      },
    ]);

    // UNA sola celda: dos celdas resolverían la misma `idTalla` y `sincronizarMatriz` abortaría.
    expect(renglones).toEqual([{ pack: 'A', tallas: [{ talla: 'CH', cantidad: 141 }] }]);
  });

  it('NO funde la misma talla entre packs distintos: cada tendido conserva la suya', () => {
    const renglones = agruparPacksEnRenglones([
      { letra: 'A', tallas: [{ talla: 'CH', cantidad: 100 }] },
      { letra: 'B', tallas: [{ talla: 'ch', cantidad: 40 }] },
    ]);

    expect(renglones).toEqual([
      { pack: 'A', tallas: [{ talla: 'CH', cantidad: 100 }] },
      { pack: 'B', tallas: [{ talla: 'ch', cantidad: 40 }] },
    ]);
  });

  it('funde dos renglones con la MISMA letra (dos renglones de esa llave abortarían la importación)', () => {
    const renglones = agruparPacksEnRenglones([
      { letra: 'A', tallas: [{ talla: '5-6', cantidad: 10 }] },
      { letra: ' a ', tallas: [{ talla: '5-6', cantidad: 5 }] },
      { letra: 'A', tallas: [{ talla: '9-10', cantidad: 3 }] },
    ]);

    // `normalizarPack` sólo RECORTA (no cambia mayúsculas): " a " es el pack "a", distinto de "A".
    expect(renglones).toEqual([
      {
        pack: 'A',
        tallas: [
          { talla: '5-6', cantidad: 10 },
          { talla: '9-10', cantidad: 3 },
        ],
      },
      { pack: 'a', tallas: [{ talla: '5-6', cantidad: 5 }] },
    ]);
  });

  it('descarta la talla que queda en 0, y el PACK que queda entero en 0 no genera renglón', () => {
    const renglones = agruparPacksEnRenglones([
      {
        letra: 'A',
        tallas: [
          { talla: '5-6', cantidad: 0 },
          { talla: '6-7', cantidad: 0 },
        ],
      },
      {
        letra: 'B',
        tallas: [
          { talla: '5-6', cantidad: 12 },
          { talla: '6-7', cantidad: 0 },
        ],
      },
    ]);

    // El pack A se "integró" en el B: el usuario movió sus números en la vista previa.
    expect(renglones).toEqual([{ pack: 'B', tallas: [{ talla: '5-6', cantidad: 12 }] }]);
  });

  it('con un solo renglón SIN letra (OC de un pack) devuelve UN renglón con el pack VACÍO', () => {
    const renglones = agruparPacksEnRenglones([
      {
        letra: null,
        tallas: [
          { talla: 'M', cantidad: 7 },
          { talla: 'G', cantidad: 3 },
        ],
      },
    ]);

    // Pack vacío = «sin pack»: la OP nace exactamente como antes de §Post-F9.10, y ni el corte ni la
    // entrega a maquila piden tendido.
    expect(renglones).toEqual([
      {
        pack: '',
        tallas: [
          { talla: 'M', cantidad: 7 },
          { talla: 'G', cantidad: 3 },
        ],
      },
    ]);
  });

  it('sin renglones (o con todos vacíos) no genera ningún renglón', () => {
    expect(agruparPacksEnRenglones([])).toEqual([]);
    expect(agruparPacksEnRenglones([{ letra: 'A', tallas: [] }])).toEqual([]);
    // Una etiqueta en blanco no genera celda (no es una talla del catálogo) y deja el pack vacío.
    expect(
      agruparPacksEnRenglones([{ letra: 'A', tallas: [{ talla: '  ', cantidad: 5 }] }]),
    ).toEqual([]);
  });
});
