import { describe, expect, it } from 'vitest';

import { parsearTallasAnchoFijo } from './tallas.js';

describe('migración · parser de tallas (ancho fijo de 2, D4)', () => {
  it('parsea cadenas válidas (relleno con espacio a la derecha)', () => {
    // Casos reales de Ordenes.csv.
    expect(parsearTallasAnchoFijo('XCCHM G XG')).toMatchObject({
      etiquetas: ['XC', 'CH', 'M', 'G', 'XG'],
      rara: false,
    });
    expect(parsearTallasAnchoFijo('CHM G EX')).toMatchObject({
      etiquetas: ['CH', 'M', 'G', 'EX'],
      rara: false,
    });
    expect(parsearTallasAnchoFijo('12141618')).toMatchObject({
      etiquetas: ['12', '14', '16', '18'],
      rara: false,
    });
    expect(parsearTallasAnchoFijo('4 6 8 10')).toMatchObject({
      etiquetas: ['4', '6', '8', '10'],
      rara: false,
    });
  });

  it('ignora el relleno final de espacios', () => {
    expect(parsearTallasAnchoFijo('XCCHM G ')).toMatchObject({
      etiquetas: ['XC', 'CH', 'M', 'G'],
      rara: false,
    });
  });

  it('marca como RARA las cadenas con separador "--" (dos curvas pegadas)', () => {
    const r = parsearTallasAnchoFijo('6 1218--2 3 3X');
    expect(r.rara).toBe(true);
    expect(r.etiquetas).toEqual([]);
    expect(r.original).toBe('6 1218--2 3 3X');
  });

  it('marca como RARA las cadenas con salto de línea', () => {
    expect(parsearTallasAnchoFijo('CH\nM').rara).toBe(true);
  });

  it('marca como RARA la cadena vacía / solo espacios', () => {
    expect(parsearTallasAnchoFijo('').rara).toBe(true);
    expect(parsearTallasAnchoFijo('   ').rara).toBe(true);
  });

  it('marca RARA una cadena de longitud impar (un carácter suelto al final)', () => {
    // "ABC" → "AB" + "C" suelto: no respeta el ancho fijo de 2.
    expect(parsearTallasAnchoFijo('ABC').rara).toBe(true);
  });

  it('conserva el orden de las tallas (la curva es ORDENADA)', () => {
    expect(parsearTallasAnchoFijo('XCCHM G EX').etiquetas).toEqual(['XC', 'CH', 'M', 'G', 'EX']);
  });
});
