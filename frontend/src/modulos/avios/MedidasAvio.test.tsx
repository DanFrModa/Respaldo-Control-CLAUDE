import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MedidasAvio as TipoMedidas } from '@/api/medidas-avio';
import { renderConProveedores } from '@/pruebas/utilidades';

import { MedidasAvio } from './MedidasAvio';

/**
 * ⭐ V1-E3g (§Post-F9.66) — el catálogo de MEDIDAS del avío deja de ser texto libre. Lo que estas
 * pruebas fijan es la decisión de Daniel: *"el campo donde se captura lo dejamos solo numérico,
 * entonces obliga al usuario a evitar poner 53 cm, 53 centímetros o 53CM"*. La unidad va aparte y
 * se ve pegada al campo; lo heredado que no se pudo convertir sale MARCADO, no borrado (D3).
 */
const useMedidas = vi.fn<
  () => {
    data: TipoMedidas | undefined;
    isPending: boolean;
    isError: boolean;
    error: { message: string } | null;
  }
>();
const guardarMutate = vi.fn();

vi.mock('@/api/medidas-avio', () => ({
  useMedidasAvio: () => useMedidas(),
  useGuardarMedidasAvio: () => ({ mutate: guardarMutate, isPending: false }),
}));

const toastError = vi.fn<(mensaje: string) => void>();
vi.mock('sonner', () => ({
  toast: {
    error: (m: string): void => {
      toastError(m);
    },
    success: vi.fn(),
  },
}));

/** Respuesta del GET con una medida ya normalizada. */
function medidas(over: Partial<TipoMedidas> = {}): TipoMedidas {
  return {
    datos: [
      {
        id: 1,
        medida: '53 cm',
        valor: 53,
        requiereRevision: false,
        precio: 6,
        orden: 0,
        activo: true,
      },
    ],
    unidadMedida: 'cm',
    promedioPreCosto: 6,
    avisos: [],
    ...over,
  };
}

function render(): void {
  renderConProveedores(<MedidasAvio idAvio={9} puedeAdministrar />);
}

describe('<MedidasAvio> (V1-E3g)', () => {
  beforeEach(() => {
    useMedidas.mockReset();
    guardarMutate.mockReset();
    toastError.mockReset();
    useMedidas.mockReturnValue({
      data: medidas(),
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it('captura el NÚMERO y la unidad UNA sola vez; manda `valor` (no la etiqueta)', async () => {
    const usuario = userEvent.setup();
    render();

    expect(screen.getByTestId('unidad-medidas-avio')).toHaveValue('cm');
    const campo = screen.getByLabelText('Medida 1');
    expect(campo).toHaveValue(53); // el número pelón, no "53 cm"

    await usuario.clear(campo);
    await usuario.type(campo, '55');
    await usuario.click(screen.getByTestId('guardar-medidas'));

    await waitFor(() => expect(guardarMutate).toHaveBeenCalledTimes(1));
    const args = guardarMutate.mock.calls[0]?.[0] as {
      cuerpo: { unidadMedida: string | null; medidas: { id?: number; valor: number }[] };
    };
    expect(args.cuerpo.unidadMedida).toBe('cm');
    // Va con `id`: es una CORRECCIÓN en su lugar, no un alta que duplicaría la medida.
    expect(args.cuerpo.medidas).toEqual([{ id: 1, valor: 55, precio: 6, orden: 0 }]);
  });

  it('sin unidad no deja guardar: el número solo no dice nada', async () => {
    const usuario = userEvent.setup();
    useMedidas.mockReturnValue({
      data: medidas({ unidadMedida: null }),
      isPending: false,
      isError: false,
      error: null,
    });
    render();

    await usuario.click(screen.getByTestId('guardar-medidas'));
    expect(guardarMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('una medida heredada sin convertir sale MARCADA, con su etiqueta original a la vista', () => {
    useMedidas.mockReturnValue({
      data: medidas({
        datos: [
          {
            id: 2,
            medida: 'S',
            valor: null,
            requiereRevision: true,
            precio: 4,
            orden: 0,
            activo: true,
          },
        ],
        avisos: ['1 medida(s) de este avío necesitan revisión manual ("S").'],
      }),
      isPending: false,
      isError: false,
      error: null,
    });
    render();

    expect(screen.getByLabelText('Medida 1')).toHaveValue(null); // nadie inventa el número
    expect(screen.getByTestId('medida-por-revisar')).toHaveTextContent('S');
    expect(screen.getByTestId('avisos-medidas-avio')).toHaveTextContent('revisión manual');
  });

  it('⭐ H4: una heredada sin número NO congela el avío — viaja para conservarse', async () => {
    const usuario = userEvent.setup();
    useMedidas.mockReturnValue({
      data: medidas({
        datos: [
          {
            id: 2,
            medida: 'S',
            valor: null,
            requiereRevision: true,
            precio: 4,
            orden: 0,
            activo: true,
          },
          {
            id: 1,
            medida: '53 cm',
            valor: 53,
            requiereRevision: false,
            precio: 6,
            orden: 1,
            activo: true,
          },
        ],
      }),
      isPending: false,
      isError: false,
      error: null,
    });
    render();

    // Se corrige el precio de la medida BUENA sin tocar la heredada.
    const precioBueno = screen.getByLabelText('Precio de la medida 2');
    await usuario.clear(precioBueno);
    await usuario.type(precioBueno, '8');
    await usuario.click(screen.getByTestId('guardar-medidas'));

    await waitFor(() => expect(guardarMutate).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
    const args = guardarMutate.mock.calls[0]?.[0] as {
      cuerpo: { medidas: { id?: number; valor: number | null; precio: number }[] };
    };
    // La heredada viaja CON su id y SIN número: el servidor la conserva en vez de darla de baja.
    expect(args.cuerpo.medidas).toEqual([
      { id: 2, valor: null, precio: 4, orden: 0 },
      { id: 1, valor: 53, precio: 8, orden: 1 },
    ]);
  });

  it('H4: un renglón NUEVO sin número es un error aunque traiga precio (no se cuela como "conservar")', async () => {
    const usuario = userEvent.setup();
    render();
    await usuario.click(screen.getByTestId('agregar-medida'));
    // Precio VÁLIDO a propósito: si no, el guardado se detendría por el precio y esta prueba no
    // diría nada sobre el número (fue justo el agujero que dejó la primera versión).
    await usuario.type(screen.getByLabelText('Precio de la medida 2'), '5');
    await usuario.click(screen.getByTestId('guardar-medidas'));
    expect(guardarMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('H4: BORRAR el número de una medida ya normalizada es un error, no un "conservar"', async () => {
    const usuario = userEvent.setup();
    render(); // el fixture trae la 53 cm con `valor: 53`
    await usuario.clear(screen.getByLabelText('Medida 1'));
    await usuario.click(screen.getByTestId('guardar-medidas'));
    expect(guardarMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('los avisos del servidor se muestran y NO bloquean', async () => {
    const usuario = userEvent.setup();
    useMedidas.mockReturnValue({
      data: medidas({ avisos: ['La medida "1 cm" queda fuera de lo normal para "cm".'] }),
      isPending: false,
      isError: false,
      error: null,
    });
    render();

    expect(screen.getByTestId('avisos-medidas-avio')).toHaveTextContent('fuera de lo normal');
    await usuario.click(screen.getByTestId('guardar-medidas'));
    await waitFor(() => expect(guardarMutate).toHaveBeenCalledTimes(1));
  });
});
