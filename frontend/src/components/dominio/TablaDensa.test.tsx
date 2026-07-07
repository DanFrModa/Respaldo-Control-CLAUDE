import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
  TablaDensaPie,
} from './TablaDensa';

/** Tabla chica de ejemplo: 2 renglones + barra de totales. */
function TablaEjemplo({ seleccionada = false }: { seleccionada?: boolean }): React.JSX.Element {
  return (
    <TablaDensa>
      <TablaDensaEncabezado>
        <tr>
          <TablaDensaHead>Modelo</TablaDensaHead>
          <TablaDensaHead numerica>Piezas</TablaDensaHead>
        </tr>
      </TablaDensaEncabezado>
      <TablaDensaCuerpo>
        <TablaDensaFila seleccionada={seleccionada} data-testid="fila-1">
          <TablaDensaCelda>MOD-101</TablaDensaCelda>
          <TablaDensaCelda numerica>1,250</TablaDensaCelda>
        </TablaDensaFila>
        <TablaDensaFila>
          <TablaDensaCelda>MOD-102</TablaDensaCelda>
          <TablaDensaCelda numerica>380</TablaDensaCelda>
        </TablaDensaFila>
      </TablaDensaCuerpo>
      <TablaDensaPie>
        <tr>
          <TablaDensaCelda>Total</TablaDensaCelda>
          <TablaDensaCelda numerica>1,630</TablaDensaCelda>
        </tr>
      </TablaDensaPie>
    </TablaDensa>
  );
}

describe('<TablaDensa>', () => {
  it('arma una tabla accesible con encabezado, cuerpo y barra de totales', () => {
    render(<TablaEjemplo />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Piezas' })).toBeInTheDocument();
    expect(screen.getByText('MOD-101')).toBeInTheDocument();
    // La barra de totales vive en el <tfoot> pegajoso.
    const total = screen.getByText('Total');
    expect(total.closest('tfoot')).not.toBeNull();
  });

  it('las columnas numericas alinean a la derecha con cifras tabulares', () => {
    render(<TablaEjemplo />);
    const encabezado = screen.getByRole('columnheader', { name: 'Piezas' });
    expect(encabezado.className).toContain('text-right');
    const celda = screen.getByText('1,250');
    expect(celda.className).toContain('text-right');
    expect(celda.className).toContain('num');
  });

  it('marca el renglon seleccionado (fondo de marca + data-attribute)', () => {
    render(<TablaEjemplo seleccionada />);
    const fila = screen.getByTestId('fila-1');
    expect(fila).toHaveAttribute('data-seleccionada');
    expect(fila.className).toContain('bg-primary-soft');
  });
});
