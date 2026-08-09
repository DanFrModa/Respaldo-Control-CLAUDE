import { describe, expect, it } from 'vitest';

import {
  faltantePorRecibir,
  minimoParaSurtir,
  renglonSurtido,
  TOLERANCIA_TELA,
} from './tolerancia-recepcion.js';

/**
 * Unit del criterio "¿está surtido este renglón?" (§Post-F9.19), dictado por Daniel:
 *  • se cierra contra lo que la OC pidió, **cuerpo y complemento** ("si en la OC lleva cardigan, se
 *    debe de recibir el cardigan"; "no siempre lleva cardigan");
 *  • en TELA hay banda del 5% por debajo, porque *"nunca se recibe la cantidad exacta que se pide:
 *    si se piden 400 kilos, el proveedor puede entregar +/− 5%"*;
 *  • en avíos y líneas libres NO hay banda (son piezas contadas).
 * Función pura: sin base de datos.
 */

describe('minimoParaSurtir', () => {
  it('en tela pide 5% menos; en avío pide lo pedido completo', () => {
    expect(TOLERANCIA_TELA).toBe(0.05);
    expect(minimoParaSurtir(400, true)).toBeCloseTo(380);
    expect(minimoParaSurtir(400, false)).toBe(400);
  });
});

describe('renglonSurtido — TELA con banda del 5%', () => {
  it('400 kilos pedidos: 380 SÍ cierran (−5%), 379 no', () => {
    expect(renglonSurtido({ pedido: 400, recibido: 380, esTela: true })).toBe(true);
    expect(renglonSurtido({ pedido: 400, recibido: 379, esTela: true })).toBe(false);
  });

  it('recibir MÁS de lo pedido cierra (el excedente nunca estorba)', () => {
    expect(renglonSurtido({ pedido: 400, recibido: 420, esTela: true })).toBe(true);
  });

  it('la cantidad EXACTA cierra, obviamente', () => {
    expect(renglonSurtido({ pedido: 400, recibido: 400, esTela: true })).toBe(true);
  });

  it('una entrega parcial de verdad (la mitad) NO cierra', () => {
    expect(renglonSurtido({ pedido: 400, recibido: 200, esTela: true })).toBe(false);
  });
});

describe('renglonSurtido — AVÍO / línea libre sin banda', () => {
  it('180 piezas pedidas: 180 cierran, 179 no (aquí no hay ±5%)', () => {
    expect(renglonSurtido({ pedido: 180, recibido: 180, esTela: false })).toBe(true);
    expect(renglonSurtido({ pedido: 180, recibido: 179, esTela: false })).toBe(false);
  });

  it('tolera el ruido de redondeo decimal', () => {
    expect(renglonSurtido({ pedido: 180, recibido: 179.9999999, esTela: false })).toBe(true);
  });
});

describe('renglonSurtido — COMPLEMENTO (Cardigan)', () => {
  it('sin complemento en la OC, el cuerpo basta ("no siempre lleva cardigan")', () => {
    expect(
      renglonSurtido({ pedido: 400, recibido: 400, pedidoComplemento: null, esTela: true }),
    ).toBe(true);
  });

  it('con complemento en la OC, el cuerpo NO basta: falta el cardigan', () => {
    expect(
      renglonSurtido({
        pedido: 400,
        recibido: 400,
        pedidoComplemento: 50,
        recibidoComplemento: 0,
        esTela: true,
      }),
    ).toBe(false);
  });

  it('cierra cuando llegan los dos, cada uno con su banda del 5%', () => {
    expect(
      renglonSurtido({
        pedido: 400,
        recibido: 380,
        pedidoComplemento: 50,
        recibidoComplemento: 47.5,
        esTela: true,
      }),
    ).toBe(true);
    // El cardigan corto más allá de la banda deja el renglón abierto.
    expect(
      renglonSurtido({
        pedido: 400,
        recibido: 400,
        pedidoComplemento: 50,
        recibidoComplemento: 40,
        esTela: true,
      }),
    ).toBe(false);
  });

  it('llega solo el cardigan y no el cuerpo: sigue abierto', () => {
    expect(
      renglonSurtido({
        pedido: 400,
        recibido: 0,
        pedidoComplemento: 50,
        recibidoComplemento: 50,
        esTela: true,
      }),
    ).toBe(false);
  });
});

describe('faltantePorRecibir', () => {
  it('dentro de la banda ya no falta NADA (ni cuerpo ni complemento)', () => {
    expect(
      faltantePorRecibir({
        pedido: 400,
        recibido: 385,
        pedidoComplemento: 50,
        recibidoComplemento: 49,
        esTela: true,
      }),
    ).toEqual({ cuerpo: 0, complemento: 0 });
  });

  it('fuera de la banda, reporta la diferencia REAL contra lo pedido', () => {
    expect(
      faltantePorRecibir({
        pedido: 400,
        recibido: 300,
        pedidoComplemento: 50,
        recibidoComplemento: 10,
        esTela: true,
      }),
    ).toEqual({ cuerpo: 100, complemento: 40 });
  });

  it('nunca reporta faltante negativo cuando se recibió de más', () => {
    const falta = faltantePorRecibir({
      pedido: 180,
      recibido: 100,
      pedidoComplemento: 20,
      recibidoComplemento: 30,
      esTela: false,
    });
    expect(falta.cuerpo).toBe(80);
    expect(falta.complemento).toBe(0);
  });
});
