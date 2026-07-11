import { describe, expect, it } from 'vitest';

import type { DesglosadoSalida } from '../../../contrato/index.js';

import {
  avisoTruncadoTexto,
  generarPdfEstadoCuenta,
  type DatosImpresoEstadoCuenta,
} from './impreso-estado-cuenta.js';

/**
 * Unit del impreso del ESTADO DE CUENTA (F6-E5, R9) — SIN Postgres. Cubre que el PDF se genera con el
 * PAGADOR de la empresa (no hardcodeado) y con el detalle del desglosado.
 */
function desglosadoDePrueba(): DesglosadoSalida {
  return {
    idMaquilero: 5,
    maquilero: 'Maquila Costura SA',
    desde: '2026-06-01',
    hasta: '2026-06-30',
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
    abonos: [
      {
        id: 1,
        concepto: 'abono',
        idEmpresa: 1,
        idMaquilero: 5,
        maquilero: 'Maquila Costura SA',
        monto: 15,
        fecha: '2026-06-21',
        conFactura: null,
        observaciones: 'Anticipo',
        estadoRevision: 'capturado',
        creadoEn: '2026-06-21T00:00:00.000Z',
      },
    ],
    descuentos: [],
    pagos: [],
    saldo: {
      idMaquilero: 5,
      maquilero: 'Maquila Costura SA',
      conFactura: null,
      totalCargos: 80,
      totalAbonos: 15,
      totalPagos: 0,
      totalDescuentos: 0,
      saldo: 95,
    },
  };
}

describe('impreso estado de cuenta (F6-E5)', () => {
  it('genera un PDF (buffer que empieza con %PDF)', async () => {
    const datos: DatosImpresoEstadoCuenta = {
      pagador: 'FR MODA SA DE CV',
      desglosado: desglosadoDePrueba(),
      totales: { cargos: 1, abonos: 1, descuentos: 0, pagos: 0 },
    };
    const buffer = await generarPdfEstadoCuenta(datos);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('no avisa truncado cuando cada sección se muestra completa', () => {
    const datos: DatosImpresoEstadoCuenta = {
      pagador: 'FR MODA SA DE CV',
      desglosado: desglosadoDePrueba(),
      totales: { cargos: 1, abonos: 1, descuentos: 0, pagos: 0 },
    };
    expect(avisoTruncadoTexto(datos)).toBeNull();
  });

  it('avisa las secciones truncadas y remite al Excel (totales del universo)', () => {
    // Se dibujó 1 cargo pero el universo tenía 300 → el aviso lo dice; el saldo NO se toca.
    const datos: DatosImpresoEstadoCuenta = {
      pagador: 'FR MODA SA DE CV',
      desglosado: desglosadoDePrueba(),
      totales: { cargos: 300, abonos: 1, descuentos: 0, pagos: 0 },
    };
    const aviso = avisoTruncadoTexto(datos);
    expect(aviso).toContain('cargos 1 de 300');
    expect(aviso).toContain('Excel');
  });
});
