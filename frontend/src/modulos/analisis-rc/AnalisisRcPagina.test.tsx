import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ErrorDeApi } from '@/api/errores';
import type { AnalisisRc, DesempenoRc } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { AnalisisRcPagina } from './AnalisisRcPagina';

type EstadoTablero = {
  data: AnalisisRc | undefined;
  isPending: boolean;
  isError: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
type EstadoDesempeno = { data: DesempenoRc | undefined; isPending: boolean };

const useAnalisisRc = vi.fn<() => EstadoTablero>();
const useDesempenoRc = vi.fn<() => EstadoDesempeno>();

vi.mock('@/api/analisis-rc', () => ({
  useAnalisisRc: () => useAnalisisRc(),
  useDesempenoRc: () => useDesempenoRc(),
  urlEvaluacionSemanalExcel: () => '/api/ruta-critica/analisis/desempeno/excel',
}));

function tablero(extra: Partial<AnalisisRc> = {}): AnalisisRc {
  return {
    salud: {
      ordenesActivas: 10,
      aTiempo: 6,
      enRiesgo: 2,
      atrasadas: 2,
      cumplimiento: 60,
      atencion: [
        {
          idOrden: 1,
          folioOrden: 501,
          cliente: 'Boutique Aurora',
          codigoModelo: 'MOD-7',
          descripcionModelo: null,
          etapaAtorada: 'Corte',
          responsable: 'Cortadores',
          semaforo: 'atrasado',
          holguraDias: -5,
          fechaEntregaRC: '2026-06-30T00:00:00.000Z',
        },
      ],
    },
    entregaCiclo: {
      onTimePct: 82,
      onTimeATiempo: 9,
      onTimeMedibles: 11,
      tendenciaSemanas: [70, 75, 80, 82],
      cicloPromedioDias: 24,
      cicloTendenciaDias: -3,
      datosAl: '2026-07-08T00:00:00.000Z',
    },
    alertas: [
      {
        idOrden: 2,
        folioOrden: 502,
        cliente: 'Tienda Zeta',
        codigoModelo: 'MOD-9',
        descripcionModelo: null,
        procesosRestantes: 4,
        colchonDias: -2,
        fechaEntregaRC: '2026-07-05T00:00:00.000Z',
      },
    ],
    riesgoCliente: [
      {
        idCliente: 3,
        cliente: 'Tienda Zeta',
        activas: 3,
        enRiesgo: 1,
        atrasadas: 1,
        semaforo: 'crit',
      },
    ],
    cuellos: [
      {
        idProcesoDef: 5,
        codigoProceso: 'corte',
        nombreProceso: 'Corte',
        vencidos: 3,
        hoy: 1,
        total: 6,
      },
    ],
    ...extra,
  };
}

function desempeno(): DesempenoRc {
  return {
    personas: [
      {
        idUsuario: 'u1',
        nombre: 'Ana Pérez',
        area: 'Cortadores',
        activos: 4,
        vencidos: 0,
        onTimePct: 100,
        reaccionHoras: 2.5,
        tendencia: 5,
        calificacion: 100,
        badge: 'excelente',
        bono: true,
        sobrecarga: false,
      },
    ],
    conBono: 1,
    parametros: { umbralBono: 90, penalizacionPorVencido: 5, sobrecargaActivos: 15 },
  };
}

function tableroConDatos(datos: AnalisisRc): EstadoTablero {
  return { data: datos, isPending: false, isError: false, error: null, refetch: vi.fn() };
}

describe('<AnalisisRcPagina>', () => {
  beforeEach(() => {
    useAnalisisRc.mockReset();
    useDesempenoRc.mockReset();
    useDesempenoRc.mockReturnValue({ data: desempeno(), isPending: false });
  });

  it('pinta los KPIs, el triage con su etapa/responsable y las alertas predictivas', () => {
    useAnalisisRc.mockReturnValue(tableroConDatos(tablero()));
    renderConProveedores(<AnalisisRcPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.programar']),
    });

    expect(screen.getByTestId('kpi-activas')).toHaveTextContent('10');
    expect(screen.getByTestId('kpi-cumplimiento')).toHaveTextContent('60');

    const triage = screen.getByTestId('atencion-fila');
    expect(triage).toHaveTextContent('Corte');
    expect(triage).toHaveTextContent('Cortadores');
    expect(triage).toHaveTextContent('Atrasada');
    expect(triage).toHaveTextContent('-5 d');

    // La alerta muestra el colchón negativo (va a atrasarse).
    expect(screen.getByTestId('alerta-fila')).toHaveTextContent('-2 d');
    // El sparkline de tendencia está montado.
    expect(screen.getByTestId('sparkline')).toBeInTheDocument();
  });

  it('con rc.programar muestra el desempeño y su export a Excel', async () => {
    const usuario = userEvent.setup();
    useAnalisisRc.mockReturnValue(tableroConDatos(tablero()));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderConProveedores(<AnalisisRcPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.programar']),
    });

    const fila = screen.getByTestId('desempeno-fila');
    expect(fila).toHaveTextContent('Ana Pérez');
    expect(fila).toHaveTextContent('Bono ✓');
    expect(fila).toHaveTextContent('Excelente');

    await usuario.click(screen.getByTestId('desempeno-excel'));
    expect(open).toHaveBeenCalledWith(
      '/api/ruta-critica/analisis/desempeno/excel',
      '_blank',
      'noopener',
    );
    open.mockRestore();
  });

  it('sin rc.programar NO muestra la tarjeta de desempeño (management)', () => {
    useAnalisisRc.mockReturnValue(tableroConDatos(tablero()));
    renderConProveedores(<AnalisisRcPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });

    expect(screen.getByTestId('kpi-activas')).toBeInTheDocument();
    expect(screen.queryByTestId('desempeno-fila')).not.toBeInTheDocument();
    expect(screen.queryByText('Desempeño del equipo (RC)')).not.toBeInTheDocument();
  });

  it('muestra el estado vacío del triage cuando no hay órdenes que atender', () => {
    useAnalisisRc.mockReturnValue(
      tableroConDatos(tablero({ salud: { ...tablero().salud, atencion: [] } })),
    );
    renderConProveedores(<AnalisisRcPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.programar']),
    });
    expect(screen.getByText('Ninguna orden en riesgo ni atrasada.')).toBeInTheDocument();
  });
});
