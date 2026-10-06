import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ClavePermiso, ExistenciasAvio } from '@/api/tipos';
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
      idProveedor: 7,
      proveedor: 'Zíper SA',
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
      // ⭐ Fila 0.221: tampoco tiene proveedor habitual → grupo «Sin proveedor habitual».
      idProveedor: null,
      proveedor: null,
    },
    {
      // El MISMO avío que el primero, en OTRO almacén: el botón de cada renglón debe llevar SU
      // almacén, no el del primer renglón del avío.
      idAvio: 1,
      avio: 'CIE-01',
      descripcion: 'Cierre 20cm',
      unidad: 'pza',
      esGenerico: false,
      idAlmacen: 6,
      almacen: 'Bodega B',
      existencia: 30,
      ubicacion: null,
      idProveedor: 7,
      proveedor: 'Zíper SA',
    },
    {
      idAvio: 4,
      avio: 'BOT-02',
      descripcion: 'Botón 4 hoyos',
      unidad: 'pza',
      esGenerico: false,
      idAlmacen: 5,
      almacen: 'Bodega A',
      existencia: 12,
      ubicacion: null,
      idProveedor: 3,
      proveedor: 'Avíos del Norte',
    },
  ],
  totalExistencia: 1542,
  // Tal como lo manda el servidor (dominio `subtotalesPorProveedor`): alfabético y el grupo sin
  // proveedor AL FINAL.
  porProveedor: [
    { idProveedor: 3, proveedor: 'Avíos del Norte', existencia: 12, renglones: 1 },
    { idProveedor: 7, proveedor: 'Zíper SA', existencia: 530, renglones: 2 },
    { idProveedor: null, proveedor: null, existencia: 1000, renglones: 1 },
  ],
};

