import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden, PendientesRecibir } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ReciboMaquilaPagina } from './ReciboMaquilaPagina';

// ── Mocks ────────────────────────────────────────────────────────────────────
const crearMutate = vi.fn();

vi.mock('@/api/recibos', () => ({
  useCrearRecibo: () => ({ mutate: crearMutate, isPending: false }),
  useCancelarRecibo: () => ({ mutate: vi.fn(), isPending: false }),
  usePendientesRecibir: () => ({ data: pendientes, refetch: vi.fn() }),
  urlImpresoRecibo: (id: number) => `/api/produccion/recibos/${id}/impreso`,
}));

// HistorialEtapasOrden consume `@/api/etapas`; mockeado para aislar la pantalla.
vi.mock('@/api/etapas', () => ({
  useEtapasOrden: () => ({
    data: { idOrden: 1, folioOrden: 100, etapas: [] },
    isPending: false,
    isError: false,
    error: null,
  }),
  useCancelarCorte: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarEnvio: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/ordenes', () => ({
  useOrden: () => ({ data: orden, isPending: false, isError: false, error: null }),
  useOrdenes: () => ({
    data: { datos: [orden], total: 1, pagina: 1, porPagina: 8, totalPaginas: 1 },
    isPending: false,
    isError: false,
  }),
}));

// Configurable: se re-programa por test para probar el aviso de error de catálogo.
const useTiposProcesoMock = vi.fn<() => Record<string, unknown>>();
vi.mock('@/api/tipos-proceso', () => ({
  useTiposProceso: () => useTiposProcesoMock(),
}));

const PROCESOS_OK = {
  data: {
    datos: [
      {
        id: 6,
        codigo: 'estampado',
        nombre: 'Estampado',
        generaEntradaPt: false,
        activo: true,
        creadoEn: '',
        creadoPorId: null,
        modificadoEn: '',
        modificadoPorId: null,
      },
    ],
  },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [{ id: 30, nombre: 'Estampados SA' }] } }),
  useRolesProveedor: () => ({
    data: [{ id: 12, codigo: 'estampado', nombre: 'Estampado' }],
  }),
}));

vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({ data: { datos: [{ id: 1, nombre: 'PT Central' }] } }),
}));

// ── Datos ────────────────────────────────────────────────────────────────────
const orden: Orden = {
  id: 1,
  folio: 100,
  idEmpresa: 1,
  estado: 'completa',
  idPedidoLinea: 1,
  idModelo: 1,
  codigoModelo: 'A-100',
  descripcionModelo: 'Playera',
  idCliente: 1,
  cliente: 'Liverpool',
  idMaquilero: null,
  maquilero: null,
  idEtiquetaMarca: null,
  etiquetaMarca: null,
  idTela: null,
  tela: null,
  fecha: null,
  fechaEntrega: null,
  observaciones: null,
  composicion: null,
  compForzada: false,
  obsMaquila: null,
  noCostear: false,
  fechaCompletada: '2026-06-18T00:00:00.000Z',
  motivoCancelada: null,
  ocCliente: null,
  tallasV1: null,
  maquilaOrd: null,
  aplicacionOrd: null,
  pagada: null,
  enRiesgo: null,
  siRC: null,
  rcViva: null,
  lineas: [
    {
      id: 1,
      idColor: 3,
      color: 'Rojo',
      pantone: null,
      tallas: [{ idTalla: 4, etiquetaTalla: 'CH', cantidad: 10 }],
      totalPiezas: 10,
    },
  ],
  totalPiezas: 10,
  referencias: [],
  comentarios: [],
  creadoEn: '2026-06-18T00:00:00.000Z',
  creadoPorId: null,
  modificadoEn: '2026-06-18T00:00:00.000Z',
  modificadoPorId: null,
};

// Pendiente por recibir de estampado (proceso 6): Rojo CH 5 enviado por recibir.
const pendientes: PendientesRecibir = {
  idOrden: 1,
  folioOrden: 100,
  porRecibir: [
    {
      idTipoProceso: 6,
      tipoProceso: 'Estampado',
      codigoProceso: 'estampado',
      generaEntradaPt: false,
      celdas: [{ idColor: 3, color: 'Rojo', idTalla: 4, etiquetaTalla: 'CH', cantidad: 5 }],
      totalPendiente: 5,
    },
  ],
};

const sesion = () =>
  estadoSesionDePrueba(['produccion.recibo', 'produccion.wip-ver', 'produccion.cancelar']);

async function elegirOrden(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  // El selector es un combobox popover: se abre (foco) y se elige la opción.
  await usuario.click(screen.getByTestId('recibo-selector-orden-busqueda'));
  await usuario.click(screen.getByTestId('recibo-selector-orden-opcion'));
}

describe('ReciboMaquilaPagina (F3-E4)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    useTiposProcesoMock.mockReset();
    useTiposProcesoMock.mockReturnValue(PROCESOS_OK);
  });

  it('avisa (reintentable) si falla un catálogo de la captura', () => {
    useTiposProcesoMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderConProveedores(<ReciboMaquilaPagina />, { sesion: sesion() });

    expect(screen.getByTestId('recibo-error-catalogo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('no deja exceder lo enviado: avisa y deshabilita guardar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ReciboMaquilaPagina />, { sesion: sesion() });
    await elegirOrden(usuario);

    await usuario.selectOptions(screen.getByTestId('recibo-proceso'), '6');
    await usuario.selectOptions(screen.getByTestId('recibo-maquilero'), '30');

    // Captura CH = 8 (enviado disponible 5) → aviso de exceso + guardar deshabilitado.
    const celda = screen.getByTestId('recibo-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '8');

    expect(screen.getByTestId('recibo-aviso-exceso')).toBeInTheDocument();
    expect(screen.getByTestId('recibo-guardar')).toBeDisabled();
  });

  it('captura un recibo (sin segundas) y al guardar llama a la mutación', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ReciboMaquilaPagina />, { sesion: sesion() });
    await elegirOrden(usuario);

    await usuario.selectOptions(screen.getByTestId('recibo-proceso'), '6');
    await usuario.selectOptions(screen.getByTestId('recibo-maquilero'), '30');

    const celda = screen.getByTestId('recibo-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '5');

    expect(screen.queryByTestId('recibo-aviso-exceso')).not.toBeInTheDocument();
    const guardar = screen.getByTestId('recibo-guardar');
    expect(guardar).toBeEnabled();

    await usuario.click(guardar);

    expect(crearMutate).toHaveBeenCalledTimes(1);
    const cuerpo = crearMutate.mock.calls[0]?.[0] as {
      idOrden: number;
      idTipoProceso: number;
      idMaquilero: number;
      lineas: { idColor: number; tallas: { idTalla: number; cantidad: number }[] }[];
    };
    expect(cuerpo).toMatchObject({
      idOrden: 1,
      idTipoProceso: 6,
      idMaquilero: 30,
      lineas: [{ idColor: 3, tallas: [{ idTalla: 4, cantidad: 5 }] }],
    });
  });
});
