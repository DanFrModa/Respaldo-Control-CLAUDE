import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Margenes } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { MargenesPagina } from './MargenesPagina';

/** Estado mutable del hook mockeado (objeto estable para el factory de vi.mock). */
const mock: { margenes: unknown } = { margenes: null };

vi.mock('@/api/costos', () => ({
  useMargenes: () => mock.margenes,
  imprimirMargenes: vi.fn(),
  descargarExcelMargenes: vi.fn(),
}));

describe('MargenesPagina', () => {
  it('muestra los márgenes por pedido (importe y % de margen)', () => {
    const datos: Margenes = {
      filas: [
        {
          idPedido: 1,
          folio: 7,
          idCliente: 3,
          cliente: 'Tienda X',
          fechaHasta: '2026-06-30',
          cantidad: 35,
          importe: 3500,
          margenPromedio: 0.47,
          margenPonderado: 0.47,
          margenPesosPorPieza: 47,
        },
      ],
      totalImporte: 3500,
      totalPiezas: 35,
    };
    mock.margenes = { data: datos, isPending: false, isError: false, error: null };
    renderConProveedores(<MargenesPagina />, {
      sesion: estadoSesionDePrueba(['costos.ver', 'consultas.ver-importes']),
    });
    expect(screen.getByTestId('mg-fila-1')).toBeInTheDocument();
    // "Tienda X" aparece en la tabla (≥lg) y en la tarjeta móvil (<lg); se afirma sobre la fila.
    expect(screen.getByTestId('mg-fila-1')).toHaveTextContent('Tienda X');
    // El 47.0% aparece dos veces (margen promedio y ponderado).
    expect(screen.getAllByText('47.0%').length).toBeGreaterThan(0);
    expect(screen.getByTestId('mg-fila-1')).toHaveTextContent('$3,500.00');
  });

  it('oculta los importes ("—") cuando el backend los devuelve en null (sin ver-importes)', () => {
    const datos: Margenes = {
      filas: [
        {
          idPedido: 2,
          folio: 8,
          idCliente: 3,
          cliente: 'Tienda Y',
          fechaHasta: null,
          cantidad: 10,
          importe: null,
          margenPromedio: null,
          margenPonderado: null,
          margenPesosPorPieza: null,
        },
      ],
      totalImporte: null,
      totalPiezas: 10,
    };
    mock.margenes = { data: datos, isPending: false, isError: false, error: null };
    renderConProveedores(<MargenesPagina />, {
      sesion: estadoSesionDePrueba(['costos.ver']),
    });
    const fila = screen.getByTestId('mg-fila-2');
    // La cantidad (no es importe) sí se ve; los importes/márgenes son "—".
    expect(fila).toHaveTextContent('10');
    expect(fila).toHaveTextContent('—');
  });

  it('estado vacío cuando no hay pedidos costeados', () => {
    mock.margenes = {
      data: { filas: [], totalImporte: 0, totalPiezas: 0 },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<MargenesPagina />, {
      sesion: estadoSesionDePrueba(['costos.ver', 'consultas.ver-importes']),
    });
    expect(screen.getByText(/No hay pedidos con órdenes costeadas/)).toBeInTheDocument();
  });
});
