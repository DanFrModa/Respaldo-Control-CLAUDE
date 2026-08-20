/**
 * Unit del REPARTO entre OP (V1-E3q, §Post-F9.86) — función pura, sin BD.
 *
 * Lo que estas pruebas protegen es la frase de Daniel: *"el sobrante de compra **se reparte entre
 * las OP de la compra**"*, y su condición innegociable, *"el reparto es SIEMPRE por OP… sin eso el
 * 'qué tengo / qué falta' de cada OP deja de cuadrar y el costo no cae donde debe"*. Por eso la
 * aserción que más importa no es el redondeo bonito: es que **la suma del reparto sea EXACTAMENTE
 * el total**, siempre.
 */
import { describe, expect, it } from 'vitest';

import { repartirEntreOrdenes } from './reparto-ordenes.js';

describe('repartirEntreOrdenes (§Post-F9.86)', () => {
  it('sin ajuste, cada OP se lleva exactamente lo suyo', () => {
    expect(repartirEntreOrdenes([180, 120], 300)).toEqual([180, 120]);
  });

  it('⭐ el SOBRANTE (rollo completo) se reparte EN PROPORCIÓN a lo que cada OP necesita', () => {
    // 100 y 50 → un rollo de 180 va 120/60, no 90/90: repartir en partes iguales dejaría a la
    // primera corta (y su "qué falta" seguiría rojo después de haber comprado).
    expect(repartirEntreOrdenes([100, 50], 180)).toEqual([120, 60]);
  });

  it('comprar de MENOS también se reparte proporcionalmente (compra parcial válida)', () => {
    expect(repartirEntreOrdenes([100, 100], 150)).toEqual([75, 75]);
  });

  it('⭐ la suma del reparto es EXACTAMENTE el total, aunque no divida (la última absorbe)', () => {
    const partes = repartirEntreOrdenes([1, 1, 1], 100);
    // 100/3 = 33.3333 dos veces y 33.3334 la última: si la última NO absorbiera el residuo, la
    // suma daría 99.9999 y el documento no cuadraría con sus renglones.
    expect(partes).toEqual([33.3333, 33.3333, 33.3334]);
    expect(partes.reduce((s, x) => s + x, 0)).toBe(100);
  });

  it('con UNA sola OP se lleva todo (no hay nada que repartir)', () => {
    expect(repartirEntreOrdenes([45], 60)).toEqual([60]);
  });

  it('si NADIE necesita nada, se reparte en partes IGUALES (no todo a la primera)', () => {
    // Dejarlo todo en la primera sería una decisión escondida; el empate se resuelve a la vista.
    expect(repartirEntreOrdenes([0, 0], 50)).toEqual([25, 25]);
  });

  it('una base negativa cuenta como cero (una necesidad negativa no existe)', () => {
    expect(repartirEntreOrdenes([-10, 100], 100)).toEqual([0, 100]);
  });

  it('sin OP no reparte nada', () => {
    expect(repartirEntreOrdenes([], 100)).toEqual([]);
  });

  it('redondea a los 4 decimales de la BD (no inventa precisión que no se puede guardar)', () => {
    const partes = repartirEntreOrdenes([1, 2], 10);
    expect(partes).toEqual([3.3333, 6.6667]);
    expect(partes.reduce((s, x) => s + x, 0)).toBe(10);
  });
});
