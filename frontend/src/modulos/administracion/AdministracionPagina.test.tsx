import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { AdministracionPagina } from './AdministracionPagina';

describe('<AdministracionPagina>', () => {
  it('muestra la tarjeta de Usuarios solo con el permiso usuarios.administrar', () => {
    renderConProveedores(<AdministracionPagina />, {
      sesion: estadoSesionDePrueba(['usuarios.administrar']),
    });

    const tarjeta = screen.getByTestId('administracion-usuarios');
    expect(tarjeta).toBeInTheDocument();
    expect(tarjeta).toHaveAttribute('href', '/administracion/usuarios');
    // Sin permiso de empresas, esa tarjeta-enlace no aparece.
    expect(screen.queryByTestId('administracion-empresas')).not.toBeInTheDocument();
  });

  it('muestra la tarjeta de Empresas solo con el permiso empresas.administrar', () => {
    renderConProveedores(<AdministracionPagina />, {
      sesion: estadoSesionDePrueba(['empresas.administrar']),
    });

    expect(screen.getByTestId('administracion-empresas')).toHaveAttribute(
      'href',
      '/administracion/empresas',
    );
    expect(screen.queryByTestId('administracion-usuarios')).not.toBeInTheDocument();
  });

  it('sin permisos administrativos no muestra ninguna sección construida', () => {
    renderConProveedores(<AdministracionPagina />, { sesion: estadoSesionDePrueba([]) });

    expect(screen.queryByTestId('administracion-usuarios')).not.toBeInTheDocument();
    expect(screen.queryByTestId('administracion-empresas')).not.toBeInTheDocument();
    // El encabezado y los "Próximamente" sí están siempre.
    expect(screen.getByRole('heading', { name: 'Administración' })).toBeInTheDocument();
    expect(screen.getAllByText('Próximamente').length).toBeGreaterThan(0);
  });
});
