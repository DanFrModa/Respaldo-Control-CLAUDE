import { afterEach, describe, expect, it, vi } from 'vitest';

import { hoyIso } from './comun.js';

/**
 * ⭐ FILA 0.230 — el conteo cíclico se abre con el día DEL NEGOCIO. `hoyIso` era
 * `new Date().toISOString().slice(0, 10)`: un conteo abierto de 18:00 a 23:59 de México quedaba
 * fechado MAÑANA. Reloj anclado en las dos franjas (23:30 y 00:30 de México); se falsea sólo `Date`.
 */
describe('hoyIso del conteo cíclico (fila 0.230)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['23:30 del 12-oct en México (UTC ya es 13)', '2026-10-13T05:30:00.000Z', '2026-10-12'],
    ['00:30 del 13-oct en México', '2026-10-13T06:30:00.000Z', '2026-10-13'],
  ])('a las %s (instante %s) el conteo se fecha %s', (_franja, instante, esperado) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instante));
    expect(hoyIso()).toBe(esperado);
  });
});
