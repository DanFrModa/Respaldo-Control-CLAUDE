import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorDeApi } from '@/api/errores';
import type { ConcentradoRcFila, ConcentradoRcPagina } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ConcentradoPagina } from './ConcentradoPagina';

type EstadoConsulta = {
  data: ConcentradoRcPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};

const useConcentradoRc = vi.fn<(query: unknown) => EstadoConsulta>();
const urlConcentradoExcel = vi.fn<(query: unknown) => string>(
  () => '/api/ruta-critica/concentrado/excel',
);
// Los selectores de proceso/responsable llaman a catálogos; se mockean vacíos (no se ofrecen filtros).
const useProcesosRc = vi.fn(() => ({ data: undefined }));
const useRoles = vi.fn(() => ({ data: undefined }));

vi.mock('@/api/ruta-critica-programacion', () => ({
  useConcentradoRc: (query: unknown) => useConcentradoRc(query),
  urlConcentradoExcel: (query: unknown) => urlConcentradoExcel(query),
}));
vi.mock('@/api/ruta-critica', () => ({ useProcesosRc: () => useProcesosRc() }));
vi.mock('@/api/roles', () => ({ useRoles: () => useRoles() }));

function fila(id: number, extra: Partial<ConcentradoRcFila> = {}): ConcentradoRcFila {
  return {
    idOrden: id,
    folioOrden: 500 + id,
    cliente: 'Cliente Demo',
    idModelo: 7,
    codigoModelo: 'MOD-7',
    descripcionModelo: null,
    fechaEntregaRC: '2026-07-01T00:00:00.000Z',
    fechaInicioRC: '2026-06-01T00:00:00.000Z',
    esResurtido: false,
    semaforo: 'aTiempo',
    maxDiasAtraso: 0,
    procesosPendientes: 1,
    procesos: [
      {
        idProcesoDef: 3,
        codigoProceso: 'corte',
        nombreProceso: 'Corte',
        secuencia: 0,
        critico: false,
        fechaPlaneadaVigente: '2026-06-20T00:00:00.000Z',
        fechaReal: null,
        estado: 'activo',
        diasAtraso: 0,
        semaforo: 'aTiempo',
      },
    ],
    ...extra,
  };
}

function pagina(datos: ConcentradoRcFila[]): ConcentradoRcPagina {
  return {
    datos,
    total: datos.length,
    pagina: 1,
    porPagina: 20,
    totalPaginas: 1,
    resumen: { atrasadas: 1, enRiesgo: 0, aTiempo: 2 },
  };
}

function consultaConDatos(datos: ConcentradoRcFila[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<ConcentradoPagina>', () => {
  beforeEach(() => {
    useConcentradoRc.mockReset();
    urlConcentradoExcel.mockClear();
    useProcesosRc.mockReturnValue({ data: undefined });
    useRoles.mockReturnValue({ data: undefined });
  });

  it('pinta cada orden con su semáforo, atraso y la tira de procesos', () => {
    useConcentradoRc.mockReturnValue(
      consultaConDatos([
        fila(1, {
          semaforo: 'atrasado',
          maxDiasAtraso: 4,
          procesos: [
            {
              idProcesoDef: 3,
              codigoProceso: 'corte',
              nombreProceso: 'Corte',
              secuencia: 0,
              critico: true,
              fechaPlaneadaVigente: '2026-06-18T00:00:00.000Z',
              fechaReal: null,
              estado: 'activo',
              diasAtraso: 4,
              semaforo: 'atrasado',
            },
          ],
        }),
      ]),
    );
    renderConProveedores(<ConcentradoPagina />, { sesion: estadoSesionDePrueba(['rc.ruta-ver']) });

    const card = screen.getByTestId('concentrado-fila');
    expect(card).toHaveAttribute('data-semaforo', 'atrasado');
    expect(screen.getByTestId('concentrado-atraso')).toHaveTextContent('4 días de atraso');
    expect(screen.getByTestId('concentrado-proceso')).toHaveTextContent('Corte');
    // El resumen por semáforo se muestra (sobre todo el filtro).
    expect(screen.getByTestId('concentrado-resumen')).toHaveTextContent('Atrasadas');
  });

  it('el botón de Excel usa la URL con el filtro vigente', async () => {
    const usuario = userEvent.setup();
    useConcentradoRc.mockReturnValue(consultaConDatos([fila(1)]));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderConProveedores(<ConcentradoPagina />, { sesion: estadoSesionDePrueba(['rc.ruta-ver']) });

    await usuario.click(screen.getByTestId('concentrado-excel'));
    expect(urlConcentradoExcel).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('/api/ruta-critica/concentrado/excel', '_blank', 'noopener');
    open.mockRestore();
  });

  it('muestra el estado vacío y el de error', () => {
    useConcentradoRc.mockReturnValue(consultaConDatos([]));
    const { unmount } = renderConProveedores(<ConcentradoPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });
    expect(screen.getByTestId('concentrado-vacio')).toBeInTheDocument();
    unmount();

    useConcentradoRc.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar el concentrado.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<ConcentradoPagina />, { sesion: estadoSesionDePrueba(['rc.ruta-ver']) });
    expect(screen.getByTestId('concentrado-error')).toHaveTextContent(
      'No se pudo cargar el concentrado.',
    );
  });

  it('ofrece el filtro de proceso cuando el catálogo está disponible', () => {
    useProcesosRc.mockReturnValue({
      data: { datos: [{ id: 9, nombre: 'Estampado' }] },
    } as never);
    useConcentradoRc.mockReturnValue(consultaConDatos([fila(1)]));
    renderConProveedores(<ConcentradoPagina />, { sesion: estadoSesionDePrueba(['rc.ruta-ver']) });

    expect(screen.getByTestId('concentrado-filtro-proceso')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Estampado' })).toBeInTheDocument();
  });
});
