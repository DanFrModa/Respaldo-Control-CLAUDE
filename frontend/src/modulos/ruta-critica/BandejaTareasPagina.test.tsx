import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorDeApi } from '@/api/errores';
import type { BandejaRcPagina, TareaRc } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { BandejaTareasPagina } from './BandejaTareasPagina';

type EstadoConsulta = {
  data: BandejaRcPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};

const useBandejaRc = vi.fn<(query: unknown) => EstadoConsulta>();
const capturarMutate = vi.fn();
const checklistMutate = vi.fn();

vi.mock('@/api/ruta-critica-programacion', () => ({
  useBandejaRc: (query: unknown) => useBandejaRc(query),
  useCapturarCumplimientoRc: () => ({ mutate: capturarMutate, isPending: false }),
  useMarcarChecklistRc: () => ({ mutate: checklistMutate, isPending: false }),
}));

function tarea(id: number, extra: Partial<TareaRc> = {}): TareaRc {
  return {
    idRutaOrden: id,
    idOrden: 100 + id,
    folioOrden: 500 + id,
    cliente: 'Cliente Demo',
    idModelo: 7,
    codigoModelo: 'MOD-7',
    descripcionModelo: null,
    idProcesoDef: 3,
    codigoProceso: 'corte',
    nombreProceso: 'Corte',
    critico: false,
    // El contrato serializa la fecha como datetime ISO (z.iso.datetime), no date-only.
    fechaPlaneadaVigente: '2026-06-20T00:00:00.000Z',
    diasAtraso: 0,
    semaforo: 'aTiempo',
    parcialEnCurso: false,
    checklist: [],
    ...extra,
  };
}

function pagina(datos: TareaRc[]): BandejaRcPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 20, totalPaginas: 1 };
}

function consultaConDatos(datos: TareaRc[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<BandejaTareasPagina>', () => {
  beforeEach(() => {
    useBandejaRc.mockReset();
    capturarMutate.mockReset();
    checklistMutate.mockReset();
  });

  it('pinta el semáforo y los datos de cada tarea', () => {
    useBandejaRc.mockReturnValue(
      consultaConDatos([tarea(1, { semaforo: 'atrasado', diasAtraso: 3, nombreProceso: 'Corte' })]),
    );
    renderConProveedores(<BandejaTareasPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.capturar']),
    });

    const card = screen.getByTestId('bandeja-tarea');
    expect(card).toHaveAttribute('data-semaforo', 'atrasado');
    expect(screen.getByTestId('semaforo-rc')).toHaveTextContent('Atrasado');
    expect(screen.getByTestId('bandeja-atraso')).toHaveTextContent('3 días de atraso');
    expect(screen.getByText('Corte')).toBeInTheDocument();
  });

  it('dispara la captura con la fecha de HOY al pulsar "Hoy"', async () => {
    const usuario = userEvent.setup();
    useBandejaRc.mockReturnValue(consultaConDatos([tarea(9)]));
    renderConProveedores(<BandejaTareasPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.capturar']),
    });

    await usuario.click(screen.getByTestId('bandeja-completar-hoy'));
    expect(capturarMutate).toHaveBeenCalledTimes(1);
    expect(capturarMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        idRuta: 9,
        cumplido: true,
        fechaReal: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
      }),
      expect.anything(),
    );
  });

  it('oculta los botones de captura para quien solo puede ver', () => {
    useBandejaRc.mockReturnValue(consultaConDatos([tarea(1)]));
    renderConProveedores(<BandejaTareasPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });

    expect(screen.queryByTestId('bandeja-completar-hoy')).not.toBeInTheDocument();
    // El toggle "ver todas" solo aparece con permiso de supervisión (rc.programar).
    expect(screen.queryByTestId('bandeja-ver-todas')).not.toBeInTheDocument();
  });

  it('muestra el estado vacío y el de error', () => {
    useBandejaRc.mockReturnValue(consultaConDatos([]));
    const { unmount } = renderConProveedores(<BandejaTareasPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });
    expect(screen.getByTestId('bandeja-vacia')).toBeInTheDocument();
    unmount();

    useBandejaRc.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la bandeja.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<BandejaTareasPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });
    expect(screen.getByTestId('bandeja-error')).toHaveTextContent('No se pudo cargar la bandeja.');
  });
});
