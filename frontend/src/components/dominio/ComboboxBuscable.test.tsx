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
function Arnes({
  onChange,
  alCambiarTexto,
}: {
  onChange?: (id: number | null) => void;
  alCambiarTexto?: (texto: string) => void;
}): React.JSX.Element {
  const [valor, setValor] = useState<number | null>(null);
  return (
    <ComboboxBuscable
      opciones={OSCARES}
      valor={valor}
      onChange={(id) => {
        setValor(id);
        onChange?.(id);
      }}
      {...(alCambiarTexto === undefined ? {} : { alCambiarTexto })}
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

describe('<ComboboxBuscable> — ciclo escribir → elegir → cambiar de opinión', () => {
  it('borrar TODO el texto limpia la selección y vuelve a la lista completa', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    const alCambiarTexto = vi.fn();
    render(<Arnes onChange={alCambiar} alCambiarTexto={alCambiarTexto} />);
    const input = screen.getByTestId('combo-input');

    await usuario.type(input, 'her');
    await usuario.keyboard('{Enter}');
    expect(alCambiar).toHaveBeenLastCalledWith(2);
    expect(input).toHaveValue('Óscar Hernández');

    // Borra todo: la selección se limpia (el filtro vuelve a "Todos"), el texto QUEDA vacío y
    // la búsqueda server-side se resetea — la lista completa vuelve a mostrarse.
    await usuario.clear(input);
    expect(input).toHaveValue('');
    expect(alCambiar).toHaveBeenLastCalledWith(null);
    expect(alCambiarTexto).toHaveBeenLastCalledWith('');
    await usuario.click(input);
    expect(screen.getAllByTestId('combo-opcion')).toHaveLength(4);
  });

  it('las opciones que llegan del server mientras escribo NO pisan lo tecleado (bug "borro y reaparece")', async () => {
    const usuario = userEvent.setup();
    const { rerender } = render(
      <ComboboxBuscable opciones={OSCARES} valor={2} onChange={() => undefined} testid="combo" />,
    );
    const input = screen.getByTestId('combo-input');
    expect(input).toHaveValue('Óscar Hernández');

    await usuario.click(input);
    await usuario.keyboard('{Control>}a{/Control}rima');
    expect(input).toHaveValue('rima');

    // Simula la respuesta del typeahead server-side: llega OTRA página de opciones (sin el id 2).
    rerender(
      <ComboboxBuscable
        opciones={[{ id: 4, nombre: 'Rima Textil' }]}
        valor={2}
        onChange={() => undefined}
        testid="combo"
      />,
    );
    // Antes: el efecto colgado del objeto `seleccionada` pisaba el texto a media edición.
    expect(input).toHaveValue('rima');
  });

  it('salir (blur) con texto fantasma restaura la etiqueta de la selección vigente y resetea la búsqueda', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    const alCambiarTexto = vi.fn();
    render(<Arnes onChange={alCambiar} alCambiarTexto={alCambiarTexto} />);
    const input = screen.getByTestId('combo-input');

    await usuario.type(input, 'her');
    await usuario.keyboard('{Enter}');
    await usuario.keyboard('{Control>}a{/Control}xyz'); // basura que no coincide
    expect(input).toHaveValue('xyz');

    await usuario.tab();
    expect(input).toHaveValue('Óscar Hernández'); // repone la etiqueta real
    expect(alCambiar).toHaveBeenLastCalledWith(2); // la selección NO cambió
    expect(alCambiarTexto).toHaveBeenLastCalledWith(''); // la búsqueda a medias se reseteó
  });

  it('sin selección, salir con texto que no coincide deja el input vacío', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    render(<Arnes onChange={alCambiar} />);
    const input = screen.getByTestId('combo-input');

    await usuario.type(input, 'zzz');
    await usuario.tab();
    expect(input).toHaveValue('');
    expect(alCambiar).not.toHaveBeenCalled();
  });

  it('Escape con texto a medias cierra la lista y repone la etiqueta', async () => {
    const usuario = userEvent.setup();
    render(
      <ComboboxBuscable opciones={OSCARES} valor={3} onChange={() => undefined} testid="combo" />,
    );
    const input = screen.getByTestId('combo-input');

    await usuario.click(input);
    await usuario.keyboard('{Control>}a{/Control}basura{Escape}');
    expect(screen.queryByTestId('combo-lista')).not.toBeInTheDocument();
    expect(input).toHaveValue('Óscar López');
  });

  it('enfocar con selección muestra el catálogo COMPLETO (no solo la opción elegida) y selecciona el texto', async () => {
    const usuario = userEvent.setup();
    render(
      <ComboboxBuscable opciones={OSCARES} valor={2} onChange={() => undefined} testid="combo" />,
    );

    // Tab (foco por teclado, sin las peculiaridades del caret del mouse): texto seleccionado.
    await usuario.tab();
    const input = screen.getByTestId<HTMLInputElement>('combo-input');
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Óscar Hernández'.length);
    // El texto es la ETIQUETA, no una búsqueda: la lista trae las 4 opciones.
    expect(screen.getAllByTestId('combo-opcion')).toHaveLength(4);
    // Teclear encima reemplaza de una (sin borrar letra por letra).
    await usuario.keyboard('rim');
    expect(input).toHaveValue('rim');
  });

  it('la etiqueta de la selección sobrevive aunque la página de opciones ya no la traiga (y el ✕ sigue)', () => {
    const { rerender } = render(
      <ComboboxBuscable opciones={OSCARES} valor={2} onChange={() => undefined} testid="combo" />,
    );
    expect(screen.getByTestId('combo-input')).toHaveValue('Óscar Hernández');

    rerender(
      <ComboboxBuscable
        opciones={[{ id: 4, nombre: 'Rima Textil' }]}
        valor={2}
        onChange={() => undefined}
        testid="combo"
      />,
    );
    expect(screen.getByTestId('combo-input')).toHaveValue('Óscar Hernández');
    expect(screen.getByTestId('combo-limpiar')).toBeInTheDocument();
  });

  it('cargando: pinta "Buscando…" en vez de "Sin coincidencias." mientras llega la página', async () => {
    const usuario = userEvent.setup();
    render(
      <ComboboxBuscable
        opciones={[]}
        valor={null}
        onChange={() => undefined}
        cargando
        testid="combo"
      />,
    );
    await usuario.click(screen.getByTestId('combo-input'));
    expect(screen.getByText('Buscando…')).toBeInTheDocument();
    expect(screen.queryByText('Sin coincidencias.')).not.toBeInTheDocument();
    expect(screen.getByTestId('combo-cargando')).toBeInTheDocument();
  });
});
