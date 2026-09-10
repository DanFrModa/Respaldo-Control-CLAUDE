import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ExistenciasTela } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExistenciasTelasPagina } from './ExistenciasTelasPagina';

const existencias: ExistenciasTela = {
  filas: [
    {
      idTela: 1,
      tela: 'Felpa',
      idLote: 7,
      loteClave: 'LOTE-A',
      idColor: 3,
      color: 'Rojo',
      idProveedor: 2,
      proveedor: 'Textiles SA',
      factura: 'F-100',
      idAlmacen: 5,
      almacen: 'Bodega A',
      existencia: 100,
      componentes: [
        { idTela: 1, tela: 'Felpa', cantidad: 100, peso: 25 },
        { idTela: 2, tela: 'Cardigan', cantidad: 40, peso: null },
      ],
    },
  ],
  totalExistencia: 100,
};

vi.mock('@/api/inventario-materiales', () => ({
  useExistenciasTela: () => ({ data: existencias, isPending: false, isError: false, error: null }),
}));
vi.mock('@/api/colores', () => ({ useColores: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));
// El filtro de tela del toolbar (SelectorTela, combobox popover) consulta el catálogo de telas.
vi.mock('@/api/telas', () => ({
  useTelas: () => ({ data: { datos: [] }, isPending: false, isError: false }),
}));

describe('ExistenciasTelasPagina (F4-E1)', () => {
  it('muestra la fila + total con tabla (escritorio) y tarjetas (móvil)', () => {
    renderConProveedores(<ExistenciasTelasPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    expect(screen.getByText(/Total:/)).toBeInTheDocument();
    // Ambos contenedores existen en el DOM (la visibilidad la decide Tailwind responsive) → móvil OK.
    expect(screen.getByTestId('telas-tabla')).toBeInTheDocument();
    expect(screen.getByTestId('telas-tarjetas')).toBeInTheDocument();
    expect(screen.getAllByText('Felpa').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LOTE-A').length).toBeGreaterThan(0);
  });

  it('expande los componentes del lote (D5) al pulsar el toggle de la fila', () => {
    renderConProveedores(<ExistenciasTelasPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    // Antes de expandir, la fila de componentes de escritorio NO está.
    expect(screen.queryByTestId('telas-fila-componentes-1-7-5')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('telas-fila-toggle-1-7-5'));
    // Tras expandir, aparece el detalle con el componente Cardigan.
    expect(screen.getByTestId('telas-fila-componentes-1-7-5')).toBeInTheDocument();
    expect(screen.getAllByText(/Cardigan/).length).toBeGreaterThan(0);
  });

  // 🔴 fila 0.098: el botón «Imprimir PDF» vivía AQUÍ y el impreso leía ESTA consulta legada, así
  // que el inventario de telas se imprimía prácticamente en blanco. El botón se fue a «Inventario
  // de telas» (la pantalla que se usa); esta prueba vigila que no regrese.
  it('NO ofrece imprimir: el impreso del inventario de telas vive en la pantalla por color', () => {
    renderConProveedores(<ExistenciasTelasPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    expect(screen.queryByTestId('telas-imprimir')).not.toBeInTheDocument();
    expect(screen.queryByText(/Imprimir PDF/i)).not.toBeInTheDocument();
  });
});
