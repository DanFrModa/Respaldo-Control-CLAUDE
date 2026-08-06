import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

import { aColoresCuerpo, aRenglones, type RenglonColor } from './colores-tela';
import { EditorColoresTela } from './EditorColoresTela';

/**
 * Pruebas del editor de colores de tela (§Post-F9.11): los colores son HIJOS de la tela
 * (nombre LIBRE + pantone + dos precios) — ya NO se eligen del catálogo global de color de
 * PRENDA (el componente ni lo consulta). También cubren los helpers puros de conversión.
 */

/** Renglon de captura con los campos nuevos en vacio (atajo de las pruebas). */
function renglon(nombre: string, sobre: Partial<RenglonColor> = {}): RenglonColor {
  return { nombre, precioTexto: '', precioComplementoTexto: '', pantoneTexto: '', ...sobre };
}

describe('<EditorColoresTela>', () => {
  it('agrega un color TECLEANDO su nombre libre y lo muestra en el grid', async () => {
    const usuario = userEvent.setup();
    // Host con estado real para ver el grid actualizarse tras agregar.
    function Host(): React.JSX.Element {
      const [colores, setColores] = useState<RenglonColor[]>([]);
      return <EditorColoresTela colores={colores} alCambiar={setColores} />;
    }
    renderConProveedores(<Host />);

    await usuario.type(screen.getByTestId('nombre-agregar-color'), 'Marino Alsa 3040');
    await usuario.click(screen.getByTestId('agregar-color'));

    expect(screen.getByTestId('grid-colores-tela')).toBeInTheDocument();
    // El nombre queda en un input EDITABLE en sitio (R2-7), con testid por índice (R2-8).
    expect(screen.getByTestId('nombre-color-0')).toHaveValue('Marino Alsa 3040');
    // El input de agregar quedó listo para el siguiente color.
    expect(screen.getByTestId('nombre-agregar-color')).toHaveValue('');
  });

  it('NO deja agregar dos veces el mismo nombre (insensible a mayúsculas)', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    renderConProveedores(<EditorColoresTela colores={[renglon('Negro')]} alCambiar={alCambiar} />);

    await usuario.type(screen.getByTestId('nombre-agregar-color'), 'NEGRO');
    await usuario.click(screen.getByTestId('agregar-color'));

    expect(alCambiar).not.toHaveBeenCalled();
    expect(screen.getByTestId('error-agregar-color')).toHaveTextContent(
      'Esta tela ya tiene el color "NEGRO".',
    );
  });

  it('quita un color del grid', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    renderConProveedores(
      <EditorColoresTela
        colores={[renglon('Blanco', { precioTexto: '50' })]}
        alCambiar={alCambiar}
      />,
    );
    await usuario.click(screen.getByTestId('quitar-color-0'));
    expect(alCambiar).toHaveBeenCalledWith([]);
  });

  it('captura el precio de un color', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    renderConProveedores(<EditorColoresTela colores={[renglon('Rojo')]} alCambiar={alCambiar} />);
    await usuario.type(screen.getByTestId('precio-color-0'), '7');
    // El ultimo cambio refleja el precio capturado.
    const ultimo = alCambiar.mock.calls.at(-1)?.[0] as RenglonColor[];
    expect(ultimo[0]?.precioTexto).toBe('7');
  });

  it('captura el PANTONE de un color (siempre visible, lleve o no complemento)', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    renderConProveedores(<EditorColoresTela colores={[renglon('Negro')]} alCambiar={alCambiar} />);
    await usuario.type(screen.getByTestId('pantone-color-0'), 'X');
    const ultimo = alCambiar.mock.calls.at(-1)?.[0] as RenglonColor[];
    expect(ultimo[0]?.pantoneTexto).toBe('X');
  });

  it('el precio del COMPLEMENTO solo aparece si la tela lo lleva, con su nombre', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    // SIN complemento: la columna no existe.
    const { rerender } = renderConProveedores(
      <EditorColoresTela colores={[renglon('Negro')]} alCambiar={alCambiar} />,
    );
    expect(screen.queryByTestId('precio-complemento-color-0')).not.toBeInTheDocument();

    // CON complemento: aparece, etiquetada con su nombre ("Precio Cardigán").
    rerender(
      <EditorColoresTela
        colores={[renglon('Negro')]}
        alCambiar={alCambiar}
        llevaComplemento
        nombreComplemento="Cardigán"
      />,
    );
    const campo = screen.getByTestId('precio-complemento-color-0');
    expect(campo).toHaveAttribute('placeholder', 'Precio Cardigán');
    await usuario.type(campo, '6');
    const ultimo = alCambiar.mock.calls.at(-1)?.[0] as RenglonColor[];
    expect(ultimo[0]?.precioComplementoTexto).toBe('6');
  });

  it('RENOMBRA un color en sitio (R2-7) y avisa si el rename duplica un nombre', async () => {
    const usuario = userEvent.setup();
    function Host(): React.JSX.Element {
      const [colores, setColores] = useState<RenglonColor[]>([
        renglon('NEGRRO', { precioTexto: '90' }),
        renglon('Blanco'),
      ]);
      return <EditorColoresTela colores={colores} alCambiar={setColores} />;
    }
    renderConProveedores(<Host />);

    // Corregir el typo en sitio: ya no hay que quitar y recapturar.
    const nombre = screen.getByTestId('nombre-color-0');
    await usuario.clear(nombre);
    await usuario.type(nombre, 'NEGRO');
    expect(screen.getByTestId('nombre-color-0')).toHaveValue('NEGRO');
    // El precio capturado se conservó en el mismo renglón.
    expect(screen.getByTestId('precio-color-0')).toHaveValue(90);
    expect(screen.queryByTestId('error-colores-repetidos')).not.toBeInTheDocument();

    // Renombrar a un nombre que YA existe (insensible) avisa en vivo.
    await usuario.clear(nombre);
    await usuario.type(nombre, 'blanco');
    expect(screen.getByTestId('error-colores-repetidos')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay colores', () => {
    renderConProveedores(<EditorColoresTela colores={[]} alCambiar={vi.fn()} />);
    expect(screen.getByTestId('colores-vacio')).toBeInTheDocument();
  });
});

