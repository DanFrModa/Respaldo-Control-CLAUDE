import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { RutaCriticaPagina } from './RutaCriticaPagina';

describe('<RutaCriticaPagina>', () => {
  it('muestra la Bandeja de tareas solo con el permiso rc.ruta-ver', () => {
    renderConProveedores(<RutaCriticaPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });

    const tarjeta = screen.getByTestId('ruta-critica-rc-bandeja');
    expect(tarjeta).toBeInTheDocument();
    expect(tarjeta).toHaveAttribute('href', '/ruta-critica/bandeja');
    // Sin el permiso de catálogo, esas tarjetas no aparecen.
    expect(screen.queryByTestId('ruta-critica-rc-procesos')).not.toBeInTheDocument();
  });

  it('muestra las sub-vistas de catálogo solo con el permiso rc.catalogo-ver', () => {
    renderConProveedores(<RutaCriticaPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver']),
    });

    expect(screen.getByTestId('ruta-critica-rc-procesos')).toHaveAttribute(
      'href',
      '/ruta-critica/procesos',
    );
    expect(screen.getByTestId('ruta-critica-rc-dependencias')).toBeInTheDocument();
    expect(screen.getByTestId('ruta-critica-rc-plantillas')).toBeInTheDocument();
    expect(screen.getByTestId('ruta-critica-rc-reglas-duracion')).toBeInTheDocument();
    // Sin rc.ruta-ver, la bandeja no aparece.
    expect(screen.queryByTestId('ruta-critica-rc-bandeja')).not.toBeInTheDocument();
  });

  it('sin permisos de RC no muestra ninguna tarjeta, pero sí el encabezado', () => {
    renderConProveedores(<RutaCriticaPagina />, { sesion: estadoSesionDePrueba([]) });

    expect(screen.queryByTestId('ruta-critica-rc-bandeja')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ruta-critica-rc-procesos')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ruta Crítica' })).toBeInTheDocument();
  });
});
