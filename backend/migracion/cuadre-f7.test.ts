/**
 * Unit del análisis de REGALÍAS del cuadre F7 (D2) — corre en el proyecto `unit` (SIN base de datos):
 * `analizarRegalias` solo lee `CostoOrd.csv` (apuntado por `TABLAS_DIR` al fixture committeado) y
 * calcula, sin tocar Postgres, si el `Costo` viejo incluía la regalía + el delta esperado v1−v2.
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { analizarRegalias } from './cuadre-f7.js';

const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-f7-costos', import.meta.url));
let previo: string | undefined;

beforeAll(() => {
  previo = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
});
afterAll(() => {
  if (previo === undefined) delete process.env.TABLAS_DIR;
  else process.env.TABLAS_DIR = previo;
});

describe('analizarRegalias (D2)', () => {
  it('detecta que el Costo viejo INCLUÍA la regalía y da el delta esperado', () => {
    const r = analizarRegalias();
    expect(r.filas).toBe(4);
    expect(r.conRegalia).toBe(1); // solo IdCostoOrd=2 (RegaliasCost=7)
    expect(r.costoIncluyeRegalia).toBe(1); // 27 == 10+2+3+5+7+0
    expect(r.costoExcluyeRegalia).toBe(0);
    expect(r.costoNoCasa).toBe(0);
    expect(r.sumaRegalias).toBe(7); // delta esperado v1−v2 del costoTotal
  });
});
