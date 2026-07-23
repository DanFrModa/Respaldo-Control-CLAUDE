import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden, OrdenCentro } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CentroOrdenesPagina } from './CentroOrdenesPagina';

/**
 * Pruebas de `<CentroOrdenesPagina>` (rediseño jul-2026, petición de Daniel):
 *  1) la FOTO del modelo se muestra ARRIBA del detalle (zona fija, sin scroll), no enterrada;
 *  2) la LISTA de órdenes se navega con las FLECHAS del teclado (↑/↓), sin romper el buscador;
 *  3) el DEEP-LINK (buscador ⌘K) deja la orden seleccionada EN LA LISTA (buscador = folio); y
 *  4) los filtros de select llevan su ✕ para quitarlos.
 * La capa de datos y los paneles pesados van simulados (sin red).
 */

// ── Capa de datos simulada ────────────────────────────────────────────────────
type EstadoCentro = {
  data: { datos: OrdenCentro[]; total: number; totalPaginas: number } | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: { message: string } | null;
  refetch: () => void;
};
// Los mocks reciben la QUERY/el id para que cada prueba conteste según los filtros (deep-link).
const useOrdenesCentro = vi.fn<(query?: unknown) => EstadoCentro>();
const useFotosModelo = vi.fn<() => { data: unknown[] }>();
const useOrden = vi.fn<(id?: number) => unknown>();

vi.mock('@/api/ordenes-centro', () => ({
  useOrdenesCentro: (query: unknown) => useOrdenesCentro(query),
}));
vi.mock('@/api/ordenes', () => ({
  useOrden: (id?: number) => useOrden(id),
}));
vi.mock('@/api/modelos', () => ({
  useFotosModelo: () => useFotosModelo(),
}));
// Fotos subidas a la orden (adjuntos): no intervienen en estas pruebas → siempre vacío.
vi.mock('@/api/adjuntos-orden', () => ({
  useAdjuntosOrden: () => ({ data: [] }),
  useSubirAdjuntoOrden: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarAdjuntoOrden: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isFetching: false }),
}));
vi.mock('@/api/empresas', () => ({
  useEmpresas: () => ({ data: [] }),
}));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isFetching: false }),
  useRolesProveedor: () => ({ data: [] }),
}));
vi.mock('@/api/liga-orden', () => ({
  useSugerenciaLiga: () => ({ data: undefined }),
  useExpedienteOrden: () => ({ data: undefined }),
}));
vi.mock('@/api/ordenes-consulta', () => ({
  imprimirOrden: vi.fn(),
}));
// Paneles pesados del detalle: no intervienen en estas pruebas.
vi.mock('./PanelPreciosOrden', () => ({ PanelPreciosOrden: () => null }));
vi.mock('@/modulos/ruta-critica/PanelRutaOrden', () => ({ PanelRutaOrden: () => null }));

// ── Fixtures ──────────────────────────────────────────────────────────────────
function fila(id: number, folio: number): OrdenCentro {
  return {
    id,
    folio,
    idEmpresa: 1,
    empresa: 'FR',
    codigoModelo: `M-${folio}`,
    pedidoCliente: null,
    cantOrdenada: 100,
    cantCortada: 0,
    maquilero: null,
    numMaquileros: 0,
    estampador: null,
    folioPedido: null,
    ocTelaFolio: null,
    mesEntrega: null,
    cliente: `Cliente ${folio}`,
    estado: 'capturada',
  } as unknown as OrdenCentro;
}

function ordenDetalle(id = 1, folio = 101): Orden {
  return {
    id,
    folio,
    codigoModelo: `M-${folio}`,
    idModelo: 55,
    cliente: `Cliente ${folio}`,
    estado: 'capturada',
    referencias: [],
    lineas: [],
    totalPiezas: 0,
    ocCliente: null,
  } as unknown as Orden;
}

/** Estado "resuelto" de `useOrden` para el detalle. */
function detalleResuelto(orden: Orden): unknown {
  return { data: orden, isPending: false, isError: false, error: null };
}

