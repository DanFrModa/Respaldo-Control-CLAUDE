import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RutaOrden, RutaOrdenProceso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { RutaPorOrdenPagina } from './RutaPorOrdenPagina';

const useRutaOrden = vi.fn<
  () => {
    data: RutaOrden | undefined;
    isPending: boolean;
    isError: boolean;
    error: { message: string } | null;
  }
>();

vi.mock('@/api/ruta-critica-programacion', () => ({
  useRutaOrden: () => useRutaOrden(),
  urlPlanImpresoRc: (idOrden: number) => `/api/ruta-critica/ordenes/${idOrden}/plan-impreso`,
}));

function proceso(extra: Partial<RutaOrdenProceso> = {}): RutaOrdenProceso {
  return {
    id: 1,
    idProcesoDef: 3,
    codigoProceso: 'corte',
    nombreProceso: 'Corte',
    secuencia: 1,
    critico: true,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'corte',
    rolesResponsables: ['Produccion'],
    esResponsableActual: false,
    duracionDias: 2,
    acumuladoDias: 2,
    // El contrato serializa las fechas como datetime ISO (z.iso.datetime), no date-only.
    fechaPlaneadaOriginal: '2026-06-10T00:00:00.000Z',
    fechaPlaneadaVigente: '2026-06-12T00:00:00.000Z',
    fechaReal: '2026-06-11T00:00:00.000Z',
    estado: 'completado',
    capturadoPorId: 'u1',
    capturadoPorNombre: 'Juana Pérez',
    capturadoEn: '2026-06-11T15:00:00.000Z',
    origenCaptura: 'manual',
    diasRestantes: 1,
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
    procesos: [proceso()],
    advertencias: [],
    ...extra,
  };
}

/** Renderiza la página bajo una ruta con el parámetro `:idOrden`. */
function render(
  estado: ReturnType<typeof useRutaOrden>,
  permisos: Parameters<typeof estadoSesionDePrueba>[0] = ['rc.ruta-ver'],
) {
  useRutaOrden.mockReturnValue(estado);
  return renderConProveedores(
    <Routes>
      <Route path="/ruta-critica/ordenes/:idOrden" element={<RutaPorOrdenPagina />} />
    </Routes>,
    {
      sesion: estadoSesionDePrueba(permisos),
      rutaInicial: '/ruta-critica/ordenes/100',
    },
  );
}

describe('<RutaPorOrdenPagina>', () => {
  beforeEach(() => {
    useRutaOrden.mockReset();
  });

  it('muestra quién capturó y la fecha de cada proceso', () => {
    render({ data: ruta(), isPending: false, isError: false, error: null });

    const captura = screen.getByTestId('rc-proceso-captura');
    expect(captura).toHaveTextContent('Juana Pérez');
    // Plan vs real legibles.
    expect(screen.getByText(/12.*jun.*2026/i)).toBeInTheDocument();
  });

  it('marca "Parcial en curso" cuando el proceso lo tiene encendido (F5-E6)', () => {
    render({
      data: ruta({ procesos: [proceso({ estado: 'activo', parcialEnCurso: true })] }),
      isPending: false,
      isError: false,
      error: null,
    });

    expect(screen.getByTestId('rc-proceso-parcial')).toHaveTextContent(/parcial en curso/i);
  });

  it('NO marca "Parcial en curso" cuando está apagado', () => {
    render({
      data: ruta({ procesos: [proceso({ parcialEnCurso: false })] }),
      isPending: false,
      isError: false,
      error: null,
    });

    expect(screen.queryByTestId('rc-proceso-parcial')).not.toBeInTheDocument();
  });

  it('avisa cuando la orden no tiene ruta programada', () => {
    render({
      data: ruta({ rcActiva: false, procesos: [] }),
      isPending: false,
      isError: false,
      error: null,
    });

    expect(screen.getByTestId('rc-sin-ruta')).toBeInTheDocument();
  });

  it('muestra el error del API', () => {
    render({
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'No se pudo cargar la ruta.' },
    });

    expect(screen.getByTestId('rc-error')).toHaveTextContent('No se pudo cargar la ruta.');
  });

  it('ofrece "Imprimir plan" cuando hay RC y abre la URL del PDF', async () => {
    const usuario = userEvent.setup();
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    render({ data: ruta(), isPending: false, isError: false, error: null });

    const boton = screen.getByTestId('imprimir-plan-rc');
    expect(boton).toBeInTheDocument();
    await usuario.click(boton);
    expect(abrir).toHaveBeenCalledWith(
      '/api/ruta-critica/ordenes/100/plan-impreso',
      '_blank',
      'noopener',
    );
    abrir.mockRestore();
  });

  it('oculta "Imprimir plan" cuando la orden no tiene RC generada', () => {
    render({
      data: ruta({ rcActiva: false, procesos: [] }),
      isPending: false,
      isError: false,
      error: null,
    });

    expect(screen.queryByTestId('imprimir-plan-rc')).not.toBeInTheDocument();
  });
});
