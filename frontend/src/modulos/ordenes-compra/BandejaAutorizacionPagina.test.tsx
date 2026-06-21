import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { BandejaAutorizacionPagina } from './BandejaAutorizacionPagina';
import { ocDePrueba } from './fixtures';

const autorizarMutate = vi.fn();
const useOrdenesCompraMock = vi.fn();

vi.mock('@/api/ordenes-compra', () => ({
  useOrdenesCompra: (q: unknown) => useOrdenesCompraMock(q) as unknown,
  useAutorizarOc: () => ({ mutate: autorizarMutate, isPending: false, variables: undefined }),
  imprimirOc: vi.fn(),
}));

function unaPendiente() {
  useOrdenesCompraMock.mockReturnValue({
    data: {
      datos: [ocDePrueba({ estatus: 'pendiente_autorizacion' })],
      total: 1,
      pagina: 1,
      porPagina: 20,
      totalPaginas: 1,
    },
    isPending: false,
    isError: false,
    isFetching: false,
  });
}

/** Fija el viewport a un ancho de móvil (para la prueba responsive). */
function viewportMovil(): void {
  window.innerWidth = 375;
  window.innerHeight = 667;
  window.dispatchEvent(new Event('resize'));
}

describe('BandejaAutorizacionPagina (F4-E2)', () => {
  beforeEach(() => {
    autorizarMutate.mockReset();
    useOrdenesCompraMock.mockReset();
  });

  it('lista las OC pendientes como tarjetas con su total', () => {
    unaPendiente();
    renderConProveedores(<BandejaAutorizacionPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.autorizar']),
    });
    expect(screen.getByText('OC 1001')).toBeInTheDocument();
    expect(screen.getByTestId('tarjeta-oc-bandeja')).toBeInTheDocument();
  });

  it('autorizar dispara la mutación con el id de la OC', async () => {
    unaPendiente();
    const usuario = userEvent.setup();
    renderConProveedores(<BandejaAutorizacionPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.autorizar']),
    });
    await usuario.click(screen.getByTestId('autorizar-oc-bandeja'));
    expect(autorizarMutate).toHaveBeenCalledWith(1, expect.anything());
  });

  it('SIN compras.autorizar no muestra el botón de autorizar', () => {
    unaPendiente();
    renderConProveedores(<BandejaAutorizacionPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(screen.queryByTestId('autorizar-oc-bandeja')).not.toBeInTheDocument();
  });

  it('estado VACÍO cuando no hay pendientes', () => {
    useOrdenesCompraMock.mockReturnValue({
      data: { datos: [], total: 0, pagina: 1, porPagina: 20, totalPaginas: 0 },
      isPending: false,
      isError: false,
      isFetching: false,
    });
    renderConProveedores(<BandejaAutorizacionPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.autorizar']),
    });
    expect(screen.getByTestId('bandeja-vacia')).toBeInTheDocument();
  });

  it('es usable en viewport MÓVIL: la tarjeta y el botón de autorizar se ven', async () => {
    viewportMovil();
    unaPendiente();
    const usuario = userEvent.setup();
    renderConProveedores(<BandejaAutorizacionPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.autorizar']),
    });
    // La tarjeta no depende de un panel oculto en móvil (no hay lista+detalle aquí).
    expect(screen.getByTestId('tarjeta-oc-bandeja')).toBeVisible();
    const boton = screen.getByTestId('autorizar-oc-bandeja');
    expect(boton).toBeVisible();
    await usuario.click(boton);
    expect(autorizarMutate).toHaveBeenCalledWith(1, expect.anything());
  });
});
