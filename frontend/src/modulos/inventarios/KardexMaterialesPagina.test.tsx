import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { KardexTela } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { KardexMaterialesPagina } from './KardexMaterialesPagina';

const kardexTela: KardexTela = {
  idTela: 1,
  tela: 'Felpa',
  renglones: [
    {
      idMovimiento: 10,
      folio: 1,
      fecha: '2026-06-20',
      idTipoMov: 14,
      tipoMov: 'Ajuste (Entrada)',
      direccion: 'entrada',
      idAlmacen: 5,
      almacen: 'Bodega A',
      idLote: 7,
      loteClave: 'LOTE-A',
      entrada: 100,
      salida: 0,
      saldo: 100,
      costoUnit: null,
      importe: null,
      origenTipo: 'movimiento-manual',
      origenId: null,
      cancelado: false,
      observaciones: 'inventario inicial',
    },
  ],
};

// La tela seleccionada se fija al elegir en el SelectorTela (mockeado abajo).
vi.mock('@/api/inventario-materiales', () => ({
  useKardexTela: () => ({ data: kardexTela, isPending: false, isError: false, error: null }),
  useKardexAvio: () => ({ data: undefined, isPending: false, isError: false, error: null }),
  useCancelarTela: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarAvio: () => ({ mutate: vi.fn(), isPending: false }),
}));
// El selector emite la tela al hacer click en su opción.
vi.mock('./SelectorTela', () => ({
  SelectorTela: ({
    alSeleccionar,
  }: {
    alSeleccionar: (t: { id: number; nombre: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="sel-tela"
      onClick={() => alSeleccionar({ id: 1, nombre: 'Felpa' })}
    >
      elegir Felpa
    </button>
  ),
}));
vi.mock('./SelectorAvio', () => ({
  SelectorAvio: () => <div data-testid="sel-avio" />,
}));

describe('KardexMaterialesPagina (F4-E1)', () => {
  it('muestra el kardex de la tela elegida con tabla (escritorio) y tarjetas (móvil)', () => {
    renderConProveedores(<KardexMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    // Elegir una tela activa la consulta.
    fireEvent.click(screen.getByTestId('sel-tela'));
    expect(screen.getByTestId('kardex-tela-tabla')).toBeInTheDocument();
    expect(screen.getByTestId('kardex-tela-tarjetas')).toBeInTheDocument();
    expect(screen.getAllByText('Ajuste (Entrada)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LOTE-A').length).toBeGreaterThan(0);
  });

  it('cambia entre las dimensiones telas/avíos con el toggle', () => {
    renderConProveedores(<KardexMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-avios.ver']),
    });
    expect(screen.getByTestId('sel-tela')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('kardex-mat-dim-avio'));
    expect(screen.getByTestId('sel-avio')).toBeInTheDocument();
  });

  it('sin inventario-telas.mover NO muestra el botón de cancelar', () => {
    renderConProveedores(<KardexMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.click(screen.getByTestId('sel-tela'));
    expect(screen.queryByTestId('kardex-tela-cancelar-10')).not.toBeInTheDocument();
  });
});
