import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoOrden } from './DialogoOrden';

// Capa de datos controlada: las pruebas no tocan la red. `useOrden` alimenta el diálogo.
type EstadoOrden = {
  data: Orden | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
};
const useOrden = vi.fn<() => EstadoOrden>();

vi.mock('@/api/ordenes', () => ({
  useOrden: () => useOrden(),
  useActualizarOrden: () => ({ mutate: vi.fn(), isPending: false }),
  useGuardarMatriz: () => ({ mutate: vi.fn(), isPending: false }),
  useCopiarMatriz: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarOrden: () => ({ mutate: vi.fn(), isPending: false }),
  useGuardarReferencias: () => ({ mutate: vi.fn(), isPending: false }),
  useAgregarComentario: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Catálogos/selectores de los paneles del detalle: inertes.
vi.mock('@/api/modelos', () => ({
  useFichaModelo: () => ({ data: { idCurvaTalla: null }, isPending: false, isError: false }),
  useFotosModelo: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/api/colores', () => ({
  useColores: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/tallas', () => ({
  useTallasActivas: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/etiquetas-marca', () => ({
  useEtiquetasMarca: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/telas', () => ({
  useTelas: () => ({ data: { datos: [] }, isPending: false }),
}));
// Campos de referencia del cliente (D7) — controlado por prueba.
const useCamposCliente = vi.fn<(id: number | undefined) => unknown>(() => ({
  data: [],
  isPending: false,
  isError: false,
  error: null,
}));
vi.mock('@/api/clientes', () => ({
  useCamposCliente: (id: number | undefined) => useCamposCliente(id),
}));
// Sección "Adjuntos" del detalle (F8-E6): se renderiza siempre; se mockea para no tocar la red.
vi.mock('@/api/adjuntos-orden', () => ({
  useAdjuntosOrden: () => ({ data: [], isPending: false, isError: false }),
  useSubirAdjuntoOrden: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarAdjuntoOrden: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Una orden de ejemplo. */
function orden(
  id: number,
  folio: number,
  opciones: { estado?: Orden['estado']; idCliente?: number } = {},
): Orden {
  return {
    id,
    folio,
    idEmpresa: 1,
    estado: opciones.estado ?? 'capturada',
    idPedidoLinea: 500 + id,
    idModelo: 10,
    codigoModelo: 'A-100',
    descripcionModelo: 'Playera',
    idCliente: opciones.idCliente ?? 3,
    cliente: 'Liverpool',
    idMaquilero: null,
    maquilero: null,
    idEtiquetaMarca: null,
    etiquetaMarca: null,
    idTela: null,
    tela: null,
    fecha: '2026-06-15',
    fechaEntrega: '2026-06-30',
    observaciones: null,
    composicion: null,
    compForzada: false,
    obsMaquila: null,
    noCostear: false,
    fechaCompletada: null,
    motivoCancelada: opciones.estado === 'cancelada' ? 'Cliente canceló' : null,
    ocCliente: null,
    tallasV1: null,
    maquilaOrd: null,
    aplicacionOrd: null,
    pagada: null,
    enRiesgo: null,
    siRC: null,
    rcViva: null,
    lineas: [],
    totalPiezas: 0,
    referencias: [],
    comentarios: [],
    creadoEn: '2026-06-15T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-06-15T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function consultaConOrden(datos: Orden): EstadoOrden {
  return { data: datos, isPending: false, isError: false, error: null };
}

// La edición completa exige `ordenes.administrar`; cancelar exige `ordenes.cancelar`.
const PERM_TODOS = ['ordenes.ver', 'ordenes.administrar', 'ordenes.cancelar'] as const;

/** Renderiza el diálogo abierto para la orden dada, con la sesión indicada. */
function renderDialogo(o: Orden, permisos: Parameters<typeof estadoSesionDePrueba>[0]): void {
  useOrden.mockReturnValue(consultaConOrden(o));
  renderConProveedores(<DialogoOrden abierto idOrden={o.id} alCerrar={vi.fn()} />, {
    sesion: estadoSesionDePrueba(permisos),
  });
}

describe('<DialogoOrden>', () => {
  beforeEach(() => {
    useOrden.mockReset();
    useCamposCliente.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it('muestra el detalle de la orden (encabezado + matriz)', () => {
    renderDialogo(orden(1, 101), [...PERM_TODOS]);

    expect(screen.getByTestId('dialogo-orden')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Orden 101/ })).toBeInTheDocument();
    expect(screen.getByTestId('detalle-orden')).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    renderDialogo(orden(1, 101), ['ordenes.ver']);

    expect(screen.queryByTestId('cancelar-orden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guardar-encabezado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guardar-matriz')).not.toBeInTheDocument();
  });

  it('muestra el badge de estado DERIVADO (sin botón "marcar completa")', () => {
    renderDialogo(orden(1, 101, { estado: 'completa' }), [...PERM_TODOS]);

    const detalle = screen.getByTestId('detalle-orden');
    expect(within(detalle).getAllByTestId('estado-orden')[0]).toHaveTextContent('Completa');
    expect(
      within(detalle).queryByRole('button', { name: /marcar completa/i }),
    ).not.toBeInTheDocument();
  });

  it('una orden cancelada muestra su motivo y no ofrece cancelar', () => {
    renderDialogo(orden(3, 103, { estado: 'cancelada' }), [...PERM_TODOS]);

    const detalle = screen.getByTestId('detalle-orden');
    expect(within(detalle).getByText(/Cliente canceló/)).toBeInTheDocument();
    expect(screen.queryByTestId('cancelar-orden')).not.toBeInTheDocument();
  });

  it('cancelar exige un motivo: el botón de confirmar arranca deshabilitado', async () => {
    const usuario = userEvent.setup();
    renderDialogo(orden(7, 107), [...PERM_TODOS]);

    await usuario.click(screen.getByTestId('cancelar-orden'));
    // El diálogo de cancelación (Radix) se identifica por su encabezado, no por rol genérico:
    // el propio panel de edición también es un `dialog`.
    expect(await screen.findByRole('heading', { name: /Cancelar orden/ })).toBeInTheDocument();
    // Sin motivo, confirmar está deshabilitado.
    expect(screen.getByTestId('confirmar-cancelar-orden')).toBeDisabled();
    // Con motivo, se habilita.
    await usuario.type(screen.getByTestId('orden-motivo-cancelar'), 'Falta de tela');
    expect(screen.getByTestId('confirmar-cancelar-orden')).toBeEnabled();
  });

  it('muestra los campos de referencia ACTIVOS del cliente de la orden (D7)', () => {
    useCamposCliente.mockReturnValue({
      data: [
        { id: 1, etiqueta: 'Orden de compra', tipo: 'TEXTO', activo: true, orden: 0 },
        { id: 2, etiqueta: 'Temporada', tipo: 'TEXTO', activo: false, orden: 1 },
      ],
      isPending: false,
      isError: false,
      error: null,
    });
    renderDialogo(orden(1, 101), [...PERM_TODOS]);

    const detalle = screen.getByTestId('detalle-orden');
    // El campo activo aparece; el inactivo NO.
    expect(within(detalle).getByLabelText('Orden de compra')).toBeInTheDocument();
    expect(within(detalle).queryByLabelText('Temporada')).not.toBeInTheDocument();
  });
});
