import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CxpBandeja } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CxpPagina } from './CxpPagina';

/** Estado mutable del hook mockeado (objeto estable para el factory de vi.mock). */
const estado: { valor: unknown } = { valor: null };

vi.mock('@/api/cxp', () => ({
  useBandejaPorPagar: () => estado.valor,
}));

const conCartera: CxpBandeja = {
  filas: [
    {
      idProveedor: 7,
      proveedor: 'Hilaturas del Norte',
      nombreCorto: 'HDN',
      diasCredito: 30,
      saldo: 88000,
      corriente: 40400,
      d1a30: 47600,
      d31a60: 0,
      mas60: 0,
      maquila: 0,
    },
    // Maquilero con SOLO deuda EsMa (0 en el motor): su saldo vive en la cubeta "Maquila".
    {
      idProveedor: 9,
      proveedor: 'Maquilas del Sur',
      nombreCorto: 'MDS',
      diasCredito: 0,
      saldo: 15000,
      corriente: 0,
      d1a30: 0,
      d31a60: 0,
      mas60: 0,
      maquila: 15000,
    },
  ],
  total: 2,
  pagina: 1,
  porPagina: 20,
  totalPaginas: 1,
  // carteraMotor = 103000 − 15000 = 88000; % = (88000 − 47600) / 88000 = 46 (la maquila NO cuenta).
  resumen: {
    carteraTotal: 103000,
    vencido: 47600,
    maquilaTotal: 15000,
    alCorrientePct: 46,
    proveedoresConSaldo: 2,
  },
  limitesAging: { limite1: 30, limite2: 60 },
};

describe('CxpPagina (F9-E2)', () => {
  beforeEach(() => {
    estado.valor = { data: conCartera, isPending: false, isError: false, error: null };
  });

  it('muestra el estado de carga', () => {
    estado.valor = { data: undefined, isPending: true, isError: false, error: null };
    renderConProveedores(<CxpPagina />, { sesion: estadoSesionDePrueba(['cxp.ver']) });
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });

  it('muestra el estado de error', () => {
    estado.valor = {
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'Boom' },
    };
    renderConProveedores(<CxpPagina />, { sesion: estadoSesionDePrueba(['cxp.ver']) });
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });

  it('pinta los KPIs de vistazo del resumen', () => {
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
    });
    // Cartera total (incl. maquila) + la maquila expuesta APARTE en el pie del tile.
    expect(screen.getByTestId('kpi-cartera')).toHaveTextContent('$103,000.00');
    expect(screen.getByTestId('kpi-cartera')).toHaveTextContent('$15,000.00');
    expect(screen.getByTestId('kpi-vencido')).toHaveTextContent('$47,600.00');
    // % SOLO sobre la cartera del motor (88,000) → 46, NO 54 (la maquila no cuenta).
    expect(screen.getByTestId('kpi-al-corriente')).toHaveTextContent('46');
    expect(screen.getByTestId('kpi-proveedores')).toHaveTextContent('2');
  });

  it('el % al corriente es "—" cuando no hay cartera del motor (solo maquila)', () => {
    estado.valor = {
      data: {
        ...conCartera,
        resumen: {
          carteraTotal: 15000,
          vencido: 0,
          maquilaTotal: 15000,
          alCorrientePct: null,
          proveedoresConSaldo: 1,
        },
      },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
    });
    expect(screen.getByTestId('kpi-al-corriente')).toHaveTextContent('—');
  });

  it('lista los proveedores con su saldo y aging', () => {
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
    });
    const fila = screen.getByTestId('cxp-fila-7');
    expect(fila).toHaveTextContent('Hilaturas del Norte');
    expect(fila).toHaveTextContent('$88,000.00');
    expect(fila).toHaveTextContent('$40,400.00');
    expect(fila).toHaveTextContent('$47,600.00');
  });

  it('muestra la cubeta de maquila para un proveedor con saldo EsMa', () => {
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
    });
    // Encabezado de la columna de maquila.
    expect(screen.getByRole('columnheader', { name: /maquila/i })).toBeInTheDocument();
    // El maquilero solo-EsMa aparece con su saldo en la cubeta Maquila (motor en "—").
    const fila = screen.getByTestId('cxp-fila-9');
    expect(fila).toHaveTextContent('Maquilas del Sur');
    expect(fila).toHaveTextContent('$15,000.00');
  });
});
