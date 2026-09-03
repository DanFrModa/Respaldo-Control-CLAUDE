import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CapturaMovimientoPagina } from './CapturaMovimientoPagina';

const crearMutate = vi.fn();

const abonos = {
  data: {
    filas: [
      {
        id: 1,
        concepto: 'abono' as const,
        idEmpresa: 1,
        idMaquilero: 5,
        maquilero: 'Maquila SA',
        // Importe oculto (sin consultas.ver-importes) → el backend lo devuelve null.
        monto: null,
        fecha: '2026-06-30',
        conFactura: null,
        observaciones: 'Anticipo',
        estadoRevision: 'capturado' as const,
        creadoEn: '2026-06-30T00:00:00.000Z',
      },
    ],
    total: null,
  },
  isPending: false,
  isError: false,
  error: null,
};

const saldo = {
  data: {
    idMaquilero: 5,
    maquilero: 'Maquila SA',
    conFactura: null,
    totalCargos: null,
    totalAbonos: null,
    totalPagos: null,
    totalDescuentos: null,
    saldo: null,
    pendienteRevision: { abonos: null, pagos: null, descuentos: null, neto: null, partidas: 0 },
  },
  isPending: false,
  isError: false,
  error: null,
};

vi.mock('@/api/esma', () => ({
  useCrearMovimientoEsMa: () => ({ mutate: crearMutate, isPending: false }),
  useAbonosMaquilero: () => abonos,
  useDescuentosMaquilero: () => ({
    data: { filas: [], total: null },
    isPending: false,
    isError: false,
    error: null,
  }),
  useSaldoMaquilero: () => saldo,
  // F6-E5: el selector de maquilero usa el nuevo endpoint (activos + rol de maquila).
  useMaquilerosEsMa: () => ({
    data: { filas: [{ id: 5, nombre: 'Maquila SA', corto: null }] },
    isPending: false,
    isError: false,
  }),
}));

/** Elige el maquilero en el combobox buscable (abre el popover y clickea la única opción). */
async function elegirMaquilero(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('mov-maquilero-busqueda'));
  await user.click(screen.getByTestId('mov-maquilero-opcion'));
}

describe('CapturaMovimientoPagina (F6-E4, abonos)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
  });

  it('sin esma.modificar el botón Guardar queda deshabilitado', async () => {
    const user = userEvent.setup();
    renderConProveedores(<CapturaMovimientoPagina concepto="abonos" />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    await elegirMaquilero(user);
    await user.type(screen.getByTestId('mov-monto'), '500');
    expect(screen.getByTestId('mov-guardar')).toBeDisabled();
  });

  it('con esma.modificar captura un abono con maquilero, monto y fecha', async () => {
    const user = userEvent.setup();
    renderConProveedores(<CapturaMovimientoPagina concepto="abonos" />, {
      sesion: estadoSesionDePrueba(['esma.modificar']),
    });
    await elegirMaquilero(user);
    await user.type(screen.getByTestId('mov-monto'), '500');
    await user.click(screen.getByTestId('mov-guardar'));

    expect(crearMutate).toHaveBeenCalledTimes(1);
    const args = crearMutate.mock.calls[0]?.[0] as {
      concepto: string;
      cuerpo: { idMaquilero: number; monto: number };
    };
    expect(args.concepto).toBe('abonos');
    expect(args.cuerpo.idMaquilero).toBe(5);
    expect(args.cuerpo.monto).toBe(500);
  });

  it('oculta los importes de la lista cuando el backend los devuelve en null', async () => {
    const user = userEvent.setup();
    renderConProveedores(<CapturaMovimientoPagina concepto="abonos" />, {
      sesion: estadoSesionDePrueba(['esma.modificar', 'esma.ver-pagos']),
    });
    await elegirMaquilero(user);
    // La fila del histórico muestra "—" en el importe (monto null) y el saldo también.
    expect(screen.getByTestId('mov-fila')).toHaveTextContent('—');
    expect(screen.getByTestId('saldo-saldo')).toHaveTextContent('—');
  });

  it('"Duplicar partida": pre-llena el formulario con los valores iniciales del router state', () => {
    renderConProveedores(<CapturaMovimientoPagina concepto="abonos" />, {
      sesion: estadoSesionDePrueba(['esma.modificar']),
      rutaInicial: {
        pathname: '/esma/abonos',
        state: { idMaquilero: 5, monto: '750', observaciones: 'Copia de anticipo' },
      },
    });
    // Maquilero, importe y observaciones llegan pre-llenados de la partida origen. El combobox
    // resuelve el nombre del maquilero (id 5) desde la lista y lo muestra en el input.
    expect(screen.getByTestId('mov-maquilero-busqueda')).toHaveValue('Maquila SA');
    expect(screen.getByTestId('mov-monto')).toHaveValue(750);
    expect(screen.getByDisplayValue('Copia de anticipo')).toBeInTheDocument();
  });
});
