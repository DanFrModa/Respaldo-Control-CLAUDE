import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Muestrario, MuestrariosCumplimiento } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { MuestrariosPagina } from './MuestrariosPagina';

const mock: { lista: unknown; kpi: unknown } = { lista: null, kpi: null };

vi.mock('@/api/muestrarios', () => ({
  useMuestrarios: () => mock.lista,
  useCumplimientoMuestrarios: () => mock.kpi,
  useCrearMuestrario: () => ({ mutate: vi.fn(), isPending: false }),
  useEntregarMuestrario: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarMuestrario: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/clientes', () => ({ useClientes: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/temporadas', () => ({ useTemporadas: () => ({ data: { datos: [] } }) }));

describe('MuestrariosPagina', () => {
  it('muestra el KPI de cumplimiento y la lista de muestrarios', () => {
    const kpi: MuestrariosCumplimiento = {
      total: 4,
      pendientes: 1,
      entregados: 3,
      aTiempo: 2,
      tarde: 1,
      porcentaje: 0.6667,
    };
    const fila: Muestrario = {
      id: 7,
      idEmpresa: 1,
      idCliente: 2,
      cliente: 'Tienda X',
      categoria: 'Playeras',
      idTemporada: null,
      temporada: null,
      cantBoards: 3,
      cantMuestras: 10,
      fechaSolicitado: '2026-06-01',
      fechaRequerida: '2026-06-20',
      fechaEntregado: null,
      boardsOK: 0,
      muestrasOK: 0,
      solicitanteId: null,
      estado: 'pendiente',
      aTiempo: null,
      cancelado: false,
      motivoCancelacion: null,
      creadoEn: '2026-06-01T00:00:00.000Z',
      creadoPorId: null,
    };
    mock.kpi = { data: kpi };
    mock.lista = {
      data: { datos: [fila], total: 1, pagina: 1, porPagina: 100, totalPaginas: 1 },
      isPending: false,
    };

    renderConProveedores(<MuestrariosPagina />, {
      sesion: estadoSesionDePrueba(['indicadores.ip-muestrarios']),
    });

    expect(screen.getByText('66.7%')).toBeInTheDocument();
    expect(screen.getByTestId('mu-fila-7')).toHaveTextContent('Tienda X');
    expect(screen.getByTestId('mu-solicitar')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay muestrarios', () => {
    mock.kpi = {
      data: { total: 0, pendientes: 0, entregados: 0, aTiempo: 0, tarde: 0, porcentaje: null },
    };
    mock.lista = {
      data: { datos: [], total: 0, pagina: 1, porPagina: 100, totalPaginas: 1 },
      isPending: false,
    };
    renderConProveedores(<MuestrariosPagina />, {
      sesion: estadoSesionDePrueba(['indicadores.ip-muestrarios']),
    });
    expect(screen.getByText('Sin muestrarios.')).toBeInTheDocument();
  });
});
