import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChipFiltro, ChipsFiltro, type OpcionChip } from './ChipsFiltro';

type Estado = 'todos' | 'activos' | 'inactivos';

const OPCIONES: readonly OpcionChip<Estado>[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'activos', etiqueta: 'Activos', conteo: 12 },
  { valor: 'inactivos', etiqueta: 'Inactivos', conteo: 3 },
];

describe('<ChipsFiltro>', () => {
  it('pinta un grupo accesible con un chip por opción y marca el activo', () => {
    render(
      <ChipsFiltro
        opciones={OPCIONES}
        valor="todos"
        alCambiar={vi.fn()}
        etiqueta="Filtrar por estado"
      />,
    );
    const grupo = screen.getByRole('group', { name: 'Filtrar por estado' });
    expect(grupo).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    // El activo se anuncia (aria-pressed) y lleva el realce suave de marca.
    const activo = screen.getByTestId('chip-todos');
    expect(activo).toHaveAttribute('aria-pressed', 'true');
    expect(activo.className).toContain('bg-primary-soft');
    expect(screen.getByTestId('chip-activos')).toHaveAttribute('aria-pressed', 'false');
  });

  it('al hacer clic en otro chip llama alCambiar con su valor', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    render(
      <ChipsFiltro
        opciones={OPCIONES}
        valor="todos"
        alCambiar={alCambiar}
        etiqueta="Filtrar por estado"
      />,
    );
    await usuario.click(screen.getByRole('button', { name: /Inactivos/ }));
    expect(alCambiar).toHaveBeenCalledExactlyOnceWith('inactivos');
  });

  it('el clic al chip ya activo NO re-dispara el cambio', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    render(
      <ChipsFiltro
        opciones={OPCIONES}
        valor="activos"
        alCambiar={alCambiar}
        etiqueta="Filtrar por estado"
      />,
    );
    await usuario.click(screen.getByTestId('chip-activos'));
    expect(alCambiar).not.toHaveBeenCalled();
  });

  it('muestra el conteo opcional formateado dentro del chip', () => {
    render(
      <ChipsFiltro
        opciones={[{ valor: 'todos', etiqueta: 'Todos', conteo: 1234 }]}
        valor="todos"
        alCambiar={vi.fn()}
        etiqueta="Filtrar"
      />,
    );
    expect(screen.getByTestId('chip-todos')).toHaveTextContent('1,234');
  });
});

describe('<ChipsFiltro> · testid por opción', () => {
  it('usa el testid heredado cuando la opción lo trae (y el default chip-{valor} si no)', () => {
    render(
      <ChipsFiltro
        opciones={[
          { valor: 'activos', etiqueta: 'Activos' },
          { valor: 'todos', etiqueta: 'Todos', testid: 'mostrar-desactivados' },
        ]}
        valor="activos"
        alCambiar={vi.fn()}
        etiqueta="Filtrar por estado"
      />,
    );
    expect(screen.getByTestId('chip-activos')).toBeInTheDocument();
    expect(screen.getByTestId('mostrar-desactivados')).toHaveTextContent('Todos');
  });
});

describe('<ChipFiltro> (chip suelto)', () => {
  it('es un toggle independiente: anuncia aria-pressed y SÍ re-dispara su onClick', async () => {
    const usuario = userEvent.setup();
    const alClic = vi.fn();
    render(
      <ChipFiltro activo onClick={alClic} data-testid="filtro-bloqueados">
        Solo bloqueados
      </ChipFiltro>,
    );
    const chip = screen.getByTestId('filtro-bloqueados');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip.className).toContain('bg-primary-soft');
    // A diferencia de la fila excluyente, el toggle re-dispara aun activo.
    await usuario.click(chip);
    expect(alClic).toHaveBeenCalledOnce();
  });

  it('inactivo usa el look atenuado del proto', () => {
    render(<ChipFiltro>Incluir canceladas</ChipFiltro>);
    const chip = screen.getByRole('button', { name: 'Incluir canceladas' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip.className).toContain('bg-panel-2');
  });
});
