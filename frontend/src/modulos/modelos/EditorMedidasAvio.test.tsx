import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MedidasAvio } from '@/api/modelo-medidas';
import { renderConProveedores } from '@/pruebas/utilidades';

import { EditorMedidasAvio } from './EditorMedidasAvio';

/**
 * Pruebas del panel de CONSUMO POR TALLA de un avío del BOM (R18 + amarre de medida R5/B11).
 * V1-E3c: la matriz nace de la CURVA del modelo (el servidor manda una fila por talla, con 0 si
 * no se ha capturado) y el aviso "el modelo no tiene curva" solo sale cuando de verdad no la
 * tiene (`tieneCurva`) — antes salía SIEMPRE porque nada creaba renglones.
 */
const useMedidasAvio = vi.fn<
  () => {
    data: MedidasAvio | undefined;
    isPending: boolean;
    isError: boolean;
    error: { message: string } | null;
  }
>();
const guardarMutate = vi.fn();
const medidasDelCatalogo =
  vi.fn<
    () => {
      data: {
        datos: {
          id: number;
          medida: string;
          valor: number | null;
          requiereRevision: boolean;
          precio: number;
          activo: boolean;
        }[];
      };
    }
  >();

vi.mock('@/api/modelo-medidas', () => ({
  useMedidasAvio: () => useMedidasAvio(),
  useReemplazarMedidasAvio: () => ({ mutate: guardarMutate, isPending: false }),
}));

vi.mock('@/api/medidas-avio', () => ({
  useMedidasAvio: () => medidasDelCatalogo(),
}));

/** Respuesta del GET con la matriz DERIVADA de la curva (3 tallas, aún sin capturar). */
function medidas(consumoPorTalla: boolean, extra: Partial<MedidasAvio> = {}): MedidasAvio {
  return {
    idModelo: 1,
    idAvio: 7,
    consumoPorTalla,
    tieneCurva: true,
    modoCaptura: 'consumo',
    unidadConsumo: 'm',
    unidadMedida: null,
    avisos: [],
    tallas: [talla(10, 'CH'), talla(11, 'M'), talla(12, 'G')],
    ...extra,
  };
}

/** Talla de la curva SIN capturar (`consumo: null`) — la matriz existe, la fila en BD no. */
function talla(idTalla: number, etiquetaTalla: string): MedidasAvio['tallas'][number] {
  return {
    idTalla,
    etiquetaTalla,
    consumo: null,
    enCurva: true,
    idAvioMedida: null,
    medidaAmarrada: null,
    precioMedida: null,
  };
}

