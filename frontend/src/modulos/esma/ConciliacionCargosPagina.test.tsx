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
        incompletas: 0,
        soloIncompletas: false,
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
        // MEZCLADO: entregó incompletas Y piezas buenas → se ven las 6, pero SIN la marca.
        incompletas: 6,
        soloIncompletas: false,
        cargado: 40,
        faltantePorCargar: 0,
        cortado: 40,
        entregado: 40,
        pagada: true,
      },
      {
        // PURAS INCOMPLETAS (V1-E8k): tres ceros y aun así con renglón. Es la fila que antes no se
        // podía leer.
        idOrden: 4,
        folioOrden: 103,
        idMaquilero: 5,
        maquilero: 'Maquila SA',
        idTipoProceso: 7,
        tipoProceso: 'Estampado',
        recibido: 0,
        incompletas: 5,
        soloIncompletas: true,
        cargado: 0,
        faltantePorCargar: 0,
        cortado: 30,
        entregado: 0,
        pagada: false,
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
    totales: {
      recibido: 90,
      incompletas: 11,
      cargado: 70,
      faltantePorCargar: 20,
      numCargosSinRecibo: 1,
    },
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

  /**
   * ⭐ V1-E8k — EL RENGLÓN DE PURAS INCOMPLETAS SE VE Y SE ENTIENDE. Un grupo cuyos recibos vivos
   * sólo trajeron prendas incompletas llega con `recibido` 0 (no se pagan → esos recibos no
   * generaron cargo); sin más cargos en el grupo —como en este fixture— el renglón queda en ceros,
   * y sin marca es una fila que nadie sabe por qué existe. La marca la manda el servidor
   * (`soloIncompletas`): la pantalla no la deduce.
   */
  it('el renglón de puras incompletas se ve, con su marca y su cuenta, en tabla Y en tarjetas', () => {
    useConciliacionEsMa.mockReturnValue({
      data: datos(),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<ConciliacionCargosPagina />, { sesion: sesion() });

    // No está escondido: sale de entrada, sin tocar ningún filtro.
    expect(screen.getAllByText('#103').length).toBeGreaterThan(0);
    // Una marca por vista (tabla + tarjetas), y SOLO en ese renglón: los otros dos no la llevan
    // (el #101 tiene incompletas y piezas buenas — si la marca fuera "tiene incompletas", habría 4).
    expect(screen.getAllByTestId('conc-solo-incompletas')).toHaveLength(2);
    const tabla = within(screen.getByTestId('conc-tabla'));
    expect(tabla.getAllByTestId('conc-solo-incompletas')).toHaveLength(1);
    const tarjetas = within(screen.getByTestId('conc-tarjetas'));
    expect(tarjetas.getAllByTestId('conc-solo-incompletas')).toHaveLength(1);
    // Y la cuenta que lo explica se ve en las dos vistas.
    expect(tabla.getAllByText('5').length).toBeGreaterThan(0);
    expect(tarjetas.getByText(/incompletas 5/)).toBeInTheDocument();
    // El total de incompletas viaja aparte del recibido (90), nunca sumado a él.
    expect(screen.getByTestId('conc-totales')).toHaveTextContent('incompletas 11');
    expect(screen.getByTestId('conc-totales')).toHaveTextContent('Recibido 90');
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
    // El de puras incompletas se va POR ESTE filtro (que ya existía) y no por uno nuevo: quien no
    // lo quiera ver lo apaga aquí, y por default sigue visible.
    expect(screen.queryByText('#103')).toBeNull();
    expect(screen.queryByTestId('conc-solo-incompletas')).toBeNull();
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
