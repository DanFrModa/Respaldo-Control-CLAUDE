import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { AjusteMaterialesPagina } from './AjusteMaterialesPagina';

vi.mock('@/api/inventario-materiales', () => ({
  useAjustarAvio: () => ({ mutate: vi.fn(), isPending: false }),
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
vi.mock('./CapturaRenglonesAvio', () => ({
  CapturaRenglonesAvio: () => <div data-testid="captura-renglones-avio" />,
}));

describe('AjusteMaterialesPagina · SOLO AVÍOS (F4-E1)', () => {
  it('captura avíos en las dos direcciones y exige motivo', () => {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.mover']),
    });
    expect(screen.getByTestId('captura-renglones-avio')).toBeInTheDocument();
    expect(screen.getByTestId('ajuste-motivo')).toBeInTheDocument();
    // Sin almacén / renglones / motivo, guardar deshabilitado.
    expect(screen.getByTestId('ajuste-guardar')).toBeDisabled();

    fireEvent.click(screen.getByTestId('ajuste-dir-salida'));
    expect(screen.getByTestId('captura-renglones-avio')).toBeInTheDocument();
  });

  /**
   * La pestaña de TELAS se retiró: hablaba con el motor LEGADO por lote (graba
   * `id_tela_color = NULL`), así que lo capturado ahí NO aparecía en «Existencias de telas» — y la
   * pantalla ARRANCABA en esa pestaña. En vez de esconder el caso, se dice a dónde ir.
   */
  it('ya NO tiene pestaña de telas y manda al ajuste por color', () => {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.mover', 'inventario-telas.mover']),
    });
    expect(screen.queryByTestId('ajuste-dim-tela')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ajuste-color')).not.toBeInTheDocument();
    expect(screen.queryByTestId('captura-renglones-tela')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ajuste de telas por color' })).toHaveAttribute(
      'href',
      '/inventarios/telas/ajuste',
    );
  });

  it('SIN inventario-telas.mover NO se ofrece el puntero al ajuste de telas (A4)', () => {
    // Mismo criterio que el enlace hermano de Notas de salida: no se pasea al usuario a una
    // pantalla que le va a salir toda deshabilitada.
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.mover']),
    });
    expect(screen.queryByTestId('ajuste-avios-nota-tela')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ajuste de telas por color' })).toBeNull();
  });

  it('SIN inventario-avios.mover la captura queda bloqueada (A4)', () => {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.ver']),
    });
    expect(screen.getByTestId('ajuste-almacen')).toBeDisabled();
    expect(screen.getByTestId('ajuste-guardar')).toBeDisabled();
  });
});
