import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Temporada, TemporadasPagina as TipoPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TemporadasPagina } from './TemporadasPagina';

// Se controla la capa de datos: las pruebas no tocan la red.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useTemporadas = vi.fn<() => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
vi.mock('@/api/temporadas', () => ({
  useTemporadas: () => useTemporadas(),
  useCrearTemporada: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarTemporada: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarTemporada: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarTemporada: () => ({ mutate: reactivarMutate, isPending: false }),
}));

/** Temporada de ejemplo. */
function temporada(id: number, nombre: string, activo = true): Temporada {
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

/** Respuesta paginada de ejemplo con las temporadas dadas. */
function pagina(datos: Temporada[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos" (forma minima que usa el componente). */
function consultaConDatos(datos: Temporada[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<TemporadasPagina>', () => {
  beforeEach(() => {
    useTemporadas.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
  });

  it('lista las temporadas que devuelve el API', () => {
    useTemporadas.mockReturnValue(
      consultaConDatos([temporada(1, 'Primavera 2026'), temporada(2, 'Otoño 2026')]),
    );
    renderConProveedores(<TemporadasPagina />, {
      sesion: estadoSesionDePrueba(['temporadas.ver', 'temporadas.administrar']),
    });

    expect(screen.getAllByTestId('fila-temporada')).toHaveLength(2);
    expect(screen.getByText('Primavera 2026')).toBeInTheDocument();
    expect(screen.getByText('Otoño 2026')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useTemporadas.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<TemporadasPagina />, {
      sesion: estadoSesionDePrueba(['temporadas.ver', 'temporadas.administrar']),
    });

    expect(
      screen.getByText('No hay temporadas que coincidan con la búsqueda.'),
    ).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un boton de reintento cuando la consulta falla', () => {
    useTemporadas.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<TemporadasPagina />, {
      sesion: estadoSesionDePrueba(['temporadas.ver', 'temporadas.administrar']),
    });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useTemporadas.mockReturnValue(consultaConDatos([temporada(1, 'Primavera 2026')]));
    renderConProveedores(<TemporadasPagina />, {
      sesion: estadoSesionDePrueba(['temporadas.ver']),
    });

    expect(screen.queryByTestId('nueva-temporada')).not.toBeInTheDocument();
    expect(screen.queryByTestId('acciones-temporada')).not.toBeInTheDocument();
  });

  it('pide confirmacion antes de desactivar y llama a la mutacion al confirmar', async () => {
    const usuario = userEvent.setup();
    useTemporadas.mockReturnValue(consultaConDatos([temporada(7, 'Temporada Vieja')]));
    renderConProveedores(<TemporadasPagina />, {
      sesion: estadoSesionDePrueba(['temporadas.ver', 'temporadas.administrar']),
    });

    await usuario.click(screen.getByTestId('acciones-temporada'));
    await usuario.click(await screen.findByTestId('desactivar-temporada'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar temporada')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('una fila inactiva ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useTemporadas.mockReturnValue(consultaConDatos([temporada(9, 'Temporada Apagada', false)]));
    renderConProveedores(<TemporadasPagina />, {
      sesion: estadoSesionDePrueba(['temporadas.ver', 'temporadas.administrar']),
    });

    const fila = screen.getByTestId('fila-temporada');
    expect(within(fila).getByText('Inactivo')).toBeInTheDocument();

    await usuario.click(within(fila).getByTestId('acciones-temporada'));
    expect(await screen.findByTestId('activar-temporada')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-temporada')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-temporada'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });
});
