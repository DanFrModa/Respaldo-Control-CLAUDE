import { afterAll, describe, expect, it } from 'vitest';

import { renderizarPdfEnWorker, cerrarPoolPdf } from './pdf-worker.js';
import type { DatosImpresoInventarioTelas } from '../dominio/inventarios/impresos/impreso-inventario-telas.js';

/**
 * Unit del POOL de render de PDF en worker (blindaje general de PDFs). No toca BD: se le pasan datos ya
 * resueltos (los `armarDatos*` corren en el hilo principal). Verifica que:
 *  • el render sale del hilo principal y devuelve un PDF válido (`%PDF-`);
 *  • un render GRANDE no bloquea el event loop (un `setInterval` sigue latiendo mientras se renderiza);
 *  • una clave desconocida se rechaza limpio;
 *  • un render que excede el timeout se corta con un mensaje accionable (rama de timeout).
 */
function datosTelas(nFilas: number): DatosImpresoInventarioTelas {
  const filas = Array.from({ length: nFilas }, (_, i) => ({
    tela: `Tela ${String(i)}`,
    loteClave: `L-${String(i)}`,
    color: 'Rojo',
    proveedor: 'Proveedor',
    factura: `F-${String(i)}`,
    almacen: 'Bodega',
    existencia: i,
    componentes: [] as string[],
  }));
  return {
    empresa: 'FR Moda',
    fecha: '2026-07-10',
    filas,
    totalRenglones: nFilas,
    totalExistencia: 0,
  };
}

afterAll(async () => {
  await cerrarPoolPdf();
});

describe('pool de render de PDF en worker', () => {
  it('renderiza un PDF válido fuera del hilo principal', async () => {
    const buffer = await renderizarPdfEnWorker('inventario-telas', datosTelas(3));
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 20_000);

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
  }, 20_000);

  it('rechaza una clave de impreso desconocida', async () => {
    await expect(renderizarPdfEnWorker('no-existe' as never, {})).rejects.toThrow(/no registrado/i);
  }, 20_000);

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
  }, 20_000);
});
