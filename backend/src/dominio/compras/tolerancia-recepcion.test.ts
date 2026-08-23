import { describe, expect, it } from 'vitest';

import {
  faltantePorRecibir,
  minimoParaSurtir,
  renglonSurtido,
  TOLERANCIA_POR_TIPO,
} from './tolerancia-recepcion.js';

/**
 * Unit del criterio "¿está surtido este renglón?" (§Post-F9.19), dictado por Daniel:
 *  • se cierra contra lo que la OC pidió, **cuerpo y complemento** ("si en la OC lleva cardigan, se
 *    debe de recibir el cardigan"; "no siempre lleva cardigan");
 *  • hay banda de tolerancia por debajo, porque *"nunca se recibe la cantidad exacta que se pide: si
 *    se piden 400 kilos, el proveedor puede entregar +/− 5%"* — y *"en avíos también puede haber una
 *    diferencia"*, así que la banda NO es exclusiva de la tela (hoy 5% en las dos, en constantes
 *    separadas para poder afinar una sin tocar la otra).
 * Función pura: sin base de datos.
 */

describe('minimoParaSurtir', () => {
  it('pide 5% menos, y la banda vive por tipo de material', () => {
    expect(TOLERANCIA_POR_TIPO.tela).toBe(0.05);
    expect(TOLERANCIA_POR_TIPO.avio).toBe(0.05);
    expect(minimoParaSurtir(400, 'tela')).toBeCloseTo(380);
    expect(minimoParaSurtir(180, 'avio')).toBeCloseTo(171);
  });
});

describe('renglonSurtido — TELA con banda del 5%', () => {
  it('400 kilos pedidos: 380 SÍ cierran (−5%), 379 no', () => {
    expect(renglonSurtido({ pedido: 400, recibido: 380, tipo: 'tela' })).toBe(true);
    expect(renglonSurtido({ pedido: 400, recibido: 379, tipo: 'tela' })).toBe(false);
  });

  it('recibir MÁS de lo pedido cierra (el excedente nunca estorba)', () => {
    expect(renglonSurtido({ pedido: 400, recibido: 420, tipo: 'tela' })).toBe(true);
  });

  it('la cantidad EXACTA cierra, obviamente', () => {
    expect(renglonSurtido({ pedido: 400, recibido: 400, tipo: 'tela' })).toBe(true);
  });

  it('una entrega parcial de verdad (la mitad) NO cierra', () => {
    expect(renglonSurtido({ pedido: 400, recibido: 200, tipo: 'tela' })).toBe(false);
  });
});

describe('renglonSurtido — AVÍO (también admite diferencia)', () => {
  it('180 piezas pedidas: 171 YA cierran (−5%), 170 no', () => {
    // Daniel: *"en avíos también puede haber una diferencia"*.
    expect(renglonSurtido({ pedido: 180, recibido: 171, tipo: 'avio' })).toBe(true);
    expect(renglonSurtido({ pedido: 180, recibido: 170, tipo: 'avio' })).toBe(false);
  });

  it('recibir de más también cierra, y tolera el ruido de redondeo', () => {
    expect(renglonSurtido({ pedido: 180, recibido: 200, tipo: 'avio' })).toBe(true);
    expect(renglonSurtido({ pedido: 180, recibido: 179.9999999, tipo: 'avio' })).toBe(true);
  });

  it('una entrega parcial de verdad (la mitad) NO cierra', () => {
    expect(renglonSurtido({ pedido: 180, recibido: 90, tipo: 'avio' })).toBe(false);
  });
});

describe('renglonSurtido — COMPLEMENTO (Cardigan)', () => {
  it('sin complemento en la OC, el cuerpo basta ("no siempre lleva cardigan")', () => {
    expect(
      renglonSurtido({ pedido: 400, recibido: 400, pedidoComplemento: null, tipo: 'tela' }),
    ).toBe(true);
  });

  it('con complemento en la OC, el cuerpo NO basta: falta el cardigan', () => {
    expect(
      renglonSurtido({
        pedido: 400,
        recibido: 400,
        pedidoComplemento: 50,
        recibidoComplemento: 0,
        tipo: 'tela',
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
        tipo: 'tela',
      }),
    ).toBe(true);
    // El cardigan corto más allá de la banda deja el renglón abierto.
    expect(
      renglonSurtido({
        pedido: 400,
        recibido: 400,
        pedidoComplemento: 50,
        recibidoComplemento: 40,
        tipo: 'tela',
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
        tipo: 'tela',
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
        tipo: 'tela',
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
        tipo: 'tela',
      }),
    ).toEqual({ cuerpo: 100, complemento: 40 });
  });

  it('nunca reporta faltante negativo cuando se recibió de más', () => {
    const falta = faltantePorRecibir({
      pedido: 180,
      recibido: 100,
      pedidoComplemento: 20,
      recibidoComplemento: 30,
      tipo: 'avio',
    });
    expect(falta.cuerpo).toBe(80);
    expect(falta.complemento).toBe(0);
  });

  /**
   * El faltante se PRECARGA en el input de la recepción: `100.5 − 30.2` en coma flotante da
   * `70.30000000000001` y el capturista lo veía tal cual. Se recorta a los 4 decimales que guarda
   * la columna `Decimal(14,4)`.
   */
  it('sin ruido de coma flotante: recorta a los 4 decimales de la columna', () => {
    const falta = faltantePorRecibir({
      pedido: 100.5,
      recibido: 30.2,
      pedidoComplemento: 10.3,
      recibidoComplemento: 1.1,
      tipo: 'avio',
    });
    expect(falta.cuerpo).toBe(70.3);
    expect(falta.complemento).toBe(9.2);
  });
});
