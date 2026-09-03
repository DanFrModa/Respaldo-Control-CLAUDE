import { afterAll, describe, expect, it } from 'vitest';

import { renderizarPdfEnWorker, renderizarExcelEnWorker, cerrarPoolPdf } from './pdf-worker.js';
import type { DatosImpresoInventarioTelas } from '../dominio/inventarios/impresos/impreso-inventario-telas.js';
import type { ConcentradoFila } from '../contrato/index.js';
import type { DatosExcelConcentrado } from '../dominio/ruta-critica/impresos/excel-concentrado.js';

/**
 * Unit del POOL de generación de documentos en worker (blindaje general de impresos). No toca BD: se le
 * pasan datos ya resueltos (los `armarDatos*` corren en el hilo principal). Verifica, para PDF y Excel:
 *  • la construcción sale del hilo principal y devuelve un documento válido (`%PDF-` / firma ZIP `PK`);
 *  • una construcción GRANDE no bloquea el event loop (un `setInterval` sigue latiendo mientras corre);
 *  • una clave desconocida se rechaza limpio;
 *  • una construcción que excede el timeout se corta con un mensaje accionable (rama de timeout).
 *
 * **Timeouts.** Estas pruebas renderizan de verdad miles de renglones (CPU-bound) y son de las más
 * pesadas del suite. NO llevan tope propio a propósito: heredan el del proyecto `unit`
 * (`vitest.config.ts`), que es único para todas las pruebas de render. Antes tenían `20_000`
 * —POR DEBAJO del default— y por eso eran las primeras en caer cuando el runner iba cargado.
 */
function datosTelas(nFilas: number): DatosImpresoInventarioTelas {
  const filas = Array.from({ length: nFilas }, (_, i) => ({
    tela: `Tela ${String(i)}`,
    contextoTela: 'Punto · Proveedor',
    color: 'Rojo',
    pantone: '19-3920',
    almacen: 'Bodega',
    unidad: 'kg',
    cuerpo: i,
    complemento: i % 2 === 0 ? i : null,
  }));
  return {
    empresa: 'FR Moda',
    fecha: '2026-07-10',
    filas,
    totalRenglones: nFilas,
    totalColores: nFilas,
    totalCuerpo: 0,
    totalComplemento: 0,
  };
}

/** Datos planos del concentrado RC (un Excel de rango libre) para ejercer el pool. */
function datosConcentrado(nFilas: number): DatosExcelConcentrado {
  const filas: ConcentradoFila[] = Array.from({ length: nFilas }, (_, i) => ({
    idOrden: i + 1,
    folioOrden: i + 1,
    cliente: `Cliente ${String(i)}`,
    idModelo: 1,
    codigoModelo: `MOD-${String(i)}`,
    descripcionModelo: 'Playera',
    fechaEntregaRC: '2026-07-01T00:00:00.000Z',
    fechaInicioRC: '2026-06-01T00:00:00.000Z',
    esResurtido: false,
    semaforo: 'atrasado',
    maxDiasAtraso: 5,
    procesosPendientes: 1,
    procesos: [],
  }));
  return { filas };
}

afterAll(async () => {
  await cerrarPoolPdf();
});

describe('pool de render de PDF en worker', () => {
  it('renderiza un PDF válido fuera del hilo principal', async () => {
    const buffer = await renderizarPdfEnWorker('inventario-telas', datosTelas(3));
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('un render grande NO bloquea el event loop (el setInterval sigue latiendo)', async () => {
    let latidos = 0;
    const reloj = setInterval(() => {
      latidos += 1;
    }, 10);
    try {
      const buffer = await renderizarPdfEnWorker('inventario-telas', datosTelas(150));
      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } finally {
      clearInterval(reloj);
    }
    // Si el render bloqueara el hilo principal, el reloj no habría latido ni una vez.
    expect(latidos).toBeGreaterThan(0);
  });

  it('rechaza una clave de impreso desconocida', async () => {
    await expect(renderizarPdfEnWorker('no-existe' as never, {})).rejects.toThrow(/no registrado/i);
  });

  it('corta un render que excede el timeout con un mensaje accionable', async () => {
    const previo = process.env.PDF_WORKER_TIMEOUT_MS;
    process.env.PDF_WORKER_TIMEOUT_MS = '1';
    try {
      await expect(renderizarPdfEnWorker('inventario-telas', datosTelas(4000))).rejects.toThrow(
        /demasiado|Excel/i,
      );
    } finally {
      if (previo === undefined) {
        delete process.env.PDF_WORKER_TIMEOUT_MS;
      } else {
        process.env.PDF_WORKER_TIMEOUT_MS = previo;
      }
    }
  });

  it('construye un .xlsx válido (firma ZIP) fuera del hilo principal', async () => {
    const buffer = await renderizarExcelEnWorker('excel-concentrado', datosConcentrado(3));
    expect(buffer.length).toBeGreaterThan(0);
    // Un .xlsx es un ZIP: empieza por "PK".
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('un Excel grande NO bloquea el event loop (el setInterval sigue latiendo)', async () => {
    let latidos = 0;
    const reloj = setInterval(() => {
      latidos += 1;
    }, 10);
    try {
      const buffer = await renderizarExcelEnWorker('excel-concentrado', datosConcentrado(5000));
      expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    } finally {
      clearInterval(reloj);
    }
    // Si la construcción bloqueara el hilo principal, el reloj no habría latido ni una vez.
    expect(latidos).toBeGreaterThan(0);
  });

  it('rechaza una clave de Excel desconocida', async () => {
    await expect(renderizarExcelEnWorker('no-existe' as never, {})).rejects.toThrow(
      /no registrado/i,
    );
  });

  it('corta un Excel que excede su propio timeout con un mensaje accionable', async () => {
    const previo = process.env.EXCEL_WORKER_TIMEOUT_MS;
    process.env.EXCEL_WORKER_TIMEOUT_MS = '1';
    try {
      await expect(
        renderizarExcelEnWorker('excel-concentrado', datosConcentrado(20_000)),
      ).rejects.toThrow(/demasiado|Excel/i);
    } finally {
      if (previo === undefined) {
        delete process.env.EXCEL_WORKER_TIMEOUT_MS;
      } else {
        process.env.EXCEL_WORKER_TIMEOUT_MS = previo;
      }
    }
  });
});
