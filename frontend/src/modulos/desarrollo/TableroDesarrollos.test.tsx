import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TableroDesarrollos } from './TableroDesarrollos';

const useTableroDesarrollosMock = vi.fn();
const useClientesMock = vi.fn();
const useDepartamentosClienteMock = vi.fn();
const useTemporadasMock = vi.fn();

vi.mock('@/api/liga-orden', () => ({
  useTableroDesarrollos: (query: unknown) => useTableroDesarrollosMock(query) as unknown,
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => useClientesMock() as unknown,
  useDepartamentosCliente: (id: unknown) => useDepartamentosClienteMock(id) as unknown,
}));
vi.mock('@/api/temporadas', () => ({
  useTemporadas: () => useTemporadasMock() as unknown,
}));

describe('TableroDesarrollos (F8-E6)', () => {
  beforeEach(() => {
    useTableroDesarrollosMock.mockReset();
    useClientesMock.mockReset();
    useDepartamentosClienteMock.mockReset();
    useTemporadasMock.mockReset();

    useClientesMock.mockReturnValue({
      data: { datos: [{ id: 1, nombre: 'Liverpool' }] },
      isPending: false,
      isError: false,
    });
    useDepartamentosClienteMock.mockReturnValue({ data: [], isPending: false, isError: false });
    useTemporadasMock.mockReturnValue({
      data: { datos: [{ id: 8, nombre: 'Primavera' }] },
      isPending: false,
      isError: false,
    });
    useTableroDesarrollosMock.mockReturnValue({
      data: {
        total: 15,
        enDesarrollo: 5,
        cotizado: 4,
        enLista: 3,
        ligadoProduccion: 2,
        apagado: 1,
      },
      isPending: false,
      isError: false,
    });
  });

  it('muestra las tarjetas de conteo por estado (agregado en servidor)', () => {
    renderConProveedores(<TableroDesarrollos />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver']),
    });
    expect(screen.getByTestId('tarjeta-total')).toHaveTextContent('15');
    expect(screen.getByTestId('tarjeta-estado-en-desarrollo')).toHaveTextContent('5');
    expect(screen.getByTestId('tarjeta-estado-cotizado')).toHaveTextContent('4');
    expect(screen.getByTestId('tarjeta-estado-en-lista')).toHaveTextContent('3');
    expect(screen.getByTestId('tarjeta-estado-ligado-produccion')).toHaveTextContent('2');
    expect(screen.getByTestId('tarjeta-estado-apagado')).toHaveTextContent('1');
  });

  it('al filtrar por cliente, re-consulta el tablero con el idCliente', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<TableroDesarrollos />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver']),
    });
    await usuario.selectOptions(screen.getByLabelText('Filtrar por cliente'), '1');
    // La última llamada al hook debe incluir el filtro de cliente.
    const ultimaLlamada = useTableroDesarrollosMock.mock.calls.at(-1)?.[0] as {
      idCliente?: number;
    };
    expect(ultimaLlamada.idCliente).toBe(1);
  });
});
