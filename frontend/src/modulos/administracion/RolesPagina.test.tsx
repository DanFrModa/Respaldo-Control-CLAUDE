import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogoPermisos } from '@/api/roles';
import type { ErrorDeApi } from '@/api/errores';
import type { Rol } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { RolesPagina } from './RolesPagina';

type EstadoRoles = {
  data: Rol[] | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
type EstadoCatalogo = {
  data: CatalogoPermisos | undefined;
  isPending: boolean;
  isError: boolean;
  error: ErrorDeApi | null;
};

const useRoles = vi.fn<() => EstadoRoles>();
const usePermisosCatalogo = vi.fn<() => EstadoCatalogo>();
const asignarMutate = vi.fn();
const eliminarMutate = vi.fn();

vi.mock('@/api/roles', () => ({
  useRoles: () => useRoles(),
  usePermisosCatalogo: () => usePermisosCatalogo(),
  useAsignarPermisos: () => ({ mutate: asignarMutate, isPending: false }),
  useEliminarRol: () => ({ mutate: eliminarMutate, isPending: false }),
  useCrearRol: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarRol: () => ({ mutate: vi.fn(), isPending: false }),
}));

function rol(
  id: number,
  nombre: string,
  esSistema: boolean,
  totalUsuarios: number,
  clavesPermisos: string[],
): Rol {
  return { id, nombre, descripcion: `Rol ${nombre}`, esSistema, clavesPermisos, totalUsuarios };
}

const CATALOGO: CatalogoPermisos = [
  {
    modulo: 'almacenes',
    etiqueta: 'Almacenes',
    permisos: [
      { clave: 'almacenes.ver', descripcion: 'Ver almacenes', modulo: 'almacenes', apagado: false },
      {
        clave: 'almacenes.administrar',
        descripcion: 'Administrar almacenes',
        modulo: 'almacenes',
        apagado: false,
      },
    ],
  },
  {
    modulo: 'roles',
    etiqueta: 'Administración de roles',
    permisos: [
      {
        clave: 'roles.administrar',
        descripcion: 'Administrar roles',
        modulo: 'roles',
        apagado: false,
      },
    ],
  },
  // ⭐ V1-E3t: un módulo APAGADO (la Ruta Crítica). El árbol lo lista pero no lo deja marcar.
  {
    modulo: 'rc',
    etiqueta: 'Ruta Crítica',
    permisos: [
      { clave: 'rc.ruta-ver', descripcion: 'Consultar la Ruta Crítica', modulo: 'rc', apagado: true },
    ],
  },
];

function estadoRoles(datos: Rol[]): EstadoRoles {
  return {
    data: datos,
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

function estadoCatalogo(): EstadoCatalogo {
  return { data: CATALOGO, isPending: false, isError: false, error: null };
}

describe('<RolesPagina>', () => {
  beforeEach(() => {
    useRoles.mockReset();
    usePermisosCatalogo.mockReset();
    asignarMutate.mockReset();
    eliminarMutate.mockReset();
    usePermisosCatalogo.mockReturnValue(estadoCatalogo());
  });

  /** Abre el cajón de detalle del primer renglón. */
  function abrirPrimero(): void {
    fireEvent.click(screen.getAllByTestId('fila-rol')[0] as HTMLElement);
  }

  it('lista los roles con badge "Sistema" y conteo de usuarios', () => {
    useRoles.mockReturnValue(
      estadoRoles([
        rol(1, 'Administrador', true, 2, ['roles.administrar']),
        rol(2, 'Almacenista', false, 0, ['almacenes.ver']),
      ]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    expect(screen.getAllByTestId('fila-rol')).toHaveLength(2);
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    // Tabla-first: al abrir el cajón, su TÍTULO trae Sistema + conteo de usuarios.
    abrirPrimero();
    const cajon = screen.getByTestId('detalle-rol').closest('[data-slot="cajon-detalle"]');
    expect(cajon).not.toBeNull();
    expect(within(cajon as HTMLElement).getByText('Sistema')).toBeInTheDocument();
    expect(within(cajon as HTMLElement).getByText(/2 usuarios/)).toBeInTheDocument();
  });

  it('muestra el árbol de permisos con lo del rol ya marcado', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(1, 'Administrador', true, 2, ['roles.administrar'])]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    expect(screen.getAllByTestId('grupo-permisos')).toHaveLength(3);
    expect(screen.getAllByTestId('permiso-checkbox')).toHaveLength(4);
    // El rol NO tiene almacenes.ver pero SÍ roles.administrar.
    expect(screen.getByRole('checkbox', { name: /almacenes\.ver/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /roles\.administrar/ })).toBeChecked();
    // Sin cambios, Guardar arranca deshabilitado.
    expect(screen.getByTestId('guardar-permisos')).toBeDisabled();
  });

  // ⭐ V1-E3t (§Post-F9.36 punto 1): el árbol NO puede ofrecer permisos de un módulo apagado —
  // la sesión los descarta, así que marcarlos no haría nada y la pantalla estaría mintiendo.
  it('deshabilita los permisos de un módulo APAGADO y lo rotula', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(1, 'Administrador', true, 2, ['roles.administrar'])]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    expect(screen.getByRole('checkbox', { name: /rc\.ruta-ver/ })).toBeDisabled();
    // Los de un módulo encendido siguen marcables (la pantalla no se apagó entera).
    expect(screen.getByRole('checkbox', { name: /almacenes\.ver/ })).toBeEnabled();
    expect(screen.getByTestId('modulo-apagado')).toHaveTextContent(
      'Módulo apagado en esta versión',
    );
  });

  it('marcar un permiso habilita Guardar y lo envía como reemplazo', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(1, 'Administrador', true, 2, ['roles.administrar'])]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    fireEvent.click(screen.getByRole('checkbox', { name: /almacenes\.ver/ })); // marca almacenes.ver

    const guardar = screen.getByTestId('guardar-permisos');
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);

    expect(asignarMutate).toHaveBeenCalledTimes(1);
    const arg = asignarMutate.mock.calls[0]?.[0] as { id: number; clavesPermisos: string[] };
    expect(arg.id).toBe(1);
    expect(arg.clavesPermisos).toEqual(
      expect.arrayContaining(['roles.administrar', 'almacenes.ver']),
    );
    expect(arg.clavesPermisos).toHaveLength(2);
  });

  it('un rol de SISTEMA no se puede eliminar (botón deshabilitado)', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(1, 'Administrador', true, 2, ['roles.administrar'])]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    // Editar/Eliminar viven en el encabezado del cajón (acciones).
    expect(screen.getByTestId('eliminar-rol')).toBeDisabled();
    // Editar sí está disponible (se puede editar su descripción y permisos).
    expect(screen.getByTestId('editar-rol')).toBeEnabled();
  });

  it('un rol propio sin usuarios sí se puede eliminar', () => {
    useRoles.mockReturnValue(estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver'])]));
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    expect(screen.getByTestId('eliminar-rol')).toBeEnabled();
  });

  it('un rol con usuarios asignados no se puede eliminar', () => {
    useRoles.mockReturnValue(estadoRoles([rol(2, 'Ventas', false, 3, ['almacenes.ver'])]));
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    expect(screen.getByTestId('eliminar-rol')).toBeDisabled();
  });

  it('sin roles.administrar los checkboxes van deshabilitados y no hay Guardar', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(1, 'Administrador', true, 2, ['roles.administrar'])]),
    );
    renderConProveedores(<RolesPagina />, { sesion: estadoSesionDePrueba([]) });

    abrirPrimero();
    expect(screen.getByRole('checkbox', { name: /almacenes\.ver/ })).toBeDisabled();
    expect(screen.queryByTestId('guardar-permisos')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nuevo-rol')).not.toBeInTheDocument();
  });
});
