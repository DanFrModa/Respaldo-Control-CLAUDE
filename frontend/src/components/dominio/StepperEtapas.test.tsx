import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { estadoPaso, StepperEtapas, type PasoEtapa } from './StepperEtapas';

const PASOS: readonly PasoEtapa[] = [
  { clave: 'corte', etiqueta: 'Corte', hecho: 1726, total: 1726 },
  { clave: 'entrega-maquila', etiqueta: 'Entrega a maquila', hecho: 800, total: 1726 },
  { clave: 'recibo-maquila', etiqueta: 'Recibo de maquila', hecho: 0, total: 1726 },
];

describe('estadoPaso', () => {
  it('done cuando hecho ≥ total (y total > 0)', () => {
    expect(estadoPaso({ clave: 'x', etiqueta: 'x', hecho: 10, total: 10 })).toBe('done');
    expect(estadoPaso({ clave: 'x', etiqueta: 'x', hecho: 12, total: 10 })).toBe('done');
  });

  it('partial con avance incompleto; vacía sin movimientos', () => {
    expect(estadoPaso({ clave: 'x', etiqueta: 'x', hecho: 3, total: 10 })).toBe('partial');
    expect(estadoPaso({ clave: 'x', etiqueta: 'x', hecho: 0, total: 10 })).toBe('vacia');
  });

  it('con total 0 nunca es done (una orden sin matriz no se "completa" sola)', () => {
    expect(estadoPaso({ clave: 'x', etiqueta: 'x', hecho: 0, total: 0 })).toBe('vacia');
    expect(estadoPaso({ clave: 'x', etiqueta: 'x', hecho: 5, total: 0 })).toBe('partial');
  });
});

describe('<StepperEtapas>', () => {
  it('pinta cada etapa con su avance x/total y su estado', () => {
    render(<StepperEtapas pasos={PASOS} activa="corte" onCambiar={() => undefined} />);
    expect(screen.getByTestId('stepper-corte')).toHaveTextContent('1,726/1,726');
    expect(screen.getByTestId('stepper-corte')).toHaveAttribute('data-estado', 'done');
    expect(screen.getByTestId('stepper-entrega-maquila')).toHaveAttribute('data-estado', 'partial');
    expect(screen.getByTestId('stepper-recibo-maquila')).toHaveAttribute('data-estado', 'vacia');
  });

  it('marca la etapa activa (aria-selected) y emite el cambio al hacer clic', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    render(<StepperEtapas pasos={PASOS} activa="corte" onCambiar={alCambiar} />);

    expect(screen.getByTestId('stepper-corte')).toHaveAttribute('aria-selected', 'true');
    await usuario.click(screen.getByTestId('stepper-entrega-maquila'));
    expect(alCambiar).toHaveBeenCalledWith('entrega-maquila');
  });
});
