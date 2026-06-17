import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ErrorDeApi } from '@/api/errores';
import type { OrdenesIncompletasPagina as TipoPagina, OrdenIncompleta } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { OrdenesIncompletasPagina } from './OrdenesIncompletasPagina';

type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useOrdenesIncompletas = vi.fn<() => EstadoConsulta>();

vi.mock('@/api/ordenes-consulta', () => ({
  useOrdenesIncompletas: () => useOrdenesIncompletas(),
  imprimirOrden: vi.fn(),
}));

function incompleta(
  id: number,
  folio: number,
  dias: number,
  semaforo: OrdenIncompleta['semaforo'],
): OrdenIncompleta {
  return {
    id,
    folio,
    estado: 'capturada',
    fecha: '2026-06-01',
    fechaEntrega: '2026-06-30',
    idModelo: 10,
    codigoModelo: 'A-100',
    descripcionModelo: 'Playera',
    idCliente: 3,
    cliente: 'Liverpool',
    idMaquilero: null,
    maquilero: null,
    totalPiezas: 0,
    diasAntiguedad: dias,
    semaforo,
  };
}

function pagina(datos: OrdenIncompleta[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 20, totalPaginas: 1 };
}

describe('<OrdenesIncompletasPagina>', () => {
  beforeEach(() => useOrdenesIncompletas.mockReset());

  it('muestra el semáforo URGENTE para una orden vieja (>7d)', () => {
    useOrdenesIncompletas.mockReturnValue({
      data: pagina([incompleta(1, 101, 10, 'urgente')]),
      isPending: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderConProveedores(<OrdenesIncompletasPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });

    const semaforo = screen.getByTestId('semaforo');
    expect(semaforo).toHaveAttribute('data-semaforo', 'urgente');
    expect(semaforo).toHaveTextContent('Urgente');
    expect(screen.getByText('10 días')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay incompletas', () => {
    useOrdenesIncompletas.mockReturnValue({
      data: pagina([]),
      isPending: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderConProveedores(<OrdenesIncompletasPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    expect(screen.getByText(/Todo capturado/)).toBeInTheDocument();
  });

  it('distingue verde/amarillo/urgente por su data-semaforo', () => {
    useOrdenesIncompletas.mockReturnValue({
      data: pagina([
        incompleta(1, 101, 1, 'verde'),
        incompleta(2, 102, 5, 'amarillo'),
        incompleta(3, 103, 9, 'urgente'),
      ]),
      isPending: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderConProveedores(<OrdenesIncompletasPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    const semaforos = screen.getAllByTestId('semaforo');
    expect(semaforos.map((s) => s.getAttribute('data-semaforo'))).toEqual([
      'verde',
      'amarillo',
      'urgente',
    ]);
  });
});
