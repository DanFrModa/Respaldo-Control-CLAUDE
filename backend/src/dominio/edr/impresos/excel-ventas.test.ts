/**
 * Tests UNITARIOS del export a Excel de VENTAS (proto vVentas; F7-E2). Sin BD: se inyecta un
 * `listarVentas` fake. Cubre:
 *  • el `.xlsx` se genera (buffer no vacío, firma ZIP de OOXML).
 *  • el export pagina internamente y trae TODAS las líneas (no solo la primera página).
 *  • el contenido vuelca folio de OP, cliente, importe y mes; una línea manual (sin folio) sale "—".
 */
import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

import type { VentaLinea, VentasSalida } from '../../../contrato/index.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';

import { excelVentas } from './excel-ventas.js';

function linea(id: number, parcial: Partial<VentaLinea> = {}): VentaLinea {
  return {
    id,
    idOrden: id,
    folioOrden: id,
    idCliente: 1,
    cliente: `Cliente ${id}`,
    idModelo: 1,
    modelo: `MOD-${id}`,
    descripcion: 'Playera',
    cantidad: 100,
    precio: 148,
    importe: 14800,
    anio: 2026,
    mes: 7,
    ...parcial,
  };
}

/** Fabrica un `listarVentas` fake que pagina `lineas` con `porPagina`. */
function fakeListar(lineas: VentaLinea[]): (...args: unknown[]) => Promise<VentasSalida> {
  return (...args: unknown[]) => {
    const parametros = (args[1] ?? {}) as { pagina?: number; porPagina?: number };
    const pagina = parametros.pagina ?? 1;
    const porPagina = parametros.porPagina ?? 50;
    const inicio = (pagina - 1) * porPagina;
    const datos = lineas.slice(inicio, inicio + porPagina);
    const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
    const importe = lineas.reduce((s, l) => s + l.importe, 0);
    return Promise.resolve({
      anio: 2026,
      mes: 7,
      resumen: {
        importe,
        unidades,
        ticketPromedio: unidades > 0 ? importe / unidades : 0,
        lineas: lineas.length,
      },
      lineas: datos,
      total: lineas.length,
      pagina,
      porPagina,
      totalPaginas: Math.max(1, Math.ceil(lineas.length / porPagina)),
    });
  };
}

const sesion = sesionDePrueba({ permisos: ['edr.ver'] });

describe('excelVentas', () => {
  it('genera un .xlsx (buffer con firma OOXML/ZIP)', async () => {
    const consultar = vi.fn(fakeListar([linea(1), linea(2)]));
    const { buffer } = await excelVentas(
      sesion,
      { anio: 2026, mes: 7, pagina: 1, porPagina: 50 },
      undefined,
      {
        listarVentas: consultar,
      },
    );
    expect(buffer.length).toBeGreaterThan(0);
    // Un .xlsx es un ZIP: empieza por "PK".
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('pagina internamente y trae TODAS las líneas (no solo la primera página)', async () => {
    // 250 líneas con tope interno de 100 → 3 páginas.
    const lineas = Array.from({ length: 250 }, (_, i) => linea(i + 1));
    const consultar = vi.fn(fakeListar(lineas));
    const { buffer } = await excelVentas(
      sesion,
      { anio: 2026, pagina: 1, porPagina: 50 },
      undefined,
      {
        listarVentas: consultar,
      },
    );
    // Se pidieron 3 páginas (100 + 100 + 50).
    expect(consultar).toHaveBeenCalledTimes(3);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.getWorksheet('Ventas');
    expect(hoja).toBeDefined();
    // 1 encabezado + 250 líneas + 1 fila total.
    expect(hoja?.rowCount).toBe(252);
  });

  it('vuelca folio de OP, cliente, importe y mes; la línea manual sin folio sale "—"', async () => {
    const consultar = vi.fn(
      fakeListar([
        linea(42, { cliente: 'Boutique Aurora', importe: 14800 }),
        linea(7, { folioOrden: null, idOrden: null, cliente: 'Venta manual', mes: 6 }),
      ]),
    );
    const { buffer } = await excelVentas(
      sesion,
      { anio: 2026, pagina: 1, porPagina: 50 },
      undefined,
      {
        listarVentas: consultar,
      },
    );

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.getWorksheet('Ventas');
    // Al re-leer se pierden los `key`; se accede por número de columna (1-based):
    // 1=OP, 2=Cliente, 5=Cantidad, 7=Importe, 8=Mes.
    const primera = hoja?.getRow(2);
    expect(primera?.getCell(1).value).toBe(42);
    expect(primera?.getCell(2).value).toBe('Boutique Aurora');
    expect(primera?.getCell(7).value).toBe(14800);
    expect(primera?.getCell(8).value).toBe('Julio 2026');
    // La línea manual (sin folio de OP) muestra el guion largo en la columna identificadora.
    const segunda = hoja?.getRow(3);
    expect(segunda?.getCell(1).value).toBe('—');
    expect(segunda?.getCell(8).value).toBe('Junio 2026');
  });
});
