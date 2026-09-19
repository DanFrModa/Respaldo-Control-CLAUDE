import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Pedido } from '@/api/tipos';
import { renderConProveedores } from '@/pruebas/utilidades';

/**
 * ⭐ FILA 0.209 — **REABRIR UN PEDIDO GUARDADO TIENE QUE ENSEÑAR EL MODELO DE CADA RENGLÓN.**
 *
 * Este archivo no existía: `DialogoPedido` sólo se probaba de refilón, y **la costura que esta fila
 * construye no la medía nadie**. El editor de renglones tiene su propia prueba, pero ahí el mapa de
 * códigos se le pasa **a mano en el fixture** ⇒ medía el CONSUMIDOR y nunca el PRODUCTOR: los dos
 * lados pasaban y la unión quedaba al aire. Borrar `codigosPorModelo` del diálogo dejaba la suite
 * entera en verde.
 *
 * El caso REAL es justo éste: con búsqueda server-side la primera página son 8 códigos, y el modelo
 * de un pedido guardado **casi nunca** viene en ella. Por eso el mock de `useModelos` devuelve una
 * página que **NO contiene** el modelo del pedido — si lo contuviera, el combobox sacaría la etiqueta
 * de la propia opción y la prueba pasaría sin que el diálogo aportara nada.
 */

/** Página de búsqueda que NO trae el modelo del pedido (el caso que importa). */
vi.mock('@/api/modelos', () => ({
  useModelos: () => ({
    data: {
      datos: [
        { id: 1, codigo: '00001', descripcion: 'Otro modelo', origen: 'produccion' },
        { id: 2, codigo: '00002', descripcion: 'Otro más', origen: 'produccion' },
      ],
    },
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('@/api/pedidos', () => ({
  useCrearPedido: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarPedido: () => ({ mutate: vi.fn(), isPending: false }),
}));

// El combobox de cliente tiene su propia prueba; aquí sólo estorba.
vi.mock('@/components/dominio/FiltroCliente', () => ({
  FiltroCliente: () => <div data-testid="filtro-cliente" />,
}));

const { DialogoPedido } = await import('./DialogoPedido');

/** Pedido GUARDADO cuyo renglón apunta a un modelo que la búsqueda no devuelve (id 900). */
function pedidoGuardado(): Pedido {
  return {
    id: 77,
    folio: 1234,
    idCliente: 3,
    cliente: 'C&A',
    fechaPedido: '2026-09-01',
    fechaDe: null,
    fechaHasta: null,
    fechaTela: null,
    fechaElaboracion: null,
    noProducir: false,
    lineas: [
      {
        id: 5,
        idModelo: 900,
        codigoModelo: 'ZZZ-24-71-009',
        descripcionModelo: 'Sudadera',
        cantidadPedida: 500,
        precio: 120,
      },
    ],
  } as unknown as Pedido;
}

describe('DialogoPedido en EDICIÓN (fila 0.209)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * 🔴 LA INVARIANTE DE LA COSTURA: el diálogo conoce el código del modelo guardado
   * (`pedido.lineas[].codigoModelo`, que ya viaja en el contrato) y **tiene que bajárselo** al editor
   * de renglones. Sin eso el campo se ve VACÍO con el id puesto por dentro — la «trampa clásica» que
   * el propio docblock de la fila nombra.
   */
  it('cada renglón enseña el código del modelo guardado aunque la búsqueda no lo devuelva', () => {
    renderConProveedores(
      <DialogoPedido
        abierto
        alCambiarAbierto={() => {}}
        pedido={pedidoGuardado()}
        puedeVerImportes={false}
      />,
      { sesion: { permisos: ['pedidos.administrar'] } as never },
    );

    expect(screen.getByTestId('renglon-modelo-0-busqueda')).toHaveValue('ZZZ-24-71-009');
  });

  /**
   * Y el alta NO arrastra etiquetas de nada: un pedido nuevo arranca sin renglones, así que no hay
   * ningún selector que pudiera enseñar un código heredado.
   */
  it('en ALTA no hay renglones que etiquetar', () => {
    renderConProveedores(
      <DialogoPedido
        abierto
        alCambiarAbierto={() => {}}
        pedido={undefined}
        puedeVerImportes={false}
      />,
      { sesion: { permisos: ['pedidos.administrar'] } as never },
    );

    expect(screen.queryByTestId('renglon-modelo-0-busqueda')).not.toBeInTheDocument();
  });
});
