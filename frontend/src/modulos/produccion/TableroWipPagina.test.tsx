import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WipOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * Pruebas del TABLERO WIP como PUERTA A LA ACCIÓN (V1-E3a). El tablero es la pantalla donde se ve
 * "por cortar 500" y "por entregar 300", y hasta esta etapa su único botón llevaba a
 * `/produccion/corte` — una pantalla que se retiró. Sin estas puertas, el usuario veía el pendiente
 * y no tenía UN clic para capturarlo: tenía que ir al riel, teclear el folio y dar doble clic.
 *
 * La capa de datos va simulada: lo que se prueba es a dónde manda cada botón, con qué contexto de
 * orden y bajo qué permiso (A4). Los números los DERIVA el servidor (A1) y no se prueban aquí.
 */

const useTableroWip = vi.fn<() => unknown>();
const useWipOrden = vi.fn<() => unknown>();
const navegar = vi.fn();

vi.mock('@/api/wip', () => ({
  CLAVE_WIP: ['wip'],
  useTableroWip: () => useTableroWip(),
  useWipOrden: () => useWipOrden(),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('react-router-dom', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useNavigate: () => navegar,
}));

const { TableroWipPagina } = await import('./TableroWipPagina');

/** Una fila del tablero (la del drill-down). */
const FILA = {
  idOrden: 1,
  folio: 5424,
  codigoModelo: '62182',
  cliente: 'C&A',
  pedido: 1000,
  porCortar: 500,
  cortadoPorEnviar: 0,
  porRecibir: 0,
  porEntregar: 300,
};

/** Drill-down de esa orden (lo mínimo que la pantalla pinta). */
const DETALLE = {
  idOrden: 1,
  folio: 5424,
  estado: 'capturada',
  idModelo: 3,
  codigoModelo: '62182',
  idCliente: 4,
  cliente: 'C&A',
  pedido: 1000,
  cortado: 500,
  enviado: 0,
  recibido: 0,
  recibidoCostura: 0,
  entregado: 0,
  porEntregar: 300,
  porCortar: [],
  cortadoPorEnviar: [],
  porRecibir: [],
  entregadoCeldas: [],
} as unknown as WipOrden;

beforeEach(() => {
  navegar.mockReset();
  useTableroWip.mockReturnValue({
    data: {
      datos: [FILA],
      total: 1,
      pagina: 1,
      porPagina: 20,
      totalPaginas: 1,
      totales: { porCortar: 500, cortadoPorEnviar: 0, porRecibir: 0, porEntregar: 300 },
    },
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
  useWipOrden.mockReturnValue({ data: DETALLE, isPending: false, isError: false, error: null });
});

const PERMISOS = ['produccion.wip-ver', 'produccion.corte', 'produccion.entrega'] as const;

describe('<TableroWipPagina> · puertas a la acción', () => {
  it('el encabezado lleva a ENTREGAR (lo que pide el KPI «Por entregar»)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<TableroWipPagina />, {
      sesion: estadoSesionDePrueba([...PERMISOS]),
    });

    await usuario.click(screen.getByTestId('wip-ir-entregas'));
    expect(navegar).toHaveBeenCalledWith('/produccion/entregas');
  });

  it('el drill-down lleva al PANEL DE AVANCE de esa orden, abierto (corte/maquila/recibo)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<TableroWipPagina />, {
      sesion: estadoSesionDePrueba([...PERMISOS]),
    });

    await usuario.click(screen.getAllByTestId('wip-detalle')[0] as HTMLElement);
    await usuario.click(await screen.findByTestId('wip-drill-avance'));
    // El deep-link lleva la orden Y la instrucción de abrir el panel: es el reemplazo de la
    // pantalla `/produccion/corte` retirada.
    expect(navegar).toHaveBeenCalledWith('/produccion/ordenes', {
      state: { idOrden: 1, abrirAvance: true },
    });
  });

  it('el drill-down lleva a ENTREGAR esa orden, con su pendiente en el botón', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<TableroWipPagina />, {
      sesion: estadoSesionDePrueba([...PERMISOS]),
    });

    await usuario.click(screen.getAllByTestId('wip-detalle')[0] as HTMLElement);
    const boton = await screen.findByTestId('wip-drill-entregar');
    expect(boton).toHaveTextContent('300');
    await usuario.click(boton);
    expect(navegar).toHaveBeenCalledWith('/produccion/entregas', { state: { idOrden: 1 } });
  });

  it('sin nada por entregar NO se ofrece entregar (pero sí registrar avance)', async () => {
    useWipOrden.mockReturnValue({
      data: { ...DETALLE, porEntregar: 0 },
      isPending: false,
      isError: false,
      error: null,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<TableroWipPagina />, {
      sesion: estadoSesionDePrueba([...PERMISOS]),
    });

    await usuario.click(screen.getAllByTestId('wip-detalle')[0] as HTMLElement);
    expect(await screen.findByTestId('wip-drill-avance')).toBeInTheDocument();
    expect(screen.queryByTestId('wip-drill-entregar')).not.toBeInTheDocument();
  });

  it('quien SOLO consulta (wip-ver) no ve ninguna de las dos puertas (A4)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<TableroWipPagina />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver']),
    });

    expect(screen.queryByTestId('wip-ir-entregas')).not.toBeInTheDocument();
    await usuario.click(screen.getAllByTestId('wip-detalle')[0] as HTMLElement);
    expect(screen.queryByTestId('wip-drill-avance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wip-drill-entregar')).not.toBeInTheDocument();
  });
});
