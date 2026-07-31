import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BandejaRcPagina, ResumenPendientesRc, TareaRc } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { MisPendientesPagina } from './MisPendientesPagina';

/**
 * Tests de <MisPendientesPagina> (R4): KPIs y secciones vienen AGREGADOS del backend (resumen);
 * aquí solo se verifica que se acomoden y pinten, que el tag auto/manual y sus botones respeten
 * el tipo de evento, y que el selector de supervisión solo aparezca con `rc.programar`.
 */

const useBandejaRc = vi.fn();
const useResumenPendientesRc = vi.fn();
const useResponsablesRc = vi.fn();
const capturarMutate = vi.fn();

vi.mock('@/api/ruta-critica-programacion', () => ({
  useBandejaRc: (query: unknown) => useBandejaRc(query) as unknown,
  useResumenPendientesRc: (opciones: unknown) => useResumenPendientesRc(opciones) as unknown,
  useResponsablesRc: (opciones: unknown) => useResponsablesRc(opciones) as unknown,
  useCapturarCumplimientoRc: () => ({ mutate: capturarMutate, isPending: false }),
  // Dependencias del PanelRutaOrden (se monta cerrado; su consulta va deshabilitada).
  useRutaOrden: () => ({ data: undefined, isPending: false, isError: false, error: null }),
  useElegirSecuenciaEstampado: () => ({ mutate: vi.fn(), isPending: false }),
  urlPlanImpresoRc: (idOrden: number) => `/api/ruta-critica/ordenes/${idOrden}/plan-impreso`,
}));

function tarea(id: number, extra: Partial<TareaRc> = {}): TareaRc {
  return {
    idRutaOrden: id,
    idOrden: 100 + id,
    folioOrden: 500 + id,
    cliente: 'Liverpool',
    idModelo: 7,
    codigoModelo: 'MOD-7',
    descripcionModelo: 'Playera cuello redondo',
    idProcesoDef: 3,
    codigoProceso: 'corte',
    nombreProceso: 'Corte',
    critico: false,
    tipoEvento: 'corte',
    fechaEntrega: '2026-07-13T00:00:00.000Z',
    fechaPlaneadaVigente: '2026-07-08T00:00:00.000Z',
    urgencia: 'semana',
    diasRestantes: 1,
    diasAtraso: 0,
    semaforo: 'aTiempo',
    parcialEnCurso: false,
    checklist: [],
    ...extra,
  };
}

function resumen(extra: Partial<ResumenPendientesRc> = {}): ResumenPendientesRc {
  return {
    vencidas: 1,
    paraHoy: 1,
    estaSemana: 1,
    masAdelante: 2,
    sinFecha: 0,
    total: 5,
    porProceso: [
      {
        idProcesoDef: 3,
        codigoProceso: 'corte',
        nombreProceso: 'Corte',
        total: 2,
        vencidas: 1,
        paraHoy: 0,
      },
      {
        idProcesoDef: 4,
        codigoProceso: 'envio',
        nombreProceso: 'Envío a maquila',
        total: 1,
        vencidas: 0,
        paraHoy: 1,
      },
    ],
    ...extra,
  };
}

function pagina(datos: TareaRc[]): BandejaRcPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 100, totalPaginas: 1 };
}

function consulta(datos: TareaRc[]): unknown {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  useBandejaRc.mockReset();
  useResumenPendientesRc.mockReset();
  useResponsablesRc.mockReset();
  capturarMutate.mockReset();
  useResumenPendientesRc.mockReturnValue({ data: resumen(), isPending: false });
  useResponsablesRc.mockReturnValue({ data: [], isPending: false });
});

