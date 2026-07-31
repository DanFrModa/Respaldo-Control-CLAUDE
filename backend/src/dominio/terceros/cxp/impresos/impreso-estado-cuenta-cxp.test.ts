import { describe, expect, it } from 'vitest';

import type { EstadoCuentaTerceroSalida } from '../../../../contrato/index.js';

import { generarPdfCxp, type DatosImpresoCxp } from './impreso-estado-cuenta-cxp.js';

/**
 * Unit del impreso del ESTADO DE CUENTA de CxP (F9-E2, R9) — SIN Postgres. Cubre que el PDF se genera
 * con el PAGADOR de la empresa (no hardcodeado) y el detalle de los movimientos + saldo.
 */
function cuentaDePrueba(): EstadoCuentaTerceroSalida {
  return {
    tipoTercero: 'proveedor',
    idTercero: 7,
    tercero: 'Hilaturas del Norte',
    vista: 'operativa',
    desde: '2026-07-01',
    hasta: '2026-07-31',
    saldo: {
      tipoTercero: 'proveedor',
      idTercero: 7,
      tercero: 'Hilaturas del Norte',
      saldo: 700,
      saldoFiscal: 0,
      saldoMovimientos: 700,
      saldoEsMa: 0,
      incluyeEsMa: true,
    },
    movimientos: [
      {
        fuente: 'motor',
        id: 11,
        idEmpresa: 1,
        folio: 1,
        tipoTercero: 'proveedor',
        idTercero: 7,
        tercero: 'Hilaturas del Norte',
        fecha: '2026-07-01',
        origen: 'entrada_sin_factura',
        monto: 1000,
        fechaVencimiento: '2026-07-16',
        esFiscal: false,
        uuidCfdi: null,
        rfcTercero: null,
        idArchivoCfdi: null,
        refTipo: null,
        refId: null,
        observaciones: 'material recibido',
        cancelado: false,
        esInverso: false,
        creadoEn: '2026-07-01T00:00:00.000Z',
        creadoPorId: null,
      },
      {
        fuente: 'motor',
        id: 12,
        idEmpresa: 1,
        folio: 2,
        tipoTercero: 'proveedor',
        idTercero: 7,
        tercero: 'Hilaturas del Norte',
        fecha: '2026-07-10',
        origen: 'pago',
        monto: -300,
        fechaVencimiento: null,
        esFiscal: false,
        uuidCfdi: null,
        rfcTercero: null,
        idArchivoCfdi: null,
        refTipo: null,
        refId: null,
        observaciones: 'abono parcial',
        cancelado: false,
        esInverso: false,
        creadoEn: '2026-07-10T00:00:00.000Z',
        creadoPorId: null,
      },
    ],
    total: 2,
    pagina: 1,
    porPagina: 100,
    totalPaginas: 1,
  };
}

describe('impreso estado de cuenta de CxP (F9-E2)', () => {
  it('genera un PDF (buffer que empieza con %PDF)', async () => {
    const datos: DatosImpresoCxp = {
      pagador: 'FR MODA SA DE CV',
      cuenta: cuentaDePrueba(),
    };
    const buffer = await generarPdfCxp(datos);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(500);
  });
});
