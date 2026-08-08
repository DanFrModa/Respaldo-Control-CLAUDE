import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Almacen, AlmacenesPagina as TipoPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { AlmacenesPagina } from './AlmacenesPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `useAlmacenes`
// captura la query con la que se le llama, para verificar el filtro por tipo.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useAlmacenes = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useAlmacenes(query);
  },
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
    idCortador: null,
    cortador: null,
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
    ultimaQuery = undefined;
  });

  it('lista los almacenes que devuelve el API', () => {
    useAlmacenes.mockReturnValue(
      consultaConDatos([almacen(1, 'Bodega Central'), almacen(2, 'Telas')]),
    );
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver', 'almacenes.administrar']),
    });

    // Hay dos renglones; el primero queda auto-seleccionado (aparece tambien en
    // el detalle), por eso su nombre se busca con getAllByText. El nombre del
    // segundo se busca dentro de su fila (evita chocar con la opción "Telas" del
    // filtro de tipo, que tambien dice "Telas").
    const filas = screen.getAllByTestId('fila-almacen');
    expect(filas).toHaveLength(2);
    expect(screen.getAllByText('Bodega Central').length).toBeGreaterThan(0);
    expect(within(filas[1] as HTMLElement).getByText('Telas')).toBeInTheDocument();
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
    expect(within(dialogo).getByLabelText(/^Nombre/)).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useAlmacenes.mockReturnValue(consultaConDatos([almacen(1, 'Bodega Central')]));
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver']),
    });

    // Ni el boton "Nuevo", ni las acciones del detalle (editar/desactivar).
    expect(screen.queryByTestId('nuevo-almacen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-almacen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-almacen')).not.toBeInTheDocument();
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

    // El registro queda auto-seleccionado: "Desactivar" es un boton directo del detalle.
    await usuario.click(screen.getByTestId('desactivar-almacen'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar almacén')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('un almacén inactivo ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useAlmacenes.mockReturnValue(consultaConDatos([almacen(9, 'Bodega Apagada', false)]));
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver', 'almacenes.administrar']),
    });

    // Tabla-first: el renglón inactivo muestra "Inactivo" y ofrece "Activar" inline.
    const fila = screen.getByTestId('fila-almacen');
    expect(within(fila).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByTestId('activar-almacen')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-almacen')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-almacen'));
    // Reactivar es no destructivo: NO abre diálogo de confirmación.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  it('el filtro por tipo se refleja en la consulta del API', async () => {
    const usuario = userEvent.setup();
    useAlmacenes.mockReturnValue(consultaConDatos([almacen(1, 'Bodega Central')]));
    renderConProveedores(<AlmacenesPagina />, {
      sesion: estadoSesionDePrueba(['almacenes.ver']),
    });

    // Sin filtro, la query no lleva `tipo` (todos los tipos).
    expect(ultimaQuery?.tipo).toBeUndefined();

    await usuario.selectOptions(screen.getByTestId('filtro-tipo-almacen'), 'TELA');

    // Tras elegir un tipo, la siguiente consulta lo incluye.
    expect(ultimaQuery?.tipo).toBe('TELA');
  });
});
