import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

describe('SalidaTelaOrdenPagina (F4-E1)', () => {
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
});
