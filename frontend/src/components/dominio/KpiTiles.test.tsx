import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type Kpi, KpiTiles } from './KpiTiles';

const KPIS: readonly Kpi[] = [
  {
    clave: 'op-proceso',
    etiqueta: 'OP en proceso',
    valor: '47',
    pie: '+3 esta semana',
    tonoPie: 'ok',
  },
  { clave: 'piezas-wip', etiqueta: 'Piezas en WIP', valor: '128,540', sufijo: 'pzas' },
  { clave: 'rc-atrasadas', etiqueta: 'RC · Atrasadas', valor: '5', pie: 'al corte de hoy' },
];

describe('<KpiTiles>', () => {
  it('pinta una tarjeta por indicador con etiqueta y valor', () => {
    render(<KpiTiles kpis={KPIS} />);
    expect(screen.getByTestId('kpi-op-proceso')).toBeInTheDocument();
    expect(screen.getByText('OP en proceso')).toBeInTheDocument();
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.getByText('128,540')).toBeInTheDocument();
  });

  it('muestra sufijo y pie opcionales', () => {
    render(<KpiTiles kpis={KPIS} />);
    expect(screen.getByText('pzas')).toBeInTheDocument();
    expect(screen.getByText('al corte de hoy')).toBeInTheDocument();
  });

  it('el pie con tono usa el color semantico; sin tono queda atenuado', () => {
    render(<KpiTiles kpis={KPIS} />);
    expect(screen.getByText('+3 esta semana').className).toContain('text-ok');
    expect(screen.getByText('al corte de hoy').className).toContain('text-muted-foreground');
  });
});
