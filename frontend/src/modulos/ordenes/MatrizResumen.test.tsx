import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Orden } from '@/api/tipos';

import { MatrizResumen } from './CentroOrdenesPagina';

// `MatrizResumen` es la matriz color×talla de SOLO LECTURA del cajón del Centro.
// Sólo lee `orden.lineas`, así que basta un fixture mínimo (el resto de `Orden`
// no interviene en el render).
type LineaOrden = Orden['lineas'][number];

function linea(parcial: Partial<LineaOrden>): LineaOrden {
  return {
    id: 1,
    color: 'BLANCO',
    pantone: null,
    tallas: [{ idTalla: 1, etiquetaTalla: '5-6', cantidad: 305 }],
    totalPiezas: 305,
    ...parcial,
  } as LineaOrden;
}

function ordenCon(lineas: LineaOrden[]): Orden {
  const totalPiezas = lineas.reduce((s, l) => s + l.totalPiezas, 0);
  return { lineas, totalPiezas } as unknown as Orden;
}

describe('MatrizResumen · pantone de solo lectura', () => {
  it('muestra el PANTONE debajo del color cuando la línea lo trae', () => {
    render(
      <MatrizResumen
        orden={ordenCon([linea({ id: 1, color: 'AZUL MARINO', pantone: '19-3920 TCX' })])}
      />,
    );

    const marca = screen.getByTestId('centro-matriz-pantone');
    expect(marca).toHaveTextContent('PANTONE 19-3920 TCX');
    // El nombre del color sigue presente e intacto.
    expect(screen.getByText('AZUL MARINO')).toBeInTheDocument();
  });

  it('no pinta el renglón de pantone cuando es null', () => {
    render(<MatrizResumen orden={ordenCon([linea({ id: 1, color: 'BLANCO', pantone: null })])} />);

    expect(screen.queryByTestId('centro-matriz-pantone')).not.toBeInTheDocument();
    expect(screen.getByText('BLANCO')).toBeInTheDocument();
  });

  it('tampoco lo pinta cuando el pantone es cadena vacía (OC sin código)', () => {
    render(<MatrizResumen orden={ordenCon([linea({ id: 1, color: 'BLANCO', pantone: '' })])} />);

    expect(screen.queryByTestId('centro-matriz-pantone')).not.toBeInTheDocument();
  });
});
