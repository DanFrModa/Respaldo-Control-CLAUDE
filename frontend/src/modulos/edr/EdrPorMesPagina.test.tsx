import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EdrPorMes } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EdrPorMesPagina } from './EdrPorMesPagina';

/** Estado mutable del hook mockeado (objeto estable para el factory de vi.mock). */
const mock: { porMes: unknown } = { porMes: null };

vi.mock('@/api/edr', () => ({
  useEdrPorMes: () => mock.porMes,
  imprimirEdrMensual: vi.fn(),
  descargarExcelEdr: vi.fn(),
}));

/** Un EDR calculado de ejemplo. */
function edrEjemplo(): NonNullable<EdrPorMes['edr']> {
  return {
    encabezado: {
      id: 7,
      anio: 2026,
      mes: 6,
      gastos: 300,
      intereses: 0,
      bonificaciones: 50,
      otros: 0,
      descOtros: null,
      observaciones: null,
      creadoEn: '2026-06-01T00:00:00.000Z',
      modificadoEn: '2026-06-01T00:00:00.000Z',
    },
    ventas: 2000,
    costo: 400,
    gastos: 300,
    intereses: 0,
    bonificaciones: 50,
    otros: 0,
    resultado: 1350,
    totalPiezas: 20,
    totalLineas: 1,
    lineasSinCosto: 0,
    cortesEmpresa: [{ id: 1, nombre: 'FR Moda', ventas: 2000, costo: 400, utilidadBruta: 1600 }],
    cortesCliente: [{ id: 3, nombre: 'Tienda X', ventas: 2000, costo: 400, utilidadBruta: 1600 }],
  };
}

describe('EdrPorMesPagina', () => {
  it('muestra el P&L del mes y los cortes cuando el EDR existe', () => {
    const datos: EdrPorMes = { existe: true, anio: 2026, mes: 6, edr: edrEjemplo() };
    mock.porMes = { data: datos, isPending: false, isError: false, error: null };
    renderConProveedores(<EdrPorMesPagina />, {
      sesion: estadoSesionDePrueba(['edr.ver']),
      rutaInicial: '/edr/por-mes?anio=2026&mes=6',
    });
    expect(screen.getByTestId('pm-resultado')).toHaveTextContent('$1,350.00');
    expect(screen.getByTestId('pm-empresa')).toHaveTextContent('FR Moda');
    expect(screen.getByTestId('pm-cliente')).toHaveTextContent('Tienda X');
    expect(screen.getByTestId('pm-pdf')).toBeInTheDocument();
    expect(screen.getByTestId('pm-excel')).toBeInTheDocument();
  });

  it('muestra el aviso cuando el mes aún no se generó', () => {
    const datos: EdrPorMes = { existe: false, anio: 2026, mes: 8, edr: null };
    mock.porMes = { data: datos, isPending: false, isError: false, error: null };
    renderConProveedores(<EdrPorMesPagina />, {
      sesion: estadoSesionDePrueba(['edr.ver']),
      rutaInicial: '/edr/por-mes?anio=2026&mes=8',
    });
    expect(screen.getByTestId('pm-no-generado')).toBeInTheDocument();
  });
});
