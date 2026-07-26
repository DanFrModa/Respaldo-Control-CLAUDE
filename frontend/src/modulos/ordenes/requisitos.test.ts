import { describe, expect, it } from 'vitest';

import { textoFaltantes } from './requisitos';

/**
 * La frase "Falta: …" que ve el usuario en el centro de órdenes y en el diálogo de la orden. La
 * REGLA vive en el backend (`dominio/produccion/requisitos-orden.ts`); aquí solo se traduce la
 * lista que manda el API.
 */
describe('textoFaltantes', () => {
  it('no dice nada cuando la orden cumple todo', () => {
    expect(textoFaltantes([])).toBeNull();
  });

  it('nombra un solo faltante en lenguaje de negocio', () => {
    expect(textoFaltantes(['avios'])).toBe('Falta: avíos');
    expect(textoFaltantes(['tallas'])).toBe('Falta: tallas');
  });

  it('nombra el ARTE (decisión de Daniel: por default la prenda sí lleva)', () => {
    expect(textoFaltantes(['arte'])).toBe('Falta: arte');
  });

  it('une dos faltantes con "y"', () => {
    expect(textoFaltantes(['avios', 'arte'])).toBe('Falta: avíos y arte');
  });

  it('une los tres con coma y "y" al final', () => {
    expect(textoFaltantes(['tallas', 'avios', 'arte'])).toBe('Falta: tallas, avíos y arte');
  });
});
