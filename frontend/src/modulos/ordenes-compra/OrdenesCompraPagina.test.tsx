import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { OrdenesCompraPagina } from './OrdenesCompraPagina';
import { ocDePrueba } from './fixtures';

// ── Mocks de la capa de datos (sin red) ──────────────────────────────────────
const autorizarMutate = vi.fn();
const duplicarMutate = vi.fn();
const useOrdenesCompraMock = vi.fn();

vi.mock('@/api/ordenes-compra', () => ({
  useOrdenesCompra: (q: unknown) => useOrdenesCompraMock(q) as unknown,
  useAutorizarOc: () => ({ mutate: autorizarMutate, isPending: false }),
  useDuplicarOc: () => ({ mutate: duplicarMutate, isPending: false }),
  imprimirOc: vi.fn(),
}));

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [{ id: 5, nombre: 'Telas del Norte' }] } }),
}));

// El detalle abre estos diálogos (montados solo al usarse): se simplifican.
vi.mock('./DialogoEditarOc', () => ({ DialogoEditarOc: () => null }));
vi.mock('./DialogoCancelarOc', () => ({ DialogoCancelarOc: () => null }));

function paginaConUna(
  estatus: ReturnType<typeof ocDePrueba>['estatus'] = 'pendiente_autorizacion',
) {
  useOrdenesCompraMock.mockReturnValue({
    data: {
      datos: [ocDePrueba({ estatus })],
      total: 1,
      pagina: 1,
      porPagina: 10,
      totalPaginas: 1,
    },
    isPending: false,
    isError: false,
    isFetching: false,
  });
}

describe('OrdenesCompraPagina (F4-E2)', () => {
  beforeEach(() => {
    autorizarMutate.mockReset();
    duplicarMutate.mockReset();
    useOrdenesCompraMock.mockReset();
  });

  it('lista las OC y muestra su folio, proveedor y total', () => {
    paginaConUna();
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    expect(screen.getAllByText('OC 1001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Telas del Norte').length).toBeGreaterThan(0);
  });

  it('muestra el estado VACÍO cuando no hay OC', () => {
    useOrdenesCompraMock.mockReturnValue({
      data: { datos: [], total: 0, pagina: 1, porPagina: 10, totalPaginas: 0 },
      isPending: false,
      isError: false,
      isFetching: false,
    });
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(
      screen.getByText('No hay órdenes de compra que coincidan con la búsqueda.'),
    ).toBeInTheDocument();
  });

  it('muestra el estado de ERROR con el mensaje del backend', () => {
    useOrdenesCompraMock.mockReturnValue({
      isPending: false,
      isError: true,
      error: { message: 'Falló la consulta' },
      isFetching: false,
    });
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(screen.getByText('Falló la consulta')).toBeInTheDocument();
  });

  it('SIN compras.administrar oculta el botón "Nueva OC"', () => {
    paginaConUna();
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(screen.queryByTestId('nuevo-oc')).not.toBeInTheDocument();
  });

  it('el botón Autorizar SOLO aparece con compras.autorizar y estatus pendiente', () => {
    paginaConUna('pendiente_autorizacion');
    const { unmount } = renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar', 'compras.autorizar']),
    });
    const detalle = screen.getByTestId('detalle-oc');
    expect(within(detalle).getByTestId('autorizar-oc')).toBeInTheDocument();
    unmount();

    // Sin el permiso de autorizar, no aparece.
    paginaConUna('pendiente_autorizacion');
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    expect(screen.queryByTestId('autorizar-oc')).not.toBeInTheDocument();
  });

  it('una OC autorizada NO ofrece Editar a un no-admin (sí "Ver")', () => {
    paginaConUna('autorizada');
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    const detalle = screen.getByTestId('detalle-oc');
    expect(within(detalle).queryByTestId('editar-oc')).not.toBeInTheDocument();
    expect(within(detalle).getByTestId('ver-oc')).toBeInTheDocument();
  });

  it('un ADMIN (roles.administrar) SÍ ve "Editar" en una OC autorizada', () => {
    paginaConUna('autorizada');
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar', 'roles.administrar']),
    });
    const detalle = screen.getByTestId('detalle-oc');
    expect(within(detalle).getByTestId('editar-oc')).toBeInTheDocument();
    expect(within(detalle).queryByTestId('ver-oc')).not.toBeInTheDocument();
  });
});
