import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Pedido, PedidosPagina as TipoPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { PedidosPagina } from './PedidosPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `usePedidos` captura la query
// con la que se le llama. Los hooks de pedidos reales (panel del detalle) son inertes, y los
// hooks de selectores (clientes/modelos del diálogo) también.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const usePedidos = vi.fn<(query: unknown) => EstadoConsulta>();
const cancelarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;

vi.mock('@/api/pedidos', () => ({
  usePedidos: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return usePedidos(query);
  },
  usePedido: () => ({ data: undefined, isPending: false, isError: false, error: null }),
  useCrearPedido: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarPedido: () => ({ mutate: vi.fn(), isPending: false }),
  useCopiarPedido: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarPedido: () => ({ mutate: cancelarMutate, isPending: false }),
  // Panel de pedidos reales (detalle): inerte.
  usePedidosReales: () => ({ data: [], isPending: false, isError: false, error: null }),
  useCrearPedidoReal: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarPedidoReal: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarSeguimiento: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Selectores del diálogo (clientes/modelos): inertes (no se abren en estas pruebas).
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/modelos', () => ({
  useModelos: () => ({ data: { datos: [] }, isPending: false }),
}));

/** Un renglón de ejemplo. */
function renglon(id: number, codigo: string, cantidad: number, precio: number | null) {
  return {
    id,
    idModelo: id * 10,
    codigoModelo: codigo,
    descripcionModelo: null,
    urlFotoModelo: null,
    cantidadPedida: cantidad,
    precio,
    importe: precio === null ? null : cantidad * precio,
    entregadoParcialV1: null,
    cantFaltanteV1: null,
  };
}

/** Un pedido de ejemplo. */
function pedido(
  id: number,
  folio: number,
  cliente: string,
  opciones: { cancelado?: boolean; precio?: number | null } = {},
): Pedido {
  const precio = opciones.precio === undefined ? 50 : opciones.precio;
  return {
    id,
    folio,
    idEmpresa: 1,
    idCliente: 3,
    cliente,
    fechaPedido: '2026-06-15',
    fechaDe: null,
    fechaHasta: null,
    fechaTela: '2026-06-20',
    fechaElaboracion: '2026-06-22',
    entregadoTienda: false,
    noProducir: false,
    pedCancelado: opciones.cancelado ?? false,
    idOrdCompraV1: null,
    totalPiezas: 10,
    totalImporte: precio === null ? null : 10 * precio,
    lineas: [renglon(100 + id, 'A-100', 10, precio)],
    creadoEn: '2026-06-15T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-06-15T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function pagina(datos: Pedido[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

function consultaConDatos(datos: Pedido[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

const PERM_TODOS = [
  'pedidos.ver',
  'pedidos.administrar',
  'pedidos.importes',
  'pedidos-reales.administrar',
] as const;

describe('<PedidosPagina>', () => {
  beforeEach(() => {
    usePedidos.mockReset();
    cancelarMutate.mockReset();
    ultimaQuery = undefined;
  });

  it('lista los pedidos que devuelve el API', () => {
    usePedidos.mockReturnValue(
      consultaConDatos([pedido(1, 101, 'Liverpool'), pedido(2, 102, 'Pumas')]),
    );
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    expect(screen.getAllByTestId('fila-pedido')).toHaveLength(2);
    expect(screen.getByText('Pedido 102')).toBeInTheDocument();
  });

  it('muestra las fechas de tela y elaboración del pedido en el detalle', () => {
    usePedidos.mockReturnValue(consultaConDatos([pedido(1, 101, 'Liverpool')]));
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba(['pedidos.ver']) });

    const detalle = screen.getByTestId('detalle-pedido');
    expect(within(detalle).getByText('Fecha de tela')).toBeInTheDocument();
    expect(within(detalle).getByText('Fecha de elaboración')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay resultados', () => {
    usePedidos.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba(['pedidos.ver']) });

    expect(screen.getByText('No hay pedidos que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un botón de reintento cuando falla', () => {
    usePedidos.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba(['pedidos.ver']) });

    expect(screen.getByText('No se pudo cargar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    usePedidos.mockReturnValue(consultaConDatos([pedido(1, 101, 'Liverpool')]));
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba(['pedidos.ver']) });

    expect(screen.queryByTestId('nuevo-pedido')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-pedido')).not.toBeInTheDocument();
    expect(screen.queryByTestId('copiar-pedido')).not.toBeInTheDocument();
  });

  it('muestra los importes (precio/total) solo con permiso pedidos.importes', () => {
    usePedidos.mockReturnValue(consultaConDatos([pedido(1, 101, 'Liverpool', { precio: 50 })]));
    renderConProveedores(<PedidosPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver', 'pedidos.importes']),
    });

    const detalle = screen.getByTestId('detalle-pedido');
    // El encabezado de columna "Precio" aparece y el importe formateado en $.
    expect(within(detalle).getByText('Precio')).toBeInTheDocument();
    expect(within(detalle).getAllByText(/\$\s?500/).length).toBeGreaterThan(0);
  });

  it('NO muestra importes sin el permiso pedidos.importes (precio viene null)', () => {
    // Sin permiso, el backend manda precio/importe/total en null.
    usePedidos.mockReturnValue(consultaConDatos([pedido(1, 101, 'Liverpool', { precio: null })]));
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba(['pedidos.ver']) });

    const detalle = screen.getByTestId('detalle-pedido');
    expect(within(detalle).queryByText('Precio')).not.toBeInTheDocument();
    expect(within(detalle).queryByText('Importe')).not.toBeInTheDocument();
    // Las piezas SÍ se ven.
    expect(within(detalle).getByText('Total de piezas')).toBeInTheDocument();
  });

  it('pide confirmación antes de cancelar y llama a la mutación al confirmar', async () => {
    const usuario = userEvent.setup();
    usePedidos.mockReturnValue(consultaConDatos([pedido(7, 107, 'Liverpool')]));
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    await usuario.click(screen.getByTestId('desactivar-pedido'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByRole('heading', { name: 'Cancelar pedido' })).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(cancelarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('abre el diálogo de copiar con selección múltiple de renglones', async () => {
    const usuario = userEvent.setup();
    usePedidos.mockReturnValue(consultaConDatos([pedido(5, 105, 'Liverpool')]));
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    await usuario.click(screen.getByTestId('copiar-pedido'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByRole('heading', { name: /Copiar pedido/ })).toBeInTheDocument();
    // El renglón del pedido aparece con su checkbox (marcado por defecto).
    const check = within(dialogo).getByTestId('copiar-renglon-check');
    expect(check).toBeChecked();
  });

  it('un pedido cancelado muestra el badge "Cancelado" y no ofrece copiar', () => {
    usePedidos.mockReturnValue(
      consultaConDatos([pedido(3, 103, 'Liverpool', { cancelado: true })]),
    );
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    const detalle = screen.getByTestId('detalle-pedido');
    expect(within(detalle).getByText('Cancelado')).toBeInTheDocument();
    expect(screen.queryByTestId('copiar-pedido')).not.toBeInTheDocument();
  });

  it('la búsqueda se refleja en la consulta del API', async () => {
    const usuario = userEvent.setup();
    usePedidos.mockReturnValue(consultaConDatos([pedido(1, 101, 'Liverpool')]));
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba(['pedidos.ver']) });

    expect(ultimaQuery?.busqueda).toBeUndefined();
    await usuario.type(screen.getByTestId('buscar-pedido'), '101');
    await vi.waitFor(() => expect(ultimaQuery?.busqueda).toBe('101'));
  });
});
