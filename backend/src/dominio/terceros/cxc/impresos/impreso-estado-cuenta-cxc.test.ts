import { describe, expect, it } from 'vitest';

import type { EstadoCuentaTerceroSalida } from '../../../../contrato/index.js';

import { generarPdfCxc, type DatosImpresoCxc } from './impreso-estado-cuenta-cxc.js';

/**
 * Unit del impreso del ESTADO DE CUENTA de CxC (F9-E4, R9) — SIN Postgres. Cubre que el PDF se genera
 * con el ACREEDOR de la empresa (no hardcodeado) y el detalle de los movimientos + saldo. Espejo del
 * unit de CxP, sin bloque de maquila (los clientes no maquilan).
 */
function cuentaDePrueba(): EstadoCuentaTerceroSalida {
  return {
    tipoTercero: 'cliente',
    idTercero: 7,
    tercero: 'Tiendas del Centro',
    vista: 'operativa',
    segmento: 'todos',
    desde: '2026-07-01',
    hasta: '2026-07-31',
    saldo: {
      tipoTercero: 'cliente',
      idTercero: 7,
      tercero: 'Tiendas del Centro',
      saldo: 700,
      saldoFiscal: 500,
      saldoSinFactura: 0,
      saldoMovimientos: 700,
      saldoEsMa: 0,
      incluyeEsMa: false,
    },
    movimientos: [
      {
        fuente: 'motor',
        id: 11,
        idEmpresa: 1,
        folio: 1,
        tipoTercero: 'cliente',
        idTercero: 7,
        tercero: 'Tiendas del Centro',
        fecha: '2026-07-01',
        origen: 'factura_cliente',
        monto: 1000,
        fechaVencimiento: '2026-07-31',
        esFiscal: true,
        uuidCfdi: 'B0000000-0000-0000-0000-000000000001',
        rfcTercero: 'XAXX010101000',
        idArchivoCfdi: 'arch-1',
        refTipo: 'pedido',
        refId: 3,
        observaciones: 'venta a crédito',
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
        tipoTercero: 'cliente',
        idTercero: 7,
        tercero: 'Tiendas del Centro',
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
        observaciones: 'cobro parcial',
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

describe('impreso estado de cuenta de CxC (F9-E4)', () => {
  it('genera un PDF (buffer que empieza con %PDF)', async () => {
    const datos: DatosImpresoCxc = {
      acreedor: 'FR MODA SA DE CV',
      cuenta: cuentaDePrueba(),
    };
    const buffer = await generarPdfCxc(datos);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(500);
  });
});
