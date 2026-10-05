import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * ⭐ 0.226b (§Post-F9.244) — el PANEL DE PRECIOS con la orden CERRADA: el precio real se consulta,
 * pero no se ofrece capturarlo (el servidor lo rechaza, A1). La capa de datos va simulada.
 */
vi.mock('@/api/ordenes-centro', () => ({
  usePreciosOrden: () => ({
    data: {
      idOrden: 50,
      folioOrden: 1515,
      precioVenta: 100,
      maquilaReferencia: 20,
      maquilaReal: 22,
      aplicacionReal: null,
      puedeVerReales: true,
      ultimoEventoMaquila: null,
      ultimoEventoAplicacion: null,
    },
    isPending: false,
    isError: false,
  }),
  useEventosPrecioOrden: () => ({ data: { eventos: [] }, isPending: false, isError: false }),
  useCapturarPrecio: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useRolesProveedor: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));

const { PanelPreciosOrden } = await import('./PanelPreciosOrden');

const PERMISOS = ['ordenes.ver', 'ordenes.precio-maquila', 'pedidos.importes'] as const;

describe('PanelPreciosOrden — orden cerrada (0.226b)', () => {
  it('cerrada: avisa y NO ofrece capturar el precio (se consulta igual)', () => {
    renderConProveedores(<PanelPreciosOrden idOrden={50} folioOrden={1515} ordenCerrada />, {
      sesion: estadoSesionDePrueba([...PERMISOS]),
    });
    expect(screen.getByTestId('aviso-orden-cerrada')).toHaveTextContent(
      /La orden 1515 está cerrada/,
    );
    expect(screen.queryByTestId('precio-maquila-editar')).not.toBeInTheDocument();
    expect(screen.getByTestId('precio-maquila')).toBeInTheDocument();
  });

  it('abierta: sin aviso, y se puede capturar', () => {
    renderConProveedores(
      <PanelPreciosOrden idOrden={50} folioOrden={1515} ordenCerrada={false} />,
      {
        sesion: estadoSesionDePrueba([...PERMISOS]),
      },
    );
    expect(screen.queryByTestId('aviso-orden-cerrada')).not.toBeInTheDocument();
    expect(screen.getByTestId('precio-maquila-editar')).toBeInTheDocument();
  });
});
