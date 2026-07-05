import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MedidasAvio } from '@/api/modelo-medidas';
import { renderConProveedores } from '@/pruebas/utilidades';

import { EditorMedidasAvio } from './EditorMedidasAvio';

const useMedidasAvio = vi.fn<
  () => {
    data: MedidasAvio | undefined;
    isPending: boolean;
    isError: boolean;
    error: { message: string } | null;
  }
>();
const guardarMutate = vi.fn();

vi.mock('@/api/modelo-medidas', () => ({
  useMedidasAvio: () => useMedidasAvio(),
  useReemplazarMedidasAvio: () => ({ mutate: guardarMutate, isPending: false }),
}));

function medidas(consumoPorTalla: boolean): MedidasAvio {
  return {
    idModelo: 1,
    idAvio: 7,
    consumoPorTalla,
    tallas: [
      { idTalla: 10, etiquetaTalla: 'CH', consumo: 0 },
      { idTalla: 11, etiquetaTalla: 'M', consumo: 0 },
      { idTalla: 12, etiquetaTalla: 'G', consumo: 0 },
    ],
  };
}

describe('<EditorMedidasAvio>', () => {
  beforeEach(() => {
    useMedidasAvio.mockReset();
    guardarMutate.mockReset();
  });

  it('despliega la tabla de tallas al activar "consumo por talla"', async () => {
    const usuario = userEvent.setup();
    useMedidasAvio.mockReturnValue({
      data: medidas(false),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar />);

    // El panel está cerrado; se abre con el toggle.
    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    const checkbox = screen.getByTestId('consumo-por-talla-7');
    expect(checkbox).not.toBeChecked();
    // Sin activar, no hay tabla de tallas.
    expect(screen.queryByTestId('tabla-tallas-avio-7')).not.toBeInTheDocument();

    await usuario.click(checkbox);
    const tabla = screen.getByTestId('tabla-tallas-avio-7');
    expect(within(tabla).getByLabelText('CH')).toBeInTheDocument();
    expect(within(tabla).getByLabelText('M')).toBeInTheDocument();
    expect(within(tabla).getByLabelText('G')).toBeInTheDocument();
  });

  it('guarda el set completo de medidas por talla (PUT)', async () => {
    const usuario = userEvent.setup();
    useMedidasAvio.mockReturnValue({
      data: medidas(true),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar />);

    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    // Ya viene con consumoPorTalla=true → la tabla se ve.
    await usuario.type(screen.getByTestId('consumo-talla-7-10'), '1.5');
    await usuario.click(screen.getByTestId('guardar-medidas-avio-7'));

    await waitFor(() => expect(guardarMutate).toHaveBeenCalledTimes(1));
    const args = guardarMutate.mock.calls[0]?.[0] as {
      idModelo: number;
      idAvio: number;
      cuerpo: { consumoPorTalla: boolean; tallas: { idTalla: number; consumo: number }[] };
    };
    expect(args.idModelo).toBe(1);
    expect(args.idAvio).toBe(7);
    expect(args.cuerpo.consumoPorTalla).toBe(true);
    expect(args.cuerpo.tallas).toEqual([
      { idTalla: 10, consumo: 1.5 },
      { idTalla: 11, consumo: 0 },
      { idTalla: 12, consumo: 0 },
    ]);
  });

  it('sin permiso de administrar, no ofrece guardar y deshabilita los inputs', async () => {
    const usuario = userEvent.setup();
    useMedidasAvio.mockReturnValue({
      data: medidas(true),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar={false} />);

    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    expect(screen.queryByTestId('guardar-medidas-avio-7')).not.toBeInTheDocument();
    expect(screen.getByTestId('consumo-talla-7-10')).toBeDisabled();
    expect(screen.getByTestId('consumo-por-talla-7')).toBeDisabled();
  });
});
