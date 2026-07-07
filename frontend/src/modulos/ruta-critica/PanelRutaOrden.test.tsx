import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RutaOrden, RutaOrdenProceso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { PanelRutaOrden } from './PanelRutaOrden';

/**
 * Tests de <PanelRutaOrden> (R4): la línea de tiempo pinta lo que DERIVA el backend (estado,
 * holgura, responsable, auto/manual, badge "tú"); el control de estampado solo aparece en órdenes
 * FLEXIBLES con permiso `rc.programar`; y sin ruta se muestra el MOTIVO de la RC automática (R3)
 * con el CTA "Programar ahora".
 */

const useRutaOrden = vi.fn();
const elegirMutate = vi.fn();

vi.mock('@/api/ruta-critica-programacion', () => ({
  useRutaOrden: (idOrden: unknown, opciones: unknown) => useRutaOrden(idOrden, opciones) as unknown,
  useElegirSecuenciaEstampado: () => ({ mutate: elegirMutate, isPending: false }),
  urlPlanImpresoRc: (idOrden: number) => `/api/ruta-critica/ordenes/${idOrden}/plan-impreso`,
}));

function proceso(id: number, extra: Partial<RutaOrdenProceso> = {}): RutaOrdenProceso {
  return {
    id,
    idProcesoDef: id,
    codigoProceso: `p-${String(id)}`,
    nombreProceso: `Proceso ${String(id)}`,
    secuencia: id,
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    rolesResponsables: ['Produccion'],
    esResponsableActual: false,
    duracionDias: 2,
    acumuladoDias: null,
    fechaPlaneadaOriginal: null,
    fechaPlaneadaVigente: '2026-07-10T00:00:00.000Z',
    fechaReal: null,
    diasRestantes: 3,
    estado: 'activo',
    capturadoPorId: null,
    capturadoPorNombre: null,
    capturadoEn: null,
    origenCaptura: null,
    parcialEnCurso: false,
    semaforo: 'aTiempo',
    idsAntecesores: [],
    checklist: [],
    ...extra,
  };
}

function ruta(extra: Partial<RutaOrden> = {}): RutaOrden {
  return {
    idOrden: 100,
    rcActiva: true,
    fechaInicioRC: '2026-07-01T00:00:00.000Z',
    fechaEntregaRC: '2026-07-30T00:00:00.000Z',
    fechaProgramada: '2026-07-01T00:00:00.000Z',
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
    procesos: [proceso(1)],
    advertencias: [],
    ...extra,
  };
}

function consulta(data: RutaOrden | undefined): void {
  useRutaOrden.mockReturnValue({ data, isPending: false, isError: false, error: null });
}

beforeEach(() => {
  useRutaOrden.mockReset();
  elegirMutate.mockReset();
});

describe('<PanelRutaOrden>', () => {
  it('pinta la línea de tiempo con estado/holgura, responsable, auto/manual y el badge "tú"', () => {
    consulta(
      ruta({
        procesos: [
          proceso(1, {
            nombreProceso: 'Corte',
            tipoEvento: 'corte',
            esResponsableActual: true,
            diasRestantes: -2,
          }),
          proceso(2, {
            nombreProceso: 'Entrega',
            estado: 'completado',
            fechaReal: '2026-07-05T00:00:00.000Z',
          }),
        ],
      }),
    );
    renderConProveedores(
      <PanelRutaOrden
        idOrden={100}
        abierto
        alCerrar={vi.fn()}
        encabezado={{ folio: 555, modelo: 'Playera', cliente: 'Liverpool' }}
      />,
      { sesion: estadoSesionDePrueba(['rc.ruta-ver']) },
    );

    const renglones = screen.getAllByTestId('panel-ruta-proceso');
    expect(renglones[0]).toHaveAttribute('data-estado', 'vencido');
    expect(renglones[0]).toHaveTextContent('tú');
    expect(renglones[0]).toHaveTextContent('⟳ Automático — al registrar: el corte');
    expect(renglones[0]).toHaveTextContent('Produccion');
    expect(renglones[1]).toHaveAttribute('data-estado', 'hecho');
    expect(screen.getByText('Ruta de la orden 555')).toBeInTheDocument();
  });

  it('en órdenes FLEXIBLES el control [ANTES]/[DESPUÉS] reprograma en vivo (con rc.programar)', async () => {
    const usuario = userEvent.setup();
    consulta(
      ruta({
        secuenciaEstampadoModelo: 'flexible',
        secuenciaEstampadoEfectiva: 'antes',
        procesos: [
          proceso(1, { tipoEvento: 'reciboEstampado' }),
          proceso(2, { tipoEvento: 'envioCostura' }),
        ],
      }),
    );
    renderConProveedores(<PanelRutaOrden idOrden={100} abierto alCerrar={vi.fn()} />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.programar']),
    });

    await usuario.click(screen.getByTestId('panel-ruta-estampar-despues'));
    expect(elegirMutate).toHaveBeenCalledWith(
      { idOrden: 100, secuencia: 'despues' },
      expect.anything(),
    );
  });

  it('modelo FORZADO (no flexible) informa la secuencia pero NO ofrece botones', () => {
    consulta(
      ruta({
        secuenciaEstampadoModelo: 'antes',
        procesos: [proceso(1, { tipoEvento: 'reciboEstampado' })],
      }),
    );
    renderConProveedores(<PanelRutaOrden idOrden={100} abierto alCerrar={vi.fn()} />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.programar']),
    });
    expect(screen.getByTestId('panel-ruta-estampado')).toHaveTextContent('ANTES de coser');
    expect(screen.queryByTestId('panel-ruta-estampar-despues')).not.toBeInTheDocument();
  });

  it('sin ruta muestra el MOTIVO de la RC automática y "Programar ahora" (gated rc.programar)', () => {
    consulta(
      ruta({
        estadoRecalculo: 'sin-ruta',
        rcActiva: false,
        procesos: [],
        motivoSinRuta:
          'La orden no tiene fecha de entrega; la RC se planea hacia atrás desde ella.',
      }),
    );
    renderConProveedores(<PanelRutaOrden idOrden={100} abierto alCerrar={vi.fn()} />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.programar']),
    });
    expect(screen.getByTestId('panel-ruta-motivo')).toHaveTextContent('fecha de entrega');
    expect(screen.getByTestId('panel-ruta-programar')).toBeInTheDocument();
  });

  it('sin rc.programar el CTA "Programar ahora" no aparece', () => {
    consulta(
      ruta({ estadoRecalculo: 'sin-ruta', rcActiva: false, procesos: [], motivoSinRuta: null }),
    );
    renderConProveedores(<PanelRutaOrden idOrden={100} abierto alCerrar={vi.fn()} />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver']),
    });
    expect(screen.getByTestId('panel-ruta-sin-ruta')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-ruta-programar')).not.toBeInTheDocument();
  });
});
