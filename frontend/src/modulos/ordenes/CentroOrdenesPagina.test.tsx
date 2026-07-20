import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden, OrdenCentro } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CentroOrdenesPagina } from './CentroOrdenesPagina';

/**
 * Pruebas de `<CentroOrdenesPagina>` (rediseño jul-2026, petición de Daniel):
 *  1) la FOTO del modelo se muestra ARRIBA del detalle (zona fija, sin scroll), no enterrada; y
 *  2) la LISTA de órdenes se navega con las FLECHAS del teclado (↑/↓), sin romper el buscador.
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
const useOrdenesCentro = vi.fn<() => EstadoCentro>();
const useFotosModelo = vi.fn<() => { data: unknown[] }>();

vi.mock('@/api/ordenes-centro', () => ({
  useOrdenesCentro: () => useOrdenesCentro(),
}));
vi.mock('@/api/ordenes', () => ({
  useOrden: () => ({ data: ordenDetalle(), isPending: false, isError: false, error: null }),
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

function ordenDetalle(): Orden {
  return {
    id: 1,
    folio: 101,
    codigoModelo: 'M-101',
    idModelo: 55,
    cliente: 'Cliente 101',
    estado: 'capturada',
    referencias: [],
    lineas: [],
    totalPiezas: 0,
    ocCliente: null,
  } as unknown as Orden;
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
    expect(within(screen.getByTestId('centro-detalle')).getByTestId('centro-detalle-fijo'))
      .toBeInTheDocument();
  });
});
