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
    // V1-E3f (catálogo único): banderas del arte, apagadas salvo que la prueba diga otra cosa.
    esArte: false,
    usaPuntadas: false,
    codigoRolProveedor: null,
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

  it('con `tipos-proceso.marcar-entrada-pt` se edita la bandera en el diálogo', async () => {
    const usuario = userEvent.setup();
    useTiposProceso.mockReturnValue(consultaConDatos([tipoProceso(1, 'costura', 'Costura', true)]));
    renderConProveedores(<TiposProcesoPagina />, {
      // ⭐ Fila 0.120: la bandera tiene llave propia. Antes esto pedía `roles.administrar`, o sea
      // que se la regalaba a quien administrara roles. Debe coincidir con lo que exige el dominio.
      sesion: estadoSesionDePrueba([
        'tipos-proceso.ver',
        'tipos-proceso.administrar',
        'tipos-proceso.marcar-entrada-pt',
      ]),
    });

    await usuario.click(screen.getByTestId('nuevo-tipo-proceso'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByTestId('tp-genera-entrada')).toBeEnabled();
  });

  it('SIN `tipos-proceso.marcar-entrada-pt` la bandera va DESHABILITADA y con aviso', async () => {
    const usuario = userEvent.setup();
    useTiposProceso.mockReturnValue(consultaConDatos([tipoProceso(1, 'costura', 'Costura', true)]));
    renderConProveedores(<TiposProcesoPagina />, {
      sesion: estadoSesionDePrueba(['tipos-proceso.ver', 'tipos-proceso.administrar']),
    });

    await usuario.click(screen.getByTestId('nuevo-tipo-proceso'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByTestId('tp-genera-entrada')).toBeDisabled();
    // Texto COMPLETO y único a propósito (cicatriz del 7-sep-2026): una palabra suelta como
    // «permiso» la pinta la pantalla por su cuenta y la aserción pasaría sin medir nada.
    expect(
      within(dialogo).getByText(
        'No tienes permiso para cambiar si el proceso mete prenda a inventario PT.',
      ),
    ).toBeInTheDocument();
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
