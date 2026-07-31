import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { SalidaTelaOrdenPagina } from './SalidaTelaOrdenPagina';

const mutate = vi.fn();

vi.mock('@/api/inventario-materiales', () => ({
  useSalidaTelaAOrden: () => ({ mutate, isPending: false }),
  useExistenciasTela: () => ({ data: { filas: [], totalExistencia: 0 }, isPending: false }),
}));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));
// SelectorOrden emite una orden al hacer click.
vi.mock('@/modulos/produccion/SelectorOrden', () => ({
  SelectorOrden: ({
    alSeleccionar,
  }: {
    alSeleccionar: (o: {
      id: number;
      folio: number;
      codigoModelo: string;
      cliente: string;
    }) => void;
  }) => (
    <button
      type="button"
      data-testid="sel-orden"
      onClick={() =>
        alSeleccionar({ id: 9, folio: 123, codigoModelo: 'M-1', cliente: 'Cliente X' })
      }
    >
      elegir orden
    </button>
  ),
}));
vi.mock('./CapturaRenglonesTela', () => ({
  CapturaRenglonesTela: () => <div data-testid="captura-renglones-tela" />,
}));
// La orden del deep-link (enlace "Descargar tela" del avance de producción) se carga por su id.
const useOrden = vi.fn<(id?: number) => unknown>();
vi.mock('@/api/ordenes', () => ({ useOrden: (id?: number) => useOrden(id) }));

describe('SalidaTelaOrdenPagina (F4-E1)', () => {
  beforeEach(() => {
    useOrden.mockReset();
    useOrden.mockReturnValue({ data: undefined, isError: false });
  });

  it('pide elegir una orden antes de capturar', () => {
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    expect(screen.getByText('Sin orden seleccionada.')).toBeInTheDocument();
  });

  it('al elegir orden muestra el formulario de salida con su captura', () => {
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    fireEvent.click(screen.getByTestId('sel-orden'));
    expect(screen.getByTestId('salida-almacen')).toBeInTheDocument();
    expect(screen.getByTestId('captura-renglones-tela')).toBeInTheDocument();
    // Sin renglones ni almacén, el botón de guardar está deshabilitado.
    expect(screen.getByTestId('salida-guardar')).toBeDisabled();
  });

  // Enlace "Descargar tela del inventario" del avance de producción (petición de Daniel, 28-jul).
  it('con deep-link llega con la ORDEN ya puesta (sin tener que buscarla)', async () => {
    useOrden.mockReturnValue({
      data: { id: 42, folio: 5424, codigoModelo: 'M-9', cliente: 'C&A' },
      isError: false,
    });
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
      rutaInicial: { pathname: '/inventarios/telas/salida-orden', state: { idOrden: 42 } },
    });

    await waitFor(() => {
      expect(screen.queryByText('Sin orden seleccionada.')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('salida-almacen')).toBeInTheDocument();
    expect(useOrden).toHaveBeenCalledWith(42);
  });

  it('sin deep-link no pide ninguna orden al servidor', () => {
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    expect(useOrden).toHaveBeenCalledWith(undefined);
    expect(screen.getByText('Sin orden seleccionada.')).toBeInTheDocument();
  });
});
