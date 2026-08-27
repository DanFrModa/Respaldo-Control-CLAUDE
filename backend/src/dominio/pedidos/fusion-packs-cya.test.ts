/**
 * Tests UNIT de la fusión de renglones-PACK en un solo renglón de color (§Post-F9.129).
 * Reglas cementadas: se SUMA talla por talla, el orden es el de primera aparición, las variantes de
 * mayúsculas/espacios de una misma talla caen en UNA sola celda (si no, `sincronizarMatriz` aborta
 * la importación con "Una talla no puede aparecer dos veces en el mismo color") y una talla que
 * queda en 0 en TODOS los packs no genera celda.
 */
import { describe, expect, it } from 'vitest';

import { fusionarPacksEnUnaCorrida } from './fusion-packs-cya.js';

describe('fusionarPacksEnUnaCorrida', () => {
  it('suma los packs talla por talla en UNA sola corrida (Negro A + Negro B = Negro)', () => {
    const corrida = fusionarPacksEnUnaCorrida([
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

    expect(corrida).toEqual([
      { talla: '5-6', cantidad: 315 },
      { talla: '9-10', cantidad: 503 },
    ]);
  });

  it('conserva el orden de PRIMERA aparición, aunque un pack posterior traiga tallas nuevas', () => {
    const corrida = fusionarPacksEnUnaCorrida([
      {
        letra: 'A',
        tallas: [
          { talla: '9-10', cantidad: 10 },
          { talla: '5-6', cantidad: 20 },
        ],
      },
      {
        letra: 'B',
        tallas: [
          { talla: '13-14', cantidad: 30 },
          { talla: '5-6', cantidad: 5 },
        ],
      },
    ]);

    expect(corrida.map((c) => c.talla)).toEqual(['9-10', '5-6', '13-14']);
    expect(corrida.map((c) => c.cantidad)).toEqual([10, 25, 30]);
  });

  it('funde la MISMA talla escrita distinto (mayúsculas/espacios) en UNA celda, con la 1ª etiqueta', () => {
    const corrida = fusionarPacksEnUnaCorrida([
      { letra: 'A', tallas: [{ talla: ' CH ', cantidad: 100 }] },
      { letra: 'B', tallas: [{ talla: 'ch', cantidad: 40 }] },
      { letra: 'C', tallas: [{ talla: 'Ch', cantidad: 1 }] },
    ]);

    // UNA sola celda: dos celdas resolverían la misma `idTalla` y `sincronizarMatriz` abortaría.
    expect(corrida).toEqual([{ talla: 'CH', cantidad: 141 }]);
  });

  it('descarta la talla que queda en 0 en TODOS los packs, pero conserva la que suma > 0', () => {
    const corrida = fusionarPacksEnUnaCorrida([
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

    expect(corrida).toEqual([{ talla: '5-6', cantidad: 12 }]);
  });

  it('con un solo renglón (OC de un solo pack) devuelve su corrida tal cual', () => {
    const corrida = fusionarPacksEnUnaCorrida([
      {
        letra: null,
        tallas: [
          { talla: 'M', cantidad: 7 },
          { talla: 'G', cantidad: 3 },
        ],
      },
    ]);

    expect(corrida).toEqual([
      { talla: 'M', cantidad: 7 },
      { talla: 'G', cantidad: 3 },
    ]);
  });

  it('sin renglones (o con todos vacíos) devuelve una corrida vacía', () => {
    expect(fusionarPacksEnUnaCorrida([])).toEqual([]);
    expect(fusionarPacksEnUnaCorrida([{ letra: 'A', tallas: [] }])).toEqual([]);
    // Una etiqueta en blanco no genera celda (no es una talla del catálogo).
    expect(
      fusionarPacksEnUnaCorrida([{ letra: 'A', tallas: [{ talla: '  ', cantidad: 5 }] }]),
    ).toEqual([]);
  });
});
