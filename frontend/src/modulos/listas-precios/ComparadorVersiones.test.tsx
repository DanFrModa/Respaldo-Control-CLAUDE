import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Precosto, PrecostoLinea } from '@/api/precostos';

import { ComparadorVersiones } from './ComparadorVersiones';

// Estado por-id de los precostos (sin red): la clave es el id que pide `usePrecosto`.
let precostosPorId: Record<number, Precosto>;

vi.mock('@/api/precostos', () => ({
  usePrecosto: (id: number | null) => ({
    data: id === null ? undefined : precostosPorId[id],
    isPending: id !== null && precostosPorId[id] === undefined,
    isError: false,
    error: null,
  }),
}));

function linea(
  over: Partial<PrecostoLinea> & Pick<PrecostoLinea, 'conceptoCodigo' | 'descripcion'>,
): PrecostoLinea {
  return {
    id: Math.random(),
    idConceptoCosto: 1,
    conceptoNombre: over.conceptoCodigo === 'tela' ? 'Tela' : 'Avíos',
    conceptoOrden: 1,
    conceptoFijo: true,
    origen: 'bom_tela',
    consumo: null,
    precioUnit: 10,
    importe: 10,
    notas: null,
    idTela: null,
    idTelaProveedor: null,
    idAvio: null,
    idAvioProveedor: null,
    idModeloArte: null,
    editable: false,
    eliminable: false,
    ajustado: false,
    ...over,
  };
}

function precosto(over: Partial<Precosto> & Pick<Precosto, 'id' | 'version'>): Precosto {
  return {
    idDesarrollo: 1,
    estado: 'congelado',
    congelado: true,
    congeladoEn: '2026-07-06T00:00:00.000Z',
    congeladoPorId: null,
    costoTotal: 40,
    lineas: [],
    creadoEn: '2026-07-06T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-06T00:00:00.000Z',
    modificadoPorId: null,
    ...over,
  };
}

describe('<ComparadorVersiones>', () => {
  it('muestra los renglones que cambiaron y el delta de costo', () => {
    precostosPorId = {
      1: precosto({
        id: 1,
        version: 1,
        costoTotal: 40,
        lineas: [
          linea({ conceptoCodigo: 'tela', descripcion: 'Felpa', importe: 30 }),
          linea({ conceptoCodigo: 'avios', descripcion: 'Bolsas', importe: 10 }),
        ],
      }),
      2: precosto({
        id: 2,
        version: 2,
        costoTotal: 25,
        lineas: [
          // La felpa bajó (menos tela), las bolsas se quitaron.
          linea({ conceptoCodigo: 'tela', descripcion: 'Felpa', importe: 25 }),
        ],
      }),
    };

    render(<ComparadorVersiones idAnterior={1} idNuevo={2} verImportes />);

    const comparador = screen.getByTestId('comparador-versiones');
    // La bolsa QUITADA y la felpa CAMBIÓ deben aparecer como filas de comparación.
    const filas = within(comparador).getAllByTestId('fila-comparacion');
    const estados = filas.map((f) => f.getAttribute('data-estado'));
    expect(estados).toContain('cambio');
    expect(estados).toContain('quitado');
    // Delta = 25 − 40 = −15.
    expect(within(comparador).getByTestId('comparador-delta')).toHaveTextContent('-$15.00');
  });

  it('oculta los importes sin ver-importes', () => {
    precostosPorId = {
      1: precosto({
        id: 1,
        version: 1,
        costoTotal: null,
        lineas: [linea({ conceptoCodigo: 'tela', descripcion: 'Felpa', importe: null })],
      }),
      2: precosto({
        id: 2,
        version: 2,
        costoTotal: null,
        lineas: [linea({ conceptoCodigo: 'tela', descripcion: 'Felpa', importe: null })],
      }),
    };

    render(<ComparadorVersiones idAnterior={1} idNuevo={2} verImportes={false} />);
    expect(screen.getByTestId('comparador-delta')).toHaveTextContent('—');
  });
});
