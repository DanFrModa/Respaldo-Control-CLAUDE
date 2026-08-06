import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

/**
 * Pruebas de la captura por TELA+COLOR (etapa A2 — Daniel §Post-F9.11): el color es HIJO de la
 * tela, y el CUERPO y el COMPLEMENTO se capturan JUNTOS en el mismo renglón (comprar solo
 * cardigan = cuerpo en 0). En telas sin complemento esa cantidad NO se captura.
 */

// El selector de tela se simula: emite la tela elegida (CON sus colores hijos) al hacer clic.
vi.mock('./SelectorTela', () => ({
  SelectorTela: ({ alSeleccionar }: { alSeleccionar: (t: unknown) => void }) => (
    <div>
      <button
        type="button"
        data-testid="sel-felpa"
        onClick={() =>
          alSeleccionar({
            id: 1,
            nombre: 'Felpa Suiza',
            nombreCuerpo: 'Felpa',
            nombreComplemento: 'Cardigan',
            colores: [
              { id: 11, nombre: 'Marino', pantone: '19-3920' },
              { id: 12, nombre: 'Blanco', pantone: null },
            ],
          })
        }
      >
        elegir felpa
      </button>
      <button
        type="button"
        data-testid="sel-lisa"
        onClick={() =>
          alSeleccionar({
            id: 2,
            nombre: 'Lisa Algodón',
            nombreCuerpo: null,
            nombreComplemento: null,
            colores: [{ id: 21, nombre: 'Negro', pantone: null }],
          })
        }
      >
        elegir lisa
      </button>
    </div>
  ),
}));

const { CapturaRenglonesTelaColor } = await import('./CapturaRenglonesTelaColor');

describe('<CapturaRenglonesTelaColor> · cuerpo y complemento juntos (A2)', () => {
  it('al elegir la tela ofrece SUS colores y el campo del complemento con su nombre', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaRenglonesTelaColor renglones={[]} onChange={vi.fn()} />);
    await usuario.click(screen.getByTestId('sel-felpa'));

    // Los colores del select son los HIJOS de la tela (con su pantone).
    const select = screen.getByTestId('captura-color-color');
    expect(select).toHaveTextContent('Marino · 19-3920');
    expect(select).toHaveTextContent('Blanco');
    // El campo del complemento usa el NOMBRE de la tela ("Cardigan").
    expect(screen.getByLabelText('Cardigan')).toBeInTheDocument();
    expect(screen.getByLabelText('Felpa')).toBeInTheDocument();
  });

  it('agrega el renglón con AMBAS cantidades y el lote del proveedor (entrada)', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(
      <CapturaRenglonesTelaColor renglones={[]} onChange={onChange} conLoteProveedor />,
    );
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '11');
    await usuario.type(screen.getByTestId('captura-color-cantidad'), '100');
    await usuario.type(screen.getByTestId('captura-color-complemento'), '40');
    await usuario.type(screen.getByTestId('captura-color-lote-prov'), 'L-778');
    await usuario.click(screen.getByTestId('captura-color-agregar'));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        idTelaColor: 11,
        tela: 'Felpa Suiza',
        color: 'Marino',
        cantidad: 100,
        cantidadComplemento: 40,
        loteProveedor: 'L-778',
      }),
    ]);
  });

  it('acepta SOLO complemento (cuerpo en 0) — comprar solo cardigan', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(<CapturaRenglonesTelaColor renglones={[]} onChange={onChange} />);
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '12');
    await usuario.type(screen.getByTestId('captura-color-complemento'), '25');
    await usuario.click(screen.getByTestId('captura-color-agregar'));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ idTelaColor: 12, cantidad: 0, cantidadComplemento: 25 }),
    ]);
  });

  it('con ambas cantidades en 0 el botón queda deshabilitado', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaRenglonesTelaColor renglones={[]} onChange={vi.fn()} />);
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '11');
    expect(screen.getByTestId('captura-color-agregar')).toBeDisabled();
  });

  it('en una tela SIN complemento no ofrece esa cantidad y exige cuerpo > 0', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(<CapturaRenglonesTelaColor renglones={[]} onChange={onChange} />);
    await usuario.click(screen.getByTestId('sel-lisa'));
    expect(screen.queryByTestId('captura-color-complemento')).not.toBeInTheDocument();
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '21');
    // Sin cuerpo no se puede agregar (no hay complemento que lo salve).
    expect(screen.getByTestId('captura-color-agregar')).toBeDisabled();
    await usuario.type(screen.getByTestId('captura-color-cantidad'), '33');
    await usuario.click(screen.getByTestId('captura-color-agregar'));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ idTelaColor: 21, cantidad: 33, cantidadComplemento: 0 }),
    ]);
  });

  it('en ENTRADA el mismo tela+color se AGREGA como renglón nuevo (dos lotes = dos partidas)', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(
      <CapturaRenglonesTelaColor
        renglones={[
          {
            idTelaColor: 11,
            tela: 'Felpa Suiza',
            color: 'Marino',
            nombreComplemento: 'Cardigan',
            cantidad: 60,
            cantidadComplemento: 20,
            loteProveedor: 'L-A',
          },
        ]}
        onChange={onChange}
        conLoteProveedor
      />,
    );
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '11');
    await usuario.type(screen.getByTestId('captura-color-cantidad'), '35');
    await usuario.type(screen.getByTestId('captura-color-complemento'), '10');
    await usuario.type(screen.getByTestId('captura-color-lote-prov'), 'L-B');
    await usuario.click(screen.getByTestId('captura-color-agregar'));

    // NO se fusiona: quedan DOS renglones del mismo color, cada uno con SU lote del proveedor.
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ idTelaColor: 11, cantidad: 60, loteProveedor: 'L-A' }),
      expect.objectContaining({ idTelaColor: 11, cantidad: 35, loteProveedor: 'L-B' }),
    ]);
  });

  it('en salida/traspaso repetir la misma tela+color SUMA las cantidades (no duplica)', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(
      <CapturaRenglonesTelaColor
        renglones={[
          {
            idTelaColor: 11,
            tela: 'Felpa Suiza',
            color: 'Marino',
            nombreComplemento: 'Cardigan',
            cantidad: 10,
            cantidadComplemento: 5,
          },
        ]}
        onChange={onChange}
      />,
    );
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '11');
    await usuario.type(screen.getByTestId('captura-color-cantidad'), '15');
    await usuario.click(screen.getByTestId('captura-color-agregar'));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ idTelaColor: 11, cantidad: 25, cantidadComplemento: 5 }),
    ]);
  });
});
