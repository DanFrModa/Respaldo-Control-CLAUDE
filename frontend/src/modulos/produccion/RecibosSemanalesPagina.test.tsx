import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorDeApi } from '@/api/errores';
import type { RecibosSemanales } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { RecibosSemanalesPagina } from './RecibosSemanalesPagina';

type EstadoConsulta = {
  data: RecibosSemanales | undefined;
  isPending: boolean;
  isError: boolean;
  error: ErrorDeApi | null;
};
const useRecibosSemanales = vi.fn<() => EstadoConsulta>();
vi.mock('@/api/recibos', () => ({
  useRecibosSemanales: () => useRecibosSemanales(),
}));
// V1-E7g: el filtro de proveedor/maquilero es el `SelectorProveedor` (combobox con búsqueda en
// SERVIDOR), que consulta por `useProveedoresPorRol`. El mock filtra por «contiene», igual que el
// servidor (`idsPorNombreSinAcentos` hace `LIKE %texto%`).
vi.mock('@/api/proveedores', () => ({
  COD_ROL_PROVEEDOR: { corte: 'corte' },
  useProveedoresPorRol: (_rol: string | undefined, filtros?: { busqueda?: string }) => {
    const todos = [{ id: 1, nombre: 'Maquila SA' }];
    const busqueda = (filtros?.busqueda ?? '').toLowerCase();
    return {
      data: {
        datos:
          busqueda === '' ? todos : todos.filter((p) => p.nombre.toLowerCase().includes(busqueda)),
      },
      isPending: false,
    };
  },
}));

function reporte(): RecibosSemanales {
  return {
    filas: [
      {
        idMaquilero: 1,
        maquilero: 'Maquila SA',
        anioSemana: '2026-W25',
        inicioSemana: '2026-06-15',
        totalRecibido: 180,
        totalPrimeras: 170,
        totalSegundas: 10,
        // V1-E8k: aparte del total recibido — 4 prendas que llegaron sin terminar de coser.
        totalIncompletas: 4,
        numRecibos: 3,
      },
    ],
  };
}

describe('RecibosSemanalesPagina (F3-E4)', () => {
  beforeEach(() => {
    useRecibosSemanales.mockReset();
  });

  it('muestra las filas de recibos semanales (tabla de escritorio)', () => {
    useRecibosSemanales.mockReturnValue({
      data: reporte(),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<RecibosSemanalesPagina />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver']),
    });
    expect(screen.getByTestId('recibos-semanales-tabla')).toBeInTheDocument();
    expect(screen.getAllByText('Maquila SA').length).toBeGreaterThan(0);
    expect(screen.getAllByText('180').length).toBeGreaterThan(0);
    expect(screen.getAllByText('170').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
  });

  it('muestra el estado vacío cuando no hay recibos', () => {
    useRecibosSemanales.mockReturnValue({
      data: { filas: [] },
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<RecibosSemanalesPagina />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver']),
    });
    expect(screen.getByText(/No hay recibos en el periodo/i)).toBeInTheDocument();
  });

  it('muestra el error de la consulta', () => {
    useRecibosSemanales.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new ErrorDeApi({ codigo: 'ERROR', mensaje: 'Falló el reporte' }),
    });
    renderConProveedores(<RecibosSemanalesPagina />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver']),
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Falló el reporte');
  });
});
