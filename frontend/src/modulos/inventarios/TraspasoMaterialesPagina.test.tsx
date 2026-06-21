import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TraspasoMaterialesPagina } from './TraspasoMaterialesPagina';

vi.mock('@/api/inventario-materiales', () => ({
  useTraspasarTela: () => ({ mutate: vi.fn(), isPending: false }),
  useTraspasarAvio: () => ({ mutate: vi.fn(), isPending: false }),
  useExistenciasTela: () => ({ data: { filas: [], totalExistencia: 0 }, isPending: false }),
}));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));
vi.mock('./CapturaRenglonesTela', () => ({
  CapturaRenglonesTela: () => <div data-testid="captura-renglones-tela" />,
}));
vi.mock('./CapturaRenglonesAvio', () => ({
  CapturaRenglonesAvio: () => <div data-testid="captura-renglones-avio" />,
}));

describe('TraspasoMaterialesPagina (F4-E1)', () => {
  it('arranca en telas y muestra origen/destino + captura de tela', () => {
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover', 'inventario-avios.mover']),
    });
    expect(screen.getByTestId('traspaso-origen')).toBeInTheDocument();
    expect(screen.getByTestId('traspaso-destino')).toBeInTheDocument();
    expect(screen.getByTestId('captura-renglones-tela')).toBeInTheDocument();
    // Sin almacenes ni renglones, guardar deshabilitado.
    expect(screen.getByTestId('traspaso-guardar')).toBeDisabled();
  });

  it('cambia a avíos con el toggle (cambia la captura)', () => {
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover', 'inventario-avios.mover']),
    });
    fireEvent.click(screen.getByTestId('traspaso-dim-avio'));
    expect(screen.getByTestId('captura-renglones-avio')).toBeInTheDocument();
  });
});