/** Columnas del encabezado y celdas de cada renglón del cuerpo (guarda de cuadre de columnas). */
function cuadre(tabla: HTMLElement): { encabezados: number; porFila: number[] } {
  return {
    encabezados: tabla.querySelectorAll('thead th').length,
    porFila: [...tabla.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].reduce((n, td) => n + (td.colSpan || 1), 0),
    ),
  };
}

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

  describe('⭐ 0.221 · «Movimientos» de cada avío', () => {
    it('cada renglón enlaza al kardex de SU avío y SU almacén', () => {
      renderConProveedores(<ExistenciasAviosPagina />, {
        sesion: estadoSesionDePrueba(['inventario-avios.ver']),
      });
      const ruta = '/inventarios/materiales/kardex?material=avio';
      expect(screen.getByTestId('avios-movimientos-1-5')).toHaveAttribute(
        'href',
        `${ruta}&idAvio=1&idAlmacen=5`,
      );
      // El mismo avío en otro almacén lleva el OTRO almacén.
      expect(screen.getByTestId('avios-movimientos-1-6')).toHaveAttribute(
        'href',
        `${ruta}&idAvio=1&idAlmacen=6`,
      );
      expect(screen.getByTestId('avios-movimientos-2-5')).toHaveAttribute(
        'href',
        `${ruta}&idAvio=2&idAlmacen=5`,
      );
      // En móvil también.
      expect(screen.getByTestId('avios-movimientos-movil-4-5')).toHaveAttribute(
        'href',
        `${ruta}&idAvio=4&idAlmacen=5`,
      );
    });

    it('sin permiso para leer el kardex de avíos NO hay botón (ni en tabla ni en móvil)', () => {
      renderConProveedores(<ExistenciasAviosPagina />, {
        sesion: estadoSesionDePrueba(['inventario-avios.mover']),
      });
      expect(screen.queryByText('Movimientos')).not.toBeInTheDocument();
      expect(screen.queryByTestId('avios-movimientos-1-5')).not.toBeInTheDocument();
      expect(screen.queryByTestId('avios-movimientos-movil-1-5')).not.toBeInTheDocument();
    });

    it('esta pantalla NO enseña importes (sin `telas.ver-totales` ni con él)', () => {
      renderConProveedores(<ExistenciasAviosPagina />, {
        sesion: estadoSesionDePrueba(['inventario-avios.ver', 'telas.ver-totales']),
      });
      expect(screen.queryByText(/importe|costo|\$/i)).not.toBeInTheDocument();
    });
  });

  describe('⭐ 0.221 · agrupar por proveedor', () => {
    it('cada renglón dice su proveedor habitual («—» si no tiene)', () => {
      renderConProveedores(<ExistenciasAviosPagina />, {
        sesion: estadoSesionDePrueba(['inventario-avios.ver']),
      });
      const tabla = screen.getByTestId('avios-tabla');
      expect(within(tabla).getByRole('columnheader', { name: 'Proveedor' })).toBeInTheDocument();
      expect(within(tabla).getAllByText('Zíper SA')).toHaveLength(2);
      // Sin agrupar no hay encabezados de grupo.
      expect(screen.queryByTestId('avios-grupo')).not.toBeInTheDocument();
    });

    it('reparte los renglones bajo su proveedor con el subtotal, y «Sin proveedor habitual» al final', () => {
      renderConProveedores(<ExistenciasAviosPagina />, {
        sesion: estadoSesionDePrueba(['inventario-avios.ver']),
      });
      fireEvent.change(screen.getByTestId('avios-agrupar'), { target: { value: 'proveedor' } });

      const grupos = screen.getAllByTestId('avios-grupo');
      expect(grupos.map((g) => g.textContent)).toEqual([
        expect.stringContaining('Avíos del Norte'),
        expect.stringContaining('Zíper SA'),
        expect.stringContaining('Sin proveedor habitual'),
      ]);
      expect(screen.getAllByTestId('avios-grupo-subtotal').map((c) => c.textContent)).toEqual([
        '12',
        '530',
        '1,000',
      ]);

      // Bajo cada encabezado, SUS renglones (orden del DOM): se lee la tabla de arriba a abajo y
      // se anota bajo qué grupo cae cada botón de movimientos.
      const tabla = screen.getByTestId('avios-tabla');
      const reparto: string[] = [];
      let grupoActual = '';
      for (const tr of tabla.querySelectorAll('tbody tr')) {
        if (tr.getAttribute('data-testid') === 'avios-grupo') {
          grupoActual = tr.textContent ?? '';
          continue;
        }
        const enlace = tr.querySelector('a[data-testid^="avios-movimientos-"]');
        reparto.push(
          `${grupoActual.split(/\d/)[0] ?? ''}|${enlace?.getAttribute('data-testid') ?? ''}`,
        );
      }
      expect(reparto).toEqual([
        'Avíos del Norte|avios-movimientos-4-5',
        'Zíper SA|avios-movimientos-1-5',
        'Zíper SA|avios-movimientos-1-6',
        'Sin proveedor habitual|avios-movimientos-2-5',
      ]);

      // En móvil, los mismos tres grupos.
      expect(
        within(screen.getByTestId('avios-tarjetas'))
          .getAllByTestId('avios-grupo-movil')
          .map((g) => g.textContent),
      ).toEqual(['Avíos del Norte12', 'Zíper SA530', 'Sin proveedor habitual1,000']);
      // El total general no cambia por agrupar.
      expect(screen.getByText(/Total:/).nextSibling).toHaveTextContent('1,542');
    });

    const casos: [string, ClavePermiso[]][] = [
      ['con botón de movimientos', ['inventario-avios.ver']],
      ['sin botón de movimientos', ['inventario-avios.mover']],
    ];
    it.each(casos)('las columnas cuadran agrupado y sin agrupar (%s)', (_c, permisos) => {
      renderConProveedores(<ExistenciasAviosPagina />, {
        sesion: estadoSesionDePrueba(permisos),
      });
      for (const valor of ['ninguno', 'proveedor']) {
        fireEvent.change(screen.getByTestId('avios-agrupar'), { target: { value: valor } });
        const { encabezados, porFila } = cuadre(screen.getByTestId('avios-tabla'));
        expect(porFila).toHaveLength(valor === 'ninguno' ? 4 : 7);
        expect(porFila).toEqual(porFila.map(() => encabezados));
      }
    });
  });
});
