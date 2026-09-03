import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EsMaEstadoCuenta, EsMaSaldo } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EstadoCuentaPagina } from './EstadoCuentaPagina';

/** Estado mutable de los hooks mockeados (objeto estable para el factory de vi.mock). */
const mock: { estado: unknown } = { estado: null };
const revisarMutate = vi.fn();

const saldo: EsMaSaldo = {
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

const estadoConMovimientos: EsMaEstadoCuenta = {
  idMaquilero: 5,
  maquilero: 'Maquila SA',
  desde: null,
  hasta: null,
  conFactura: null,
  saldo,
  movimientos: [
    {
      concepto: 'abono',
      id: 1,
      fecha: '2026-06-30',
      referencia: 'Anticipo',
      monto: 500,
      estadoRevision: 'capturado',
      pendienteRevision: true,
    },
  ],
  // V1-E8k (§Post-F9.136): el maquilero entregó 2 prendas incompletas. Van FUERA de `movimientos`
  // y del saldo — el fixture las trae para que la tarjeta informativa se ejercite de verdad.
  incompletas: {
    filas: [
      {
        idRecibo: 77,
        folioRecibo: 77,
        fecha: '2026-06-28',
        idOrden: 9,
        folioOrden: 100,
        codigoModelo: 'A-100',
        descripcionModelo: 'Playera',
        tipoProceso: 'Costura',
        piezas: 2,
      },
    ],
    totalPiezas: 2,
  },
};

vi.mock('@/api/esma', () => ({
  useEstadoCuenta: () => mock.estado,
  useRevisarMovimiento: () => ({ mutate: revisarMutate, isPending: false }),
  useSaldoMaquilero: () => ({ data: saldo, isPending: false, isError: false, error: null }),
  useMaquilerosEsMa: () => ({
    data: { filas: [{ id: 5, nombre: 'Maquila SA', corto: null }] },
    isPending: false,
    isError: false,
  }),
  imprimirEstadoCuenta: vi.fn(),
  descargarExcelEstadoCuenta: vi.fn(),
}));
vi.mock('@/api/wip', () => ({
  useExistenciaMaquilero: () => ({
    data: { filas: [], totalEnPoder: 0 },
    isPending: false,
    isError: false,
  }),
}));

describe('EstadoCuentaPagina (F6-E5)', () => {
  beforeEach(() => {
    revisarMutate.mockReset();
    mock.estado = { data: estadoConMovimientos, isPending: false, isError: false, error: null };
  });

  it('pide elegir un maquilero cuando no hay ninguno seleccionado', () => {
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    expect(
      screen.getByText(/Elige un maquilero para ver su estado de cuenta/i),
    ).toBeInTheDocument();
  });

  it('muestra los movimientos y su marca de pendiente al llegar con un maquilero (router state)', () => {
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'esma.modificar', 'consultas.ver-importes']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    const fila = screen.getByTestId('edc-fila');
    expect(fila).toHaveTextContent('Abono');
    expect(fila).toHaveTextContent('Anticipo');
    // Con esma.modificar y partida pendiente, aparece el botón de autorizar (vista móvil).
    expect(screen.getByTestId('edc-autorizar')).toBeInTheDocument();
  });

  it('V1-E8k · muestra las PRENDAS INCOMPLETAS entregadas, con su total, fuera de los movimientos', () => {
    // Es literalmente lo que Daniel pidió: *"sólo quisiera ver reflejado en algún lado que sí las
    // entrego, para revisar los temas de pago"*. Sin esta aserción, borrar la tarjeta entera dejaba
    // las 7 pruebas del archivo en verde.
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    const tarjeta = screen.getByTestId('edc-incompletas');
    expect(tarjeta).toHaveTextContent('Prendas incompletas entregadas');
    // El renglón trae la orden y el modelo, y el total dice las piezas.
    const fila = screen.getByTestId('edc-incompletas-fila');
    expect(fila).toHaveTextContent('#100');
    expect(fila).toHaveTextContent('A-100');
    expect(screen.getByTestId('edc-incompletas-total')).toHaveTextContent(
      'Total de prendas incompletas: 2',
    );
    // Y NO se colaron entre los movimientos (no son dinero): la tabla sigue con su único abono.
    expect(screen.getAllByTestId('edc-fila')).toHaveLength(1);
  });

  it('V1-E8k · sin incompletas, la tarjeta no se dibuja', () => {
    mock.estado = {
      data: { ...estadoConMovimientos, incompletas: { filas: [], totalPiezas: 0 } },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    expect(screen.queryByTestId('edc-incompletas')).not.toBeInTheDocument();
  });

  it('sin esma.modificar no ofrece autorizar la partida pendiente', () => {
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    expect(screen.getByTestId('edc-fila')).toBeInTheDocument();
    expect(screen.queryByTestId('edc-autorizar')).not.toBeInTheDocument();
  });
});
