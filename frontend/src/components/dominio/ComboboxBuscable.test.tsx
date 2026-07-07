import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ComboboxBuscable,
  filtrarOpciones,
  normalizarTexto,
  type OpcionCombobox,
} from './ComboboxBuscable';

/** Los homónimos del requisito de Daniel (§4.4.1). */
const OSCARES: readonly OpcionCombobox[] = [
  { id: 1, nombre: 'Óscar Jiménez' },
  { id: 2, nombre: 'Óscar Hernández' },
  { id: 3, nombre: 'Óscar López' },
  { id: 4, nombre: 'Rima Textil' },
];

describe('normalizarTexto / filtrarOpciones (búsqueda sin acentos ni mayúsculas)', () => {
  it('normaliza acentos y mayúsculas ("Óscar" → "oscar")', () => {
    expect(normalizarTexto('Óscar')).toBe('oscar');
    expect(normalizarTexto('JIMÉNEZ')).toBe('jimenez');
  });

  it('"óscar" encuentra a los tres Óscar; "oscar" (sin acento) también', () => {
    expect(filtrarOpciones(OSCARES, 'óscar').map((o) => o.id)).toEqual([1, 2, 3]);
    expect(filtrarOpciones(OSCARES, 'oscar').map((o) => o.id)).toEqual([1, 2, 3]);
  });

  it('"her" deja SOLO a Hernández', () => {
    expect(filtrarOpciones(OSCARES, 'her').map((o) => o.nombre)).toEqual(['Óscar Hernández']);
  });

  it('texto vacío devuelve todas', () => {
    expect(filtrarOpciones(OSCARES, '')).toHaveLength(4);
  });
});

/** Arnés controlado (el combobox es controlado por el padre). */
function Arnes({ onChange }: { onChange?: (id: number | null) => void }): React.JSX.Element {
  const [valor, setValor] = useState<number | null>(null);
  return (
    <ComboboxBuscable
      opciones={OSCARES}
      valor={valor}
      onChange={(id) => {
        setValor(id);
        onChange?.(id);
      }}
      placeholder="Escribe el maquilero…"
      testid="combo"
    />
  );
}

describe('<ComboboxBuscable>', () => {
  it('teclear "her" filtra la lista a Hernández y Enter lo selecciona', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    render(<Arnes onChange={alCambiar} />);

    await usuario.type(screen.getByTestId('combo-input'), 'her');
    const opciones = screen.getAllByTestId('combo-opcion');
    expect(opciones).toHaveLength(1);
    expect(opciones[0]).toHaveTextContent('Óscar Hernández');

    await usuario.keyboard('{Enter}');
    expect(alCambiar).toHaveBeenCalledWith(2);
    expect(screen.getByTestId('combo-input')).toHaveValue('Óscar Hernández');
  });

  it('clic en una opción la selecciona; el botón ✕ limpia', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    render(<Arnes onChange={alCambiar} />);

    await usuario.click(screen.getByTestId('combo-input'));
    const opciones = screen.getAllByTestId('combo-opcion');
    expect(opciones).toHaveLength(4); // sin filtro, todas
    const lopez = opciones.find((o) => o.textContent?.includes('López'));
    expect(lopez).toBeDefined();
    await usuario.click(lopez as HTMLElement);
    expect(alCambiar).toHaveBeenLastCalledWith(3);

    await usuario.click(screen.getByTestId('combo-limpiar'));
    expect(alCambiar).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('combo-input')).toHaveValue('');
  });

  it('NO acepta texto libre: sin coincidencias muestra el vacío y Enter no selecciona nada', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    render(<Arnes onChange={alCambiar} />);

    await usuario.type(screen.getByTestId('combo-input'), 'proveedor nuevo');
    expect(screen.getByText('Sin coincidencias.')).toBeInTheDocument();
    await usuario.keyboard('{Enter}');
    expect(alCambiar).not.toHaveBeenCalled();
  });

  it('navega con flechas: ↓↓ + Enter elige la segunda opción filtrada', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    render(<Arnes onChange={alCambiar} />);

    await usuario.type(screen.getByTestId('combo-input'), 'óscar');
    await usuario.keyboard('{ArrowDown}{Enter}');
    // activo arranca en 0; una flecha abajo → índice 1 = Óscar Hernández.
    expect(alCambiar).toHaveBeenCalledWith(2);
  });

  it('con `accionCrear` muestra el atajo y lo dispara', async () => {
    const usuario = userEvent.setup();
    const alCrear = vi.fn();
    render(
      <ComboboxBuscable
        opciones={OSCARES}
        valor={null}
        onChange={() => undefined}
        accionCrear={{ etiqueta: 'Crear proveedor…', onCrear: alCrear }}
        testid="combo"
      />,
    );
    await usuario.click(screen.getByTestId('combo-input'));
    await usuario.click(screen.getByTestId('combo-crear'));
    expect(alCrear).toHaveBeenCalled();
  });
});
