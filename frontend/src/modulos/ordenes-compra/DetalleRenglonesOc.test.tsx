import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

import { DetalleRenglonesOc } from './DetalleRenglonesOc';
import { ocDePrueba } from './fixtures';

describe('DetalleRenglonesOc (F4-E2)', () => {
  it('pinta los renglones con material, cantidad, subtotal y el total derivado', () => {
    renderConProveedores(<DetalleRenglonesOc oc={ocDePrueba()} />);
    expect(screen.getByText('Felpa francesa')).toBeInTheDocument();
    expect(screen.getByTestId('total-detalle-oc')).toHaveTextContent('$2,500.00');
  });

  it('imprime la matriz talla×color como tabla para los renglones que la usan', () => {
    const oc = ocDePrueba({
      lineas: [
        {
          id: 10,
          idTela: 3,
          tela: 'Felpa',
          idAvio: null,
          avio: null,
          idAvioProveedor: null,
          descripcionLibre: null,
          cantidad: 8,
          unidad: 'pza',
          precio: 1,
          subtotal: 8,
          idOrden: null,
          folioOrden: null,
          tallas: [
            { idColor: 1, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 5 },
            { idColor: 1, color: 'Rojo', idTalla: 12, etiquetaTalla: 'M', cantidad: 3 },
          ],
        },
      ],
    });
    renderConProveedores(<DetalleRenglonesOc oc={oc} />);
    expect(screen.getByTestId('matriz-detalle-oc')).toBeInTheDocument();
    expect(screen.getByText('CH')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('estado vacío cuando la OC no tiene renglones', () => {
    renderConProveedores(<DetalleRenglonesOc oc={ocDePrueba({ lineas: [], total: 0 })} />);
    expect(screen.getByText('Esta orden de compra no tiene renglones.')).toBeInTheDocument();
  });
});
