import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EtapasOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { HistorialEtapasOrden } from './HistorialEtapasOrden';

// ── Mocks ────────────────────────────────────────────────────────────────────
const cancelarCorteMutate = vi.fn();
const cancelarEnvioMutate = vi.fn();
vi.mock('@/api/etapas', () => ({
  useEtapasOrden: () => ({ data: historial, isPending: false, isError: false, error: null }),
  useCancelarCorte: () => ({ mutate: cancelarCorteMutate, isPending: false }),
  useCancelarEnvio: () => ({ mutate: cancelarEnvioMutate, isPending: false }),
}));

/** Un corte vivo + un envío cancelado (historial conserva las canceladas). */
const historial: EtapasOrden = {
  idOrden: 1,
  folioOrden: 100,
  etapas: [
    {
      id: 10,
      folio: 1,
      idEmpresa: 1,
      idOrden: 1,
      folioOrden: 100,
      tipo: 'corte',
      idTipoProceso: null,
      tipoProceso: null,
      idTercero: 7,
      tercero: 'Corte SA',
      fecha: '2026-06-18',
      fechaCompromiso: null,
      precioPactado: null,
      observaciones: null,
      cancelado: false,
      canceladoEn: null,
      canceladoPorId: null,
      motivoCancelacion: null,
      lineas: [],
      totalPiezas: 10,
      creadoEn: '2026-06-18T00:00:00.000Z',
      creadoPorId: null,
      creadoPorNombre: null,
    },
    {
      id: 11,
      folio: 2,
      idEmpresa: 1,
      idOrden: 1,
      folioOrden: 100,
      tipo: 'envio_maquila',
      idTipoProceso: 5,
      tipoProceso: 'Costura',
      idTercero: 20,
      tercero: 'Maquila Costura SA',
      fecha: '2026-06-19',
      fechaCompromiso: null,
      precioPactado: 8,
      observaciones: null,
      cancelado: true,
      canceladoEn: '2026-06-20T00:00:00.000Z',
      canceladoPorId: 'u1',
      motivoCancelacion: 'se reasignó',
      lineas: [],
      totalPiezas: 5,
      creadoEn: '2026-06-19T00:00:00.000Z',
      creadoPorId: null,
      creadoPorNombre: null,
    },
  ],
};

const sesion = () => estadoSesionDePrueba(['produccion.wip-ver', 'produccion.cancelar']);

describe('HistorialEtapasOrden (F3-E2)', () => {
  beforeEach(() => {
    cancelarCorteMutate.mockReset();
    cancelarEnvioMutate.mockReset();
  });

  it('muestra cortes y envíos; las canceladas quedan marcadas (historial)', () => {
    renderConProveedores(<HistorialEtapasOrden idOrden={1} />, { sesion: sesion() });
    const etapas = screen.getAllByTestId('historial-etapa');
    expect(etapas).toHaveLength(2);
    // El envío cancelado lleva el badge "Cancelada".
    expect(screen.getByTestId('historial-cancelado')).toHaveTextContent('Cancelada');
  });

  it('solo ofrece Cancelar en las etapas VIVAS', () => {
    renderConProveedores(<HistorialEtapasOrden idOrden={1} />, { sesion: sesion() });
    // Un solo botón Cancelar (el del corte vivo); el envío cancelado no lo tiene.
    expect(screen.getAllByTestId('historial-cancelar')).toHaveLength(1);
  });

  it('cancelar abre el diálogo, EXIGE motivo y llama al servicio de cancelación', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<HistorialEtapasOrden idOrden={1} />, { sesion: sesion() });

    await usuario.click(screen.getByTestId('historial-cancelar'));
    const dialogo = screen.getByRole('dialog');

    // Sin motivo, el botón de confirmar está deshabilitado.
    const confirmar = within(dialogo).getByTestId('confirmar-cancelar-etapa');
    expect(confirmar).toBeDisabled();

    await usuario.type(within(dialogo).getByTestId('etapa-motivo-cancelar'), 'error de captura');
    expect(confirmar).toBeEnabled();
    await usuario.click(confirmar);

    // La etapa abierta era un CORTE → se usa el hook de cancelar corte.
    expect(cancelarCorteMutate).toHaveBeenCalledTimes(1);
    const [args] = cancelarCorteMutate.mock.calls[0] as [
      { id: number; cuerpo: { motivo: string } },
    ];
    expect(args.id).toBe(10);
    expect(args.cuerpo.motivo).toBe('error de captura');
  });

  it('sin permiso de cancelar NO muestra botones de cancelar', () => {
    renderConProveedores(<HistorialEtapasOrden idOrden={1} />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver']),
    });
    expect(screen.queryByTestId('historial-cancelar')).not.toBeInTheDocument();
  });
});
