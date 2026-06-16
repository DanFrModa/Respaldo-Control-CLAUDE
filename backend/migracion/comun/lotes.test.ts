import { describe, expect, it } from 'vitest';

import { enLotes } from './lotes.js';

/** Espera `ms` milisegundos (para simular trabajo async con duración). */
function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('migración · enLotes (concurrencia acotada)', () => {
  it('procesa TODOS los items y preserva el orden del resultado', async () => {
    const items = [1, 2, 3, 4, 5];
    const res = await enLotes(items, (n) => Promise.resolve(n * 10), 2);
    expect(res).toHaveLength(5);
    expect(res.map((r) => (r.ok ? r.valor : null))).toEqual([10, 20, 30, 40, 50]);
    expect(res.every((r) => r.ok)).toBe(true);
  });

  it('RESPETA el límite de concurrencia (nunca más de N en vuelo)', async () => {
    let enVuelo = 0;
    let maxEnVuelo = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await enLotes(
      items,
      async () => {
        enVuelo += 1;
        maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
        await dormir(5);
        enVuelo -= 1;
      },
      4,
    );
    expect(maxEnVuelo).toBeLessThanOrEqual(4);
    expect(maxEnVuelo).toBeGreaterThan(1); // de verdad corrió en paralelo
  });

  it('un FALLO de un item NO tumba el lote: los demás se procesan', async () => {
    const items = [1, 2, 3, 4];
    const res = await enLotes(
      items,
      (n) => {
        if (n === 2) {
          return Promise.reject(new Error('item 2 falla'));
        }
        return Promise.resolve(n);
      },
      3,
    );
    expect(res).toHaveLength(4);
    expect(res[0]).toEqual({ ok: true, valor: 1 });
    expect(res[1]?.ok).toBe(false);
    if (!res[1]?.ok) {
      expect((res[1]?.error as Error).message).toBe('item 2 falla');
    }
    expect(res[2]).toEqual({ ok: true, valor: 3 });
    expect(res[3]).toEqual({ ok: true, valor: 4 });
  });

  it('lista vacía → arreglo vacío (no lanza)', async () => {
    const res = await enLotes([], () => Promise.resolve(1), 8);
    expect(res).toEqual([]);
  });

  it('concurrencia ≥ items o = 1 funcionan igual (acota internamente)', async () => {
    const items = [1, 2, 3];
    const conMucha = await enLotes(items, (n) => Promise.resolve(n), 100);
    const conUna = await enLotes(items, (n) => Promise.resolve(n), 1);
    expect(conMucha.map((r) => (r.ok ? r.valor : null))).toEqual([1, 2, 3]);
    expect(conUna.map((r) => (r.ok ? r.valor : null))).toEqual([1, 2, 3]);
  });

  it('con concurrencia 1 el orden de EJECUCIÓN es secuencial', async () => {
    const orden: number[] = [];
    await enLotes(
      [1, 2, 3],
      async (n) => {
        orden.push(n);
        await dormir(1);
        orden.push(-n);
      },
      1,
    );
    // Secuencial: cada item entra y sale antes del siguiente.
    expect(orden).toEqual([1, -1, 2, -2, 3, -3]);
  });
});
