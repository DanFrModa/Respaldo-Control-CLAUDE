/**
 * Tests UNITARIOS del export del tablero WIP analítico (D3, blindaje de topes). Sin BD: se inyecta un
 * `kpisWip` fake que pagina. Cubre:
 *  • el EXCEL acumula TODAS las órdenes del universo (antes topaba en 100 EN SILENCIO);
 *  • el PDF renderiza con y sin aviso de truncado (el aviso se calcula contra el total del universo).
 */
import { describe, expect, it, vi } from 'vitest';

import type { KpisWip } from '../../../contrato/index.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { MAX_FILAS_PDF } from '../../../comun/impreso-topes.js';

import type { kpisWip } from '../kpis.js';
import { armarDatosExcelKpisWip, construirExcelKpisWip } from './excel.js';
import { COLUMNAS_ORDENES_WIP, filaOrdenWip, generarPdfKpisWip } from './pdf.js';

/** Totales del universo (no dependen de la página); marco `porRecibir` para verificar que se conserven. */
const TOTALES: KpisWip['totales'] = {
  pedido: 0,
  cortado: 0,
  enviado: 0,
  recibido: 0,
  incompletas: 0,
  faltantesSaldados: 0,
  recibidoCostura: 0,
  entregado: 0,
  porCortar: 0,
  cortadoPorEnviar: 0,
  porRecibir: 999,
  porEntregar: 0,
};

/** Una orden WIP mínima con el `folio` = índice (para contar). */
function fila(i: number): KpisWip['datos'][number] {
  return {
    idOrden: i,
    folio: 1000 + i,
    idCliente: 1,
    cliente: `Cliente ${String(i)}`,
    idModelo: 1,
    codigoModelo: `M-${String(i)}`,
    pedido: 100,
    cortado: 100,
    enviado: 80,
    recibido: 50,
    incompletas: 0,
    faltantesSaldados: 0,
    recibidoCostura: 50,
    entregado: 20,
    porCortar: 0,
    cortadoPorEnviar: 20,
    porRecibir: 30,
    porEntregar: 30,
  };
}

/** `kpisWip` fake que pagina `universo` respetando el tope real del backend (100). */
function fakeKpisWip(universo: KpisWip['datos']): typeof kpisWip {
  return (_sesion, parametros = {}, _bd) => {
    const porPagina = Math.min(parametros.porPagina ?? 20, 100);
    const pagina = parametros.pagina ?? 1;
    const inicio = (pagina - 1) * porPagina;
    return Promise.resolve({
      datosAl: null,
      totales: TOTALES,
      datos: universo.slice(inicio, inicio + porPagina),
      total: universo.length,
      pagina,
      porPagina,
      totalPaginas: Math.max(1, Math.ceil(universo.length / porPagina)),
    });
  };
}

describe('export WIP — Excel completo (D3)', () => {
  it('acumula TODAS las órdenes del universo (>100) y conserva los totales', async () => {
    const universo = Array.from({ length: 230 }, (_, i) => fila(i));
    const consultar = vi.fn(fakeKpisWip(universo));
    const datos = await armarDatosExcelKpisWip(sesionDePrueba(), {}, undefined, {
      kpisWip: consultar,
    });
    expect(datos.datos).toHaveLength(230); // no topó en 100
    expect(datos.total).toBe(230);
    expect(datos.totales.porRecibir).toBe(999); // los totales siguen siendo del universo
    // 230 filas con tope 100 → 3 páginas (paginó, no leyó una sola).
    expect(consultar).toHaveBeenCalledTimes(3);
  });
});

