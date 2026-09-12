import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ExistenciasAvio } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExistenciasAviosPagina } from './ExistenciasAviosPagina';

const existencias: ExistenciasAvio = {
  filas: [
    {
      idAvio: 1,
      avio: 'CIE-01',
      descripcion: 'Cierre 20cm',
      unidad: 'pza',
      esGenerico: false,
      idAlmacen: 5,
      almacen: 'Bodega A',
      existencia: 500,
      ubicacion: 'Rack 4, nivel 2',
    },
    {
      idAvio: 2,
      avio: 'HIL-01',
      descripcion: 'Hilo blanco',
      unidad: 'cono',
      esGenerico: true,
      idAlmacen: 5,
      almacen: 'Bodega A',
      existencia: 1000,
      // ⭐ Fila 0.103: éste NO tiene ubicación anotada — es el caso normal (REGLA 0-B).
      ubicacion: null,
    },
  ],
  totalExistencia: 1500,
};

const fijarUbicacion = vi.fn();
vi.mock('@/api/inventario-materiales', () => ({
  useExistenciasAvio: () => ({ data: existencias, isPending: false, isError: false, error: null }),
  useFijarUbicacionAvio: () => ({ mutate: fijarUbicacion, isPending: false }),
}));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));
// El filtro de avío del toolbar (SelectorAvio, combobox popover) consulta el catálogo de avíos.
vi.mock('@/api/avios', () => ({
  useAvios: () => ({ data: { datos: [] }, isPending: false, isError: false }),
}));

describe('ExistenciasAviosPagina (F4-E1)', () => {
  it('muestra existencias multi-almacén con tabla (escritorio) y tarjetas (móvil)', () => {
    renderConProveedores(<ExistenciasAviosPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.ver']),
    });
    expect(screen.getByText(/Total:/)).toBeInTheDocument();
    expect(screen.getByTestId('avios-tabla')).toBeInTheDocument();
    expect(screen.getByTestId('avios-tarjetas')).toBeInTheDocument();
    expect(screen.getAllByText('CIE-01').length).toBeGreaterThan(0);
  });

  it('distingue los avíos genéricos (R4) con su badge', () => {
    renderConProveedores(<ExistenciasAviosPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.ver']),
    });
    // El badge "Genérico · stock" (texto del proto) aparece (tabla + tarjeta) para el avío genérico.
    expect(screen.getAllByText('Genérico · stock').length).toBeGreaterThan(0);
  });

  it('⭐ 0.103 · muestra DÓNDE está guardado, y con `.mover` deja capturarlo/corregirlo', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExistenciasAviosPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.ver', 'inventario-avios.mover']),
    });
    // Lo anotado se ve tal cual; lo que nadie ha anotado invita a capturarlo (no un hueco mudo).
    expect(screen.getAllByText('Rack 4, nivel 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Anotar…').length).toBeGreaterThan(0);

    await usuario.click(screen.getByTestId('avios-ubicacion-1-5'));
    const campo = await screen.findByTestId('material-ubicacion');
    // El diálogo se SIEMBRA con lo que ya estaba: corregir es lo normal, capturar de cero lo raro.
    expect(campo).toHaveValue('Rack 4, nivel 2');
    await usuario.clear(campo);
    await usuario.type(campo, 'Pasillo B, caja 3');
    await usuario.click(screen.getByTestId('guardar-ubicacion-material'));
    expect(fijarUbicacion).toHaveBeenCalledWith(
      { idAvio: 1, idAlmacen: 5, ubicacion: 'Pasillo B, caja 3' },
      expect.anything(),
    );
  });

  it('⭐ 0.103 · sin `.mover` la ubicación se LEE pero no se puede tocar', () => {
    renderConProveedores(<ExistenciasAviosPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.ver']),
    });
    expect(screen.getAllByText('Rack 4, nivel 2').length).toBeGreaterThan(0);
    expect(screen.queryByText('Anotar…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dónde está guardado/ })).not.toBeInTheDocument();
  });

  it('tiene el filtro "solo genéricos"', () => {
    renderConProveedores(<ExistenciasAviosPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.ver']),
    });
    expect(screen.getByTestId('avios-genericos')).toBeInTheDocument();
  });
});
