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

  it('la tendencia pinta flecha + delta con el tono default del proto (sube=ok, baja=crit)', () => {
    render(
      <KpiTiles
        kpis={[
          {
            clave: 'abiertas',
            etiqueta: 'Órdenes abiertas',
            valor: '47',
            tendencia: { direccion: 'sube', delta: '+6', contexto: 'vs. sem. pasada' },
          },
          {
            clave: 'entregas',
            etiqueta: 'Entregas a tiempo',
            valor: '96.4',
            sufijo: '%',
            tendencia: { direccion: 'baja', delta: '−1.2', contexto: 'últimos 30 d' },
          },
        ]}
      />,
    );
    // Sube → verde (ok); baja → rojo (crit); el sentido tambien va en texto (a11y).
    expect(screen.getByText('+6').parentElement?.className).toContain('text-ok');
    expect(screen.getByText('Subió')).toBeInTheDocument();
    expect(screen.getByText('−1.2').parentElement?.className).toContain('text-crit');
    expect(screen.getByText('Bajó')).toBeInTheDocument();
    // El contexto acompaña atenuado.
    expect(screen.getByText('vs. sem. pasada').className).toContain('text-faint');
  });

  it('el tono explicito de la tendencia pisa el default (bajar puede ser bueno)', () => {
    render(
      <KpiTiles
        kpis={[
          {
            clave: 'defectos',
            etiqueta: 'Defectos',
            valor: '12',
            tendencia: { direccion: 'baja', delta: '−4', tono: 'ok' },
          },
        ]}
      />,
    );
    expect(screen.getByText('−4').parentElement?.className).toContain('text-ok');
  });

  it('sin tendencia el tile se ve como siempre (backwards-compatible)', () => {
    render(<KpiTiles kpis={KPIS} />);
    expect(document.querySelector('[data-slot="kpi-tendencia"]')).toBeNull();
  });
});
