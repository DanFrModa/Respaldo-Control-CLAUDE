/**
 * Unit de la constancia de TERCEROS con saldo EsMa excluidos por la ventana (§7) — sin BD:
 * el saldo viejo se deriva con la MISMA fórmula que v2 (cargos VALIDADOS + abonos − pagos −
 * descuentos, D3) y la lista solo trae a los EXCLUIDOS con neto ≠ 0. Lee el fixture committeado
 * vía `TABLAS_DIR` (no toca los CSV reales).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  calcularSaldosEsMaViejos,
  listarTercerosExcluidosConSaldo,
  escribirConstanciaTercerosConSaldo,
} from './constancia-terceros.js';
import { Reporte } from './reporte.js';

const DIR_FIXTURES = fileURLToPath(
  new URL('../__fixtures__/tablas-terceros-saldo', import.meta.url),
);
let previo: string | undefined;

beforeAll(() => {
  previo = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
});
afterAll(() => {
  if (previo === undefined) delete process.env.TABLAS_DIR;
  else process.env.TABLAS_DIR = previo;
});

describe('calcularSaldosEsMaViejos (fórmula derivada D3 sobre los CSV)', () => {
  it('suma cargos VALIDADOS + abonos − pagos − descuentos, con la última fecha', () => {
    const saldos = calcularSaldosEsMaViejos();
    // maq 7: 100×10 (validado; el pendiente NO cuenta) + 200 − 300 − 100 = 800.
    expect(saldos.get('7')).toEqual({ neto: 800, ultimaFecha: '2024-03-15', movimientos: 4 });
    // maq 8: 50×3 + (−50) = 100 (abono NEGATIVO preservado).
    expect(saldos.get('8')).toEqual({ neto: 100, ultimaFecha: '2022-06-20', movimientos: 2 });
    // maq 9: 20×5 − 100 = 0 (cierra en cero, pero sí tuvo movimientos).
    expect(saldos.get('9')?.neto).toBe(0);
  });

  it('ignora movimientos sin cabecera y cabeceras sin maquilero', () => {
    const saldos = calcularSaldosEsMaViejos();
    expect(saldos.has('99')).toBe(false); // recibo con IdEsMa inexistente
    expect(saldos.has('0')).toBe(false); // cabecera con IdMaquileros=0
  });
});

describe('listarTercerosExcluidosConSaldo', () => {
  it('lista solo los EXCLUIDOS con neto ≠ 0, con nombre y antigüedad', () => {
    const fuera = listarTercerosExcluidosConSaldo((id) => id === '8'); // el 8 SÍ migra
    expect(fuera).toHaveLength(1);
    expect(fuera[0]).toMatchObject({
      idViejo: '7',
      nombre: 'Confecciones Del Norte',
      neto: 800,
      ultimaFecha: '2024-03-15',
    });
  });

  it('un tercero con neto 0 nunca entra a la constancia (no hay saldo que perder)', () => {
    const fuera = listarTercerosExcluidosConSaldo(() => false); // nadie migra
    expect(fuera.map((x) => x.idViejo).sort()).toEqual(['7', '8']); // el 9 (neto 0) queda fuera
  });

  it('ordena por |neto| descendente (lo más gordo primero)', () => {
    const fuera = listarTercerosExcluidosConSaldo(() => false);
    expect(fuera[0]?.idViejo).toBe('7'); // 800 > 100
  });
});

describe('escribirConstanciaTercerosConSaldo', () => {
  it('sin excluidos es un NO-OP (no escribe archivo ni ensucia el reporte)', () => {
    const reporte = new Reporte();
    expect(escribirConstanciaTercerosConSaldo([], reporte)).toBeNull();
    expect(reporte.obtenerNotas()).toHaveLength(0);
  });
});
