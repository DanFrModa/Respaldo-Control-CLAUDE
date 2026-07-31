/**
 * Tests UNITARIOS de la lógica PURA del motor de la ruta viva (R4). Sin BD. Cubre:
 *  • `secuenciaEstampadoEfectiva` — elección de la orden > modelo; flexible sin elección = antes.
 *  • `diasRestantesProceso` — holgura en días naturales UTC (negativo = vencido; null sin fecha).
 */
import { describe, expect, it } from 'vitest';

import { diasRestantesProceso, secuenciaEstampadoEfectiva } from './rutaOrden.js';

function f(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe('secuenciaEstampadoEfectiva (R4, B10)', () => {
  it('el modelo forzado manda cuando no hay elección', () => {
    expect(secuenciaEstampadoEfectiva('antes', null)).toBe('antes');
    expect(secuenciaEstampadoEfectiva('despues', null)).toBe('despues');
  });

  it('flexible sin elección se planea ANTES (conservador)', () => {
    expect(secuenciaEstampadoEfectiva('flexible', null)).toBe('antes');
  });

  it('la elección de la orden manda sobre el modelo', () => {
    expect(secuenciaEstampadoEfectiva('flexible', 'despues')).toBe('despues');
    expect(secuenciaEstampadoEfectiva('flexible', 'antes')).toBe('antes');
  });

  it('un "flexible" residual como elección se ignora (cae al modelo)', () => {
    expect(secuenciaEstampadoEfectiva('despues', 'flexible')).toBe('despues');
    expect(secuenciaEstampadoEfectiva('flexible', 'flexible')).toBe('antes');
  });
});

describe('diasRestantesProceso (R4)', () => {
  const hoy = f('2026-07-07');

  it('planeada futura → días positivos; hoy → 0; vencida → negativos', () => {
    expect(diasRestantesProceso(f('2026-07-10'), hoy)).toBe(3);
    expect(diasRestantesProceso(f('2026-07-07'), hoy)).toBe(0);
    expect(diasRestantesProceso(f('2026-07-03'), hoy)).toBe(-4);
  });

  it('sin planeada → null', () => {
    expect(diasRestantesProceso(null, hoy)).toBeNull();
  });

  it('ignora la hora (día calendario UTC)', () => {
    expect(
      diasRestantesProceso(new Date('2026-07-08T01:00:00Z'), new Date('2026-07-07T23:00:00Z')),
    ).toBe(1);
  });
});
