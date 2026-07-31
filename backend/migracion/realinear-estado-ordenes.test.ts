import { describe, expect, it } from 'vitest';

import {
  formatearResumen,
  leerOpciones,
  type OpcionesRealineado,
} from './realinear-estado-ordenes.js';
import type { ResumenRealineacion } from '../src/dominio/produccion/requisitos-orden.js';

/**
 * Unit del CLI del script de mantenimiento (los flags y el resumen que imprime). El motor —la regla
 * y sus cinturones— vive en el dominio (`realinearEstadoOrdenes`) y se prueba en
 * `src/dominio/produccion/requisitos-orden.test.ts`: aquí NO se re-prueba la regla, solo la cáscara.
 */
describe('leerOpciones', () => {
  it('sin flags: todas las empresas, lotes de 500, escribiendo de verdad', () => {
    expect(leerOpciones([])).toEqual({ tamanoLote: 500, dryRun: false });
  });

  it('acepta --empresa, --lote y --dry-run', () => {
    expect(leerOpciones(['--empresa=3', '--lote=50', '--dry-run'])).toEqual({
      idEmpresa: 3,
      tamanoLote: 50,
      dryRun: true,
    });
  });

  it('rechaza un --lote inválido en vez de caer a un default silencioso', () => {
    expect(() => leerOpciones(['--lote=0'])).toThrow(/--lote/);
    expect(() => leerOpciones(['--lote=abc'])).toThrow(/--lote/);
  });

  it('rechaza una --empresa inválida', () => {
    expect(() => leerOpciones(['--empresa=-1'])).toThrow(/--empresa/);
  });
});

describe('formatearResumen', () => {
  const resumen: ResumenRealineacion = {
    revisadas: 3_923,
    degradadas: 2_800,
    completadas: 12,
    protegidasPorProduccion: 40,
  };
  const opciones: OpcionesRealineado = { tamanoLote: 500, dryRun: false };

  it('reporta los cuatro conteos y deriva las que no cambiaron', () => {
    const texto = formatearResumen(resumen, opciones);
    expect(texto).toContain('3923');
    expect(texto).toContain('2800');
    expect(texto).toContain('40');
    // Sin cambio = revisadas − degradadas − completadas.
    expect(texto).toContain('1111');
  });

  it('avisa cuando fue SIMULACIÓN (no escribió nada)', () => {
    expect(formatearResumen(resumen, { ...opciones, dryRun: true })).toContain('SIMULACIÓN');
    expect(formatearResumen(resumen, opciones)).not.toContain('SIMULACIÓN');
  });

  it('dice cómo se resuelven las que quedaron incompletas (por modelo, no orden por orden)', () => {
    const texto = formatearResumen(resumen, opciones);
    expect(texto).toContain('POR MODELO');
    expect(texto).toContain('Lleva arte');
    expect(texto).toContain('NO impide operarlas');
  });
});
