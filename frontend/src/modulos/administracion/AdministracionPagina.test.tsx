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

  it('muestra la tarjeta de Roles y permisos con el permiso roles.administrar', () => {
    renderConProveedores(<AdministracionPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    expect(screen.getByTestId('administracion-roles')).toHaveAttribute(
      'href',
      '/administracion/roles',
    );
    expect(screen.queryByTestId('administracion-usuarios')).not.toBeInTheDocument();
  });

  it('sin permisos administrativos no muestra ninguna sección construida', () => {
    renderConProveedores(<AdministracionPagina />, { sesion: estadoSesionDePrueba([]) });

    expect(screen.queryByTestId('administracion-usuarios')).not.toBeInTheDocument();
    expect(screen.queryByTestId('administracion-empresas')).not.toBeInTheDocument();
    expect(screen.queryByTestId('administracion-roles')).not.toBeInTheDocument();
    // El encabezado está siempre; ya no hay secciones "Próximamente".
    expect(screen.getByRole('heading', { name: 'Administración' })).toBeInTheDocument();
    expect(screen.queryByText('Próximamente')).not.toBeInTheDocument();
  });
});
