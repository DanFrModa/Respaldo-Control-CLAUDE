import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EsMaSaldosTodos } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { SaldosMaquilerosPagina } from './SaldosMaquilerosPagina';

/** Estado mutable del hook mockeado (objeto estable para el factory de vi.mock). */
const estado: { valor: unknown } = { valor: null };

vi.mock('@/api/esma', () => ({
  useSaldosTodos: () => estado.valor,
}));

const conSaldos: EsMaSaldosTodos = {
  conFactura: null,
  filas: [
    {
      idMaquilero: 5,
      maquilero: 'Maquila SA',
      corto: 'MSA',
      totalCargos: 1000,
      totalAbonos: 0,
      totalPagos: 200,
      totalDescuentos: 0,
      saldo: 800,
    },
  ],
  totalSaldo: 800,
};

describe('SaldosMaquilerosPagina (F6-E5)', () => {
  beforeEach(() => {
    estado.valor = { data: conSaldos, isPending: false, isError: false, error: null };
  });

  it('muestra el estado de carga', () => {
    estado.valor = { data: undefined, isPending: true, isError: false, error: null };
    renderConProveedores(<SaldosMaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });

  it('muestra el estado de error', () => {
    estado.valor = {
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'Boom' },
    };
    renderConProveedores(<SaldosMaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });

  it('muestra el estado vacío cuando no hay saldos', () => {
    estado.valor = {
      data: { conFactura: null, filas: [], totalSaldo: 0 },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<SaldosMaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    expect(screen.getByText(/No hay maquileros con saldo pendiente/i)).toBeInTheDocument();
  });

  it('lista los maquileros con su saldo', () => {
    renderConProveedores(<SaldosMaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
    });
    const fila = screen.getByTestId('saldos-fila');
    expect(fila).toHaveTextContent('Maquila SA');
    expect(fila).toHaveTextContent('$800.00');
  });
});
