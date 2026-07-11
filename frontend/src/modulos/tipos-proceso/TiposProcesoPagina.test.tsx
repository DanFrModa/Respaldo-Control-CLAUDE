import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TipoProceso, TiposProcesoPagina as TipoPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TiposProcesoPagina } from './TiposProcesoPagina';

type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useTiposProceso = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
vi.mock('@/api/tipos-proceso', () => ({
  useTiposProceso: (query: Record<string, unknown>) => useTiposProceso(query),
  useCrearTipoProceso: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarTipoProceso: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarTipoProceso: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarTipoProceso: () => ({ mutate: reactivarMutate, isPending: false }),
}));

function tipoProceso(
  id: number,
  codigo: string,
  nombre: string,
  generaEntradaPt = false,
  activo = true,
): TipoProceso {
  return {
    id,
    codigo,
    nombre,
    generaEntradaPt,
    activo,
    creadoEn: '2026-06-17T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-06-17T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function pagina(datos: TipoProceso[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

function consultaConDatos(datos: TipoProceso[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<TiposProcesoPagina>', () => {
  beforeEach(() => {
    useTiposProceso.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
  });

  it('lista los tipos de proceso que devuelve el API', () => {
    useTiposProceso.mockReturnValue(
      consultaConDatos([
        tipoProceso(1, 'costura', 'Costura', true),
        tipoProceso(2, 'lavado', 'Lavado'),
      ]),
    );
    renderConProveedores(<TiposProcesoPagina />, {
      sesion: estadoSesionDePrueba(['tipos-proceso.ver', 'tipos-proceso.administrar']),
    });

    const filas = screen.getAllByTestId('fila-tipo-proceso');
    expect(filas).toHaveLength(2);
    expect(screen.getAllByText('Costura').length).toBeGreaterThan(0);
    expect(within(filas[1] as HTMLElement).getByText('Lavado')).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useTiposProceso.mockReturnValue(consultaConDatos([tipoProceso(1, 'costura', 'Costura')]));
    renderConProveedores(<TiposProcesoPagina />, {
      sesion: estadoSesionDePrueba(['tipos-proceso.ver']),
    });

    expect(screen.queryByTestId('nuevo-tipo-proceso')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-tipo-proceso')).not.toBeInTheDocument();
  });

  it('muestra el estado vacío y el de error', () => {
    useTiposProceso.mockReturnValue(consultaConDatos([]));
    const { unmount } = renderConProveedores(<TiposProcesoPagina />, {
      sesion: estadoSesionDePrueba(['tipos-proceso.ver']),
    });
    expect(
      screen.getByText('No hay tipos de proceso que coincidan con la búsqueda.'),
    ).toBeInTheDocument();
    unmount();

    useTiposProceso.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<TiposProcesoPagina />, {
      sesion: estadoSesionDePrueba(['tipos-proceso.ver']),
    });
    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('un ADMIN puede editar la bandera generaEntradaPt en el diálogo', async () => {
    const usuario = userEvent.setup();
    useTiposProceso.mockReturnValue(consultaConDatos([tipoProceso(1, 'costura', 'Costura', true)]));
    renderConProveedores(<TiposProcesoPagina />, {
      // roles.administrar = marcador de admin → puede tocar la bandera.
      sesion: estadoSesionDePrueba([
        'tipos-proceso.ver',
        'tipos-proceso.administrar',
        'roles.administrar',
      ]),
    });

    await usuario.click(screen.getByTestId('nuevo-tipo-proceso'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByTestId('tp-genera-entrada')).toBeEnabled();
  });

  it('un GESTOR (no admin) ve la bandera DESHABILITADA y el aviso', async () => {
    const usuario = userEvent.setup();
    useTiposProceso.mockReturnValue(consultaConDatos([tipoProceso(1, 'costura', 'Costura', true)]));
    renderConProveedores(<TiposProcesoPagina />, {
      sesion: estadoSesionDePrueba(['tipos-proceso.ver', 'tipos-proceso.administrar']),
    });

    await usuario.click(screen.getByTestId('nuevo-tipo-proceso'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByTestId('tp-genera-entrada')).toBeDisabled();
    expect(within(dialogo).getByText(/Solo un administrador puede cambiar/i)).toBeInTheDocument();
  });

  it('pide confirmación antes de desactivar y llama a la mutación al confirmar', async () => {
    const usuario = userEvent.setup();
    useTiposProceso.mockReturnValue(consultaConDatos([tipoProceso(7, 'bordado', 'Bordado')]));
    renderConProveedores(<TiposProcesoPagina />, {
      sesion: estadoSesionDePrueba(['tipos-proceso.ver', 'tipos-proceso.administrar']),
    });

    // La tabla y las tarjetas móviles coexisten en el DOM (jsdom ignora `lg:hidden`): la acción se
    // dispara desde la tabla de escritorio para no chocar con el botón duplicado de la tarjeta.
    await usuario.click(
      within(screen.getByTestId('tipo-proceso-tabla')).getByTestId('desactivar-tipo-proceso'),
    );
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar tipo de proceso')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });
});
