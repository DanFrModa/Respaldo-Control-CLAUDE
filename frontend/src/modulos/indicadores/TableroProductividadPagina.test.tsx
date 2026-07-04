import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TableroProductividad } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TableroProductividadPagina } from './TableroProductividadPagina';

const mock: { tablero: unknown } = { tablero: null };

vi.mock('@/api/productividad', () => ({
  useTableroProductividad: () => mock.tablero,
}));

describe('TableroProductividadPagina', () => {
  it('muestra las filas agregadas con su índice total y promedio', () => {
    const datos: TableroProductividad = {
      area: 'ip',
      agrupacion: 'semana',
      filas: [
        {
          periodo: '2026-W23',
          anio: 2026,
          periodoNum: 23,
          area: 'ip',
          idActividad: 1,
          actividad: 'Fichas',
          idPersona: 5,
          persona: 'Laura',
          numRegistros: 2,
          cantidad: 15,
          horasTrabajadas: 16,
          indiceTotal: 15,
          indicePromedio: 7.5,
          porcentajeTrabajado: 1,
          estandar: 1,
        },
      ],
    };
    mock.tablero = { data: datos, isPending: false, isError: false, error: null };

    renderConProveedores(<TableroProductividadPagina />, {
      sesion: estadoSesionDePrueba(['indicadores.ip-productividad']),
    });

    expect(screen.getByText('2026-W23')).toBeInTheDocument();
    expect(screen.getByText('Laura')).toBeInTheDocument();
    expect(screen.getByTestId('tp-fila')).toHaveTextContent('15');
  });

  it('muestra el estado vacío sin registros', () => {
    mock.tablero = {
      data: { area: 'ip', agrupacion: 'semana', filas: [] },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<TableroProductividadPagina />, {
      sesion: estadoSesionDePrueba(['indicadores.ip-productividad']),
    });
    expect(screen.getByText('Sin registros en el periodo.')).toBeInTheDocument();
  });
});
