import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { AjusteMaterialesPagina } from './AjusteMaterialesPagina';

vi.mock('@/api/inventario-materiales', () => ({
  useAjustarTela: () => ({ mutate: vi.fn(), isPending: false }),
  useAjustarAvio: () => ({ mutate: vi.fn(), isPending: false }),
  useExistenciasTela: () => ({ data: { filas: [], totalExistencia: 0 }, isPending: false }),
}));
vi.mock('@/api/inventarios', () => ({
  useTiposMovimiento: () => ({
    data: {
      datos: [
        {
          id: 14,
          codigo: 'ajuste-entrada',
          nombre: 'Ajuste (Entrada)',
          direccion: 'entrada',
          activo: true,
        },
        {
          id: 15,
          codigo: 'ajuste-salida',
          nombre: 'Ajuste (Salida)',
          direccion: 'salida',
          activo: true,
        },
      ],
    },
  }),
}));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/colores', () => ({ useColores: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/proveedores', () => ({ useProveedores: () => ({ data: { datos: [] } }) }));
vi.mock('./CapturaRenglonesTela', () => ({
  CapturaRenglonesTela: () => <div data-testid="captura-renglones-tela" />,
}));
vi.mock('./CapturaRenglonesAvio', () => ({
  CapturaRenglonesAvio: () => <div data-testid="captura-renglones-avio" />,
}));
vi.mock('./SelectorTela', () => ({
  SelectorTela: () => <div data-testid="sel-tela-comp" />,
}));

describe('AjusteMaterialesPagina (F4-E1)', () => {
  it('en TELA-ENTRADA pide el lote (color + componentes, D5) y el motivo es obligatorio', () => {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    // Por defecto: dimensión tela + dirección entrada → captura de lote con color y componentes.
    expect(screen.getByTestId('ajuste-color')).toBeInTheDocument();
    expect(screen.getByTestId('ajuste-agregar-componente')).toBeInTheDocument();
    expect(screen.getByTestId('ajuste-motivo')).toBeInTheDocument();
    // Sin almacén/color/componentes/motivo, guardar deshabilitado.
    expect(screen.getByTestId('ajuste-guardar')).toBeDisabled();
  });

  it('en TELA-SALIDA cambia a la captura de renglones sobre lo existente', () => {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    fireEvent.click(screen.getByTestId('ajuste-dir-salida'));
    expect(screen.getByTestId('captura-renglones-tela')).toBeInTheDocument();
    expect(screen.queryByTestId('ajuste-color')).not.toBeInTheDocument();
  });

  it('en AVÍO usa la captura de avíos', () => {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.mover']),
    });
    fireEvent.click(screen.getByTestId('ajuste-dim-avio'));
    expect(screen.getByTestId('captura-renglones-avio')).toBeInTheDocument();
  });
});
