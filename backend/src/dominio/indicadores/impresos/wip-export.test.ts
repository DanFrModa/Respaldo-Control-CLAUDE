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
import { armarDatosExcelKpisWip } from './excel.js';
import { generarPdfKpisWip } from './pdf.js';

/** Totales del universo (no dependen de la página); marco `porRecibir` para verificar que se conserven. */
const TOTALES: KpisWip['totales'] = {
  pedido: 0,
  cortado: 0,
  enviado: 0,
  recibido: 0,
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
  }, 20_000);

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
  }, 20_000);
});

// Referencia al tope estándar para dejar constancia de que el impreso lo respeta (no re-implementa).
it('el tope de dibujo del PDF es el estándar de impresos', () => {
  expect(MAX_FILAS_PDF).toBeGreaterThanOrEqual(100);
});
