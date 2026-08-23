import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BadgePunto, ChipEstado, Semaforo } from './ChipEstado';

describe('<ChipEstado>', () => {
  it('pinta el texto con el tono semantico y su punto', () => {
    render(<ChipEstado tono="ok">Aprobada</ChipEstado>);
    const chip = screen.getByText('Aprobada');
    expect(chip).toHaveAttribute('data-tono', 'ok');
    expect(chip.className).toContain('bg-ok-soft');
    expect(chip.className).toContain('text-ok');
    // El punto decorativo acompaña al texto (no informacion solo-color).
    expect(chip.querySelector('[data-slot="badge-punto"]')).not.toBeNull();
  });

  it('cada tono usa su par fondo-suave + texto', () => {
    const { rerender } = render(<ChipEstado tono="crit">Atrasada</ChipEstado>);
    expect(screen.getByText('Atrasada').className).toContain('bg-crit-soft');
    rerender(<ChipEstado tono="warn">En riesgo</ChipEstado>);
    expect(screen.getByText('En riesgo').className).toContain('bg-warn-soft');
    rerender(<ChipEstado tono="info">En proceso</ChipEstado>);
    expect(screen.getByText('En proceso').className).toContain('bg-info-soft');
    rerender(<ChipEstado tono="neutro">Inactivo</ChipEstado>);
    expect(screen.getByText('Inactivo').className).toContain('bg-muted');
  });

  it('con `sinPunto` omite el punto', () => {
    render(
      <ChipEstado tono="info" sinPunto>
        Clasificación
      </ChipEstado>,
    );
    expect(screen.getByText('Clasificación').querySelector('[data-slot="badge-punto"]')).toBeNull();
  });
});

describe('<BadgePunto>', () => {
  it('es decorativo (aria-hidden) y toma el color del tono', () => {
    const { container } = render(<BadgePunto tono="warn" />);
    const punto = container.querySelector('[data-slot="badge-punto"]');
    expect(punto).toHaveAttribute('aria-hidden');
    expect(punto?.className).toContain('bg-warn');
  });
});

describe('<Semaforo>', () => {
  it('expone la etiqueta accesible (el color no basta)', () => {
    render(<Semaforo tono="crit" etiqueta="Atrasado 3 días" />);
    const semaforo = screen.getByRole('img', { name: 'Atrasado 3 días' });
    expect(semaforo).toHaveAttribute('data-tono', 'crit');
  });
});
