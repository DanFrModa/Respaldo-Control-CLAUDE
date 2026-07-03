import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { KpisRc } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TableroRcPagina } from './TableroRcPagina';

/** Estado mutable del hook mockeado (objeto estable para el factory de vi.mock). */
const mock: { rc: unknown } = { rc: null };

vi.mock('@/api/indicadores', () => ({
  useKpisRc: () => mock.rc,
  useRefrescarKpis: () => ({ mutate: vi.fn(), isPending: false }),
  imprimirKpisRc: vi.fn(),
  descargarExcelKpisRc: vi.fn(),
}));

describe('TableroRcPagina', () => {
  it('muestra el % de entregas a tiempo y las tablas de KPIs con el sello de frescura', () => {
    const datos: KpisRc = {
      datosAl: '2026-07-03T12:00:00.000Z',
      entregasATiempo: {
        completadas: 3,
        medibles: 3,
        completadasSinPlan: 0,
        aTiempo: 2,
        porcentaje: 0.6667,
      },
      leadTime: [
        {
          idProcesoDef: 1,
          codigoProceso: 'corte',
          nombreProceso: 'Corte',
          numProcesos: 5,
          diasRealesProm: 2.5,
          diasEstimadoProm: 2,
        },
      ],
      cuellosBotella: [
        {
          idProcesoDef: 2,
          codigoProceso: 'costura',
          nombreProceso: 'Costura',
          numProcesos: 4,
          atrasoMedioDias: 3.1,
        },
      ],
      desempeno: [
        { responsableId: 'u1', responsable: 'Ana', numProcesos: 10, aTiempo: 9, porcentaje: 0.9 },
      ],
      tendencia: [{ anio: 2026, mes: 6, completadas: 3, aTiempo: 2, porcentaje: 0.6667 }],
    };
    mock.rc = { data: datos, isPending: false, isError: false, error: null };
    renderConProveedores(<TableroRcPagina />, {
      sesion: estadoSesionDePrueba(['indicadores.ver']),
    });

    expect(screen.getByTestId('rc-pct')).toHaveTextContent('66.7%');
    expect(screen.getByTestId('rc-datos-al')).toHaveTextContent(/Datos al:/);
    expect(screen.getByText('Corte')).toBeInTheDocument();
    expect(screen.getByText('Costura')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    // Las 3 tarjetas ciegas al periodo (lead time, cuellos, desempeño) van rotuladas (ARREGLO 1).
    expect(screen.getAllByTestId('badge-historico')).toHaveLength(3);
  });

  it('muestra el aviso de datos aún no calculados cuando datosAl es null', () => {
    const datos: KpisRc = {
      datosAl: null,
      entregasATiempo: {
        completadas: 0,
        medibles: 0,
        completadasSinPlan: 0,
        aTiempo: 0,
        porcentaje: null,
      },
      leadTime: [],
      cuellosBotella: [],
      desempeno: [],
      tendencia: [],
    };
    mock.rc = { data: datos, isPending: false, isError: false, error: null };
    renderConProveedores(<TableroRcPagina />, {
      sesion: estadoSesionDePrueba(['indicadores.ver']),
    });
    expect(screen.getByTestId('rc-datos-al')).toHaveTextContent(/aún no calculados/i);
    expect(screen.getByTestId('rc-pct')).toHaveTextContent('—');
  });
});
