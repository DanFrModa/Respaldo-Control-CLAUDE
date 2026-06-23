import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Semaforo, fechaRc } from './piezas';

describe('<Semaforo>', () => {
  it('pinta cada tri-estado con su etiqueta y color', () => {
    const { rerender } = render(<Semaforo semaforo="aTiempo" />);
    let badge = screen.getByTestId('semaforo-rc');
    expect(badge).toHaveAttribute('data-semaforo', 'aTiempo');
    expect(badge).toHaveTextContent('A tiempo');

    rerender(<Semaforo semaforo="enRiesgo" />);
    badge = screen.getByTestId('semaforo-rc');
    expect(badge).toHaveAttribute('data-semaforo', 'enRiesgo');
    expect(badge).toHaveTextContent('En riesgo');

    rerender(<Semaforo semaforo="atrasado" />);
    badge = screen.getByTestId('semaforo-rc');
    expect(badge).toHaveAttribute('data-semaforo', 'atrasado');
    expect(badge).toHaveTextContent('Atrasado');
  });

  it('con soloPunto omite el texto visible pero conserva el accesible', () => {
    render(<Semaforo semaforo="atrasado" soloPunto />);
    const badge = screen.getByTestId('semaforo-rc');
    // El texto sigue presente para lectores de pantalla (sr-only), pero el title da la etiqueta.
    expect(badge).toHaveAttribute('title', 'Atrasado');
  });
});

describe('fechaRc', () => {
  it('formatea una fecha date-only sin desfase de zona', () => {
    expect(fechaRc('2026-06-13')).toMatch(/13.*jun.*2026/i);
  });

  it('formatea un datetime ISO completo del contrato (z.iso.datetime) sin "Invalid Date"', () => {
    // El contrato serializa las fechas como datetime ISO; fechaRc debe tomar solo la parte de fecha.
    expect(fechaRc('2026-06-12T00:00:00.000Z')).toMatch(/12.*jun.*2026/i);
    // Regresión: nunca debe colarse "Invalid Date".
    expect(fechaRc('2026-06-12T00:00:00.000Z')).not.toMatch(/invalid/i);
  });

  it('devuelve el guion para vacío o nulo', () => {
    expect(fechaRc(null)).toBe('—');
    expect(fechaRc(undefined)).toBe('—');
    expect(fechaRc('')).toBe('—');
  });
});
