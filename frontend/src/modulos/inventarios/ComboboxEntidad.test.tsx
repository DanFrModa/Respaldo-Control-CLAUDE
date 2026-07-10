import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ComboboxEntidad } from './ComboboxEntidad';

/** Entidad mínima de prueba. */
interface Cosa {
  id: number;
  nombre: string;
}

const COSAS: Cosa[] = [
  { id: 1, nombre: 'General A' },
  { id: 2, nombre: 'General B' },
];

/** Render con defaults; `cargando` y los callbacks se controlan por caso. */
function pintar({
  cargando,
  alSeleccionar = vi.fn(),
}: {
  cargando: boolean;
  alSeleccionar?: (cosa: Cosa) => void;
}) {
  render(
    <ComboboxEntidad<Cosa>
      opciones={COSAS}
      obtenerId={(c) => c.id}
      principal={(c) => c.nombre}
      idSeleccionado={undefined}
      etiquetaSeleccion={undefined}
      alSeleccionar={alSeleccionar}
      alCambiarTexto={vi.fn()}
      cargando={cargando}
      placeholder="Buscar…"
      etiqueta="Buscar cosa"
      testid="combo-ent"
    />,
  );
}

describe('<ComboboxEntidad>', () => {
  it('con la búsqueda SIN resolver (cargando) NO ofrece opciones: muestra "Buscando…" (anti-carrera)', async () => {
    // La carrera real (e2e de inventario PT en CI): teclear y clickear rápido encontraba las
    // opciones VIEJAS del catálogo general aún montadas y seleccionaba la entidad equivocada.
    const usuario = userEvent.setup();
    const alSeleccionar = vi.fn();
    pintar({ cargando: true, alSeleccionar });

    await usuario.click(screen.getByTestId('combo-ent-busqueda'));
    expect(screen.getByTestId('combo-ent-lista')).toBeInTheDocument();
    expect(screen.queryAllByTestId('combo-ent-opcion')).toHaveLength(0);
    expect(screen.getByText('Buscando…')).toBeInTheDocument();

    // Tampoco por teclado: Enter con la lista "cargando" no selecciona nada.
    await usuario.keyboard('{Enter}');
    expect(alSeleccionar).not.toHaveBeenCalled();
  });

  it('con la búsqueda resuelta pinta las opciones y elegir una emite la entidad', async () => {
    const usuario = userEvent.setup();
    const alSeleccionar = vi.fn();
    pintar({ cargando: false, alSeleccionar });

    await usuario.click(screen.getByTestId('combo-ent-busqueda'));
    const opciones = screen.getAllByTestId('combo-ent-opcion');
    expect(opciones).toHaveLength(2);

    await usuario.click(opciones[0] as HTMLElement);
    expect(alSeleccionar).toHaveBeenCalledWith(COSAS[0]);
    // Al elegir, el popover cierra.
    expect(screen.queryByTestId('combo-ent-lista')).not.toBeInTheDocument();
  });
});
