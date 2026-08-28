import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CargosEsMa } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ValidacionCargosPagina } from './ValidacionCargosPagina';

// ── Mocks ────────────────────────────────────────────────────────────────────
const validarMutate = vi.fn();
const useCargosEsMa =
  vi.fn<
    () => { data: CargosEsMa | undefined; isPending: boolean; isError: boolean; error: null }
  >();

vi.mock('@/api/esma', () => ({
  useCargosEsMa: () => useCargosEsMa(),
  useValidarCargoEsMa: () => ({ mutate: validarMutate, isPending: false }),
}));

function cola(): CargosEsMa {
  return {
    filas: [
      {
        id: 7,
        idEmpresa: 1,
        idEtapaRecibo: 99,
        folioRecibo: 12,
        idMaquilero: 3,
        maquilero: 'Maquila SA',
        idOrden: 1,
        folioOrden: 100,
        idTipoProceso: 5,
        tipoProceso: 'Costura',
        cantidadPropuesta: 50,
        precioPropuesto: 8,
        importePropuesto: 400,
        // V1-E8k: el maquilero entregó además 3 prendas incompletas. NO están en la cantidad
        // propuesta ni en el importe — el fixture refleja el mundo, no el mínimo que compila.
        incompletas: 3,
        cantidadReal: null,
        precioReal: null,
        importeReal: null,
        sinCosto: false,
        conFactura: null,
        cantidadPagada: 0,
        porPagar: 0,
        pagado: false,
        estado: 'propuesto',
        estadoConciliacion: 'capturado',
        observaciones: null,
        validadoEn: null,
        validadoPorId: null,
        creadoEn: '2026-06-19T00:00:00.000Z',
      },
    ],
    totalImportePropuesto: 400,
  };
}

const sesion = () => estadoSesionDePrueba(['esma.cargo-validar']);

describe('ValidacionCargosPagina (F3-E4)', () => {
  beforeEach(() => {
    validarMutate.mockReset();
    useCargosEsMa.mockReset();
  });

  it('muestra los cargos propuestos (tabla de escritorio)', () => {
    useCargosEsMa.mockReturnValue({ data: cola(), isPending: false, isError: false, error: null });
    renderConProveedores(<ValidacionCargosPagina />, { sesion: sesion() });

    expect(screen.getByTestId('cargos-tabla')).toBeInTheDocument();
    expect(screen.getAllByText('Maquila SA').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Costura').length).toBeGreaterThan(0);
  });

  it('muestra el estado vacío cuando no hay cargos', () => {
    useCargosEsMa.mockReturnValue({
      data: { filas: [], totalImportePropuesto: 0 },
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<ValidacionCargosPagina />, { sesion: sesion() });
    expect(screen.getByText(/No hay cargos propuestos/i)).toBeInTheDocument();
  });

  it('abre el diálogo y al confirmar llama a validar con los datos reales', async () => {
    const usuario = userEvent.setup();
    useCargosEsMa.mockReturnValue({ data: cola(), isPending: false, isError: false, error: null });
    renderConProveedores(<ValidacionCargosPagina />, { sesion: sesion() });

    // Abre el diálogo de validación (botón de la tabla de escritorio).
    const tabla = screen.getByTestId('cargos-tabla');
    await usuario.click(within(tabla).getByTestId('cargo-validar'));

    // Pre-llenado con lo propuesto.
    expect(screen.getByTestId('cargo-cantidad-real')).toHaveValue(50);
    expect(screen.getByTestId('cargo-precio-real')).toHaveValue(8);

    // Ajusta el precio y confirma.
    const precio = screen.getByTestId('cargo-precio-real');
    await usuario.clear(precio);
    await usuario.type(precio, '9');
    await usuario.click(screen.getByTestId('confirmar-validar-cargo'));

    expect(validarMutate).toHaveBeenCalledTimes(1);
    const args = validarMutate.mock.calls[0]?.[0] as {
      id: number;
      cuerpo: { cantidadReal: number; precioReal: number };
    };
    expect(args.id).toBe(7);
    expect(args.cuerpo.cantidadReal).toBe(50);
    expect(args.cuerpo.precioReal).toBe(9);
  });

  it('envía sinCosto y conFactura cuando se marcan en el diálogo (decisiones f/h)', async () => {
    const usuario = userEvent.setup();
    useCargosEsMa.mockReturnValue({ data: cola(), isPending: false, isError: false, error: null });
    renderConProveedores(<ValidacionCargosPagina />, { sesion: sesion() });

    const tabla = screen.getByTestId('cargos-tabla');
    await usuario.click(within(tabla).getByTestId('cargo-validar'));

    await usuario.click(screen.getByTestId('cargo-sin-costo'));
    await usuario.selectOptions(screen.getByTestId('cargo-con-factura'), 'con');
    await usuario.click(screen.getByTestId('confirmar-validar-cargo'));

    expect(validarMutate).toHaveBeenCalledTimes(1);
    const args = validarMutate.mock.calls[0]?.[0] as {
      cuerpo: { sinCosto: boolean; conFactura?: boolean };
    };
    expect(args.cuerpo.sinCosto).toBe(true);
    expect(args.cuerpo.conFactura).toBe(true);
  });
});
