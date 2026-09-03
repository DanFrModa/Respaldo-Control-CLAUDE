import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CargoEsMaFila } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CapturaPagosPagina } from './CapturaPagosPagina';

const imprimirPago = vi.fn();
const pagoCreado = {
  id: 77,
  idEmpresa: 1,
  idMaquilero: 5,
  maquilero: 'Maquila SA',
  monto: 160,
  fecha: '2026-06-30',
  conFactura: null,
  observaciones: null,
  estadoRevision: 'capturado' as const,
  aplicaciones: [],
  creadoEn: '2026-06-30T00:00:00.000Z',
};
const crearPagoMutate = vi.fn(
  (_cuerpo: unknown, opts?: { onSuccess?: (p: typeof pagoCreado) => void }) => {
    opts?.onSuccess?.(pagoCreado);
  },
);

function cargo(): CargoEsMaFila {
  return {
    id: 7,
    idEmpresa: 1,
    idEtapaRecibo: 99,
    folioRecibo: 12,
    idMaquilero: 5,
    maquilero: 'Maquila SA',
    idOrden: 1,
    folioOrden: 100,
    idTipoProceso: 3,
    tipoProceso: 'Costura',
    cantidadPropuesta: 20,
    precioPropuesto: 8,
    importePropuesto: 160,
    // V1-E8k: un cargo que viene de un recibo limpio (sin incompletas) — el caso común.
    incompletas: 0,
    cantidadReal: 20,
    precioReal: 8,
    importeReal: 160,
    sinCosto: false,
    conFactura: null,
    cantidadPagada: 0,
    porPagar: 20,
    pagado: false,
    estado: 'validado',
    estadoConciliacion: 'revisado',
    observaciones: null,
    validadoEn: '2026-06-20T00:00:00.000Z',
    validadoPorId: 'u1',
    creadoEn: '2026-06-19T00:00:00.000Z',
  };
}

vi.mock('@/api/esma', () => ({
  useCargosEsMa: () => ({
    data: { filas: [cargo()], totalImportePropuesto: 160 },
    isPending: false,
    isError: false,
    error: null,
  }),
  useCrearPagoEsMa: () => ({ mutate: crearPagoMutate, isPending: false }),
  imprimirPagoEsMa: (id: number) => {
    imprimirPago(id);
  },
  useSaldoMaquilero: () => ({
    data: {
      idMaquilero: 5,
      maquilero: 'Maquila SA',
      conFactura: null,
      totalCargos: 160,
      totalAbonos: 0,
      totalPagos: 0,
      totalDescuentos: 0,
      saldo: 160,
      pendienteRevision: { abonos: 0, pagos: 0, descuentos: 0, neto: 0, partidas: 0 },
    },
    isPending: false,
    isError: false,
    error: null,
  }),
  // F6-E5: el selector de maquilero usa el nuevo endpoint (activos + rol de maquila).
  useMaquilerosEsMa: () => ({
    data: { filas: [{ id: 5, nombre: 'Maquila SA', corto: null }] },
    isPending: false,
    isError: false,
  }),
}));

/** Elige el maquilero en el combobox buscable (abre el popover y clickea la única opción). */
async function elegirMaquilero(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('pago-maquilero-busqueda'));
  await user.click(screen.getByTestId('pago-maquilero-opcion'));
}

describe('CapturaPagosPagina (F6-E4)', () => {
  beforeEach(() => {
    imprimirPago.mockReset();
    crearPagoMutate.mockClear();
  });

  it('lista los cargos por pagar al elegir maquilero y paga los seleccionados', async () => {
    const user = userEvent.setup();
    renderConProveedores(<CapturaPagosPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });

    await elegirMaquilero(user);
    expect(screen.getByTestId('pago-cargos-tabla')).toBeInTheDocument();

    // Selecciona el cargo (default: cubre todo lo por pagar) y registra el pago.
    await user.click(screen.getByTestId('pago-cargo-check-7'));
    await user.click(screen.getByTestId('pago-guardar'));

    expect(crearPagoMutate).toHaveBeenCalledTimes(1);
    const cuerpo = crearPagoMutate.mock.calls[0]?.[0] as {
      idMaquilero: number;
      aplicaciones: { idCargo: number; cantidad: number }[];
    };
    expect(cuerpo.idMaquilero).toBe(5);
    expect(cuerpo.aplicaciones).toEqual([{ idCargo: 7, cantidad: 20 }]);

    // Tras el pago aparece el botón de imprimir el recibo.
    await user.click(screen.getByTestId('pago-imprimir'));
    expect(imprimirPago).toHaveBeenCalledWith(77);
  });

  it('sin esma.ver-pagos el botón Registrar pago queda deshabilitado', async () => {
    const user = userEvent.setup();
    renderConProveedores(<CapturaPagosPagina />, {
      sesion: estadoSesionDePrueba(['esma.modificar']),
    });
    await elegirMaquilero(user);
    await user.click(screen.getByTestId('pago-cargo-check-7'));
    expect(screen.getByTestId('pago-guardar')).toBeDisabled();
  });
});
