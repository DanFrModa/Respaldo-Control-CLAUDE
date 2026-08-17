import { fireEvent, screen } from '@testing-library/react';
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

  /**
   * V1-E4 (punto 7): el filtro pasó de `<select>` (topado a la primera página del catálogo, 100 —
   * con ~117 clientes había INALCANZABLES) al combobox con búsqueda server-side. La aserción de
   * fondo no cambia: elegir un cliente re-consulta el tablero con su id.
   */
  it('al filtrar por cliente, re-consulta el tablero con el idCliente', async () => {
    renderConProveedores(<TableroDesarrollos />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver']),
    });

    // Se teclea en el combobox y se elige la opción (mousedown: gana antes del blur).
    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'Liv' } });
    fireEvent.mouseDown(await screen.findByText('Liverpool'));

    const ultimaLlamada = useTableroDesarrollosMock.mock.calls.at(-1)?.[0] as {
      idCliente?: number;
    };
    expect(ultimaLlamada.idCliente).toBe(1);
  });
});
