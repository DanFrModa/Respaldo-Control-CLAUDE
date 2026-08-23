/**
 * Tests UNITARIOS del export a Excel del reporte fiscal (F9-E5). Sin BD: se inyecta un `reporteFiscal`
 * fake. Cubre:
 *  • el `.xlsx` se genera (buffer no vacío, firma ZIP de OOXML);
 *  • el export pagina internamente y trae TODAS las filas (no solo la primera página);
 *  • el contenido incluye folio, tercero, RFC, UUID e importe (validado al re-leer el libro).
 */
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { ReporteFiscalFila, ReporteFiscalSalida } from '../../../../contrato/index.js';
import { sesionDePrueba } from '../../../../pruebas/sesiones.js';
import { cerrarPoolPdf } from '../../../../comun/pdf-worker.js';

import { excelReporteFiscal } from './excel-reporte-fiscal.js';

function fila(id: number, parcial: Partial<ReporteFiscalFila> = {}): ReporteFiscalFila {
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
    ...parcial,
  };
}

/** Fabrica un `reporteFiscal` fake que pagina `filas` con `porPagina` y expone totales fijos. */
function fakeReporte(
  filas: ReporteFiscalFila[],
): (...args: unknown[]) => Promise<ReporteFiscalSalida> {
  return (...args: unknown[]) => {
    const parametros = (args[1] ?? {}) as { pagina?: number; porPagina?: number };
    const pagina = parametros.pagina ?? 1;
    const porPagina = parametros.porPagina ?? 50;
    const inicio = (pagina - 1) * porPagina;
    return Promise.resolve({
      desde: null,
      hasta: null,
      filas: filas.slice(inicio, inicio + porPagina),
      total: filas.length,
      pagina,
      porPagina,
      totalPaginas: Math.max(1, Math.ceil(filas.length / porPagina)),
      totales: {
        cargos: 1000 * filas.length,
        abonos: 0,
        neto: 1000 * filas.length,
        movimientos: filas.length,
      },
    });
  };
}

const sesion = sesionDePrueba({ permisos: ['terceros.fiscal', 'consultas.ver-importes'] });

afterAll(async () => {
  await cerrarPoolPdf();
});

describe('excelReporteFiscal', () => {
  it('genera un .xlsx (buffer con firma OOXML/ZIP)', async () => {
    const consultar = vi.fn(fakeReporte([fila(1), fila(2)]));
    const { buffer } = await excelReporteFiscal(sesion, {}, undefined, {
      reporteFiscal: consultar,
    });
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('pagina internamente y trae TODAS las filas (no solo la primera página)', async () => {
    const filas = Array.from({ length: 250 }, (_, i) => fila(i + 1));
    const consultar = vi.fn(fakeReporte(filas));
    await excelReporteFiscal(sesion, {}, undefined, { reporteFiscal: consultar });
    // 250 filas, tope interno 100 → 3 páginas (la paginación corre en el hilo principal).
    expect(consultar).toHaveBeenCalledTimes(3);
  });

  it('vuelca folio, tercero, RFC, UUID e importe a las celdas', async () => {
    const consultar = vi.fn(
      fakeReporte([fila(42, { tercero: 'Telas del Norte', uuidCfdi: 'UUID-XYZ', monto: 1234.5 })]),
    );
    const { buffer } = await excelReporteFiscal(sesion, {}, undefined, {
      reporteFiscal: consultar,
    });

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.getWorksheet('Reporte fiscal');
    expect(hoja).toBeDefined();
    const renglon = hoja?.getRow(2);
    // Al re-leer se pierden los `key`; se accede por número de columna (1-based):
    // 1=folio, 3=cuenta, 4=tercero, 5=rfc, 7=uuid, 10=importe.
    expect(renglon?.getCell(1).value).toBe(42);
    expect(renglon?.getCell(3).value).toBe('CxP');
    expect(renglon?.getCell(4).value).toBe('Telas del Norte');
    expect(renglon?.getCell(5).value).toBe('TNO900101AAA');
    expect(renglon?.getCell(7).value).toBe('UUID-XYZ');
    expect(renglon?.getCell(10).value).toBe(1234.5);
  });
});
