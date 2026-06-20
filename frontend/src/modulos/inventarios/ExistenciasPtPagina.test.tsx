import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ExistenciasPt } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExistenciasPtPagina } from './ExistenciasPtPagina';

const existencias: ExistenciasPt = {
  filas: [
    {
      idModelo: 1,
      modelo: 'A-100',
      idColor: 7,
      color: 'Rojo',
      idTalla: 11,
      etiquetaTalla: 'CH',
      ordenTalla: 1,
      idAlmacen: 3,
      almacen: 'Primeras',
      existencia: 30,
    },
  ],
  totalExistencia: 30,
};

vi.mock('@/api/inventarios', () => ({
  useExistenciasPt: () => ({ data: existencias, isPending: false, isError: false, error: null }),
}));
vi.mock('@/api/colores', () => ({ useColores: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/tallas', () => ({ useTallas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/modelos', () => ({
  useModelos: () => ({ data: { datos: [] }, isPending: false, isError: false }),
}));

describe('ExistenciasPtPagina (F3-E3)', () => {
  it('muestra la fila de existencia y el total (tabla de escritorio + tarjetas móvil)', () => {
    renderConProveedores(<ExistenciasPtPagina />, {
      sesion: estadoSesionDePrueba(['inventario-pt.ver']),
    });
    // El total aparece en el resumen.
    expect(screen.getByText(/Total:/)).toBeInTheDocument();
    // Tanto la tabla (escritorio) como las tarjetas (móvil) existen en el DOM (la visibilidad la
    // controla Tailwind con clases responsive).
    expect(screen.getByTestId('exist-tabla')).toBeInTheDocument();
    expect(screen.getByTestId('exist-tarjetas')).toBeInTheDocument();
    // El dato de la fila se pinta (modelo/color/talla/almacén/existencia).
    expect(screen.getAllByText('A-100').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Primeras').length).toBeGreaterThan(0);
    expect(screen.getAllByText('30').length).toBeGreaterThan(0);
  });
});
