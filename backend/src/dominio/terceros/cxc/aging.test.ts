/**
 * Unit del aging de CxC (F9-E4). La mecánica es la COMPARTIDA (`../aging-comun.ts`), así que este test
 * verifica que CxC la exponga con sus límites (bordes de cubetas) y que el neteo de cobros (de más viejo
 * a más nuevo) cuadre — el saldo total siempre exacto (D3). Espejo del unit de CxP.
 */
import { describe, expect, it } from 'vitest';

import { LIMITES_AGING_CXC, cubetaPorAtraso, netearCubetas, type CubetasBrutas } from './aging.js';

describe('cubetaPorAtraso de CxC (bordes de las cubetas)', () => {
  it('≤ 0 días de atraso = corriente', () => {
    expect(cubetaPorAtraso(-10)).toBe('corriente');
    expect(cubetaPorAtraso(0)).toBe('corriente');
  });

  it('1..d30 = 1–30', () => {
    expect(cubetaPorAtraso(1)).toBe('d1a30');
    expect(cubetaPorAtraso(LIMITES_AGING_CXC.d30)).toBe('d1a30');
  });

  it('(d30+1)..d60 = 31–60', () => {
    expect(cubetaPorAtraso(LIMITES_AGING_CXC.d30 + 1)).toBe('d31a60');
    expect(cubetaPorAtraso(LIMITES_AGING_CXC.d60)).toBe('d31a60');
  });

  it('> d60 = +60', () => {
    expect(cubetaPorAtraso(LIMITES_AGING_CXC.d60 + 1)).toBe('mas60');
    expect(cubetaPorAtraso(400)).toBe('mas60');
  });
});

describe('netearCubetas de CxC (cobros de más viejo a más nuevo)', () => {
  it('reparte el cobro empezando por lo más atrasado; el saldo total cuadra', () => {
    const brutas: CubetasBrutas = {
      corriente: 100,
      d1a30: 50,
      d31a60: 40,
      mas60: 30,
      creditos: 90,
    };
    const neta = netearCubetas(brutas);
    // 90 de crédito: cubre +60 (30) → 31–60 (40) → sobran 20 para 1–30.
    expect(neta.mas60).toBe(0);
    expect(neta.d31a60).toBe(0);
    expect(neta.d1a30).toBe(30);
    expect(neta.corriente).toBe(100);
    const saldo = neta.corriente + neta.d1a30 + neta.d31a60 + neta.mas60;
    expect(saldo).toBe(130); // (100+50+40+30) − 90
  });

  it('el sobrepago empuja corriente a negativo (saldo a favor del cliente)', () => {
    const brutas: CubetasBrutas = { corriente: 50, d1a30: 0, d31a60: 0, mas60: 0, creditos: 80 };
    const neta = netearCubetas(brutas);
    expect(neta.corriente).toBe(-30);
  });
});
