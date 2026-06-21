import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { InventariosPagina } from './InventariosPagina';

describe('<InventariosPagina>', () => {
  it('muestra las tarjetas de PT solo con el permiso inventario-pt.ver', () => {
    renderConProveedores(<InventariosPagina />, {
      sesion: estadoSesionDePrueba(['inventario-pt.ver']),
    });

    // Existencias y Kardex de PT cuelgan de `inventario-pt.ver`.
    const existencias = screen.getByTestId('inventarios-inventario-existencias');
    expect(existencias).toBeInTheDocument();
    expect(existencias).toHaveAttribute('href', '/inventarios/existencias');
    expect(screen.getByTestId('inventarios-inventario-kardex')).toHaveAttribute(
      'href',
      '/inventarios/kardex',
    );

    // Sin permiso de mover PT, las capturas de PT no aparecen.
    expect(screen.queryByTestId('inventarios-inventario-movimientos')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inventarios-inventario-traspasos')).not.toBeInTheDocument();
    // Sin permiso de telas, las vistas de telas tampoco.
    expect(screen.queryByTestId('inventarios-inventario-telas-existencias')).not.toBeInTheDocument();
  });

  it('muestra la captura de movimientos PT con inventario-pt.mover', () => {
    renderConProveedores(<InventariosPagina />, {
      sesion: estadoSesionDePrueba(['inventario-pt.mover']),
    });

    expect(screen.getByTestId('inventarios-inventario-movimientos')).toHaveAttribute(
      'href',
      '/inventarios/movimientos',
    );
    expect(screen.getByTestId('inventarios-inventario-traspasos')).toHaveAttribute(
      'href',
      '/inventarios/traspasos',
    );
    // El permiso de mover NO da acceso a las consultas (.ver).
    expect(screen.queryByTestId('inventarios-inventario-existencias')).not.toBeInTheDocument();
  });

  it('muestra la existencia de telas solo con inventario-telas.ver', () => {
    renderConProveedores(<InventariosPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });

    expect(screen.getByTestId('inventarios-inventario-telas-existencias')).toHaveAttribute(
      'href',
      '/inventarios/telas/existencias',
    );
    expect(
      screen.queryByTestId('inventarios-inventario-avios-existencias'),
    ).not.toBeInTheDocument();
  });

  it('sin permisos de inventario no muestra ninguna tarjeta (solo el encabezado)', () => {
    renderConProveedores(<InventariosPagina />, { sesion: estadoSesionDePrueba([]) });

    expect(screen.queryByTestId('inventarios-inventario-existencias')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inventarios-inventario-telas-existencias')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inventarios' })).toBeInTheDocument();
  });
});
