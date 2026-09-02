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
const actualizarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;

vi.mock('@/api/pedidos', () => ({
  usePedidos: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return usePedidos(query);
  },
  useCrearPedido: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarPedido: () => ({ mutate: actualizarMutate, isPending: false }),
  useCopiarPedido: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarPedido: () => ({ mutate: cancelarMutate, isPending: false }),
  // Panel de pedidos reales (detalle): inerte.
  usePedidosReales: () => ({ data: [], isPending: false, isError: false, error: null }),
  useCrearPedidoReal: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarPedidoReal: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarSeguimiento: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Selectores del diálogo (clientes/modelos): traen SOLO las opciones que usan los pedidos de
// ejemplo (cliente 3 y el modelo del renglón), para que al abrir el diálogo de edición los
// `<select>` conserven el valor del `reset` y el formulario pueda enviarse. Con las listas vacías,
// el select caía a "" y la validación de captura bloqueaba el submit.
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [{ id: 3, nombre: 'Liverpool' }] }, isPending: false }),
}));
vi.mock('@/api/modelos', () => ({
  useModelos: () => ({
    data: { datos: [{ id: 1060, codigo: 'A-100', descripcion: null }] },
    isPending: false,
  }),
}));

/**
 * Un renglón de ejemplo. `numerosProduccion` por defecto VACÍO: desde V1-E3 el renglón apunta a su
 * modelo de desarrollo, así que sin OPs no hay ningún nº de 5 dígitos que enseñar.
 */
function renglon(
  id: number,
  codigo: string,
  cantidad: number,
  precio: number | null,
  numeros: { numerosProduccion?: number[]; numeroProduccion?: number | null } = {},
) {
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
    idDesarrollo: null,
    numeroProduccion: numeros.numeroProduccion ?? null,
    numerosProduccion: numeros.numerosProduccion ?? [],
  };
}

