import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EsMaConciliacion } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ConciliacionCargosPagina } from './ConciliacionCargosPagina';

const useConciliacionEsMa = vi.fn<
  () => {
    data: EsMaConciliacion | undefined;
    isPending: boolean;
    isError: boolean;
    error: { message: string } | null;
  }
>();

vi.mock('@/api/esma', () => ({
  useConciliacionEsMa: () => useConciliacionEsMa(),
  // El filtro de maquilero es ahora el combobox de maquileros (activos + rol de maquila), no
  // useProveedores (que topaba en 100).
  useMaquilerosEsMa: () => ({
    data: { filas: [{ id: 5, nombre: 'Maquila SA', corto: null }] },
    isPending: false,
    isError: false,
  }),
}));

function datos(): EsMaConciliacion {
  return {
    desde: null,
    hasta: null,
    filas: [
      {
        idOrden: 1,
        folioOrden: 100,
        idMaquilero: 5,
        maquilero: 'Maquila SA',
        idTipoProceso: 3,
        tipoProceso: 'Costura',
        recibido: 50,
        cargado: 30,
        faltantePorCargar: 20,
        cortado: 60,
        entregado: 25,
        pagada: false,
      },
      {
        idOrden: 2,
        folioOrden: 101,
        idMaquilero: 5,
        maquilero: 'Maquila SA',
        idTipoProceso: 3,
        tipoProceso: 'Costura',
        recibido: 40,
        cargado: 40,
        faltantePorCargar: 0,
        cortado: 40,
        entregado: 40,
        pagada: true,
      },
    ],
    cargosSinRecibo: [
      {
        idCargo: 9,
        idOrden: 3,
        folioOrden: 102,
        idMaquilero: 5,
        maquilero: 'Maquila SA',
        idTipoProceso: 3,
        tipoProceso: 'Costura',
        cantidad: 12,
      },
    ],
    totales: { recibido: 90, cargado: 70, faltantePorCargar: 20, numCargosSinRecibo: 1 },
  };
}

const sesion = () => estadoSesionDePrueba(['esma.ver-pagos']);

describe('ConciliacionCargosPagina (F6-E4)', () => {
  beforeEach(() => {
    useConciliacionEsMa.mockReset();
  });

  it('muestra el cuadre con sus totales y los cargos sin recibo', () => {
    useConciliacionEsMa.mockReturnValue({
      data: datos(),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<ConciliacionCargosPagina />, { sesion: sesion() });

    expect(screen.getByTestId('conc-tabla')).toBeInTheDocument();
    expect(screen.getByTestId('conc-totales')).toBeInTheDocument();
    // Dos renglones del cuadre + los cargos sin recibo.
    expect(within(screen.getByTestId('conc-tabla')).getAllByText('Costura').length).toBe(2);
    expect(screen.getByTestId('conc-sin-recibo')).toBeInTheDocument();
  });

  it('el filtro "solo con faltante" oculta los renglones al día', async () => {
    const user = userEvent.setup();
    useConciliacionEsMa.mockReturnValue({
      data: datos(),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<ConciliacionCargosPagina />, { sesion: sesion() });

    await user.click(screen.getByTestId('conc-solo-faltantes'));
    // Solo queda el renglón con faltante (#100); el #101 (al día) desaparece.
    expect(within(screen.getByTestId('conc-tabla')).getAllByText('Costura').length).toBe(1);
    expect(screen.getByText('#100')).toBeInTheDocument();
    expect(screen.queryByText('#101')).toBeNull();
  });

  it('estado de error', () => {
    useConciliacionEsMa.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'Fallo la conciliación' },
    });
    renderConProveedores(<ConciliacionCargosPagina />, { sesion: sesion() });
    expect(screen.getByRole('alert')).toHaveTextContent('Fallo la conciliación');
  });
});
