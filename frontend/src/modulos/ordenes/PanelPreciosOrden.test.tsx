import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * ⭐ 0.226b (§Post-F9.244) — el PANEL DE PRECIOS con la orden CERRADA: el precio real se consulta,
 * pero no se ofrece capturarlo (el servidor lo rechaza, A1). La capa de datos va simulada.
 */
/** Los datos del resumen, mutables por prueba (la fila 0.249 parte C necesita variarlos). */
const precios = vi.hoisted(() => ({
  base: {
    idOrden: 50,
    folioOrden: 1515,
    precioVenta: 100,
    maquilaReferencia: 20,
    maquilaReferenciaOculta: false,
    maquilaReal: 22,
    aplicacionReal: null,
    puedeVerReales: true,
    ultimoEventoMaquila: null,
    ultimoEventoAplicacion: null,
  },
  actual: null as null | Record<string, unknown>,
}));
vi.mock('@/api/ordenes-centro', () => ({
  usePreciosOrden: () => ({
    data: precios.actual ?? precios.base,
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

describe('PanelPreciosOrden — la maquila de REFERENCIA tapada (fila 0.249 parte C)', () => {
  it('sin captura real y con la referencia TAPADA: pinta ••••• (oculto), no un monto ni «—»', () => {
    precios.actual = {
      ...precios.base,
      maquilaReferencia: null,
      maquilaReferenciaOculta: true,
      maquilaReal: null,
      puedeVerReales: false,
    };
    renderConProveedores(
      <PanelPreciosOrden idOrden={50} folioOrden={1515} ordenCerrada={false} />,
      {
        sesion: estadoSesionDePrueba(['ordenes.ver']),
      },
    );
    expect(screen.getByTestId('precio-maquila-oculto')).toBeInTheDocument();
    expect(screen.getByTestId('precio-maquila')).not.toHaveTextContent('$');
    precios.actual = null;
  });

  it('control: con la referencia VISIBLE y sin captura real, pinta el monto de referencia', () => {
    precios.actual = { ...precios.base, maquilaReal: null, puedeVerReales: false };
    renderConProveedores(
      <PanelPreciosOrden idOrden={50} folioOrden={1515} ordenCerrada={false} />,
      {
        sesion: estadoSesionDePrueba(['ordenes.ver']),
      },
    );
    expect(screen.queryByTestId('precio-maquila-oculto')).not.toBeInTheDocument();
    expect(screen.getByTestId('precio-maquila')).toHaveTextContent('$20.00');
    precios.actual = null;
  });
});
