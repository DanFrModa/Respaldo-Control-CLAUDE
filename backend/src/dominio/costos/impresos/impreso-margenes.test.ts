import { describe, expect, it } from 'vitest';

import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { MAX_FILAS_PDF } from '../../../comun/impreso-topes.js';
import type { PrismaClient } from '../../../datos/index.js';
import type { MargenesSalida } from '../../../contrato/index.js';

import {
  armarDatosImpresoMargenes,
  generarPdfMargenes,
  type DatosImpresoMargenes,
} from './impreso-margenes.js';

/**
 * Unit del impreso de COSTOS Y MÁRGENES (F7-E1, R9) + su TOPE (blindaje de PDFs). SIN Postgres: se
 * inyecta un `margenesPorPedido` fake y un cliente mínimo para la razón social. Verifica que se DIBUJAN
 * a lo más `MAX_FILAS_PDF` pedidos pero los totales (piezas/importe) siguen siendo del universo completo.
 */
const sesion = sesionDePrueba({ permisos: ['costos.ver', 'consultas.ver-importes'] });

/** Cliente mínimo para la consulta de la razón social (evita tocar la BD en el unit). */
const bdFake = {
  cliente: {
    empresa: {
      findUnique: () => Promise.resolve({ razonSocial: 'FR MODA SA DE CV', nombre: 'FR Moda' }),
    },
  } as unknown as PrismaClient,
};

function margenesFake(n: number): MargenesSalida {
  return {
    filas: Array.from({ length: n }, (_, i) => ({
      idPedido: i + 1,
      folio: i + 1,
      idCliente: 1,
      cliente: `Cliente ${String(i)}`,
      fechaHasta: '2026-07-01',
      cantidad: 10,
      importe: 100,
      margenPromedio: 0.3,
      margenPonderado: 0.3,
      margenPesosPorPieza: 3,
    })),
    totalImporte: n * 100,
    totalPiezas: n * 10,
  };
}

describe('impreso márgenes por pedido (F7-E1) — tope', () => {
  it('no topa cuando hay pocos pedidos', async () => {
    const datos = await armarDatosImpresoMargenes(sesion, {}, bdFake, {
      margenesPorPedido: () => Promise.resolve(margenesFake(3)),
    });
    expect(datos.margenes.filas).toHaveLength(3);
    expect(datos.totalFilas).toBe(3);
    expect(datos.pagador).toBe('FR MODA SA DE CV');
  });

  it('topa a MAX_FILAS_PDF pero conserva los totales del universo completo', async () => {
    const n = MAX_FILAS_PDF + 40;
    const datos = await armarDatosImpresoMargenes(sesion, {}, bdFake, {
      margenesPorPedido: () => Promise.resolve(margenesFake(n)),
    });
    expect(datos.margenes.filas).toHaveLength(MAX_FILAS_PDF);
    expect(datos.totalFilas).toBe(n);
    // Los totales NO se recortan: son del universo completo.
    expect(datos.margenes.totalPiezas).toBe(n * 10);
    expect(datos.margenes.totalImporte).toBe(n * 100);
  });

  it('renderiza un PDF con la leyenda de truncado (pocas filas dibujadas, total alto)', async () => {
    const datos: DatosImpresoMargenes = {
      pagador: 'FR MODA SA DE CV',
      margenes: margenesFake(3),
      totalFilas: 500,
    };
    const buffer = await generarPdfMargenes(datos);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
