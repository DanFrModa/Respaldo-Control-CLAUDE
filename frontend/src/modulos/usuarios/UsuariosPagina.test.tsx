import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorDeApi } from '@/api/errores';
import type { Rol, Usuario, UsuariosPagina as TipoPagina } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { UsuariosPagina } from './UsuariosPagina';

// Se controla la capa de datos: las pruebas no tocan la red.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useUsuarios = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
const desbloquearMutate = vi.fn();
const crearMutate = vi.fn();

vi.mock('@/api/usuarios', () => ({
  useUsuarios: (query: Record<string, unknown>) => useUsuarios(query),
  useCrearUsuario: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarUsuario: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarUsuario: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarUsuario: () => ({ mutate: reactivarMutate, isPending: false }),
  useDesbloquearUsuario: () => ({ mutate: desbloquearMutate, isPending: false }),
  useCambiarContrasena: () => ({ mutate: vi.fn(), isPending: false }),
}));

// El selector de roles consulta `useRoles`; se controla con una lista fija.
const useRoles = vi.fn<() => { data: Rol[]; isPending: boolean; isError: boolean; error: null }>();
vi.mock('@/api/roles', () => ({
  useRoles: () => useRoles(),
}));

/** Rol de ejemplo. */
function rol(id: number, nombre: string): Rol {
  return {
    id,
    nombre,
    descripcion: `Rol ${nombre}`,
    esSistema: false,
    clavesPermisos: [],
    totalUsuarios: 0,
  };
}

/** Usuario de ejemplo. */
function usuario(id: string, username: string, sobre: Partial<Usuario> = {}): Usuario {
  return {
    id,
    username,
    nombre: `Nombre de ${username}`,
    email: `${username}@control.local`,
    activo: true,
    bloqueado: false,
    intentosFallidos: 0,
    esAuditor: false,
    creadoEn: '2026-01-01T00:00:00.000Z',
    modificadoEn: '2026-01-01T00:00:00.000Z',
    roles: [],
    ...sobre,
  };
}

/** Respuesta paginada de ejemplo. */
function pagina(datos: Usuario[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos". */
function consultaConDatos(datos: Usuario[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

const ADMIN = ['usuarios.administrar'] as const;

describe('<UsuariosPagina>', () => {
  beforeEach(() => {
    useUsuarios.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
    desbloquearMutate.mockReset();
    crearMutate.mockReset();
    useRoles.mockReset();
    useRoles.mockReturnValue({
      data: [rol(1, 'Administrador'), rol(2, 'Básico')],
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it('lista los usuarios que devuelve el API', () => {
    useUsuarios.mockReturnValue(consultaConDatos([usuario('u1', 'admin'), usuario('u2', 'ana')]));
    renderConProveedores(<UsuariosPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    expect(screen.getAllByTestId('fila-usuario')).toHaveLength(2);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('ana')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useUsuarios.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<UsuariosPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    expect(screen.getByText('No hay usuarios que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un boton de reintento cuando la consulta falla', () => {
    useUsuarios.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<UsuariosPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien no puede administrar', () => {
    useUsuarios.mockReturnValue(consultaConDatos([usuario('u1', 'admin')]));
    // Sesion sin `usuarios.administrar`.
    renderConProveedores(<UsuariosPagina />, { sesion: estadoSesionDePrueba([]) });

    expect(screen.queryByTestId('nuevo-usuario')).not.toBeInTheDocument();
    expect(screen.queryByTestId('acciones-usuario')).not.toBeInTheDocument();
  });

  it('pide confirmacion antes de desactivar y llama a la mutacion al confirmar', async () => {
    const u = userEvent.setup();
    useUsuarios.mockReturnValue(consultaConDatos([usuario('u7', 'pedro')]));
    renderConProveedores(<UsuariosPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    await u.click(screen.getByTestId('acciones-usuario'));
    await u.click(await screen.findByTestId('desactivar-usuario'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar usuario')).toBeInTheDocument();

    await u.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith('u7', expect.anything());
  });

  it('una fila inactiva ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const u = userEvent.setup();
    useUsuarios.mockReturnValue(consultaConDatos([usuario('u9', 'apagado', { activo: false })]));
    renderConProveedores(<UsuariosPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    const fila = screen.getByTestId('fila-usuario');
    expect(within(fila).getByText('Inactivo')).toBeInTheDocument();

    await u.click(within(fila).getByTestId('acciones-usuario'));
    await u.click(await screen.findByTestId('activar-usuario'));

    // Reactivar es no destructivo: NO abre diálogo.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith('u9', expect.anything());
  });

  it('un usuario bloqueado ofrece Desbloquear y lo aplica directo', async () => {
    const u = userEvent.setup();
    useUsuarios.mockReturnValue(
      consultaConDatos([usuario('u3', 'trabado', { bloqueado: true, intentosFallidos: 5 })]),
    );
    renderConProveedores(<UsuariosPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    const fila = screen.getByTestId('fila-usuario');
    expect(within(fila).getByText('Bloqueado')).toBeInTheDocument();

    await u.click(within(fila).getByTestId('acciones-usuario'));
    await u.click(await screen.findByTestId('desbloquear-usuario'));

    expect(desbloquearMutate).toHaveBeenCalledWith('u3', expect.anything());
  });

  it('el alta muestra el selector de roles y crea con los roles marcados', async () => {
    const u = userEvent.setup();
    useUsuarios.mockReturnValue(consultaConDatos([usuario('u1', 'admin')]));
    renderConProveedores(<UsuariosPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    await u.click(screen.getByTestId('nuevo-usuario'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Nuevo usuario')).toBeInTheDocument();

    // El selector de roles lista las opciones del API.
    expect(within(dialogo).getByTestId('selector-roles')).toBeInTheDocument();
    expect(within(dialogo).getByText('Administrador')).toBeInTheDocument();

    await u.type(within(dialogo).getByLabelText('Usuario'), 'nuevo');
    await u.type(within(dialogo).getByLabelText('Nombre'), 'Persona Nueva');
    await u.type(within(dialogo).getByLabelText('Contraseña'), 'secreto-largo');
    // Marca el rol "Básico" (id 2).
    await u.click(within(dialogo).getByTestId('rol-opcion-2'));

    await u.click(screen.getByTestId('guardar-usuario'));

    expect(crearMutate).toHaveBeenCalledTimes(1);
    const [cuerpo] = crearMutate.mock.calls[0] as [
      { username: string; idsRoles: number[]; password: string },
    ];
    expect(cuerpo.username).toBe('nuevo');
    expect(cuerpo.idsRoles).toEqual([2]);
  });

  it('abre el diálogo de cambio de contraseña desde las acciones de fila', async () => {
    const u = userEvent.setup();
    useUsuarios.mockReturnValue(consultaConDatos([usuario('u4', 'cambia')]));
    renderConProveedores(<UsuariosPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    await u.click(screen.getByTestId('acciones-usuario'));
    await u.click(await screen.findByTestId('contrasena-usuario'));

    const dialogo = await screen.findByRole('dialog');
    expect(
      within(dialogo).getByRole('heading', { name: 'Cambiar contraseña' }),
    ).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Nueva contraseña')).toBeInTheDocument();
  });
});
