import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Cortador, CortadoresPagina as TipoPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CortadoresPagina } from './CortadoresPagina';

// Se controla la capa de datos: las pruebas no tocan la red.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useCortadores = vi.fn<() => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
vi.mock('@/api/cortadores', () => ({
  useCortadores: () => useCortadores(),
  useCrearCortador: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarCortador: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarCortador: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarCortador: () => ({ mutate: reactivarMutate, isPending: false }),
}));

/** Cortador de ejemplo. */
function cortador(id: number, nombre: string, activo = true): Cortador {
  return {
    id,
    nombre,
    precioReferencia: null,
    telefonos: null,
    activo,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Respuesta paginada de ejemplo con los cortadores dados. */
function pagina(datos: Cortador[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos" (forma minima que usa el componente). */
function consultaConDatos(datos: Cortador[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<CortadoresPagina>', () => {
  beforeEach(() => {
    useCortadores.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
  });

  it('lista los cortadores que devuelve el API', () => {
    useCortadores.mockReturnValue(
      consultaConDatos([cortador(1, 'Taller Pérez'), cortador(2, 'Corte Express')]),
    );
    renderConProveedores(<CortadoresPagina />, {
      sesion: estadoSesionDePrueba(['cortadores.ver', 'cortadores.administrar']),
    });

    expect(screen.getAllByTestId('fila-cortador')).toHaveLength(2);
    expect(screen.getByText('Taller Pérez')).toBeInTheDocument();
    expect(screen.getByText('Corte Express')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useCortadores.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<CortadoresPagina />, {
      sesion: estadoSesionDePrueba(['cortadores.ver', 'cortadores.administrar']),
    });

    expect(
      screen.getByText('No hay cortadores que coincidan con la búsqueda.'),
    ).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un boton de reintento cuando la consulta falla', () => {
    useCortadores.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<CortadoresPagina />, {
      sesion: estadoSesionDePrueba(['cortadores.ver', 'cortadores.administrar']),
    });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useCortadores.mockReturnValue(consultaConDatos([cortador(1, 'Taller Pérez')]));
    renderConProveedores(<CortadoresPagina />, {
      sesion: estadoSesionDePrueba(['cortadores.ver']),
    });

    expect(screen.queryByTestId('nuevo-cortador')).not.toBeInTheDocument();
    expect(screen.queryByTestId('acciones-cortador')).not.toBeInTheDocument();
  });

  it('pide confirmacion antes de desactivar y llama a la mutacion al confirmar', async () => {
    const usuario = userEvent.setup();
    useCortadores.mockReturnValue(consultaConDatos([cortador(7, 'Taller Viejo')]));
    renderConProveedores(<CortadoresPagina />, {
      sesion: estadoSesionDePrueba(['cortadores.ver', 'cortadores.administrar']),
    });

    await usuario.click(screen.getByTestId('acciones-cortador'));
    await usuario.click(await screen.findByTestId('desactivar-cortador'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar cortador')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('una fila inactiva ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useCortadores.mockReturnValue(consultaConDatos([cortador(9, 'Taller Apagado', false)]));
    renderConProveedores(<CortadoresPagina />, {
      sesion: estadoSesionDePrueba(['cortadores.ver', 'cortadores.administrar']),
    });

    const fila = screen.getByTestId('fila-cortador');
    expect(within(fila).getByText('Inactivo')).toBeInTheDocument();

    await usuario.click(within(fila).getByTestId('acciones-cortador'));
    expect(await screen.findByTestId('activar-cortador')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-cortador')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-cortador'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });
});