/** Un pedido de ejemplo. */
function pedido(
  id: number,
  folio: number,
  cliente: string,
  opciones: { cancelado?: boolean; precio?: number | null; noProducir?: boolean } = {},
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
    noProducir: opciones.noProducir ?? false,
    pedCancelado: opciones.cancelado ?? false,
    ocCliente: null,
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
    actualizarMutate.mockReset();
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

    await usuario.click(screen.getByTestId('confirmar-cancelar-pedido'));
    expect(cancelarMutate).toHaveBeenCalledWith({ id: 7, cuerpo: {} }, expect.anything());
  });

  /**
   * ⭐ V1-E4 punto 5. El diálogo de antes prometía que el pedido "deja de producirse" y era
   * MENTIRA: sus OPs seguían vivas, cortándose. Nadie lo nota probando a mano —la cancelación
   * "funciona"—, así que la promesa (y la forma de cumplirla) se cementan aquí.
   */
  describe('⭐ cancelar dice la verdad sobre las OPs (V1-E4)', () => {
    it('avisa que cancelar NO detiene las órdenes de producción', async () => {
      const usuario = userEvent.setup();
      usePedidos.mockReturnValue(consultaConDatos([pedido(7, 107, 'Liverpool')]));
      renderConProveedores(<PedidosPagina />, {
        sesion: estadoSesionDePrueba([...PERM_TODOS, 'ordenes.cancelar']),
      });

      await usuario.click(screen.getByTestId('desactivar-pedido'));
      const dialogo = await screen.findByRole('dialog');

      expect(dialogo).toHaveTextContent(/NO detiene sus órdenes de producción/i);
    });

    it('con la casilla marcada + motivo, manda cancelarOrdenes y el motivo', async () => {
      const usuario = userEvent.setup();
      usePedidos.mockReturnValue(consultaConDatos([pedido(7, 107, 'Liverpool')]));
      renderConProveedores(<PedidosPagina />, {
        sesion: estadoSesionDePrueba([...PERM_TODOS, 'ordenes.cancelar']),
      });

      await usuario.click(screen.getByTestId('desactivar-pedido'));
      await usuario.click(await screen.findByTestId('cancelar-tambien-ordenes'));
      await usuario.type(screen.getByTestId('cancelar-pedido-motivo'), 'El cliente canceló');
      await usuario.click(screen.getByTestId('confirmar-cancelar-pedido'));

      expect(cancelarMutate).toHaveBeenCalledWith(
        { id: 7, cuerpo: { cancelarOrdenes: true, motivo: 'El cliente canceló' } },
        expect.anything(),
      );
    });

    it('marcada SIN motivo no deja confirmar (toda OP cancelada lleva su porqué)', async () => {
      const usuario = userEvent.setup();
      usePedidos.mockReturnValue(consultaConDatos([pedido(7, 107, 'Liverpool')]));
      renderConProveedores(<PedidosPagina />, {
        sesion: estadoSesionDePrueba([...PERM_TODOS, 'ordenes.cancelar']),
      });

      await usuario.click(screen.getByTestId('desactivar-pedido'));
      await usuario.click(await screen.findByTestId('cancelar-tambien-ordenes'));

      expect(screen.getByTestId('confirmar-cancelar-pedido')).toBeDisabled();
      expect(cancelarMutate).not.toHaveBeenCalled();
    });

    // §Post-F9.68 — esconder, no negar: sin `ordenes.cancelar` la casilla no
    // existe Y no se explica por qué; el aviso tampoco manda a marcarla.
    it('sin `ordenes.cancelar` la casilla NO se ofrece, y nada habla de permisos', async () => {
      const usuario = userEvent.setup();
      usePedidos.mockReturnValue(consultaConDatos([pedido(7, 107, 'Liverpool')]));
      renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

      await usuario.click(screen.getByTestId('desactivar-pedido'));
      const dialogo = await screen.findByRole('dialog');

      expect(screen.queryByTestId('cancelar-tambien-ordenes')).not.toBeInTheDocument();
      expect(dialogo.textContent).not.toMatch(/permiso/i);
      // El aviso NO puede mandar a una casilla que no está.
      expect(dialogo).not.toHaveTextContent(/márcalas abajo/i);
      expect(dialogo).toHaveTextContent(/una por una desde Órdenes/i);
    });

    it('CON `ordenes.cancelar` el aviso sí manda a la casilla (gemela positiva)', async () => {
      const usuario = userEvent.setup();
      usePedidos.mockReturnValue(consultaConDatos([pedido(7, 107, 'Liverpool')]));
      renderConProveedores(<PedidosPagina />, {
        sesion: estadoSesionDePrueba([...PERM_TODOS, 'ordenes.cancelar']),
      });

      await usuario.click(screen.getByTestId('desactivar-pedido'));
      const dialogo = await screen.findByRole('dialog');

      expect(await screen.findByTestId('cancelar-tambien-ordenes')).toBeInTheDocument();
      expect(dialogo).toHaveTextContent(/márcalas abajo/i);
    });
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

  it('«No producir» se VE en el detalle y con su badge (V1-E3a, §Post-F9.36 punto 3)', () => {
    // La bandera hace que el servidor RECHACE "Generar OP" (`dominio/produccion/ordenes.ts`) y hasta
    // V1-E3a no aparecía en NINGUNA pantalla: los pedidos migrados de Access la traen, así que el
    // bloqueo no tenía salida ni explicación.
    usePedidos.mockReturnValue(
      consultaConDatos([pedido(4, 104, 'Liverpool', { noProducir: true })]),
    );
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    const detalle = screen.getByTestId('detalle-pedido');
    expect(within(detalle).getByTestId('pedido-badge-no-producir')).toBeInTheDocument();
    // Dos apariciones: el badge del encabezado y la etiqueta del campo del detalle.
    expect(within(detalle).getAllByText('No producir')).toHaveLength(2);
    expect(
      within(detalle).getByText(/no se le pueden generar órdenes de producción/),
    ).toBeInTheDocument();
  });

  it('un pedido normal NO trae el badge de «No producir»', () => {
    usePedidos.mockReturnValue(consultaConDatos([pedido(5, 105, 'Liverpool')]));
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    expect(screen.queryByTestId('pedido-badge-no-producir')).not.toBeInTheDocument();
  });

  it('el diálogo de edición trae la casilla «No producir» marcada y editable', async () => {
    const usuario = userEvent.setup();
    usePedidos.mockReturnValue(
      consultaConDatos([pedido(6, 106, 'Liverpool', { noProducir: true })]),
    );
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    await usuario.click(screen.getByTestId('editar-pedido'));
    const dialogo = await screen.findByRole('dialog');
    const casilla = within(dialogo).getByTestId('pedido-no-producir');
    expect(casilla).toBeChecked();
    // Y se puede DESMARCAR: es la salida que el bloqueo no tenía. Se guarda y el PATCH lleva la
    // bandera en `false` — sin esto el pedido quedaría atrapado sin poder generar OP nunca.
    await usuario.click(casilla);
    expect(casilla).not.toBeChecked();
    await usuario.click(screen.getByTestId('guardar-pedido'));
    await vi.waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    expect(actualizarMutate.mock.calls[0]?.[0]).toMatchObject({
      id: 6,
      cuerpo: { noProducir: false },
    });
  });

  it('la búsqueda se refleja en la consulta del API', async () => {
    const usuario = userEvent.setup();
    usePedidos.mockReturnValue(consultaConDatos([pedido(1, 101, 'Liverpool')]));
    renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba(['pedidos.ver']) });

    expect(ultimaQuery?.busqueda).toBeUndefined();
    await usuario.type(screen.getByTestId('buscar-pedido'), '101');
    await vi.waitFor(() => expect(ultimaQuery?.busqueda).toBe('101'));
  });

  /**
   * ⭐⭐ V1-E3 (fila 0.089) — **el nº de 5 dígitos que el detalle había perdido.**
   *
   * Hasta V1-E3 salía aquí POR ACCIDENTE: el renglón pinta `codigoModelo` y ese código *era* el de
   * producción porque generar la OP transformaba el modelo. Hoy el desarrollo NO se transforma, así
   * que el código que se pinta es el de desarrollo y el número vive en los modelos POR COLOR de sus
   * OPs (`numerosProduccion`, agregado en el servidor) — igual que en la vista del MES.
   */
  describe('⭐⭐ nº de producción por color en el renglón (V1-E3)', () => {
    /** El pedido 1 con un renglón de DESARROLLO y los números que le dé el servidor. */
    function pedidoConNumeros(numerosProduccion: number[]): Pedido {
      return {
        ...pedido(1, 101, 'Liverpool'),
        lineas: [renglon(101, 'CYA-26-71-009', 10, 50, { numerosProduccion })],
      };
    }

    it('los enseña junto al código, uno por color y separados', () => {
      usePedidos.mockReturnValue(consultaConDatos([pedidoConNumeros([71_001, 71_002])]));
      renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

      const fila = within(screen.getByTestId('detalle-pedido')).getByTestId('renglon-pedido');
      // El código que se pinta sigue siendo el del DESARROLLO…
      expect(within(fila).getByText('CYA-26-71-009')).toBeInTheDocument();
      // …y el número de producción sale APARTE, uno por color.
      expect(within(fila).getByTestId('renglon-numeros-produccion')).toHaveTextContent(
        'prod. #71001 · #71002',
      );
    });

    it('🔴 LA GEMELA — sin números NO pinta nada (ni "prod." ni un cero)', () => {
      usePedidos.mockReturnValue(consultaConDatos([pedidoConNumeros([])]));
      renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

      const fila = within(screen.getByTestId('detalle-pedido')).getByTestId('renglon-pedido');
      expect(within(fila).queryByTestId('renglon-numeros-produccion')).not.toBeInTheDocument();
      expect(within(fila).queryByText(/prod\./)).not.toBeInTheDocument();
    });

    it('el renglón LEGADO cae a su propio `numeroProduccion` (lo nuevo no se comió lo viejo)', () => {
      const legado: Pedido = {
        ...pedido(1, 101, 'Liverpool'),
        lineas: [renglon(101, '51114', 10, 50, { numeroProduccion: 51_114 })],
      };
      usePedidos.mockReturnValue(consultaConDatos([legado]));
      renderConProveedores(<PedidosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

      const fila = within(screen.getByTestId('detalle-pedido')).getByTestId('renglon-pedido');
      expect(within(fila).getByTestId('renglon-numeros-produccion')).toHaveTextContent(
        'prod. #51114',
      );
    });
  });
});
