import { describe, expect, it } from 'vitest';

import { esquemaMedidasAvioGuardar } from './modelo-avio-talla.js';

/**
 * Contrato de las MEDIDAS POR TALLA de un avío del BOM (R18) + el AMARRE medida×talla (R5/B11)
 * que estrena V1-E3c: el consumo por talla se captura sobre las tallas de la CURVA del modelo y
 * cada talla puede amarrar la `AvioMedida` (tamaño real) con la que se compra.
 */
describe('esquemaMedidasAvioGuardar', () => {
  it('acepta el set completo con toggle y tallas, con el amarre de medida en null por default', () => {
    const datos = esquemaMedidasAvioGuardar.parse({
      consumoPorTalla: true,
      tallas: [
        { idTalla: 1, consumo: 0.5 },
        { idTalla: 2, consumo: 0.6 },
      ],
    });
    expect(datos.tallas).toHaveLength(2);
    expect(datos.tallas[0]?.idAvioMedida).toBeNull();
  });

  it('conserva el amarre a la medida del avío cuando viene', () => {
    const datos = esquemaMedidasAvioGuardar.parse({
      consumoPorTalla: true,
      tallas: [{ idTalla: 1, consumo: 0.5, idAvioMedida: 42 }],
    });
    expect(datos.tallas[0]?.idAvioMedida).toBe(42);
  });

  it('acepta consumo 0 (talla de la curva aún sin capturar) y rechaza negativos', () => {
    expect(
      esquemaMedidasAvioGuardar.safeParse({
        consumoPorTalla: true,
        tallas: [{ idTalla: 1, consumo: 0 }],
      }).success,
    ).toBe(true);
    expect(
      esquemaMedidasAvioGuardar.safeParse({
        consumoPorTalla: true,
        tallas: [{ idTalla: 1, consumo: -0.1 }],
      }).success,
    ).toBe(false);
  });

  it('rechaza tallas repetidas y amarres que no son enteros positivos', () => {
    expect(
      esquemaMedidasAvioGuardar.safeParse({
        consumoPorTalla: true,
        tallas: [
          { idTalla: 1, consumo: 1 },
          { idTalla: 1, consumo: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      esquemaMedidasAvioGuardar.safeParse({
        consumoPorTalla: true,
        tallas: [{ idTalla: 1, consumo: 1, idAvioMedida: 0 }],
      }).success,
    ).toBe(false);
  });
});
