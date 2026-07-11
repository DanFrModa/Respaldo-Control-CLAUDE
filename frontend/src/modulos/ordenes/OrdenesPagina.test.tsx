import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden, OrdenesPagina as TipoPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { OrdenesPagina } from './OrdenesPagina';

// Capa de datos controlada: las pruebas no tocan la red. `useOrdenes` captura la query.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useOrdenes = vi.fn<(query: unknown) => EstadoConsulta>();
let ultimaQuery: Record<string, unknown> | undefined;

vi.mock('@/api/ordenes', () => ({
  useOrdenes: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useOrdenes(query);
  },
  useOrden: () => ({ data: undefined, isPending: false, isError: false, error: null }),
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
// Pedidos (selector del diálogo de alta): inerte.
vi.mock('@/api/pedidos', () => ({
  usePedidos: () => ({ data: { datos: [] }, isPending: false, isError: false, error: null }),
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

function pagina(datos: Orden[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

function consultaConDatos(datos: Orden[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

// "Nueva orden" abre el constructor de PEDIDO (R3): exige tambien pedidos.administrar.
const PERM_TODOS = [
  'ordenes.ver',
  'ordenes.administrar',
  'ordenes.cancelar',
  'pedidos.administrar',
] as const;

describe('<OrdenesPagina>', () => {
  beforeEach(() => {
    useOrdenes.mockReset();
    ultimaQuery = undefined;
    useCamposCliente.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it('lista las órdenes que devuelve el API', () => {
    useOrdenes.mockReturnValue(consultaConDatos([orden(1, 101), orden(2, 102)]));
    renderConProveedores(<OrdenesPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    expect(screen.getAllByTestId('fila-orden')).toHaveLength(2);
    expect(screen.getByText('Orden 102')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay resultados', () => {
    useOrdenes.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<OrdenesPagina />, { sesion: estadoSesionDePrueba(['ordenes.ver']) });

    expect(screen.getByText('No hay órdenes que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un botón de reintento cuando falla', () => {
    useOrdenes.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<OrdenesPagina />, { sesion: estadoSesionDePrueba(['ordenes.ver']) });

    expect(screen.getByText('No se pudo cargar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useOrdenes.mockReturnValue(consultaConDatos([orden(1, 101)]));
    renderConProveedores(<OrdenesPagina />, { sesion: estadoSesionDePrueba(['ordenes.ver']) });

    expect(screen.queryByTestId('nuevo-orden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cancelar-orden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guardar-encabezado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guardar-matriz')).not.toBeInTheDocument();
  });

  it('muestra el botón "Nueva orden" con ordenes.administrar + pedidos.administrar', () => {
    useOrdenes.mockReturnValue(consultaConDatos([orden(1, 101)]));
    renderConProveedores(<OrdenesPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    expect(screen.getByTestId('nuevo-orden')).toBeInTheDocument();
  });

  it('sin pedidos.administrar NO ofrece "Nueva orden" (abre el constructor de pedido, R3)', () => {
    useOrdenes.mockReturnValue(consultaConDatos([orden(1, 101)]));
    renderConProveedores(<OrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver', 'ordenes.administrar', 'ordenes.cancelar']),
    });

    expect(screen.queryByTestId('nuevo-orden')).not.toBeInTheDocument();
    // La edición de la orden (matriz/encabezado) sigue disponible con ordenes.administrar.
    expect(screen.getByTestId('cancelar-orden')).toBeInTheDocument();
  });

  it('muestra el badge de estado DERIVADO (sin botón "marcar completa")', () => {
    useOrdenes.mockReturnValue(consultaConDatos([orden(1, 101, { estado: 'completa' })]));
    renderConProveedores(<OrdenesPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    const detalle = screen.getByTestId('detalle-orden');
    expect(within(detalle).getAllByTestId('estado-orden')[0]).toHaveTextContent('Completa');
    expect(
      within(detalle).queryByRole('button', { name: /marcar completa/i }),
    ).not.toBeInTheDocument();
  });

  it('una orden cancelada muestra su motivo y no ofrece cancelar', () => {
    useOrdenes.mockReturnValue(consultaConDatos([orden(3, 103, { estado: 'cancelada' })]));
    renderConProveedores(<OrdenesPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    const detalle = screen.getByTestId('detalle-orden');
    expect(within(detalle).getByText(/Cliente canceló/)).toBeInTheDocument();
    expect(screen.queryByTestId('cancelar-orden')).not.toBeInTheDocument();
  });

  it('cancelar exige un motivo: el botón de confirmar arranca deshabilitado', async () => {
    const usuario = userEvent.setup();
    useOrdenes.mockReturnValue(consultaConDatos([orden(7, 107)]));
    renderConProveedores(<OrdenesPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    await usuario.click(screen.getByTestId('cancelar-orden'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByRole('heading', { name: /Cancelar orden/ })).toBeInTheDocument();
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
    useOrdenes.mockReturnValue(consultaConDatos([orden(1, 101)]));
    renderConProveedores(<OrdenesPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    const detalle = screen.getByTestId('detalle-orden');
    // El campo activo aparece; el inactivo NO.
    expect(within(detalle).getByLabelText('Orden de compra')).toBeInTheDocument();
    expect(within(detalle).queryByLabelText('Temporada')).not.toBeInTheDocument();
  });

  it('la búsqueda se refleja en la consulta del API', async () => {
    const usuario = userEvent.setup();
    useOrdenes.mockReturnValue(consultaConDatos([orden(1, 101)]));
    renderConProveedores(<OrdenesPagina />, { sesion: estadoSesionDePrueba(['ordenes.ver']) });

    expect(ultimaQuery?.busqueda).toBeUndefined();
    await usuario.type(screen.getByTestId('buscar-orden'), '101');
    await vi.waitFor(() => expect(ultimaQuery?.busqueda).toBe('101'));
  });
});
