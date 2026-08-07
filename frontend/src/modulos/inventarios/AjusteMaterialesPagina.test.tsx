import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { AjusteMaterialesPagina } from './AjusteMaterialesPagina';

vi.mock('@/api/inventario-materiales', () => ({
  useAjustarTela: () => ({ mutate: vi.fn(), isPending: false }),
  useAjustarAvio: () => ({ mutate: vi.fn(), isPending: false }),
  useExistenciasTela: () => ({ data: { filas: [], totalExistencia: 0 }, isPending: false }),
}));
vi.mock('@/api/inventarios', () => ({
  useTiposMovimiento: () => ({
    data: {
      datos: [
        {
          id: 14,
          codigo: 'ajuste-entrada',
          nombre: 'Ajuste (Entrada)',
          direccion: 'entrada',
          activo: true,
        },
        {
          id: 15,
          codigo: 'ajuste-salida',
          nombre: 'Ajuste (Salida)',
          direccion: 'salida',
          activo: true,
        },
      ],
    },
  }),
}));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/colores', () => ({ useColores: () => ({ data: { datos: [] } }) }));
// Espía del código de rol con el que la pantalla pide los proveedores del lote.
const { espiaRolProveedor } = vi.hoisted(() => ({ espiaRolProveedor: vi.fn() }));
vi.mock('@/api/proveedores', () => ({
  COD_ROL_PROVEEDOR: { vendeTelas: 'vende-telas', vendeAvios: 'vende-avios' },
  useProveedoresPorRol: (codigo: string | undefined) => {
    espiaRolProveedor(codigo);
    // El backend ya filtró: solo llegan proveedores con ese rol.
    return { data: { datos: [{ id: 7, nombre: 'Telas del Norte' }] }, isPending: false };
  },
}));
vi.mock('./CapturaRenglonesTela', () => ({
  CapturaRenglonesTela: () => <div data-testid="captura-renglones-tela" />,
}));
vi.mock('./CapturaRenglonesAvio', () => ({
  CapturaRenglonesAvio: () => <div data-testid="captura-renglones-avio" />,
}));
vi.mock('./SelectorTela', () => ({
  SelectorTela: () => <div data-testid="sel-tela-comp" />,
}));

describe('AjusteMaterialesPagina (F4-E1)', () => {
  it('en TELA-ENTRADA pide el lote (color + componentes, D5) y el motivo es obligatorio', () => {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    // Por defecto: dimensión tela + dirección entrada → captura de lote con color y componentes.
    expect(screen.getByTestId('ajuste-color')).toBeInTheDocument();
    expect(screen.getByTestId('ajuste-agregar-componente')).toBeInTheDocument();
    expect(screen.getByTestId('ajuste-motivo')).toBeInTheDocument();
    // Sin almacén/color/componentes/motivo, guardar deshabilitado.
    expect(screen.getByTestId('ajuste-guardar')).toBeDisabled();
  });

  it('en TELA-ENTRADA solo ofrece proveedores con el rol «Vende telas»', () => {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    // La lista se pide ACOTADA al rol (el filtro lo aplica el servidor, no la pantalla).
    expect(espiaRolProveedor).toHaveBeenCalledWith('vende-telas');
    const selector = screen.getByTestId('ajuste-proveedor');
    expect(within(selector).getByRole('option', { name: 'Telas del Norte' })).toBeInTheDocument();
  });

  it('en TELA-SALIDA cambia a la captura de renglones sobre lo existente', () => {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    fireEvent.click(screen.getByTestId('ajuste-dir-salida'));
    expect(screen.getByTestId('captura-renglones-tela')).toBeInTheDocument();
    expect(screen.queryByTestId('ajuste-color')).not.toBeInTheDocument();
  });

  it('en AVÍO usa la captura de avíos', () => {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.mover']),
    });
    fireEvent.click(screen.getByTestId('ajuste-dim-avio'));
    expect(screen.getByTestId('captura-renglones-avio')).toBeInTheDocument();
  });
});
