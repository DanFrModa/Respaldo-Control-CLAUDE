import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { Talla } from '@/api/tipos';

import { ArmadorCurva } from './ArmadorCurva';

/** Talla de ejemplo. */
function talla(id: number, etiqueta: string, orden: number): Talla {
  return {
    id,
    etiqueta,
    orden,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

const CATALOGO: Talla[] = [talla(1, 'CH', 1), talla(2, 'M', 2), talla(3, 'G', 3)];

/**
 * Arnés con estado para probar el componente CONTROLADO: refleja `seleccionados` y
 * expone su orden actual en un nodo oculto para aseverarlo.
 */
function Arnes({ inicial = [] as number[] }: { inicial?: number[] }): React.JSX.Element {
  const [ids, setIds] = useState<number[]>(inicial);
  return (
    <>
      <span data-testid="orden-actual">{ids.join(',')}</span>
      <ArmadorCurva
        tallas={CATALOGO}
        cargando={false}
        error={null}
        seleccionados={ids}
        alCambiar={setIds}
      />
    </>
  );
}

function ordenActual(): string {
  return screen.getByTestId('orden-actual').textContent ?? '';
}

describe('<ArmadorCurva>', () => {
  it('agrega tallas a la curva en el orden en que se eligen', async () => {
    const usuario = userEvent.setup();
    render(<Arnes />);

    // Disponibles: las tres; elegidas: ninguna.
    expect(
      within(screen.getByTestId('armador-curva-disponibles')).getAllByRole('button'),
    ).toHaveLength(3);

    await usuario.click(screen.getByTestId('agregar-talla-3')); // G
    await usuario.click(screen.getByTestId('agregar-talla-1')); // CH
    expect(ordenActual()).toBe('3,1');

    // Las elegidas ya no aparecen en disponibles.
    expect(screen.queryByTestId('agregar-talla-3')).not.toBeInTheDocument();
  });

  it('reordena con subir/bajar (la posición la define el orden)', async () => {
    const usuario = userEvent.setup();
    render(<Arnes inicial={[1, 2, 3]} />);
    expect(ordenActual()).toBe('1,2,3');

    // Bajar la primera (CH) la pone en segundo lugar.
    await usuario.click(screen.getByTestId('bajar-1'));
    expect(ordenActual()).toBe('2,1,3');

    // Subir la última (G) la pone en medio.
    await usuario.click(screen.getByTestId('subir-3'));
    expect(ordenActual()).toBe('2,3,1');
  });

  it('el primero no puede subir y el último no puede bajar', () => {
    render(<Arnes inicial={[1, 2, 3]} />);
    expect(screen.getByTestId('subir-1')).toBeDisabled();
    expect(screen.getByTestId('bajar-3')).toBeDisabled();
  });

  it('quita una talla de la curva (vuelve a disponibles)', async () => {
    const usuario = userEvent.setup();
    render(<Arnes inicial={[1, 2]} />);

    await usuario.click(screen.getByTestId('quitar-1'));
    expect(ordenActual()).toBe('2');
    // CH vuelve a estar disponible.
    expect(screen.getByTestId('agregar-talla-1')).toBeInTheDocument();
  });

  it('muestra el mensaje de validación de captura cuando se pasa', () => {
    render(
      <ArmadorCurva
        tallas={CATALOGO}
        cargando={false}
        error={null}
        seleccionados={[]}
        alCambiar={() => undefined}
        mensajeError="Agrega al menos una talla a la curva."
      />,
    );
    expect(screen.getByText('Agrega al menos una talla a la curva.')).toBeInTheDocument();
  });

  it('si no hay tallas activas, avisa que hay que crearlas', () => {
    render(
      <ArmadorCurva
        tallas={[]}
        cargando={false}
        error={null}
        seleccionados={[]}
        alCambiar={() => undefined}
      />,
    );
    expect(screen.getByText('No hay tallas activas. Crea tallas primero.')).toBeInTheDocument();
  });
});
