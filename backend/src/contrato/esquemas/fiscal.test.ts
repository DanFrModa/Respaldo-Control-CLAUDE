import { describe, expect, it } from 'vitest';

import { esClabeValida, esRfcValido } from './fiscal.js';

describe('esRfcValido (forma del RFC mexicano, R15)', () => {
  it('acepta RFC de persona MORAL (12) y FÍSICA (13)', () => {
    expect(esRfcValido('ABC010101AB1')).toBe(true); // moral
    expect(esRfcValido('AABB801231XY9')).toBe(true); // física
    expect(esRfcValido('XAXX010101000')).toBe(true); // genérico nacional
  });

  it('normaliza minúsculas antes de validar', () => {
    expect(esRfcValido('abc010101ab1')).toBe(true);
  });

  it('rechaza longitudes y formas inválidas', () => {
    expect(esRfcValido('ABC')).toBe(false);
    expect(esRfcValido('ABC0101')).toBe(false);
    expect(esRfcValido('1234010101AB1')).toBe(false); // empieza con dígitos
    expect(esRfcValido('ABCD13131311')).toBe(false); // mes 13, día 13 inválidos
  });

  it('rechaza fechas imposibles en el RFC', () => {
    expect(esRfcValido('ABC011301AB1')).toBe(false); // mes 13
    expect(esRfcValido('ABC010132AB1')).toBe(false); // día 32
  });
});

describe('esClabeValida (18 dígitos con dígito de control, módulo 10 pesos 3,7,1)', () => {
  it('acepta CLABE con dígito de control correcto', () => {
    // CLABE de ejemplo válida (dígito de control calculado con el algoritmo de Banxico).
    expect(esClabeValida('002010077777777771')).toBe(true);
    expect(esClabeValida('032180000118359719')).toBe(true);
  });

  it('rechaza una CLABE con dígito de control incorrecto', () => {
    // Misma CLABE válida pero con el último dígito alterado.
    expect(esClabeValida('002010077777777772')).toBe(false);
    expect(esClabeValida('032180000118359710')).toBe(false);
  });

  it('rechaza longitudes distintas de 18 o con no-dígitos', () => {
    expect(esClabeValida('00201007777777777')).toBe(false); // 17
    expect(esClabeValida('0020100777777777712')).toBe(false); // 19
    expect(esClabeValida('00201007777777777X')).toBe(false); // letra
    expect(esClabeValida('')).toBe(false);
  });

  it('ignora espacios alrededor', () => {
    expect(esClabeValida('  002010077777777771  ')).toBe(true);
  });
});