describe('<EditorMedidasAvio>', () => {
  beforeEach(() => {
    useMedidasAvio.mockReset();
    guardarMutate.mockReset();
    medidasDelCatalogo.mockReset();
    medidasDelCatalogo.mockReturnValue({ data: { datos: [] } });
  });

  it('despliega la matriz de tallas de la CURVA al activar "consumo por talla"', async () => {
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
    // Sin activar, no hay matriz de tallas.
    expect(screen.queryByTestId('tabla-tallas-avio-7')).not.toBeInTheDocument();

    await usuario.click(checkbox);
    const tabla = screen.getByTestId('tabla-tallas-avio-7');
    expect(within(tabla).getByLabelText('CH')).toBeInTheDocument();
    expect(within(tabla).getByLabelText('M')).toBeInTheDocument();
    expect(within(tabla).getByLabelText('G')).toBeInTheDocument();
    // Y NO se acusa falta de curva: el modelo sí la tiene.
    expect(screen.queryByTestId('sin-curva-7')).not.toBeInTheDocument();
  });

  it('⭐ las tallas EN BLANCO no se guardan: solo viaja lo capturado (PUT)', async () => {
    const usuario = userEvent.setup();
    useMedidasAvio.mockReturnValue({
      data: medidas(true),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar />);

    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    // Ya viene con consumoPorTalla=true → la matriz se ve. Se captura SOLO CH y se dejan M y G
    // en blanco (el caso real: "las demás las lleno después").
    await usuario.type(screen.getByTestId('consumo-talla-7-10'), '1.5');
    await usuario.click(screen.getByTestId('guardar-medidas-avio-7'));

    await waitFor(() => expect(guardarMutate).toHaveBeenCalledTimes(1));
    const args = guardarMutate.mock.calls[0]?.[0] as {
      idModelo: number;
      idAvio: number;
      cuerpo: {
        consumoPorTalla: boolean;
        tallas: { idTalla: number; consumo: number; idAvioMedida: number | null }[];
      };
    };
    expect(args.idModelo).toBe(1);
    expect(args.idAvio).toBe(7);
    expect(args.cuerpo.consumoPorTalla).toBe(true);
    // NADA de ceros fantasma: mandarlos crearía filas de 0 que hunden el promedio del precosto
    // (0.45 → 0.27 con 2 de 5 tallas en blanco) y apagan el aviso `tallasSinMedida` del MRP.
    expect(args.cuerpo.tallas).toEqual([{ idTalla: 10, consumo: 1.5, idAvioMedida: null }]);
  });

  it('un CERO tecleado a propósito SÍ se guarda (no se confunde con "sin capturar")', async () => {
    const usuario = userEvent.setup();
    useMedidasAvio.mockReturnValue({
      data: medidas(true),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar />);

    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    await usuario.type(screen.getByTestId('consumo-talla-7-10'), '0');
    await usuario.click(screen.getByTestId('guardar-medidas-avio-7'));

    await waitFor(() => expect(guardarMutate).toHaveBeenCalledTimes(1));
    const args = guardarMutate.mock.calls[0]?.[0] as {
      cuerpo: { tallas: { idTalla: number; consumo: number }[] };
    };
    expect(args.cuerpo.tallas).toEqual([{ idTalla: 10, consumo: 0, idAvioMedida: null }]);
  });

  it('una medida ya capturada se muestra tal cual (incluido un 0 guardado)', async () => {
    const usuario = userEvent.setup();
    useMedidasAvio.mockReturnValue({
      data: medidas(true, {
        tallas: [{ ...talla(10, 'CH'), consumo: 0 }, talla(11, 'M')],
      }),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar />);

    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    // El 0 capturado se ve como "0"; la talla sin capturar, vacía.
    expect(screen.getByTestId('consumo-talla-7-10')).toHaveValue(0);
    expect(screen.getByTestId('consumo-talla-7-11')).toHaveValue(null);
  });

  it('amarra la MEDIDA del avío a una talla cuando el avío tiene medidas (R5/B11)', async () => {
    const usuario = userEvent.setup();
    useMedidasAvio.mockReturnValue({
      data: medidas(true),
      isPending: false,
      isError: false,
      error: null,
    });
    medidasDelCatalogo.mockReturnValue({
      data: {
        datos: [
          { id: 3, medida: '15 cm', valor: 15, requiereRevision: false, precio: 5.8, activo: true },
          { id: 4, medida: '18 cm', valor: 18, requiereRevision: false, precio: 6.2, activo: true },
        ],
      },
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar />);

    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    // El amarre vive EN la fila de la medida: sin consumo no hay fila donde guardarlo, así que el
    // selector está inerte hasta que se captura el consumo.
    expect(screen.getByTestId('medida-talla-7-10')).toBeDisabled();
    await usuario.type(screen.getByTestId('consumo-talla-7-10'), '1');
    await usuario.selectOptions(screen.getByTestId('medida-talla-7-10'), '4');
    await usuario.click(screen.getByTestId('guardar-medidas-avio-7'));

    await waitFor(() => expect(guardarMutate).toHaveBeenCalledTimes(1));
    const args = guardarMutate.mock.calls[0]?.[0] as {
      cuerpo: { tallas: { idTalla: number; idAvioMedida: number | null }[] };
    };
    expect(args.cuerpo.tallas).toEqual([{ idTalla: 10, consumo: 1, idAvioMedida: 4 }]);
  });

  it('el aviso "sin curva" SOLO sale cuando el modelo no tiene curva', async () => {
    const usuario = userEvent.setup();
    useMedidasAvio.mockReturnValue({
      data: medidas(true, { tieneCurva: false, tallas: [] }),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar />);

    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    expect(screen.getByTestId('sin-curva-7')).toBeInTheDocument();
    expect(screen.queryByTestId('tabla-tallas-avio-7')).not.toBeInTheDocument();
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

/**
 * ⭐ V1-E3g (§Post-F9.66) — el panel cambia de cara según el MODO que manda el servidor: en
 * `medida` (cierres) se elige QUÉ se pide y el campo de cantidad ni se muestra ni se manda; en
 * `consumo` (elástico) se captura CUÁNTO, con la unidad del avío PEGADA al campo.
 */
describe('<EditorMedidasAvio> — modo de captura (V1-E3g)', () => {
  beforeEach(() => {
    useMedidasAvio.mockReset();
    guardarMutate.mockReset();
    medidasDelCatalogo.mockReset();
    medidasDelCatalogo.mockReturnValue({
      data: {
        datos: [
          { id: 4, medida: '53 cm', valor: 53, requiereRevision: false, precio: 6, activo: true },
        ],
      },
    });
  });

  it('en modo `medida` no hay checkbox ni campo de cantidad: solo se elige la medida', async () => {
    const usuario = userEvent.setup();
    useMedidasAvio.mockReturnValue({
      data: medidas(false, { modoCaptura: 'medida', unidadMedida: 'cm', unidadConsumo: 'pza' }),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar />);

    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    expect(screen.queryByTestId('consumo-por-talla-7')).not.toBeInTheDocument();
    expect(screen.queryByTestId('consumo-talla-7-10')).not.toBeInTheDocument();
    expect(screen.getByTestId('modo-medida-7')).toBeInTheDocument();
    // La matriz sale SIN necesidad de encender nada (el select ya está vivo).
    expect(screen.getByTestId('medida-talla-7-10')).toBeEnabled();

    await usuario.selectOptions(screen.getByTestId('medida-talla-7-10'), '4');
    await usuario.click(screen.getByTestId('guardar-medidas-avio-7'));
    await waitFor(() => expect(guardarMutate).toHaveBeenCalledTimes(1));
    const args = guardarMutate.mock.calls[0]?.[0] as {
      cuerpo: { consumoPorTalla: boolean; tallas: { idTalla: number; idAvioMedida: number }[] };
    };
    // Sólo la talla con medida elegida, SIN `consumo` y con el toggle apagado.
    expect(args.cuerpo.consumoPorTalla).toBe(false);
    expect(args.cuerpo.tallas).toEqual([{ idTalla: 10, idAvioMedida: 4 }]);
  });

  it('en modo `consumo` la UNIDAD del avío se ve pegada al campo', async () => {
    const usuario = userEvent.setup();
    useMedidasAvio.mockReturnValue({
      data: medidas(true, { modoCaptura: 'consumo', unidadConsumo: 'm' }),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar />);

    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    const fila = screen.getByTestId('consumo-talla-7-10').closest('span');
    expect(fila).not.toBeNull();
    expect(within(fila as HTMLElement).getByText('m')).toBeInTheDocument();
  });

  it('los AVISOS del servidor se muestran y NO bloquean el guardado', async () => {
    const usuario = userEvent.setup();
    useMedidasAvio.mockReturnValue({
      data: medidas(true, {
        modoCaptura: 'consumo',
        unidadConsumo: 'm',
        avisos: ['El consumo de la talla CH (75 m) queda fuera de lo normal para "m".'],
      }),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar />);

    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    expect(screen.getByTestId('avisos-medidas-avio-7')).toHaveTextContent('fuera de lo normal');
    await usuario.type(screen.getByTestId('consumo-talla-7-10'), '75');
    await usuario.click(screen.getByTestId('guardar-medidas-avio-7'));
    await waitFor(() => expect(guardarMutate).toHaveBeenCalledTimes(1));
  });

  it('en modo `medida` sin medidas en el catálogo, dice qué falta hacer', async () => {
    const usuario = userEvent.setup();
    medidasDelCatalogo.mockReturnValue({ data: { datos: [] } });
    useMedidasAvio.mockReturnValue({
      data: medidas(false, { modoCaptura: 'medida' }),
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorMedidasAvio idModelo={1} idAvio={7} puedeAdministrar />);

    await usuario.click(screen.getByTestId('toggle-medidas-avio-7'));
    expect(screen.getByTestId('sin-medidas-catalogo-7')).toBeInTheDocument();
  });
});
