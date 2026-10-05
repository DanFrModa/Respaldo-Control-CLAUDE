import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * ⭐ 0.226b (§Post-F9.244) — el ALTA de auditoría con la orden CERRADA: se elige (el selector no
 * filtra: el estado es informativo, nunca una llave), pero se avisa y no se puede crear. La capa de
 * datos va simulada; el servidor rechaza igual (A1).
 */

const crear = vi.fn();
vi.mock('@/api/calidad', () => ({
  useContextoOrden: (idOrden: number | undefined) => ({
    data:
      idOrden === undefined
        ? undefined
        : {
            idOrden,
            folioOrden: 321,
            idModelo: 3,
            codigoModelo: 'M-9',
            cantidad: 120,
            maquileros: [],
            muestra: {
              resoluble: true,
              idPlan: 1,
              nombrePlan: 'ISO 2859',
              tamanoLote: 120,
              tamanoMuestra: 20,
              niveles: [],
              mensaje: null,
            },
          },
    isPending: false,
    isError: false,
    error: null,
  }),
  useCrearAuditoria: () => ({ mutate: crear, isPending: false }),
}));

let cerradaEnEmitida: string | null = null;
vi.mock('@/modulos/produccion/SelectorOrden', () => ({
  SelectorOrden: ({ alSeleccionar }: { alSeleccionar: (o: Orden) => void }) => (
    <button
      type="button"
      data-testid="elegir-orden"
      onClick={() =>
        alSeleccionar({ id: 9, folio: 321, cerradaEn: cerradaEnEmitida } as unknown as Orden)
      }
    >
      Elegir orden
    </button>
  ),
}));

const { AltaAuditoriaPagina } = await import('./AltaAuditoriaPagina');

function pintar(): void {
  renderConProveedores(<AltaAuditoriaPagina />, {
    sesion: estadoSesionDePrueba(['calidad.ver', 'calidad.generar-auditorias']),
  });
}

beforeEach(() => {
  crear.mockReset();
  cerradaEnEmitida = null;
});

describe('AltaAuditoriaPagina — orden cerrada (0.226b)', () => {
  it('cerrada: avisa y no deja crear la auditoría', async () => {
    cerradaEnEmitida = '2026-10-01T10:00:00.000Z';
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(screen.getByTestId('elegir-orden'));

    expect(screen.getByTestId('aviso-orden-cerrada')).toHaveTextContent(
      /La orden 321 está cerrada/,
    );
    expect(screen.getByTestId('auditoria-crear')).toBeDisabled();
    expect(screen.getByTestId('auditoria-tipo')).toBeDisabled();
  });

  it('abierta: sin aviso, y se puede crear', async () => {
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(screen.getByTestId('elegir-orden'));

    expect(screen.queryByTestId('aviso-orden-cerrada')).not.toBeInTheDocument();
    expect(screen.getByTestId('auditoria-crear')).toBeEnabled();
  });
});
