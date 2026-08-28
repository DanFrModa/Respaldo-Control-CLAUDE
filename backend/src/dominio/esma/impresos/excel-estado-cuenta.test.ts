import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import type { DesglosadoSalida } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';

import { excelEstadoCuenta } from './excel-estado-cuenta.js';

/**
 * Unit del export a Excel del ESTADO DE CUENTA (F6-E5) — SIN Postgres. Reusa el desglosado vía deps
 * inyectadas (un fake que no toca la BD) y verifica que se genera un `.xlsx` no vacío (firma ZIP "PK").
 */
function desglosadoFake(): DesglosadoSalida {
  return {
    idMaquilero: 5,
    maquilero: 'Maquila Costura SA',
    desde: null,
    hasta: null,
    conFactura: null,
    cargos: [
      {
        idCargo: 1,
        fecha: '2026-06-20',
        folioOrden: 100,
        codigoModelo: 'A-100',
        descripcionModelo: 'Playera',
        tipoProceso: 'Costura',
        cantidad: 10,
        precio: 8,
        importe: 80,
        sinCosto: false,
        conFactura: null,
      },
    ],
    abonos: [],
    descuentos: [],
    pagos: [],
    // V1-E8k (§Post-F9.136): el fixture trae una entrega de prendas incompletas, que es como se ve
    // el mundo que Daniel describió — un recibo con lo bueno Y lo que no se pudo coser.
    incompletas: {
      filas: [
        {
          idRecibo: 77,
          folioRecibo: 77,
          fecha: '2026-06-20',
          idOrden: 9,
          folioOrden: 100,
          codigoModelo: 'A-100',
          descripcionModelo: 'Playera',
          tipoProceso: 'Costura',
          piezas: 5,
        },
      ],
      totalPiezas: 5,
    },
    saldo: {
      idMaquilero: 5,
      maquilero: 'Maquila Costura SA',
      conFactura: null,
      totalCargos: 80,
      totalAbonos: 0,
      totalPagos: 0,
      totalDescuentos: 0,
      saldo: 80,
    },
  };
}

describe('excel estado de cuenta (F6-E5)', () => {
  it('genera un .xlsx no vacío (firma ZIP "PK")', async () => {
    const sesionFake = {} as SesionUsuario;
    const { buffer } = await excelEstadoCuenta(sesionFake, 5, {}, undefined, {
      estadoCuentaDesglosado: () => Promise.resolve(desglosadoFake()),
    });
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('V1-E8k · la hoja de prendas incompletas se crea aunque no haya ninguna', async () => {
    // La forma del archivo no puede depender de si hubo incompletas: quien lo abre siempre
    // encuentra las mismas cuatro hojas.
    const sesionFake = {} as SesionUsuario;
    const { buffer } = await excelEstadoCuenta(sesionFake, 5, {}, undefined, {
      estadoCuentaDesglosado: () =>
        Promise.resolve({ ...desglosadoFake(), incompletas: { filas: [], totalPiezas: 0 } }),
    });
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(libro.worksheets.map((h) => h.name)).toEqual([
      'Cargos',
      'Movimientos',
      'Prendas incompletas',
      'Resumen',
    ]);
  });
});
