import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden, PendientesOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CapturaCortePagina } from './CapturaCortePagina';

// ── Mocks de la capa de datos (sin red) ──────────────────────────────────────
const crearMutate = vi.fn();
vi.mock('@/api/etapas', () => ({
  useCrearCorte: () => ({ mutate: crearMutate, isPending: false }),
  usePendientesOrden: () => ({ data: pendientes, refetch: vi.fn() }),
  // El historial y sus hooks son inertes en esta prueba.
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

// Configurables: se re-programan por test para probar el gate `enabled` y el aviso de error.
const useProveedoresMock =
  vi.fn<(query: unknown, opciones?: { enabled?: boolean }) => Record<string, unknown>>();
const useRolesProveedorMock = vi.fn<() => Record<string, unknown>>();
vi.mock('@/api/proveedores', () => ({
  useProveedores: (query: unknown, opciones?: { enabled?: boolean }) =>
    useProveedoresMock(query, opciones),
  useRolesProveedor: () => useRolesProveedorMock(),
}));

// ── Datos de prueba ──────────────────────────────────────────────────────────
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
  requisitos: {
    tallas: true,
    avios: true,
    arte: 'no-aplica' as const,
    completa: true,
    faltantes: [],
  },
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

// Pendiente por cortar: Rojo CH 10 (orden − corte).
const pendientes: PendientesOrden = {
  idOrden: 1,
  folioOrden: 100,
  porCortar: [{ idColor: 3, color: 'Rojo', idTalla: 4, etiquetaTalla: 'CH', cantidad: 10 }],
  totalPorCortar: 10,
  cortadoTotal: 0,
  cortadoPorEnviar: [],
};

const sesion = () =>
  estadoSesionDePrueba(['produccion.corte', 'produccion.wip-ver', 'produccion.cancelar']);

/** Selecciona la orden de prueba (abre el popover del selector y clic en la opción). */
async function elegirOrden(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  await usuario.click(screen.getByTestId('selector-orden-busqueda'));
  await usuario.click(screen.getByTestId('selector-orden-opcion'));
}

describe('CapturaCortePagina (F3-E2)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    useProveedoresMock.mockReset();
    useRolesProveedorMock.mockReset();
    useProveedoresMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Corte SA' }] },
      isError: false,
      refetch: vi.fn(),
    });
    useRolesProveedorMock.mockReturnValue({
      data: [{ id: 9, codigo: 'corte', nombre: 'Corte' }],
      isError: false,
      refetch: vi.fn(),
    });
  });

  it('NO consulta cortadores sin rol resuelto (enabled=false, nunca lista sin filtro)', () => {
    // Roles aún sin resolver → idRolCorte undefined → la query de cortadores va deshabilitada.
    useRolesProveedorMock.mockReturnValue({ data: undefined, isError: false, refetch: vi.fn() });
    renderConProveedores(<CapturaCortePagina />, { sesion: sesion() });

    const ultima = useProveedoresMock.mock.calls.at(-1);
    expect(ultima?.[1]).toEqual({ enabled: false });
  });

  it('consulta cortadores con enabled=true una vez resuelto el rol "corte"', () => {
    renderConProveedores(<CapturaCortePagina />, { sesion: sesion() });

    const ultima = useProveedoresMock.mock.calls.at(-1);
    expect(ultima?.[1]).toEqual({ enabled: true });
  });

  it('avisa (reintentable) si falla el catálogo de cortadores', () => {
    useProveedoresMock.mockReturnValue({ data: undefined, isError: true, refetch: vi.fn() });
    renderConProveedores(<CapturaCortePagina />, { sesion: sesion() });

    expect(screen.getByTestId('corte-error-catalogo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('el botón guardar arranca DESHABILITADO (sin cortador ni cantidades)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaCortePagina />, { sesion: sesion() });
    await elegirOrden(usuario);
    expect(screen.getByTestId('corte-guardar')).toBeDisabled();
  });

  it('avisa del SOBRE-CORTE cuando se captura más que lo pendiente (decisión f)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaCortePagina />, { sesion: sesion() });
    await elegirOrden(usuario);

    // Captura CH = 15 (pendiente 10) → debe avisar de 5 de más.
    const celda = screen.getByTestId('corte-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '15');

    expect(screen.getByTestId('corte-aviso-sobrecorte')).toBeInTheDocument();
    expect(screen.getByTestId('corte-aviso-sobrecorte')).toHaveTextContent('5');
  });

  it('habilita guardar al elegir cortador y capturar cantidades, y envía al servicio', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaCortePagina />, { sesion: sesion() });
    await elegirOrden(usuario);

    await usuario.selectOptions(screen.getByTestId('corte-cortador'), '7');
    const celda = screen.getByTestId('corte-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '8');

    const guardar = screen.getByTestId('corte-guardar');
    expect(guardar).toBeEnabled();
    await usuario.click(guardar);
    expect(crearMutate).toHaveBeenCalledTimes(1);
    const [cuerpo] = crearMutate.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo.idCortador).toBe(7);
    expect(cuerpo.idOrden).toBe(1);
  });
});
