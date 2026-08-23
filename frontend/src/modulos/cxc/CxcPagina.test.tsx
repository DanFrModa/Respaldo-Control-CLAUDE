import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CxcBandeja } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CxcPagina } from './CxcPagina';

/** Estado mutable del hook mockeado (objeto estable para el factory de vi.mock). */
const estado: { valor: unknown } = { valor: null };

vi.mock('@/api/cxc', () => ({
  useBandejaPorCobrar: () => estado.valor,
}));

const conCartera: CxcBandeja = {
  filas: [
    {
      idCliente: 7,
      cliente: 'Tiendas del Centro',
      diasCredito: 30,
      saldo: 88000,
      corriente: 40400,
      d1a30: 47600,
      d31a60: 0,
      mas60: 0,
    },
  ],
  total: 1,
  pagina: 1,
  porPagina: 20,
  totalPaginas: 1,
  // % = (88000 − 47600) / 88000 = 46.
  resumen: {
    carteraTotal: 88000,
    vencido: 47600,
    alCorrientePct: 46,
    clientesConSaldo: 1,
  },
  limitesAging: { limite1: 30, limite2: 60 },
};

describe('CxcPagina (F9-E4)', () => {
  beforeEach(() => {
    estado.valor = { data: conCartera, isPending: false, isError: false, error: null };
  });

  it('muestra el estado de carga', () => {
    estado.valor = { data: undefined, isPending: true, isError: false, error: null };
    renderConProveedores(<CxcPagina />, { sesion: estadoSesionDePrueba(['cxc.ver']) });
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });

  it('muestra el estado de error', () => {
    estado.valor = {
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'Boom' },
    };
    renderConProveedores(<CxcPagina />, { sesion: estadoSesionDePrueba(['cxc.ver']) });
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });

  it('pinta los KPIs de vistazo del resumen', () => {
    renderConProveedores(<CxcPagina />, {
      sesion: estadoSesionDePrueba(['cxc.ver', 'consultas.ver-importes']),
    });
    expect(screen.getByTestId('kpi-cartera')).toHaveTextContent('$88,000.00');
    expect(screen.getByTestId('kpi-vencido')).toHaveTextContent('$47,600.00');
    expect(screen.getByTestId('kpi-al-corriente')).toHaveTextContent('46');
    expect(screen.getByTestId('kpi-clientes')).toHaveTextContent('1');
  });

  it('el % al corriente es "—" cuando no hay cartera', () => {
    estado.valor = {
      data: {
        ...conCartera,
        resumen: { carteraTotal: 0, vencido: 0, alCorrientePct: null, clientesConSaldo: 0 },
      },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<CxcPagina />, {
      sesion: estadoSesionDePrueba(['cxc.ver', 'consultas.ver-importes']),
    });
    expect(screen.getByTestId('kpi-al-corriente')).toHaveTextContent('—');
  });

  it('lista los clientes con su saldo y aging', () => {
    renderConProveedores(<CxcPagina />, {
      sesion: estadoSesionDePrueba(['cxc.ver', 'consultas.ver-importes']),
    });
    const fila = screen.getByTestId('cxc-fila-7');
    expect(fila).toHaveTextContent('Tiendas del Centro');
    expect(fila).toHaveTextContent('$88,000.00');
    expect(fila).toHaveTextContent('$40,400.00');
    expect(fila).toHaveTextContent('$47,600.00');
  });

  it('el botón "Importar CFDI" solo aparece con cxc.administrar', () => {
    renderConProveedores(<CxcPagina />, {
      sesion: estadoSesionDePrueba(['cxc.ver']),
    });
    expect(screen.queryByTestId('cxc-ir-importar-cfdi')).not.toBeInTheDocument();
  });
});
