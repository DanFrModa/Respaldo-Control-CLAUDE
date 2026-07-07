import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CadenaTrazabilidad, type NodoTraza } from './CadenaTrazabilidad';

/** Unit del componente de la cadena de trazabilidad (R3, §4.1): nodos, apagados y navegación. */
describe('CadenaTrazabilidad', () => {
  const nodos: NodoTraza[] = [
    { clave: 'oc', etiqueta: 'OC cliente', valor: 'OC-CA-4471', activo: true },
    {
      clave: 'desarrollo',
      etiqueta: 'Desarrollo',
      valor: '#12',
      activo: true,
      onNavegar: vi.fn(),
    },
    {
      clave: 'lista',
      etiqueta: 'Lista de precios',
      valor: '—',
      activo: false,
      titulo: 'modelo anterior al módulo de Desarrollo',
    },
    { clave: 'pedido', etiqueta: 'Pedido interno', valor: '1502-F', activo: true },
    { clave: 'op', etiqueta: 'OP · producción', valor: '#5500 · mod. 7', activo: true },
  ];

  it('pinta todos los nodos con etiqueta y valor', () => {
    render(<CadenaTrazabilidad nodos={nodos} />);
    expect(screen.getByText('OC cliente')).toBeInTheDocument();
    expect(screen.getByText('OC-CA-4471')).toBeInTheDocument();
    expect(screen.getByText('Desarrollo')).toBeInTheDocument();
    expect(screen.getByText('1502-F')).toBeInTheDocument();
    expect(screen.getByText('#5500 · mod. 7')).toBeInTheDocument();
  });

  it('un nodo activo con navegación dispara onNavegar al clic', () => {
    render(<CadenaTrazabilidad nodos={nodos} />);
    fireEvent.click(screen.getByTestId('traza-desarrollo'));
    expect(nodos[1]?.onNavegar).toHaveBeenCalledTimes(1);
  });

  it('un nodo apagado queda deshabilitado y lleva su nota en el tooltip', () => {
    render(<CadenaTrazabilidad nodos={nodos} />);
    const lista = screen.getByTestId('traza-lista');
    expect(lista).toBeDisabled();
    expect(lista).toHaveAttribute('title', 'modelo anterior al módulo de Desarrollo');
  });
});