function conFilas(filas: OrdenCentro[]): EstadoCentro {
  return {
    data: { datos: filas, total: filas.length, totalPaginas: 1 },
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<CentroOrdenesPagina>', () => {
  beforeEach(() => {
    useOrdenesCentro.mockReset();
    useFotosModelo.mockReset();
    useFotosModelo.mockReturnValue({ data: [] });
    useOrden.mockReset();
    useOrden.mockImplementation((id?: number) =>
      detalleResuelto(ordenDetalle(id ?? 1, 100 + (id ?? 1))),
    );
  });

  it('muestra las MINIATURAS del modelo ARRIBA del detalle (zona fija, no en el scroll)', () => {
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
    useFotosModelo.mockReturnValue({
      data: [{ idFoto: 1, urlDescarga: 'https://ej.test/a.jpg' }],
    });
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    const tira = screen.getByTestId('fotos-modelo-orden');
    // Vive dentro de la zona FIJA del detalle (lo primero que se ve, sin scroll).
    expect(tira.closest('[data-testid="centro-detalle-fijo"]')).not.toBeNull();
    // Ya no hay una sección "Foto del modelo" enterrada abajo.
    expect(screen.queryByText('Foto del modelo')).not.toBeInTheDocument();
  });

  it('no pinta bloque de foto cuando el modelo no tiene fotos', () => {
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
    useFotosModelo.mockReturnValue({ data: [] });
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    expect(screen.queryByTestId('fotos-modelo-orden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('foto-modelo-orden')).not.toBeInTheDocument();
  });

  it('las flechas ↑/↓ mueven la selección de la lista (con clamp)', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102), fila(3, 103)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    const filas = () => screen.getAllByTestId('centro-fila');
    // Por defecto se selecciona la primera fila.
    expect(filas()[0]).toHaveAttribute('data-seleccionada');
    expect(filas()[1]).not.toHaveAttribute('data-seleccionada');

    await usuario.keyboard('{ArrowDown}');
    expect(filas()[1]).toHaveAttribute('data-seleccionada');
    expect(filas()[0]).not.toHaveAttribute('data-seleccionada');

    await usuario.keyboard('{ArrowDown}');
    expect(filas()[2]).toHaveAttribute('data-seleccionada');

    // Clamp: en el último renglón, ↓ no envuelve al primero.
    await usuario.keyboard('{ArrowDown}');
    expect(filas()[2]).toHaveAttribute('data-seleccionada');

    await usuario.keyboard('{ArrowUp}');
    expect(filas()[1]).toHaveAttribute('data-seleccionada');
  });

  it('ignora las flechas cuando el foco está en el buscador', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    const filas = () => screen.getAllByTestId('centro-fila');
    expect(filas()[0]).toHaveAttribute('data-seleccionada');

    const buscador = screen.getByTestId('centro-busqueda');
    await usuario.click(buscador);
    await usuario.keyboard('{ArrowDown}');

    // La selección NO cambió (la flecha no se secuestró estando en el input).
    expect(filas()[0]).toHaveAttribute('data-seleccionada');
    expect(filas()[1]).not.toHaveAttribute('data-seleccionada');
  });

  it('ignora las flechas cuando hay un diálogo/sheet abierto (no cambia la orden del fondo)', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    const filas = () => screen.getAllByTestId('centro-fila');
    expect(filas()[0]).toHaveAttribute('data-seleccionada');

    // Simula un modal Radix abierto (AvanceProduccion / DialogoOrden / cancelar / copiar matriz…),
    // que marca su overlay con role="dialog" + data-state="open".
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('data-state', 'open');
    document.body.appendChild(modal);
    try {
      await usuario.keyboard('{ArrowDown}');
      // La orden de fondo NO cambió: la flecha se ignoró por el diálogo abierto.
      expect(filas()[0]).toHaveAttribute('data-seleccionada');
      expect(filas()[1]).not.toHaveAttribute('data-seleccionada');
    } finally {
      modal.remove();
    }
  });

  it('la selección por teclado enfoca el renglón y usa el mismo panel de detalle', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    await usuario.keyboard('{ArrowDown}');
    const filaActiva = screen.getAllByTestId('centro-fila')[1];
    expect(filaActiva).toHaveAttribute('data-seleccionada');
    // El foco se movió al renglón seleccionado.
    expect(document.activeElement).toBe(filaActiva);
    // El detalle sigue siendo el mismo panel único (no hay estado paralelo de selección).
    expect(
      within(screen.getByTestId('centro-detalle')).getByTestId('centro-detalle-fijo'),
    ).toBeInTheDocument();
  });

  it('deep-link con la orden FUERA de la página: pone el buscador al folio y la fila queda seleccionada', async () => {
    // La lista "normal" NO trae la orden 5; solo al buscar su folio (105) aparece. `useOrden(5)`
    // (el detalle que el panel ya carga) es quien conoce el folio.
    useOrdenesCentro.mockImplementation((query) => {
      const q = query as { busqueda?: string } | undefined;
      return q?.busqueda === '105'
        ? conFilas([fila(5, 105)])
        : conFilas([fila(1, 101), fila(2, 102)]);
    });
    renderConProveedores(<CentroOrdenesPagina />, {
      sesion: estadoSesionDePrueba([]),
      rutaInicial: { pathname: '/produccion/ordenes', state: { idOrden: 5 } },
    });

    // El buscador queda con el folio de la orden del deep-link…
    const buscador = screen.getByTestId('centro-busqueda');
    await waitFor(() => expect(buscador).toHaveValue('105'));
    // …y (tras el debounce del buscador) la fila aparece en la lista, SELECCIONADA.
    await waitFor(() => {
      const filasEl = screen.getAllByTestId('centro-fila');
      expect(filasEl).toHaveLength(1);
      expect(filasEl[0]).toHaveAttribute('data-seleccionada');
      expect(filasEl[0]).toHaveTextContent('105');
    });
  });

  it('deep-link con la orden en ERROR (404/sin permiso): apaga el pendiente y NO toca el buscador', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102)]));
    // La orden 5 del deep-link FALLA (p. ej. de otra empresa → 404); las demás resuelven normal.
    useOrden.mockImplementation((id?: number) =>
      id === 5
        ? { data: undefined, isPending: false, isError: true, error: { message: 'No encontrada' } }
        : detalleResuelto(ordenDetalle(id ?? 1, 100 + (id ?? 1))),
    );
    renderConProveedores(<CentroOrdenesPagina />, {
      sesion: estadoSesionDePrueba([]),
      rutaInicial: { pathname: '/produccion/ordenes', state: { idOrden: 5 } },
    });

    // El buscador NO se tocó (no hay folio que poner).
    const buscador = screen.getByTestId('centro-busqueda');
    expect(buscador).toHaveValue('');

    // El pendiente se APAGÓ: en el siguiente render (cambiar la selección con ↓) ya nadie vuelve a
    // pedir la orden 5 — sin el guard de error, la query seguiría habilitada refetcheando por siempre.
    useOrden.mockClear();
    await usuario.keyboard('{ArrowDown}');
    await waitFor(() => expect(useOrden).toHaveBeenCalledWith(1));
    expect(useOrden).not.toHaveBeenCalledWith(5);
    expect(buscador).toHaveValue('');
  });

  it('si el usuario teclea mientras el folio del deep-link viene en vuelo, su texto NO se pisa', async () => {
    const usuario = userEvent.setup();
    let resuelta = false;
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102)]));
    // La orden 5 del deep-link tarda: primero pending; "llega" cuando `resuelta` se enciende.
    useOrden.mockImplementation((id?: number) =>
      id === 5
        ? resuelta
          ? detalleResuelto(ordenDetalle(5, 105))
          : { data: undefined, isPending: true, isError: false, error: null }
        : detalleResuelto(ordenDetalle(id ?? 1, 100 + (id ?? 1))),
    );
    renderConProveedores(<CentroOrdenesPagina />, {
      sesion: estadoSesionDePrueba([]),
      rutaInicial: { pathname: '/produccion/ordenes', state: { idOrden: 5 } },
    });

    const buscador = screen.getByTestId('centro-busqueda');
    // El usuario teclea ANTES de que llegue el folio: su escritura cancela el deep-link pendiente.
    await usuario.type(buscador, '777');
    resuelta = true;
    // Con la orden ya "resuelta", otro tecleo re-renderiza: el folio 105 NO debe pisar lo escrito.
    await usuario.type(buscador, '8');
    expect(buscador).toHaveValue('7778');
  });

  it('los filtros de select llevan su ✕ para quitarlos (mes de entrega)', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    const select = screen.getByTestId('centro-filtro-mes');
    // Sin valor elegido no hay ✕ (nada que limpiar).
    expect(screen.queryByTestId('centro-filtro-mes-limpiar')).not.toBeInTheDocument();

    await usuario.selectOptions(select, '3');
    expect(select).toHaveValue('3');

    // La ✕ regresa el filtro a su default ("Mes de entrega" = todos) y desaparece.
    await usuario.click(screen.getByTestId('centro-filtro-mes-limpiar'));
    expect(select).toHaveValue('');
    expect(screen.queryByTestId('centro-filtro-mes-limpiar')).not.toBeInTheDocument();
  });
});
