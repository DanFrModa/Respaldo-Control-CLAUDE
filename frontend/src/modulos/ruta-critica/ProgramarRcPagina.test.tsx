import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RutaOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ProgramarRcPagina } from './ProgramarRcPagina';

const useRutaOrden = vi.fn<
  () => {
    data: RutaOrden | undefined;
    isFetching: boolean;
    isError: boolean;
    error: { message: string } | null;
  }
>();
const programarMutate = vi.fn();

vi.mock('@/api/ruta-critica-programacion', () => ({
  useRutaOrden: () => useRutaOrden(),
  useProgramarRc: () => ({ mutate: programarMutate, isPending: false }),
  useAjustarRuta: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/ordenes', () => ({
  useOrden: () => ({
    data: { id: 100, folio: 555, codigoModelo: 'MOD-1', cliente: 'Cliente Demo' },
  }),
}));

vi.mock('@/api/ruta-critica-plantillas', () => ({
  useArticulosRc: () => ({ data: [{ id: 1, nombre: 'Playera' }] }),
  useDuracionesTelaRc: () => ({ data: [{ id: 2, nombre: 'Algodón' }] }),
  useDuracionesAplicacionRc: () => ({ data: [{ id: 3, nombre: 'Estampado' }] }),
}));

function ruta(extra: Partial<RutaOrden> = {}): RutaOrden {
  return {
    idOrden: 100,
    rcActiva: true,
    // El contrato serializa las fechas como datetime ISO (z.iso.datetime), no date-only.
    fechaInicioRC: '2026-06-01T00:00:00.000Z',
    fechaEntregaRC: '2026-06-30T00:00:00.000Z',
    fechaProgramada: '2026-06-01T00:00:00.000Z',
    esResurtido: false,
    idArticuloRC: 1,
    idTipoTela: 2,
    idAplicacion: 3,
    secuenciaEstampadoModelo: 'antes',
    secEstampadoElegido: null,
    secuenciaEstampadoEfectiva: 'antes',
    motivoSinRuta: null,
    estadoRecalculo: 'calculado',
    semaforo: 'aTiempo',
    procesos: [],
    advertencias: [],
    ...extra,
  };
}

describe('<ProgramarRcPagina>', () => {
  beforeEach(() => {
    useRutaOrden.mockReset();
    programarMutate.mockReset();
  });

  it('muestra el indicador "recalculando…" mientras el CPM no termina', () => {
    useRutaOrden.mockReturnValue({
      data: ruta({ estadoRecalculo: 'recalculando' }),
      isFetching: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<ProgramarRcPagina />, {
      sesion: estadoSesionDePrueba(['rc.programar']),
      rutaInicial: '/ruta-critica/ordenes/100/programar',
    });

    expect(screen.getByTestId('prog-recalculando')).toHaveTextContent('Recalculando');
  });

  it('rotula el botón "Re-programar" cuando la orden ya tiene ruta', () => {
    useRutaOrden.mockReturnValue({
      data: ruta(),
      isFetching: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<ProgramarRcPagina />, {
      sesion: estadoSesionDePrueba(['rc.programar']),
      rutaInicial: '/ruta-critica/ordenes/100/programar',
    });

    expect(screen.getByTestId('prog-enviar')).toHaveTextContent('Re-programar');
  });

  it('niega el acceso a quien no tiene rc.programar', () => {
    useRutaOrden.mockReturnValue({
      data: undefined,
      isFetching: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<ProgramarRcPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
      rutaInicial: '/ruta-critica/ordenes/100/programar',
    });

    expect(
      screen.getByText('No tienes permiso para programar la Ruta Crítica.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('form-programar-rc')).not.toBeInTheDocument();
  });
});
