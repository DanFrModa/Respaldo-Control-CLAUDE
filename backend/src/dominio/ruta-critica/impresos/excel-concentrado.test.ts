/**
 * Tests UNITARIOS del export a Excel del concentrado de la RC (F5-E7). Sin BD: se inyecta un
 * `consultarConcentrado` fake. Cubre:
 *  • el `.xlsx` se genera (buffer no vacío, firma ZIP de OOXML).
 *  • el export pagina internamente y trae TODAS las filas (no solo la primera página).
 *  • el contenido incluye el folio, el cliente y el resumen de procesos (validado al re-leer el libro).
 */
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { ConcentradoFila, ConcentradoPagina } from '../../../contrato/index.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { cerrarPoolPdf } from '../../../comun/pdf-worker.js';

import { excelConcentrado, construirExcelConcentrado } from './excel-concentrado.js';

function fila(idOrden: number, parcial: Partial<ConcentradoFila> = {}): ConcentradoFila {
  return {
    idOrden,
    folioOrden: idOrden,
    cliente: `Cliente ${idOrden}`,
    idModelo: 1,
    codigoModelo: `MOD-${idOrden}`,
    descripcionModelo: 'Playera',
    fechaEntregaRC: '2026-07-01T00:00:00.000Z',
    fechaInicioRC: '2026-06-01T00:00:00.000Z',
    esResurtido: false,
    semaforo: 'atrasado',
    maxDiasAtraso: 5,
    procesosPendientes: 2,
    procesos: [
      {
        idProcesoDef: 1,
        codigoProceso: 'corte',
        nombreProceso: 'Corte',
        secuencia: 0,
        critico: true,
        fechaPlaneadaVigente: '2026-06-17T00:00:00.000Z',
        fechaReal: null,
        estado: 'activo',
        diasAtraso: 5,
        semaforo: 'atrasado',
      },
    ],
    ...parcial,
  };
}

/** Fabrica un `consultarConcentrado` fake que pagina `filas` con `porPagina`. */
function fakeConsultar(
  filas: ConcentradoFila[],
): (...args: unknown[]) => Promise<ConcentradoPagina> {
  return (...args: unknown[]) => {
    const parametros = (args[1] ?? {}) as { pagina?: number; porPagina?: number };
    const pagina = parametros.pagina ?? 1;
    const porPagina = parametros.porPagina ?? 20;
    const inicio = (pagina - 1) * porPagina;
    const datos = filas.slice(inicio, inicio + porPagina);
    return Promise.resolve({
      datos,
      total: filas.length,
      pagina,
      porPagina,
      totalPaginas: Math.max(1, Math.ceil(filas.length / porPagina)),
      resumen: { atrasadas: filas.length, enRiesgo: 0, aTiempo: 0 },
    });
  };
}

const sesion = sesionDePrueba({ permisos: ['rc.ruta-ver'] });

afterAll(async () => {
  await cerrarPoolPdf();
});

describe('excelConcentrado', () => {
  it('genera un .xlsx (buffer con firma OOXML/ZIP)', async () => {
    const consultar = vi.fn(fakeConsultar([fila(1), fila(2)]));
    const { buffer } = await excelConcentrado(sesion, {}, undefined, undefined, {
      consultarConcentrado: consultar,
    });
    expect(buffer.length).toBeGreaterThan(0);
    // Un .xlsx es un ZIP: empieza por "PK".
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  }, 20_000); // orquestador → construcción en worker (arranque en frío del pool bajo carga de tests).

  it('pagina internamente y trae TODAS las filas (no solo la primera página)', async () => {
    // 250 filas con tope interno de 100 → 3 páginas.
    const filas = Array.from({ length: 250 }, (_, i) => fila(i + 1));
    const consultar = vi.fn(fakeConsultar(filas));
    const { buffer } = await excelConcentrado(sesion, {}, undefined, undefined, {
      consultarConcentrado: consultar,
    });
    // Se pidieron 3 páginas (100 + 100 + 50) — la paginación corre en el hilo principal.
    expect(consultar).toHaveBeenCalledTimes(3);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.getWorksheet('Concentrado RC');
    expect(hoja).toBeDefined();
    // 1 encabezado + 250 filas de datos.
    expect(hoja?.rowCount).toBe(251);
  }, 20_000);

  it('vuelca folio, cliente y el resumen de procesos a las celdas', async () => {
    const consultar = vi.fn(fakeConsultar([fila(42, { cliente: 'Boutique Aurora' })]));
    const { buffer } = await excelConcentrado(sesion, {}, undefined, undefined, {
      consultarConcentrado: consultar,
    });

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.getWorksheet('Concentrado RC');
    const renglon = hoja?.getRow(2);
    // Al re-leer el libro se pierden los `key`; se accede por número de columna (1-based):
    // 1=folio, 2=cliente, 7=semáforo, 10=procesos.
    expect(renglon?.getCell(1).value).toBe(42);
    expect(renglon?.getCell(2).value).toBe('Boutique Aurora');
    expect(renglon?.getCell(7).value).toBe('Atrasado');
    // El resumen de procesos es texto multilínea; al re-leer, el value es string.
    const procesos = renglon?.getCell(10).value;
    expect(typeof procesos).toBe('string');
    expect(procesos as string).toContain('Corte: 2026-06-17→—');
  }, 20_000);

  // El constructor puro (sin worker) fija el color de marca: el encabezado usa el verde `FF0E7C47`,
  // no el teal viejo. Se verifica directo sobre el builder para ser determinista.
  it('el encabezado del libro usa el verde de marca (FF0E7C47)', async () => {
    const buffer = await construirExcelConcentrado({ filas: [fila(1)] });
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.getWorksheet('Concentrado RC');
    const encabezado = hoja?.getRow(1).getCell(1).fill as ExcelJS.FillPattern | undefined;
    expect(encabezado?.fgColor?.argb).toBe('FF0E7C47');
  });
});
