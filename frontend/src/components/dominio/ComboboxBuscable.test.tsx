import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ComboboxBuscable,
  OpcionRica,
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

  it('la lista se PORTA al body (no la recorta un ancestro con overflow)', async () => {
    const usuario = userEvent.setup();
    render(
      <div style={{ overflow: 'hidden', height: 40 }} data-testid="jaula">
        <Arnes />
      </div>,
    );
    await usuario.click(screen.getByTestId('combo-input'));
    // La lista existe pero NO cuelga del ancestro con overflow: es hija directa del <body>.
    const lista = screen.getByTestId('combo-lista');
    expect(lista.parentElement).toBe(document.body);
    expect(screen.getByTestId('jaula').contains(lista)).toBe(false);
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

/** Entidad mínima al estilo de los selectores (opción extendida con sus campos). */
const COSAS = [
  { id: 1, nombre: 'General A', descripcion: 'Primera' },
  { id: 2, nombre: 'General B', descripcion: 'Segunda' },
] as const;

/** Render en modo servidor (los selectores de entidad, ex-`ComboboxEntidad`). */
function pintarServidor({
  cargando,
  onChange = vi.fn(),
  mensajeError,
}: {
  cargando: boolean;
  onChange?: (id: number | null) => void;
  mensajeError?: string;
}) {
  render(
    <ComboboxBuscable
      opciones={COSAS}
      valor={null}
      onChange={onChange}
      alCambiarTexto={vi.fn()}
      busquedaServidor
      renderOpcion={(o) => <OpcionRica principal={o.nombre} secundario={o.descripcion} />}
      mensajeError={mensajeError}
      conLupa
      permitirLimpiar={false}
      cargando={cargando}
      placeholder="Buscar…"
      etiqueta="Buscar cosa"
      testid="combo-ent"
      testidInput="combo-ent-busqueda"
    />,
  );
}

describe('<ComboboxBuscable> — modo `busquedaServidor` (los selectores de entidad)', () => {
  it('con la búsqueda SIN resolver (cargando) NO ofrece opciones: muestra "Buscando…" (anti-carrera)', async () => {
    // La carrera real (e2e de inventario PT en CI): teclear y clickear rápido encontraba las
    // opciones VIEJAS del catálogo general aún montadas y seleccionaba la entidad equivocada.
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    pintarServidor({ cargando: true, onChange });

    await usuario.click(screen.getByTestId('combo-ent-busqueda'));
    expect(screen.getByTestId('combo-ent-lista')).toBeInTheDocument();
    expect(screen.queryAllByTestId('combo-ent-opcion')).toHaveLength(0);
    expect(screen.getByText('Buscando…')).toBeInTheDocument();

    // Tampoco por teclado: Enter con la lista "cargando" no selecciona nada.
    await usuario.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('con la búsqueda resuelta pinta las opciones RICAS y elegir una emite su id', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    pintarServidor({ cargando: false, onChange });

    await usuario.click(screen.getByTestId('combo-ent-busqueda'));
    const opciones = screen.getAllByTestId('combo-ent-opcion');
    expect(opciones).toHaveLength(2);
    // Opción rica: línea principal + secundaria (el markup del ex-ComboboxEntidad).
    expect(opciones[0]).toHaveTextContent('General A');
    expect(opciones[0]).toHaveTextContent('Primera');

    await usuario.click(opciones[0] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(1);
    // Al elegir, el popover cierra.
    expect(screen.queryByTestId('combo-ent-lista')).not.toBeInTheDocument();
  });

  it('NO re-filtra en cliente: las opciones del server se ofrecen aunque el texto no coincida con el nombre', async () => {
    // El API busca en campos que la opción ni muestra (p. ej. la descripción): el filtro local
    // del kit las escondería en falso.
    const usuario = userEvent.setup();
    pintarServidor({ cargando: false });

    await usuario.type(screen.getByTestId('combo-ent-busqueda'), 'zzz');
    expect(screen.getAllByTestId('combo-ent-opcion')).toHaveLength(2);
  });

  it('`permitirLimpiar: false` (campo requerido): sin ✕, borrar NO emite null y el blur restaura', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ComboboxBuscable
        opciones={COSAS}
        valor={1}
        onChange={onChange}
        busquedaServidor
        permitirLimpiar={false}
        testid="combo-ent"
        testidInput="combo-ent-busqueda"
      />,
    );
    const input = screen.getByTestId('combo-ent-busqueda');
    expect(input).toHaveValue('General A');
    // Con selección pero campo requerido, el ✕ no existe.
    expect(screen.queryByTestId('combo-ent-limpiar')).not.toBeInTheDocument();

    // Borrar todo el texto NO des-elige (la orden/entidad se cambia eligiendo otra).
    await usuario.clear(input);
    expect(onChange).not.toHaveBeenCalled();

    // Y al salir, la etiqueta de la selección vigente se restaura.
    await usuario.tab();
    expect(input).toHaveValue('General A');
  });

  it('el error de la consulta del padre se pinta dentro del popover', async () => {
    const usuario = userEvent.setup();
    pintarServidor({ cargando: false, mensajeError: 'Se cayó el API' });

    await usuario.click(screen.getByTestId('combo-ent-busqueda'));
    expect(screen.getByRole('alert')).toHaveTextContent('Se cayó el API');
    expect(screen.queryAllByTestId('combo-ent-opcion')).toHaveLength(0);
  });
});
