import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoNotaTela } from './DialogoNotaTela';

// ── Mocks (sin red) ──────────────────────────────────────────────────────────
const salidaMutate = vi.fn();
vi.mock('@/api/inventario-materiales', () => ({
  useSalidaTelaAOrden: () => ({ mutate: salidaMutate, isPending: false }),
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: { datos: [{ id: 2, nombre: 'Bodega de telas' }] },
    isPending: false,
  }),
}));
// Los hijos pesados (selector de orden + captura de tela por lote) se simplifican a botones.
vi.mock('@/modulos/produccion/SelectorOrden', () => ({
  SelectorOrden: ({ alSeleccionar }: { alSeleccionar: (o: unknown) => void }) => (
    <button
      type="button"
      data-testid="mock-selector-orden"
      onClick={() =>
        alSeleccionar({
          id: 50,
          folio: 1001,
          codigoModelo: 'MOD-1',
          cliente: 'Cliente A',
          maquilero: 'Costuras del Bajío',
        })
      }
    >
      elegir orden
    </button>
  ),
}));
vi.mock('@/modulos/inventarios/CapturaRenglonesTela', () => ({
  CapturaRenglonesTela: ({ onChange }: { onChange: (r: unknown[]) => void }) => (
    <button
      type="button"
      data-testid="mock-captura-tela"
      onClick={() =>
        onChange([
          {
            idTela: 7,
            tela: 'Felpa',
            idLote: 11,
            loteClave: 'L-09',
            cantidad: 30,
            disponible: 100,
          },
        ])
      }
    >
      agregar tela
    </button>
  ),
}));

describe('DialogoNotaTela (R6, §4.6 dec. 2 — nota de salida de telas)', () => {
  beforeEach(() => {
    salidaMutate.mockReset();
  });

  it('arranca con el botón deshabilitado (falta orden, almacén y renglones)', () => {
    renderConProveedores(<DialogoNotaTela abierto alCambiarAbierto={() => undefined} />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    expect(screen.getByTestId('confirmar-nota-tela')).toBeDisabled();
  });

  it('al elegir la orden muestra su maquilero (destino de la tela)', () => {
    renderConProveedores(<DialogoNotaTela abierto alCambiarAbierto={() => undefined} />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    fireEvent.click(screen.getByTestId('mock-selector-orden'));
    expect(screen.getByTestId('nota-tela-maquilero')).toHaveValue('Costuras del Bajío');
  });

  it('registra la salida de tela con orden + almacén de telas + renglones (motor F4)', () => {
    renderConProveedores(<DialogoNotaTela abierto alCambiarAbierto={() => undefined} />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    fireEvent.click(screen.getByTestId('mock-selector-orden'));
    // El almacén va ANTES de los renglones (cambiar el almacén reinicia los renglones).
    fireEvent.change(screen.getByTestId('nota-tela-almacen'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('mock-captura-tela'));

    const confirmar = screen.getByTestId('confirmar-nota-tela');
    expect(confirmar).toBeEnabled();
    confirmar.click();

    expect(salidaMutate).toHaveBeenCalledTimes(1);
    const cuerpo = salidaMutate.mock.calls.at(0)?.[0] as {
      idOrden: number;
      idAlmacen: number;
      lineas: { idTela: number; idLote: number; cantidad: number }[];
    };
    expect(cuerpo).toMatchObject({
      idOrden: 50,
      idAlmacen: 2,
      lineas: [{ idTela: 7, idLote: 11, cantidad: 30 }],
    });
  });
});
