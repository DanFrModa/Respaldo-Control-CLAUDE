/**
 * Unit de `piezasRecibibles` (`matriz-orden.ts`) — el número que el SELECTOR de maquilero anuncia
 * («N pza(s) por recibirle») y que decide **a quién se le ofrece recibir**.
 *
 * Nació de una mutación de V1-E8v: al cambiar la función de `recibible` a `cantidad` (los dos campos
 * colapsaron, §Post-F9.147) se probó a quitarle el `Math.max(0, …)` y **la suite entera se quedó
 * verde**. Ese piso a 0 nunca había tenido una aserción propia, aunque la ficha de V1-E8k lo daba por
 * cubierto: era una guarda viva que nada mataba.
 */
import { describe, expect, it } from 'vitest';

import { piezasRecibibles } from './matriz-orden';

/** Una celda mínima con lo único que la función mira. */
const celda = (cantidad: number): { cantidad: number } => ({ cantidad });

describe('piezasRecibibles', () => {
  it('suma el pendiente de las celdas', () => {
    expect(piezasRecibibles([celda(4), celda(6)])).toBe(10);
  });

  it('🔴 SÓLO las celdas positivas: +5 y −5 del histórico migrado dan 5, no 0', () => {
    // En el Access un recibo podía capturarse en la talla equivocada: sobra en una y falta en otra.
    // Sumando con signo el total da 0 y el selector diría «0 pza(s) por recibirle» — falso: al
    // maquilero SÍ se le pueden recibir esas 5 (hallazgo del reviewer en V1-E8k). El servidor
    // acepta la celda positiva y rechaza la negativa, celda por celda.
    expect(piezasRecibibles([celda(5), celda(-5)])).toBe(5);
  });

  it('un maquilero que sólo tiene celdas negativas no tiene NADA que devolver', () => {
    // Recibos sin envío (histórico migrado): pendiente negativo, pero no hay qué recibirle.
    expect(piezasRecibibles([celda(-3), celda(-2)])).toBe(0);
  });

  it('sin celdas es 0 (no NaN ni undefined)', () => {
    expect(piezasRecibibles([])).toBe(0);
  });
});
