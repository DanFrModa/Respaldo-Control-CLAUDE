import { describe, expect, it } from 'vitest';

import { redondear2, redondear4 } from './decimales.js';

/**
 * Redondeo por ESCALA DE COLUMNA. La regla que fijan estas pruebas es una sola y vale para las dos
 * escalas: **lo que se guarda y lo que se usa para derivar tienen que ser EL MISMO número**. Las
 * columnas de dinero son `Decimal(12,2)` y las de consumo/cantidad `Decimal(12,4)`; si un promedio o
 * un valor tecleado llega con más decimales, Postgres lo REDONDEA (no trunca) al escribirlo y el derivado
 * (importe = consumo × precio) calculado con el valor completo deja de cuadrar contra lo que el
 * usuario ve en la misma fila.
 */
describe('redondear2 (escala del dinero)', () => {
  it('redondea a 2 decimales', () => {
    expect(redondear2(0.694444444)).toBe(0.69);
    expect(redondear2(4.166666)).toBe(4.17);
    expect(redondear2(10)).toBe(10);
  });

  it('es idempotente (redondear lo ya redondeado no lo mueve)', () => {
    expect(redondear2(redondear2(0.694444444))).toBe(0.69);
  });
});

describe('redondear4 (escala del consumo)', () => {
  it('redondea a 4 decimales un promedio no terminante', () => {
    // El caso real: el promedio de las medidas por talla de R18, (1+1+2)/3.
    expect(redondear4(4 / 3)).toBe(1.3333);
    expect(redondear4(5 / 3)).toBe(1.6667);
  });

  it('no toca lo que ya cabe en la escala', () => {
    expect(redondear4(1.5)).toBe(1.5);
    expect(redondear4(3)).toBe(3);
    expect(redondear4(0.1234)).toBe(0.1234);
  });

  it('es idempotente', () => {
    expect(redondear4(redondear4(4 / 3))).toBe(1.3333);
  });

  it('el importe derivado cuadra con el consumo GUARDADO, no con el crudo', () => {
    // Con un avío de $50 y consumo (1+1+2)/3: el crudo daría 66.67 y el guardado da 66.66.
    const crudo = 4 / 3;
    const guardado = redondear4(crudo);
    expect(redondear2(guardado * 50)).toBe(66.66);
    expect(redondear2(crudo * 50)).toBe(66.67); // lo que se producía antes (fila descuadrada)
  });
});
