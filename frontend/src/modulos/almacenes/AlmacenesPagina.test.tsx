import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Almacen, AlmacenesPagina as TipoPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { AlmacenesPagina } from './AlmacenesPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `useAlmacenes`
// devuelve una forma minima de `UseQueryResult` (solo lo que el componente lee).
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useAlmacenes = vi.fn<() => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => useAlmacenes(),
  useCrearAlmacen: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarAlmacen: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarAlmacen: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarAlmacen: () => ({ mutate: reactivarMutate, isPending: false }),
}));

/** Almacen de ejemplo. */
function almacen(id: number, nombre: string, activo = true): Almacen {
  return {
    id,
    nombre,
    tipo: 'PT',
    activo,
    idEmpresa: 1,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Respuesta paginada de ejemplo con los almacenes dados. */
function pagina(datos: Almacen[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos" (forma minima que usa el componente). */
function consultaConDatos(datos: Almacen[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<AlmacenesPagina>', () => {
  beforeEach(() => {
    useAlmacenes.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
  });

  it('lista los almacenes que devuelve el API', () => {
    useAlmacenes.mockReturnValue(
      consultaConDatos([almacen(1, 'Bodega Central'), almacen(2, 'Telas')]),
    );
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver', 'almacenes.administrar']),
    });

    const filas = screen.getAllByTestId('fila-almacen');
    expect(filas).toHaveLength(2);
    expect(screen.getByText('Bodega Central')).toBeInTheDocument();
    expect(screen.getByText('Telas')).toBeInTheDocument();
  });

  it('muestra el boton "Nuevo almacén" y abre el dialogo de alta con permiso de administrar', async () => {
    const usuario = userEvent.setup();
    useAlmacenes.mockReturnValue(consultaConDatos([almacen(1, 'Bodega Central')]));
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver', 'almacenes.administrar']),
    });

    await usuario.click(screen.getByTestId('nuevo-almacen'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Nuevo almacén')).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Nombre')).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useAlmacenes.mockReturnValue(consultaConDatos([almacen(1, 'Bodega Central')]));
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver']),
    });

    expect(screen.queryByTestId('nuevo-almacen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('acciones-almacen')).not.toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useAlmacenes.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver', 'almacenes.administrar']),
    });

    expect(screen.getByText('No hay almacenes que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un boton de reintento cuando la consulta falla', () => {
    useAlmacenes.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver', 'almacenes.administrar']),
    });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('pide confirmacion antes de desactivar y llama a la mutacion al confirmar', async () => {
    const usuario = userEvent.setup();
    useAlmacenes.mockReturnValue(consultaConDatos([almacen(7, 'Bodega Vieja')]));
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver', 'almacenes.administrar']),
    });

    await usuario.click(screen.getByTestId('acciones-almacen'));
    await usuario.click(await screen.findByTestId('desactivar-almacen'));

    // Aparece el dialogo de confirmacion con el nombre del almacen.
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar almacén')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('un almacén inactivo se ve con badge "Inactivo" y ofrece Activar (no Desactivar)', async () => {
    const usuario = userEvent.setup();
    useAlmacenes.mockReturnValue(consultaConDatos([almacen(9, 'Bodega Apagada', false)]));
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver', 'almacenes.administrar']),
    });

    const fila = screen.getByTestId('fila-almacen');
    expect(within(fila).getByText('Inactivo')).toBeInTheDocument();

    await usuario.click(within(fila).getByTestId('acciones-almacen'));
    // La fila inactiva ofrece Activar, no Desactivar.
    expect(await screen.findByTestId('activar-almacen')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-almacen')).not.toBeInTheDocument();
  });

  it('reactiva directamente (sin confirmación) y llama a la mutación', async () => {
    const usuario = userEvent.setup();
    useAlmacenes.mockReturnValue(consultaConDatos([almacen(9, 'Bodega Apagada', false)]));
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver', 'almacenes.administrar']),
    });

    await usuario.click(screen.getByTestId('acciones-almacen'));
    await usuario.click(await screen.findByTestId('activar-almacen'));

    // Reactivar es no destructivo: NO abre diálogo de confirmación.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });
});
