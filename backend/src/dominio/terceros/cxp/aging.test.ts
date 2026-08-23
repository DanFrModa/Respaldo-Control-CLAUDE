import { describe, expect, it } from 'vitest';

import { LIMITES_AGING_CXP, cubetaPorAtraso, netearCubetas, type CubetasBrutas } from './aging.js';

/**
 * Unit del AGING de CxP (F9-E2): la clasificación por días de atraso (bordes 0/1/30/31/60/61) y el
 * neteo de créditos de más viejo a más nuevo. Sin BD ni fechas del reloj — pieza pura.
 */
describe('cubetaPorAtraso (bordes de las cubetas)', () => {
  it('atraso ≤ 0 (incl. "vencido hoy" = 0) cae en corriente', () => {
    expect(cubetaPorAtraso(-10)).toBe('corriente');
    expect(cubetaPorAtraso(0)).toBe('corriente');
  });

  it('1..30 días → d1a30 (bordes 1 y 30)', () => {
    expect(cubetaPorAtraso(1)).toBe('d1a30');
    expect(cubetaPorAtraso(LIMITES_AGING_CXP.d30)).toBe('d1a30');
  });

  it('31..60 días → d31a60 (bordes 31 y 60)', () => {
    expect(cubetaPorAtraso(LIMITES_AGING_CXP.d30 + 1)).toBe('d31a60');
    expect(cubetaPorAtraso(LIMITES_AGING_CXP.d60)).toBe('d31a60');
  });

  it('> 60 días → mas60 (borde 61)', () => {
    expect(cubetaPorAtraso(LIMITES_AGING_CXP.d60 + 1)).toBe('mas60');
    expect(cubetaPorAtraso(400)).toBe('mas60');
  });
});

describe('netearCubetas (créditos de más viejo a más nuevo)', () => {
  const suma = (b: { corriente: number; d1a30: number; d31a60: number; mas60: number }): number =>
    Math.round((b.corriente + b.d1a30 + b.d31a60 + b.mas60) * 100) / 100;

  it('sin créditos: pasa las cubetas tal cual', () => {
    const brutas: CubetasBrutas = { corriente: 100, d1a30: 50, d31a60: 20, mas60: 30, creditos: 0 };
    const neta = netearCubetas(brutas);
    expect(neta).toEqual({ corriente: 100, d1a30: 50, d31a60: 20, mas60: 30 });
    // Invariante: Σ cubetas netas = Σ cargos − créditos.
    expect(suma(neta)).toBe(200);
  });

  it('el crédito reduce PRIMERO la cubeta más vencida (+60)', () => {
    const brutas: CubetasBrutas = { corriente: 100, d1a30: 0, d31a60: 0, mas60: 100, creditos: 40 };
    const neta = netearCubetas(brutas);
    expect(neta.mas60).toBe(60);
    expect(neta.corriente).toBe(100);
    expect(suma(neta)).toBe(160);
  });

  it('el crédito desborda de +60 a 31–60 y a 1–30, dejando corriente intacto', () => {
    const brutas: CubetasBrutas = {
      corriente: 100,
      d1a30: 50,
      d31a60: 50,
      mas60: 50,
      creditos: 130,
    };
    const neta = netearCubetas(brutas);
    // 130 salda 50 (+60) + 50 (31–60) + 30 (1–30).
    expect(neta.mas60).toBe(0);
    expect(neta.d31a60).toBe(0);
    expect(neta.d1a30).toBe(20);
    expect(neta.corriente).toBe(100);
    expect(suma(neta)).toBe(120);
  });

  it('sobrepago: el crédito supera todos los cargos → corriente NEGATIVO (saldo a favor)', () => {
    const brutas: CubetasBrutas = { corriente: 100, d1a30: 0, d31a60: 0, mas60: 50, creditos: 200 };
    const neta = netearCubetas(brutas);
    expect(neta.mas60).toBe(0);
    // 200 − 50 (+60) − 100 (corriente) = 50 de sobrepago → corriente = −50.
    expect(neta.corriente).toBe(-50);
    expect(suma(neta)).toBe(-50);
  });
});
