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
      nombreCorto: 'MSA',
      totalCargos: 1000,
      totalAbonos: 0,
      totalPagos: 200,
      totalDescuentos: 0,
      saldo: 800,
      pendienteRevision: { abonos: 0, pagos: 0, descuentos: 0, neto: 0, partidas: 0 },
    },
  ],
  totalSaldo: 800,
  totalPendienteNeto: 0,
};

/** Un maquilero cuyo ÚNICO movimiento está capturado: saldo 0, pero hay dinero esperando decisión. */
const soloPendiente: EsMaSaldosTodos = {
  conFactura: null,
  filas: [
    {
      idMaquilero: 9,
      maquilero: 'Maquila Sin Revisar SA',
      nombreCorto: null,
      totalCargos: 0,
      totalAbonos: 0,
      totalPagos: 0,
      totalDescuentos: 0,
      saldo: 0,
      pendienteRevision: { abonos: 90, pagos: 0, descuentos: 0, neto: 90, partidas: 1 },
    },
  ],
  totalSaldo: 0,
  totalPendienteNeto: 90,
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
      data: { conFactura: null, filas: [], totalSaldo: 0, totalPendienteNeto: 0 },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<SaldosMaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    expect(
      screen.getByText(/No hay maquileros con saldo ni partidas por revisar/i),
    ).toBeInTheDocument();
  });

  it('lista los maquileros con su saldo', () => {
    renderConProveedores(<SaldosMaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
    });
    const fila = screen.getByTestId('saldos-fila');
    expect(fila).toHaveTextContent('Maquila SA');
    expect(fila).toHaveTextContent('$800.00');
  });

  it('sin nada por revisar, no anuncia un pendiente que no existe', () => {
    renderConProveedores(<SaldosMaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
    });
    expect(screen.getByTestId('saldos-total')).not.toHaveTextContent(/por revisar/i);
  });

  it('⭐ el maquilero que sólo tiene partidas por revisar se ve, con su importe explicado', () => {
    // El caso que el corte viejo (`saldo ≠ 0`) escondía: saldo en 0 y dinero esperando decisión.
    estado.valor = { data: soloPendiente, isPending: false, isError: false, error: null };
    renderConProveedores(<SaldosMaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
    });
    const fila = screen.getByTestId('saldos-fila');
    expect(fila).toHaveTextContent('Maquila Sin Revisar SA');
    expect(fila).toHaveTextContent('$90.00');
    expect(screen.getByTestId('saldos-total')).toHaveTextContent(/por revisar/i);
    expect(screen.getByTestId('saldos-total')).toHaveTextContent('$90.00');
  });

  it('⭐ también se ve el que tiene partidas que NETEAN cero, y la columna lo DICE', () => {
    // Abono capturado 500 + pago capturado 500: neto 0. Con el importe como criterio, esta fila
    // desaparecería del tablero teniendo dos partidas esperando decisión.
    const fila = soloPendiente.filas[0];
    if (fila === undefined) throw new Error('fixture sin fila');
    estado.valor = {
      data: {
        ...soloPendiente,
        filas: [
          {
            ...fila,
            pendienteRevision: { abonos: 500, pagos: 500, descuentos: 0, neto: 0, partidas: 2 },
          },
        ],
        totalPendienteNeto: 0,
      },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<SaldosMaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
    });
    const renglon = screen.getByTestId('saldos-fila');
    expect(renglon).toHaveTextContent('Maquila Sin Revisar SA');
    // La celda «Por revisar» no puede quedarse en "$0.00": son DOS cosas esperando decisión, y sin
    // el conteo el renglón se leería como si no hubiera nada pendiente.
    expect(renglon).toHaveTextContent('2 partidas');
    expect(screen.getByTestId('saldos-total')).toHaveTextContent(/por revisar/i);
  });

  it('⭐ con los importes ocultos, la columna «Por revisar» dice CUÁNTAS partidas (no "—")', () => {
    // El servidor oculta los cuatro importes del pendiente pero NUNCA el conteo. Si la columna
    // pintara sólo el neto, quien no puede ver dinero vería un "—" y no sabría que hay algo
    // esperando decisión — el mismo agujero que esta fila vino a tapar.
    const fila = soloPendiente.filas[0];
    if (fila === undefined) throw new Error('fixture sin fila');
    estado.valor = {
      data: {
        ...soloPendiente,
        filas: [
          {
            ...fila,
            totalCargos: null,
            totalAbonos: null,
            totalPagos: null,
            totalDescuentos: null,
            saldo: null,
            pendienteRevision: {
              abonos: null,
              pagos: null,
              descuentos: null,
              neto: null,
              partidas: 3,
            },
          },
        ],
        totalSaldo: null,
        totalPendienteNeto: null,
      },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<SaldosMaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    expect(screen.getByTestId('saldos-fila')).toHaveTextContent('3 partidas');
    // Y la tarjeta móvil dice exactamente lo mismo (mismo texto, las dos vistas).
    expect(screen.getByTestId('saldos-tarjeta')).toHaveTextContent('3 partidas');
  });

  it('con importes visibles, la columna lleva el importe Y el conteo', () => {
    estado.valor = { data: soloPendiente, isPending: false, isError: false, error: null };
    renderConProveedores(<SaldosMaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
    });
    const renglon = screen.getByTestId('saldos-fila');
    expect(renglon).toHaveTextContent('$90.00');
    expect(renglon).toHaveTextContent('1 partida');
  });
});
