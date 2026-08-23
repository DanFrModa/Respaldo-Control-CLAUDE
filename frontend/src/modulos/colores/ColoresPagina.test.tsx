import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Color, ColoresPagina as TipoPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ColoresPagina } from './ColoresPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `crear` invoca el
// callback de exito para poder probar la "alta rapida encadenada".
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useColores = vi.fn<() => EstadoConsulta>();
const crearMutate = vi.fn();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
vi.mock('@/api/colores', () => ({
  useColores: () => useColores(),
  useCrearColor: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarColor: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarColor: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarColor: () => ({ mutate: reactivarMutate, isPending: false }),
  useFusionarColores: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Color de ejemplo. */
function color(id: number, nombre: string, activo = true): Color {
  return {
    id,
    nombre,
    activo,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Respuesta paginada de ejemplo con los colores dados. */
function pagina(datos: Color[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos" (forma minima que usa el componente). */
function consultaConDatos(datos: Color[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<ColoresPagina>', () => {
  beforeEach(() => {
    useColores.mockReset();
    crearMutate.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
  });

  it('lista los colores que devuelve el API', () => {
    useColores.mockReturnValue(consultaConDatos([color(1, 'Rojo'), color(2, 'Azul')]));
    renderConProveedores(<ColoresPagina />, {
      sesion: estadoSesionDePrueba(['colores.ver', 'colores.administrar']),
    });

    // Tabla-first (proto vCat): dos renglones, cada color una vez en la tabla.
    expect(screen.getAllByTestId('fila-color')).toHaveLength(2);
    expect(screen.getByText('Rojo')).toBeInTheDocument();
    expect(screen.getByText('Azul')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useColores.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<ColoresPagina />, {
      sesion: estadoSesionDePrueba(['colores.ver', 'colores.administrar']),
    });

    expect(screen.getByText('No hay colores que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un boton de reintento cuando la consulta falla', () => {
    useColores.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<ColoresPagina />, {
      sesion: estadoSesionDePrueba(['colores.ver', 'colores.administrar']),
    });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useColores.mockReturnValue(consultaConDatos([color(1, 'Rojo')]));
    renderConProveedores(<ColoresPagina />, {
      sesion: estadoSesionDePrueba(['colores.ver']),
    });

    expect(screen.queryByTestId('nuevo-color')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-color')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-color')).not.toBeInTheDocument();
    expect(screen.queryByTestId('abrir-fusion-colores')).not.toBeInTheDocument();
  });

  it('ofrece la acción Fusionar a quien administra y abre el diálogo', async () => {
    const usuario = userEvent.setup();
    useColores.mockReturnValue(consultaConDatos([color(1, 'Rojo'), color(2, 'Rojo Vino')]));
    renderConProveedores(<ColoresPagina />, {
      sesion: estadoSesionDePrueba(['colores.ver', 'colores.administrar']),
    });

    await usuario.click(screen.getByTestId('abrir-fusion-colores'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Fusionar colores duplicados')).toBeInTheDocument();
  });

  it('pide confirmacion antes de desactivar y llama a la mutacion al confirmar', async () => {
    const usuario = userEvent.setup();
    useColores.mockReturnValue(consultaConDatos([color(7, 'Verde Viejo')]));
    renderConProveedores(<ColoresPagina />, {
      sesion: estadoSesionDePrueba(['colores.ver', 'colores.administrar']),
    });

    // Tabla-first: "Desactivar" es un botón inline del renglón.
    await usuario.click(screen.getByTestId('desactivar-color'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar color')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('un color inactivo ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useColores.mockReturnValue(consultaConDatos([color(9, 'Gris Apagado', false)]));
    renderConProveedores(<ColoresPagina />, {
      sesion: estadoSesionDePrueba(['colores.ver', 'colores.administrar']),
    });

    // Tabla-first: el renglón inactivo muestra el estado "Inactivo" y ofrece "Activar" inline.
    const fila = screen.getByTestId('fila-color');
    expect(within(fila).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByTestId('activar-color')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-color')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-color'));
    // Reactivar es no destructivo: NO abre diálogo de confirmación.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  it('alta rápida encadenada: tras guardar, el diálogo sigue abierto y el campo se limpia', async () => {
    const usuario = userEvent.setup();
    // El alta exitosa invoca el onSuccess para que el dialogo limpie y mantenga foco.
    crearMutate.mockImplementation(
      (cuerpo: { nombre: string }, opciones?: { onSuccess?: (color: Color) => void }) => {
        opciones?.onSuccess?.(color(1, cuerpo.nombre));
      },
    );
    useColores.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<ColoresPagina />, {
      sesion: estadoSesionDePrueba(['colores.ver', 'colores.administrar']),
    });

    await usuario.click(screen.getByTestId('nuevo-color'));
    const dialogo = await screen.findByRole('dialog');
    const campo = within(dialogo).getByLabelText(/^Nombre/);

    await usuario.type(campo, 'Rojo');
    await usuario.click(screen.getByTestId('guardar-color'));

    expect(crearMutate).toHaveBeenCalledTimes(1);
    expect(crearMutate.mock.calls[0]?.[0]).toEqual({ nombre: 'Rojo' });

    // El dialogo NO se cierra y el campo queda vacio para el siguiente color.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(within(dialogo).getByLabelText(/^Nombre/)).toHaveValue(''));

    // Se puede capturar otro color de corrido.
    await usuario.type(within(dialogo).getByLabelText(/^Nombre/), 'Azul');
    await usuario.click(screen.getByTestId('guardar-color'));
    expect(crearMutate).toHaveBeenCalledTimes(2);
    expect(crearMutate.mock.calls[1]?.[0]).toEqual({ nombre: 'Azul' });

    // "Listo" cierra el dialogo.
    await usuario.click(screen.getByTestId('listo-color'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
