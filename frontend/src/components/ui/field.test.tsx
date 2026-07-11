import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FieldLabel, LeyendaObligatorios } from './field';

/**
 * Convención transversal del rediseño de altas: un campo obligatorio se marca con un
 * asterisco rojo DECORATIVO (aria-hidden, no lo lee el lector de pantalla) más un texto
 * solo-para-lectores "(obligatorio)" que SÍ se anuncia como parte de la etiqueta. Estos
 * tests fijan ese contrato para que no se rompa al reusar `FieldLabel`.
 */
describe('<FieldLabel required>', () => {
  it('agrega un asterisco decorativo (aria-hidden) y el texto solo-lectores "(obligatorio)"', () => {
    render(<FieldLabel required>Nombre</FieldLabel>);

    const asterisco = screen.getByText('*');
    expect(asterisco).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('(obligatorio)')).toBeInTheDocument();
  });

  it('sin `required` NO agrega la marca (el asterisco y el texto no aparecen)', () => {
    render(<FieldLabel>Nombre</FieldLabel>);

    expect(screen.queryByText('*')).not.toBeInTheDocument();
    expect(screen.queryByText('(obligatorio)')).not.toBeInTheDocument();
  });
});

describe('<LeyendaObligatorios>', () => {
  it('explica la convención del asterisco', () => {
    render(<LeyendaObligatorios />);
    expect(screen.getByText(/son obligatorios/)).toBeInTheDocument();
  });
});
