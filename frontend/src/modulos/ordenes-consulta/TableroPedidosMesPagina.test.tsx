import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ReactRouter from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ErrorDeApi } from '@/api/errores';
import type { TableroPedidosMes } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TableroPedidosMesPagina } from './TableroPedidosMesPagina';

const navegar = vi.fn();
vi.mock('react-router-dom', async () => {
  const real = await vi.importActual<typeof ReactRouter>('react-router-dom');
  return { ...real, useNavigate: () => navegar };
});

type EstadoConsulta = {
  data: TableroPedidosMes | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useTableroPedidosMes = vi.fn<() => EstadoConsulta>();
vi.mock('@/api/ordenes-consulta', () => ({
  useTableroPedidosMes: () => useTableroPedidosMes(),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isPending: false }),
}));

function tablero(): TableroPedidosMes {
  return {
    filas: [
      {
        anio: 2026,
        mes: 6,
        clave: '2026-06',
        etiqueta: 'jun 2026',
        numOrdenes: 3,
        totalPiezas: 500,
      },
    ],
    totalOrdenes: 3,
    totalPiezas: 500,
  };
}

describe('<TableroPedidosMesPagina>', () => {
  beforeEach(() => {
    useTableroPedidosMes.mockReset();
    navegar.mockReset();
  });

  it('muestra las filas del tablero con sus métricas y el total', () => {
    useTableroPedidosMes.mockReturnValue({
      data: tablero(),
      isPending: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderConProveedores(<TableroPedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    expect(screen.getByText('jun 2026')).toBeInTheDocument();
    expect(screen.getByTestId('fila-mes')).toBeInTheDocument();
  });

  it('saltar a la consulta navega con el año del mes', async () => {
    const usuario = userEvent.setup();
    useTableroPedidosMes.mockReturnValue({
      data: tablero(),
      isPending: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderConProveedores(<TableroPedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    await usuario.click(screen.getByTestId('saltar-consulta'));
    expect(navegar).toHaveBeenCalledWith('/produccion/consulta', {
      state: { anio: 2026, idCliente: null },
    });
  });

  it('muestra el estado vacío cuando no hay órdenes en el rango', () => {
    useTableroPedidosMes.mockReturnValue({
      data: { filas: [], totalOrdenes: 0, totalPiezas: 0 },
      isPending: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderConProveedores(<TableroPedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    expect(screen.getByText(/No hay órdenes con fecha/)).toBeInTheDocument();
  });
});