describe('conversiones de colores (cuerpo del API <-> renglones de captura)', () => {
  it('aRenglones: precios number/null -> texto ("" si null) y pantone null -> ""', () => {
    expect(
      aRenglones([
        { nombre: 'Negro', precio: 95, precioComplemento: 60, pantone: '19-4005 TCX' },
        { nombre: 'Blanco', precio: null, precioComplemento: null, pantone: null },
      ]),
    ).toEqual([
      {
        nombre: 'Negro',
        precioTexto: '95',
        precioComplementoTexto: '60',
        pantoneTexto: '19-4005 TCX',
      },
      { nombre: 'Blanco', precioTexto: '', precioComplementoTexto: '', pantoneTexto: '' },
    ]);
  });

  it('aColoresCuerpo: texto vacío -> omitido; con valor -> number; el PANTONE viaja', () => {
    expect(
      aColoresCuerpo(
        [
          renglon('Negro', {
            precioTexto: '95',
            precioComplementoTexto: '60',
            pantoneTexto: '19-4005 TCX',
          }),
          renglon('Blanco'),
        ],
        { llevaComplemento: true },
      ),
    ).toEqual([
      { nombre: 'Negro', precio: 95, precioComplemento: 60, pantone: '19-4005 TCX' },
      { nombre: 'Blanco' },
    ]);
  });

  // R3-1: el `id` de la fila viaja para que RENOMBRAR no la destruya (liga legacy).
  it('aRenglones carga el id de las filas existentes y aColoresCuerpo lo manda; las nuevas van sin id', () => {
    const [marino] = aRenglones([
      { id: 7, nombre: 'Marino', precio: 57, precioComplemento: null, pantone: null },
    ]);
    if (marino === undefined) {
      throw new Error('aRenglones no devolvió el renglón');
    }
    expect(marino.id).toBe(7);
    // La fila existente (renombrada en sitio) conserva su id; la nueva no lleva.
    expect(aColoresCuerpo([{ ...marino, nombre: 'Marino Alsa 3040' }, renglon('Blanco')])).toEqual([
      { id: 7, nombre: 'Marino Alsa 3040', precio: 57 },
      { nombre: 'Blanco' },
    ]);
  });

  it('aColoresCuerpo: si la tela NO lleva complemento, su precio NUNCA viaja (aunque quede tecleado)', () => {
    expect(
      aColoresCuerpo([renglon('Negro', { precioTexto: '95', precioComplementoTexto: '60' })], {
        llevaComplemento: false,
      }),
    ).toEqual([{ nombre: 'Negro', precio: 95 }]);
  });
});
