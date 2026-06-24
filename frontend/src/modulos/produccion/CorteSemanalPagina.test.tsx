import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CorteSemanal } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CorteSemanalPagina } from './CorteSemanalPagina';

type EstadoConsulta = {
  data: CorteSemanal | undefined;
  isPending: boolean;
  isError: boolean;
  error: ErrorDeApi | null;
};
const useCorteSemanal = vi.fn<() => EstadoConsulta>();
vi.mock('@/api/etapas', () => ({
  useCorteSemanal: () => useCorteSemanal(),
}));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [{ id: 1, nombre: 'Corte SA' }] } }),
  useRolesProveedor: () => ({ data: [{ id: 9, codigo: 'corte', nombre: 'Corte' }] }),
}));

function reporte(): CorteSemanal {
  return {
    filas: [
      {
        idCortador: 1,
        cortador: 'Corte SA',
        anioSemana: '2026-W25',
        inicioSemana: '2026-06-15',
        totalCortado: 120,
        numCortes: 2,
      },
    ],
  };
}

describe('CorteSemanalPagina (F3-E2)', () => {
  beforeEach(() => {
    useCorteSemanal.mockReset();
  });

  it('muestra las filas del corte semanal (tabla de escritorio)', () => {
    useCorteSemanal.mockReturnValue({
      data: reporte(),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<CorteSemanalPagina />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver']),
    });
    expect(screen.getByTestId('corte-semanal-tabla')).toBeInTheDocument();
    expect(screen.getAllByText('Corte SA').length).toBeGreaterThan(0);
    expect(screen.getAllByText('120').length).toBeGreaterThan(0);
  });

  it('muestra el estado vacío cuando no hay cortes', () => {
    useCorteSemanal.mockReturnValue({
      data: { filas: [] },
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<CorteSemanalPagina />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver']),
    });
    expect(screen.getByText(/No hay cortes en el periodo/i)).toBeInTheDocument();
  });

  it('muestra el error de la consulta', () => {
    useCorteSemanal.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new ErrorDeApi({ codigo: 'ERROR', mensaje: 'Falló el reporte' }),
    });
    renderConProveedores(<CorteSemanalPagina />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver']),
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Falló el reporte');
  });
});
