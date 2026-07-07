import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PedidosPorMes } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { PedidosMesPagina } from './PedidosMesPagina';

/**
 * Unit de la pantalla PEDIDOS POR MES (rediseño R3, §4.1) — SIN red (capa de datos mockeada).
 * Cubre lo que el e2e (que corre como admin) NO ejercita (hallazgo del reviewer): el GATING de
 * IMPORTES sin `pedidos.importes` (columnas Precio/Importe y el "Importe total" de la barra NO se
 * pintan; el backend además manda los valores en null) y el gate del deep-link del constructor
 * (`state.abrirConstructor` sin `pedidos.administrar` NO abre nada).
 */

// ── Capa de datos mockeada (la consulta por mes se controla por test; lo demás inerte) ──
const usePedidosPorMes = vi.fn<() => unknown>();

vi.mock('@/api/pedidos-mes', () => ({
  usePedidosPorMes: () => usePedidosPorMes(),
  useCandidatosDesarrollo: () => ({ data: [], isPending: false }),
  useSalidaProduccion: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/pedidos', () => ({
  CLAVE_PEDIDOS: ['pedidos'],
  useCrearPedido: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/api/adjuntos-pedido', () => ({
  useAdjuntosPedido: () => ({ data: [], isPending: false, isError: false, error: null }),
  useSubirAdjuntoPedido: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQuitarAdjuntoPedido: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isPending: false }),
  useCamposCliente: () => ({ data: [], isPending: false }),
}));
vi.mock('@/api/empresas', () => ({
  useEmpresas: () => ({ data: [], isPending: false }),
}));
vi.mock('@/api/colores', () => ({
  useColores: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/tallas', () => ({
  useTallasActivas: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/ordenes-consulta', () => ({
  imprimirOrden: vi.fn(),
}));

/** Página de ejemplo: un pedido con un renglón (los importes van según el permiso simulado). */
function paginaDeEjemplo(conImportes: boolean): PedidosPorMes {
  return {
    datos: [
      {
        id: 1,
        folio: 1502,
        idEmpresa: 1,
        empresa: 'FR Moda',
        idCliente: 3,
        cliente: 'C&A',
        ocCliente: 'OC-CA-4471',
        fechaDe: null,
        fechaHasta: '2026-08-15',
        estatus: 'vigente',
        cantidadTotal: 100,
        cortadoTotal: 40,
        importeTotal: conImportes ? 14800 : null,
        renglones: [
          {
            id: 11,
            idModelo: 9,
            codigoModelo: 'KM-114',
            descripcionModelo: 'Playera Cherry',
            idDesarrollo: 5,
            numeroCliente: 'CA-KM-114',
            numeroProduccion: 7,
            cantidad: 100,
            precio: conImportes ? 148 : null,
            importe: conImportes ? 14800 : null,
            idOrden: 501,
            folioOrden: 5500,
            numOrdenes: 1,
            cortado: 40,
          },
        ],
      },
    ],
    totales: {
      pedidos: 1,
      ordenes: 1,
      piezas: 100,
      cortado: 40,
      avancePct: 40,
      importe: conImportes ? 14800 : null,
    },
    total: 1,
    pagina: 1,
    porPagina: 50,
    totalPaginas: 1,
  };
}

function consulta(datos: PedidosPorMes): unknown {
  return {
    data: datos,
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<PedidosMesPagina>', () => {
  beforeEach(() => {
    usePedidosPorMes.mockReset();
  });

  it('CON pedidos.importes pinta Precio/Importe y el Importe total de la barra', () => {
    usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(true)));
    renderConProveedores(<PedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver', 'pedidos.importes']),
    });

    expect(screen.getByText('Precio')).toBeInTheDocument();
    expect(screen.getByText('Importe')).toBeInTheDocument();
    expect(screen.getByText('Importe total')).toBeInTheDocument();
    // El renglón trae su precio formateado.
    expect(screen.getByText('$148.00')).toBeInTheDocument();
  });

  it('SIN pedidos.importes NO pinta las columnas Precio/Importe ni el Importe total (gating)', () => {
    usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(false)));
    renderConProveedores(<PedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver']),
    });

    // La tabla sí pinta el pedido…
    expect(screen.getByText('1502-F')).toBeInTheDocument();
    expect(screen.getByText('C&A')).toBeInTheDocument();
    // …pero SIN columnas de dinero ni total de la barra (además el backend los manda en null).
    expect(screen.queryByText('Precio')).not.toBeInTheDocument();
    expect(screen.queryByText('Importe')).not.toBeInTheDocument();
    expect(screen.queryByText('Importe total')).not.toBeInTheDocument();
    expect(screen.queryByText('$148.00')).not.toBeInTheDocument();
  });

  it('sin pedidos.administrar el deep-link state.abrirConstructor NO abre el constructor', () => {
    usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(false)));
    renderConProveedores(<PedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver']),
      rutaInicial: { pathname: '/pedidos', state: { abrirConstructor: true } },
    });

    expect(screen.queryByTestId('constructor-pedido')).not.toBeInTheDocument();
    // Tampoco existe el CTA "Nuevo pedido" (gated con pedidos.administrar).
    expect(screen.queryByTestId('nuevo-pedido')).not.toBeInTheDocument();
  });

  it('con pedidos.administrar el deep-link SÍ abre el constructor', () => {
    usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(true)));
    renderConProveedores(<PedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver', 'pedidos.administrar', 'pedidos.importes']),
      rutaInicial: { pathname: '/pedidos', state: { abrirConstructor: true } },
    });

    expect(screen.getByTestId('constructor-pedido')).toBeInTheDocument();
  });
});
