import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AvisoOrdenCerrada } from './AvisoOrdenCerrada';

describe('<AvisoOrdenCerrada> (0.226b)', () => {
  it('pinta el texto único como estado (no alerta), con su testid', () => {
    render(<AvisoOrdenCerrada folios={[55]} />);
    const aviso = screen.getByTestId('aviso-orden-cerrada');
    expect(aviso).toHaveAttribute('role', 'status');
    expect(aviso).toHaveTextContent(
      'La orden 55 está cerrada: se puede consultar, pero no admite movimientos.',
    );
  });

  it('agrega la frase propia de la pantalla', () => {
    render(<AvisoOrdenCerrada folios={[55]} detalle="Su costo quedó congelado." />);
    expect(screen.getByTestId('aviso-orden-cerrada')).toHaveTextContent(
      /Su costo quedó congelado\./,
    );
  });

  it('sin órdenes cerradas no pinta nada', () => {
    render(<AvisoOrdenCerrada folios={[]} />);
    expect(screen.queryByTestId('aviso-orden-cerrada')).not.toBeInTheDocument();
  });
});
