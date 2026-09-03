import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EsMaSaldo } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { SaldoMaquilero } from './SaldoMaquilero';

/** Estado mutable del hook mockeado (objeto estable para el factory de vi.mock). */
const estado: { valor: unknown } = { valor: null };

vi.mock('@/api/esma', () => ({
  useSaldoMaquilero: () => estado.valor,
}));

/** Saldo limpio: todo revisado, nada esperando decisión. */
const saldoLimpio: EsMaSaldo = {
  idMaquilero: 5,
  maquilero: 'Maquila SA',
  conFactura: null,
  totalCargos: 1000,
  totalAbonos: 0,
  totalPagos: 200,
  totalDescuentos: 0,
  saldo: 800,
  pendienteRevision: { abonos: 0, pagos: 0, descuentos: 0, neto: 0, partidas: 0 },
};

/** El mismo saldo, con tres partidas capturadas que TODAVÍA no cuentan (V1, fila 0.115). */
const saldoConPendiente: EsMaSaldo = {
  ...saldoLimpio,
  pendienteRevision: { abonos: 100, pagos: 30, descuentos: 20, neto: 50, partidas: 3 },
};

describe('SaldoMaquilero · el pendiente de revisión acompaña al saldo', () => {
  beforeEach(() => {
    estado.valor = { data: saldoLimpio, isPending: false, isError: false, error: null };
  });

  it('muestra el desglose y el saldo', () => {
    renderConProveedores(<SaldoMaquilero idMaquilero={5} />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
    });
    expect(screen.getByTestId('saldo-saldo')).toHaveTextContent('$800.00');
  });

  it('sin nada capturado, NO inventa un aviso de pendiente', () => {
    renderConProveedores(<SaldoMaquilero idMaquilero={5} />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
    });
    expect(screen.queryByTestId('saldo-pendiente')).not.toBeInTheDocument();
  });

  it('⭐ con partidas capturadas, dice cuánto NO entró al saldo y por qué', () => {
    // Si el importe excluido no se explicara, el usuario vería un saldo más chico sin razón.
    estado.valor = { data: saldoConPendiente, isPending: false, isError: false, error: null };
    renderConProveedores(<SaldoMaquilero idMaquilero={5} />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
    });
    const aviso = screen.getByTestId('saldo-pendiente');
    expect(aviso).toHaveTextContent('$50.00');
    expect(aviso).toHaveTextContent(/pendiente de revisión/i);
    // Y el desglose por concepto, para saber de dónde sale ese neto.
    expect(aviso).toHaveTextContent('$100.00');
    expect(aviso).toHaveTextContent('$30.00');
    expect(aviso).toHaveTextContent('$20.00');
  });

  /** El saldo como lo ve quien NO tiene `consultas.ver-importes`: todo en null, salvo el conteo. */
  function saldoOculto(partidas: number): EsMaSaldo {
    return {
      ...saldoLimpio,
      totalCargos: null,
      totalAbonos: null,
      totalPagos: null,
      totalDescuentos: null,
      saldo: null,
      pendienteRevision: { abonos: null, pagos: null, descuentos: null, neto: null, partidas },
    };
  }

  it('con los importes ocultos y nada por revisar, no anuncia nada', () => {
    estado.valor = { data: saldoOculto(0), isPending: false, isError: false, error: null };
    renderConProveedores(<SaldoMaquilero idMaquilero={5} />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    expect(screen.queryByTestId('saldo-pendiente')).not.toBeInTheDocument();
  });

  it('⭐ con los importes ocultos, el CONTEO sí se anuncia (saber que hay algo pendiente no es ver dinero)', () => {
    // El servidor nunca oculta `partidas`: sin ese número, quien no ve importes tampoco sabría que
    // hay decisiones esperando — que es justo lo que esta fila vino a destapar.
    estado.valor = { data: saldoOculto(2), isPending: false, isError: false, error: null };
    renderConProveedores(<SaldoMaquilero idMaquilero={5} />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    const aviso = screen.getByTestId('saldo-pendiente');
    expect(aviso).toHaveTextContent('2 partidas');
    expect(aviso).not.toHaveTextContent('$');
  });
});