describe('<MisPendientesPagina>', () => {
  it('pinta los KPIs del resumen y las secciones por urgencia (con "+N más adelante")', () => {
    useBandejaRc.mockReturnValue(
      consulta([
        tarea(1, { urgencia: 'vencida', diasAtraso: 2, diasRestantes: -2 }),
        tarea(2, {
          urgencia: 'hoy',
          diasRestantes: 0,
          idProcesoDef: 4,
          nombreProceso: 'Envío a maquila',
        }),
        tarea(3, { urgencia: 'semana' }),
      ]),
    );
    renderConProveedores(<MisPendientesPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });

    expect(screen.getByTestId('kpi-vencidas')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-total')).toHaveTextContent('5');
    const secciones = screen.getAllByTestId('pendientes-seccion');
    expect(secciones).toHaveLength(3); // Vencidas / Para hoy / Esta semana
    expect(secciones[0]).toHaveTextContent('⚠ Vencidas');
    expect(secciones[2]).toHaveTextContent('+2 programadas más adelante');
    // Renglón: proceso + orden·modelo·cliente·entrega.
    const fila = within(secciones[0] as HTMLElement).getByTestId('pendientes-fila');
    expect(fila).toHaveTextContent('Corte');
    expect(fila).toHaveTextContent('Orden 501');
    expect(fila).toHaveTextContent('Liverpool');
  });

  it('agrupa por PROCESO con los conteos del resumen (server-side)', async () => {
    const usuario = userEvent.setup();
    useBandejaRc.mockReturnValue(
      consulta([
        tarea(1, { urgencia: 'vencida' }),
        tarea(2, { idProcesoDef: 4, nombreProceso: 'Envío a maquila', urgencia: 'hoy' }),
      ]),
    );
    renderConProveedores(<MisPendientesPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });

    await usuario.click(screen.getByTestId('pendientes-agrupar-proceso'));
    const grupos = screen.getByTestId('pendientes-grupos-proceso');
    const secciones = within(grupos).getAllByTestId('pendientes-seccion');
    expect(secciones[0]).toHaveTextContent('Corte');
    expect(secciones[0]).toHaveTextContent('1 vencido');
    expect(secciones[1]).toHaveTextContent('Envío a maquila');
  });

  it('procesos AUTO muestran "Registrar"; los manuales, "Marcar hecho" (con rc.capturar)', async () => {
    const usuario = userEvent.setup();
    useBandejaRc.mockReturnValue(
      consulta([
        tarea(1, { urgencia: 'hoy', tipoEvento: 'corte' }),
        tarea(2, { urgencia: 'hoy', tipoEvento: 'manual', nombreProceso: 'Programación' }),
      ]),
    );
    renderConProveedores(<MisPendientesPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.capturar']),
    });

    expect(screen.getByTestId('pendientes-registrar')).toBeInTheDocument();
    const marcar = screen.getByTestId('pendientes-marcar-hecho');
    await usuario.click(marcar);
    expect(capturarMutate).toHaveBeenCalledWith(
      expect.objectContaining({ idRuta: 2, cumplido: true }),
      expect.anything(),
    );
  });

  it('sin rc.capturar no ofrece "Marcar hecho"; sin rc.programar no hay selector de persona', () => {
    useBandejaRc.mockReturnValue(consulta([tarea(1, { tipoEvento: 'manual' })]));
    renderConProveedores(<MisPendientesPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });

    expect(screen.queryByTestId('pendientes-marcar-hecho')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pendientes-selector-persona')).not.toBeInTheDocument();
  });

  it('con rc.programar muestra "Viendo pendientes de:" y consulta al usuario elegido', async () => {
    const usuario = userEvent.setup();
    useResponsablesRc.mockReturnValue({
      data: [
        { id: 'u-laura', nombre: 'Laura Hernández', username: 'laura' },
        { id: 'u-miguel', nombre: 'Miguel Torres', username: 'miguel' },
      ],
      isPending: false,
    });
    useBandejaRc.mockReturnValue(consulta([tarea(1)]));
    renderConProveedores(<MisPendientesPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.programar']),
    });

    expect(screen.getByTestId('pendientes-selector-persona')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('pendientes-persona-input'));
    await usuario.click(screen.getByText('Laura Hernández'));
    // La consulta de la bandeja se re-dispara con el id del usuario supervisado.
    expect(useBandejaRc).toHaveBeenLastCalledWith(
      expect.objectContaining({ deUsuario: 'u-laura' }),
    );
    expect(useResumenPendientesRc).toHaveBeenLastCalledWith(
      expect.objectContaining({ deUsuario: 'u-laura' }),
    );
  });

  it('la búsqueda por cliente viaja al SERVIDOR (parámetro busquedaCliente de la bandeja)', async () => {
    const usuario = userEvent.setup();
    useBandejaRc.mockReturnValue(consulta([tarea(1)]));
    renderConProveedores(<MisPendientesPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });

    await usuario.type(screen.getByTestId('pendientes-buscar-cliente'), 'Liver');
    // El texto viaja con debounce (300 ms) al parámetro server-side de la consulta.
    await vi.waitFor(() => {
      expect(useBandejaRc).toHaveBeenLastCalledWith(
        expect.objectContaining({ busquedaCliente: 'Liver' }),
      );
    });
  });

  it('muestra el vacío feliz cuando no hay pendientes', () => {
    useBandejaRc.mockReturnValue(consulta([]));
    useResumenPendientesRc.mockReturnValue({
      data: resumen({
        vencidas: 0,
        paraHoy: 0,
        estaSemana: 0,
        masAdelante: 0,
        total: 0,
        porProceso: [],
      }),
      isPending: false,
    });
    renderConProveedores(<MisPendientesPagina />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });
    expect(screen.getByTestId('pendientes-vacio')).toBeInTheDocument();
  });
});
