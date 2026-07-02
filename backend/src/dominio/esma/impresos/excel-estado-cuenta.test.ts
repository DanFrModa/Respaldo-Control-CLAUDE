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
});
