import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PedidoReal } from '@/api/tipos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { PanelPedidosReales } from './PanelPedidosReales';

/**
 * ⭐ Unit del panel de PEDIDOS REALES centrado en V1-E4 (punto 6): CANCELAR el pedido real.
 *
 * La decisión la cerró Daniel en §Post-F9.37 punto 9 (*"Sí."*), destrabando el TODO que llevaba
 * abierto desde F2-E1. Lo que se cementa aquí es que la cancelación NO sea decorativa: pide motivo
 * (obligatorio), se ve con su porqué, y un pedido real cancelado deja de admitir capturas.
 */
const cancelarMutate = vi.fn();
const usePedidosRealesMock = vi.fn();

vi.mock('@/api/pedidos', () => ({
  usePedidosReales: () => usePedidosRealesMock() as unknown,
  useCrearPedidoReal: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarPedidoReal: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarSeguimiento: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarPedidoReal: () => ({ mutate: cancelarMutate, isPending: false }),
}));

/** Un pedido real de ejemplo (vivo o cancelado). */
function pedidoReal(cancelado: boolean, motivo: string | null = null): PedidoReal {
  return {
    id: 5,
    idPedido: 1,
    numPedReal: 'PR-77',
    cedis: 'CEDIS Norte',
    apertura: null,
    fechaPedPR: null,
    fechaInicio: null,
    fechaFin: null,
    fechaEntregadaReal: null,
    cancelado,
    motivoCancelada: motivo,
    lineas: [
      {
        id: 51,
        idPedidoLinea: 11,
        idModelo: 9,
        codigoModelo: 'KM-114',
        descripcionModelo: 'Playera',
        cantidadPedida: 100,
        precio: null,
        cantidadPR: 0,
        cantidadEnviada: 0,
        cantidadEntregadaReal: 0,
        empaques: 0,
      },
    ],
    creadoEn: '2026-08-10T10:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-08-10T10:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Estado de consulta con el pedido real dado. */
function consulta(real: PedidoReal): unknown {
  return { data: [real], isPending: false, isError: false, error: null };
}

describe('⭐ PanelPedidosReales — cancelar el pedido real (V1-E4 punto 6)', () => {
  beforeEach(() => {
    cancelarMutate.mockReset();
    usePedidosRealesMock.mockReset();
  });

  it('manda la cancelación con su motivo', async () => {
    const usuario = userEvent.setup();
    usePedidosRealesMock.mockReturnValue(consulta(pedidoReal(false)));
    renderConProveedores(<PanelPedidosReales idPedido={1} puedeAdministrarReales />);

    await usuario.click(screen.getByTestId('cancelar-pedido-real'));
    const dialogo = await screen.findByTestId('dialogo-cancelar-pedido-real');
    await usuario.type(
      within(dialogo).getByTestId('motivo-cancelar-pedido-real'),
      'Se adelantó la entrega',
    );
    await usuario.click(within(dialogo).getByTestId('confirmar-cancelar-pedido-real'));

    expect(cancelarMutate).toHaveBeenCalledWith(
      { idPedido: 1, idReal: 5, cuerpo: { motivo: 'Se adelantó la entrega' } },
      expect.anything(),
    );
  });

  it('SIN motivo no deja confirmar (D3: la cancelación lleva su porqué)', async () => {
    const usuario = userEvent.setup();
    usePedidosRealesMock.mockReturnValue(consulta(pedidoReal(false)));
    renderConProveedores(<PanelPedidosReales idPedido={1} puedeAdministrarReales />);

    await usuario.click(screen.getByTestId('cancelar-pedido-real'));
    const dialogo = await screen.findByTestId('dialogo-cancelar-pedido-real');

    expect(within(dialogo).getByTestId('confirmar-cancelar-pedido-real')).toBeDisabled();
    expect(cancelarMutate).not.toHaveBeenCalled();
  });

  it('el cancelado se VE con su motivo y ya no admite capturas (no es decorativo)', () => {
    usePedidosRealesMock.mockReturnValue(consulta(pedidoReal(true, 'Ya no va')));
    renderConProveedores(<PanelPedidosReales idPedido={1} puedeAdministrarReales />);

    expect(screen.getByTestId('pedido-real-cancelado')).toHaveTextContent(/Cancelado: Ya no va/);
    // Los controles de escritura desaparecen (el backend además los rechaza, A1).
    expect(screen.queryByTestId('guardar-seguimiento')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-pedido-real')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cancelar-pedido-real')).not.toBeInTheDocument();
  });

  it('sin pedidos-reales.administrar no se ofrece cancelar', () => {
    usePedidosRealesMock.mockReturnValue(consulta(pedidoReal(false)));
    renderConProveedores(<PanelPedidosReales idPedido={1} puedeAdministrarReales={false} />);

    expect(screen.queryByTestId('cancelar-pedido-real')).not.toBeInTheDocument();
  });
});