describe('export WIP — PDF con aviso de truncado (D3)', () => {
  it('renderiza con aviso cuando el universo excede lo dibujado', async () => {
    // Se dibujan pocas filas pero el `total` del universo es mayor → leyendaTruncado NO nula.
    const datos: KpisWip = {
      datosAl: null,
      totales: TOTALES,
      datos: Array.from({ length: 30 }, (_, i) => fila(i)),
      total: 500,
      pagina: 1,
      porPagina: 100,
      totalPaginas: 5,
    };
    const buffer = await generarPdfKpisWip({ pagador: 'FR Moda SA de CV', datos });
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renderiza sin aviso cuando caben todas las órdenes', async () => {
    const datos: KpisWip = {
      datosAl: null,
      totales: TOTALES,
      datos: Array.from({ length: 10 }, (_, i) => fila(i)),
      total: 10,
      pagina: 1,
      porPagina: 100,
      totalPaginas: 1,
    };
    const buffer = await generarPdfKpisWip({ pagador: 'FR Moda SA de CV', datos });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

// Referencia al tope estándar para dejar constancia de que el impreso lo respeta (no re-implementa).
it('el tope de dibujo del PDF es el estándar de impresos', () => {
  expect(MAX_FILAS_PDF).toBeGreaterThanOrEqual(100);
});

describe('export WIP — la CUARTA y la TERCERA cubeta tienen columna propia (V1, fila 0.109)', () => {
  /**
   * ⭐ La hoja y el PDF declaran una IDENTIDAD como razón de ser de sus columnas:
   *
   *     enviado = recibido + incompletas + saldados + por recibir
   *
   * Desde que «por recibir» resta también los FALTANTES SALDADOS al cerrar la orden con un
   * maquilero, sin la columna «Saldados» la identidad deja de cuadrar para cualquier orden con
   * cierre vivo: el lector ve un `enviado` que no le suma y no tiene dónde buscar la diferencia.
   */
  const conSaldados: KpisWip['datos'][number] = {
    ...fila(1),
    enviado: 100,
    recibido: 80,
    incompletas: 5,
    faltantesSaldados: 12,
    porRecibir: 3, // 100 − 80 − 5 − 12
  };

  it('la identidad del fixture cuadra (si no, la prueba de abajo no probaría nada)', () => {
    expect(conSaldados.enviado).toBe(
      conSaldados.recibido +
        conSaldados.incompletas +
        conSaldados.faltantesSaldados +
        conSaldados.porRecibir,
    );
  });

  it('el EXCEL trae la columna «Saldados» con su valor, y el renglón cuadra el enviado', async () => {
    const buffer = await construirExcelKpisWip({
      datosAl: null,
      totales: TOTALES,
      datos: [conSaldados],
      total: 1,
      pagina: 1,
      porPagina: 100,
      totalPaginas: 1,
    });
    const { default: ExcelJS } = await import('exceljs');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.getWorksheet('Órdenes');
    expect(hoja).toBeDefined();

    // `row.values` viene indexado desde 1 y con huecos: sólo interesan los títulos, que son texto.
    const crudos = hoja?.getRow(1).values as unknown[];
    const encabezados = crudos.map((v) => (typeof v === 'string' ? v : ''));
    expect(encabezados).toContain('Incompletas');
    expect(encabezados).toContain('Saldados');

    const columna = encabezados.indexOf('Saldados');
    expect(hoja?.getRow(2).getCell(columna).value).toBe(12);

    // Y la identidad se puede LEER de la hoja: enviado = recibido + incompletas + saldados + x recibir.
    const celda = (titulo: string): number => {
      const valor: unknown = hoja?.getRow(2).getCell(encabezados.indexOf(titulo)).value;
      return typeof valor === 'number' ? valor : 0;
    };
    expect(celda('Enviado')).toBe(
      celda('Recibido') + celda('Incompletas') + celda('Saldados') + celda('Por recibir'),
    );
  });

  it('el PDF trae la columna «Saldados» y cada fila tiene tantas celdas como títulos', () => {
    // 🔴 Se asevera sobre la TABLA, no sobre los bytes. Medido por mutación: quitando la celda de
    // «Saldados» del PDF, `generarPdfKpisWip` seguía devolviendo un `%PDF-` perfectamente válido —
    // `@react-pdf/renderer` no truena por una fila corta, la dibuja corta—. O sea que «el PDF se
    // generó» no prueba NADA sobre su alineación, y la prueba anterior pasaba en verde con la
    // columna vacía. Por eso las columnas y la fila se exportan y se comparan aquí.
    const titulos = COLUMNAS_ORDENES_WIP.map((c) => c.titulo);
    expect(titulos).toContain('Incompl.');
    expect(titulos).toContain('Saldados');

    const fila = filaOrdenWip(conSaldados);
    expect(fila).toHaveLength(titulos.length);
    expect(fila[titulos.indexOf('Saldados')]).toBe('12');

    // Y la identidad se lee de la fila, igual que en la hoja.
    const celda = (titulo: string): number => Number(fila[titulos.indexOf(titulo)]);
    expect(celda('Env.')).toBe(
      celda('Rec.') + celda('Incompl.') + celda('Saldados') + celda('x recibir'),
    );
  });

  it('y el PDF completo se sigue generando con esa columna', async () => {
    const buffer = await generarPdfKpisWip({
      pagador: 'FR Moda SA de CV',
      datos: {
        datosAl: null,
        totales: TOTALES,
        datos: [conSaldados],
        total: 1,
        pagina: 1,
        porPagina: 100,
        totalPaginas: 1,
      },
    });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
