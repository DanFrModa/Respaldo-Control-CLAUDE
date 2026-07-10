/**
 * Tests UNITARIOS del impreso PDF del reporte fiscal (F9-E5). Sin BD: se construyen los datos ya
 * resueltos. Cubre:
 *  • la LEYENDA de truncado (el PDF trae hasta 100 filas mientras los totales son del periodo completo):
 *    aparece con su texto exacto cuando total > filas mostradas, y NO aparece cuando la página trae todo;
 *  • el `renderToBuffer` produce un PDF válido (firma `%PDF-`) en ambos casos (rama con/sin aviso).
 */
import { describe, expect, it } from 'vitest';

import type { ReporteFiscalFila, ReporteFiscalSalida } from '../../../../contrato/index.js';

import {
  generarPdfReporteFiscal,
  leyendaTruncadoTexto,
  type DatosImpresoReporteFiscal,
} from './impreso-reporte-fiscal.js';

function fila(id: number): ReporteFiscalFila {
  return {
    id,
    folio: id,
    fecha: '2026-07-01',
    tipoTercero: 'proveedor',
    idTercero: id,
    tercero: `Proveedor ${id}`,
    rfcTercero: 'TNO900101AAA',
    origen: 'factura_proveedor',
    uuidCfdi: `UUID-${id}`,
    tieneXml: true,
    monto: 1000,
    esCargo: true,
    cancelado: false,
    esInverso: false,
  };
}

/** Reporte con `total` movimientos en el filtro pero solo `nFilas` en la página (lo máximo, 100). */
function reporteDe(total: number, nFilas: number): ReporteFiscalSalida {
  const filas = Array.from({ length: nFilas }, (_, i) => fila(i + 1));
  return {
    desde: '2026-07-01',
    hasta: '2026-07-31',
    filas,
    total,
    pagina: 1,
    porPagina: 100,
    totalPaginas: Math.max(1, Math.ceil(total / 100)),
    totales: { cargos: 1000 * total, abonos: 0, neto: 1000 * total, movimientos: total },
  };
}

function datosDe(reporte: ReporteFiscalSalida): DatosImpresoReporteFiscal {
  return { empresa: 'FR Moda SA de CV', reporte };
}

describe('leyendaTruncadoTexto', () => {
  it('avisa (con conteos exactos) cuando hay más movimientos que los mostrados', () => {
    const texto = leyendaTruncadoTexto(reporteDe(250, 100));
    expect(texto).toBe(
      'Mostrando los primeros 100 de 250 movimientos — usa el export a Excel para el detalle completo.',
    );
  });

  it('NO avisa cuando la página ya trae todo el periodo (total = filas)', () => {
    expect(leyendaTruncadoTexto(reporteDe(2, 2))).toBeNull();
  });

  it('NO avisa cuando el periodo está vacío (total 0, sin filas)', () => {
    expect(leyendaTruncadoTexto(reporteDe(0, 0))).toBeNull();
  });
});

describe('generarPdfReporteFiscal', () => {
  it('genera un PDF válido cuando el reporte está truncado (rama con aviso)', async () => {
    const buffer = await generarPdfReporteFiscal(datosDe(reporteDe(250, 100)));
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('genera un PDF válido cuando el reporte trae todo (rama sin aviso)', async () => {
    const buffer = await generarPdfReporteFiscal(datosDe(reporteDe(3, 3)));
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
