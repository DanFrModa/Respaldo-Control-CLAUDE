import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ExistenciasAvio } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExistenciasAviosPagina } from './ExistenciasAviosPagina';

const existencias: ExistenciasAvio = {
  filas: [
    {
      idAvio: 1,
      avio: 'CIE-01',
      descripcion: 'Cierre 20cm',
      unidad: 'pza',
      esGenerico: false,
      idAlmacen: 5,
      almacen: 'Bodega A',
      existencia: 500,
    },
    {
      idAvio: 2,
      avio: 'HIL-01',
      descripcion: 'Hilo blanco',
      unidad: 'cono',
      esGenerico: true,
      idAlmacen: 5,
      almacen: 'Bodega A',
      existencia: 1000,
    },
  ],
  totalExistencia: 1500,
};

vi.mock('@/api/inventario-materiales', () => ({
  useExistenciasAvio: () => ({ data: existencias, isPending: false, isError: false, error: null }),
}));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));

describe('ExistenciasAviosPagina (F4-E1)', () => {
  it('muestra existencias multi-almacén con tabla (escritorio) y tarjetas (móvil)', () => {
    renderConProveedores(<ExistenciasAviosPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.ver']),
    });
    expect(screen.getByText(/Total:/)).toBeInTheDocument();
    expect(screen.getByTestId('avios-tabla')).toBeInTheDocument();
    expect(screen.getByTestId('avios-tarjetas')).toBeInTheDocument();
    expect(screen.getAllByText('CIE-01').length).toBeGreaterThan(0);
  });

  it('distingue los avíos genéricos (R4) con su badge', () => {
    renderConProveedores(<ExistenciasAviosPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.ver']),
    });
    // El badge "Genérico" aparece (tabla + tarjeta) para el avío genérico.
    expect(screen.getAllByText('Genérico').length).toBeGreaterThan(0);
  });

  it('tiene el filtro "solo genéricos"', () => {
    renderConProveedores(<ExistenciasAviosPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.ver']),
    });
    expect(screen.getByTestId('avios-genericos')).toBeInTheDocument();
  });
});
