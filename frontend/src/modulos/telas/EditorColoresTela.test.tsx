import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Color } from '@/api/tipos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { aColoresCuerpo, aRenglones, type RenglonColor } from './colores-tela';
import { EditorColoresTela } from './EditorColoresTela';

/** Catalogo de colores de ejemplo (selector "agregar"). */
const COLORES: Color[] = [
  {
    id: 1,
    nombre: 'Negro',
    activo: true,
    creadoEn: '',
    creadoPorId: null,
    modificadoEn: '',
    modificadoPorId: null,
  },
  {
    id: 2,
    nombre: 'Blanco',
    activo: true,
    creadoEn: '',
    creadoPorId: null,
    modificadoEn: '',
    modificadoPorId: null,
  },
  {
    id: 3,
    nombre: 'Rojo',
    activo: true,
    creadoEn: '',
    creadoPorId: null,
    modificadoEn: '',
    modificadoPorId: null,
  },
];

vi.mock('@/api/colores', () => ({
  useColores: () => ({
    data: { datos: COLORES, total: COLORES.length, pagina: 1, porPagina: 100, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

describe('<EditorColoresTela>', () => {
  it('agrega un color desde el selector y lo muestra en el grid', async () => {
    const usuario = userEvent.setup();
    // Host con estado real para ver el grid actualizarse tras agregar.
    function Host(): React.JSX.Element {
      const [colores, setColores] = useState<RenglonColor[]>([]);
      return <EditorColoresTela colores={colores} alCambiar={setColores} />;
    }
    renderConProveedores(<Host />);

    await usuario.selectOptions(screen.getByTestId('selector-agregar-color'), '1');
    await usuario.click(screen.getByTestId('agregar-color'));

    expect(screen.getByTestId('grid-colores-tela')).toBeInTheDocument();
    expect(within(screen.getByTestId('grid-colores-tela')).getByText('Negro')).toBeInTheDocument();
  });

  it('no ofrece en el selector un color que ya está en el grid (evita duplicados)', () => {
    renderConProveedores(
      <EditorColoresTela colores={[{ idColor: 1, precioTexto: '' }]} alCambiar={vi.fn()} />,
    );
    const selector = screen.getByTestId('selector-agregar-color');
    // Negro (id 1) ya está en el grid: no aparece como opcion; Blanco/Rojo sí.
    expect(within(selector).queryByRole('option', { name: 'Negro' })).not.toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Blanco' })).toBeInTheDocument();
  });

  it('quita un color del grid', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    renderConProveedores(
      <EditorColoresTela colores={[{ idColor: 2, precioTexto: '50' }]} alCambiar={alCambiar} />,
    );
    await usuario.click(screen.getByTestId('quitar-color-2'));
    expect(alCambiar).toHaveBeenCalledWith([]);
  });

  it('captura el precio de un color', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    renderConProveedores(
      <EditorColoresTela colores={[{ idColor: 3, precioTexto: '' }]} alCambiar={alCambiar} />,
    );
    await usuario.type(screen.getByTestId('precio-color-3'), '7');
    // El ultimo cambio refleja el precio capturado.
    const ultimo = alCambiar.mock.calls.at(-1)?.[0] as RenglonColor[];
    expect(ultimo[0]?.precioTexto).toBe('7');
  });

  it('muestra el estado vacío cuando no hay colores', () => {
    renderConProveedores(<EditorColoresTela colores={[]} alCambiar={vi.fn()} />);
    expect(screen.getByTestId('colores-vacio')).toBeInTheDocument();
  });
});

describe('conversiones de colores (cuerpo del API <-> renglones de captura)', () => {
  it('aRenglones: precio number/null -> texto ("" si null)', () => {
    expect(
      aRenglones([
        { idColor: 1, precio: 95 },
        { idColor: 2, precio: null },
      ]),
    ).toEqual([
      { idColor: 1, precioTexto: '95' },
      { idColor: 2, precioTexto: '' },
    ]);
  });

  it('aColoresCuerpo: texto vacío -> sin precio; con valor -> number', () => {
    expect(
      aColoresCuerpo([
        { idColor: 1, precioTexto: '95' },
        { idColor: 2, precioTexto: '' },
      ]),
    ).toEqual([{ idColor: 1, precio: 95 }, { idColor: 2 }]);
  });
});
