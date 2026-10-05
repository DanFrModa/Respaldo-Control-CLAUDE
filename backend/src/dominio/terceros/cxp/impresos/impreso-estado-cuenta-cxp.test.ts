import { describe, expect, it } from 'vitest';

import type { EstadoCuentaTerceroSalida } from '../../../../contrato/index.js';
import { extraerTextoPdf } from '../../../../comun/pdf-texto.js';

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
    segmento: 'todos',
    desde: '2026-07-01',
    hasta: '2026-07-31',
    saldo: {
      tipoTercero: 'proveedor',
      idTercero: 7,
      tercero: 'Hilaturas del Norte',
      saldo: 700,
      saldoFiscal: 0,
      saldoSinFactura: 0,
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
        amparaEsMa: false,
        uuidCfdi: null,
        rfcTercero: null,
        idArchivoCfdi: null,
        refTipo: null,
        refId: null,
        observaciones: 'material recibido',
        cancelado: false,
        esInverso: false,
        idMovimientoCorregido: null,
        observacionesGuardadas: null,
        importeGuardado: null,
        corregible: false,
        importeCorregible: false,
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
        amparaEsMa: false,
        uuidCfdi: null,
        rfcTercero: null,
        idArchivoCfdi: null,
        refTipo: null,
        refId: null,
        observaciones: 'abono parcial',
        cancelado: false,
        esInverso: false,
        idMovimientoCorregido: null,
        observacionesGuardadas: null,
        importeGuardado: null,
        corregible: false,
        importeCorregible: false,
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

/** Todo el texto del PDF, con los saltos normalizados a espacios (react-pdf parte las líneas). */
async function textoDelPdf(buffer: Buffer): Promise<string> {
  const paginas = await extraerTextoPdf(buffer);
  return paginas.join(' ').replace(/\s+/g, ' ');
}

describe('fila 0.252: el comprobante de EsMa en el impreso', () => {
  it('se rotula como comprobante y NO enseña vencimiento; el renglón normal sí lo enseña', async () => {
    const cuenta = cuentaDePrueba();
    const [normal] = cuenta.movimientos;
    if (normal === undefined) throw new Error('El fixture trae movimientos.');
    const comprobante = {
      ...normal,
      id: 12,
      origen: 'factura_proveedor',
      fechaVencimiento: '2026-08-31',
      esFiscal: true,
      amparaEsMa: true,
    };
    const texto = await textoDelPdf(
      await generarPdfCxp({
        pagador: 'FR MODA SA DE CV',
        cuenta: { ...cuenta, movimientos: [comprobante, normal] },
      }),
    );
    expect(texto).toContain('comprobante, la deuda vive en EsMa');
    // La fecha guardada del comprobante no se imprime; la del renglón normal, sí.
    expect(texto).not.toContain('2026-08-31');
    expect(texto).toContain('2026-07-16');
  });
});
