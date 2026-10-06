import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ExistenciasAvio, KardexAvio } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExistenciasAviosPagina } from './ExistenciasAviosPagina';
import { KardexMaterialesPagina } from './KardexMaterialesPagina';
import { RUTA_KARDEX_MATERIALES } from './kardex-enlace';

/**
 * ⭐ FILA 0.221 — EL VIAJE COMPLETO: botón «Movimientos» de existencias → kardex de materiales.
 * Las pruebas de cada pantalla miden su mitad (el `href` que se arma, la URL que se lee); ésta mide
 * que las DOS mitades hablen el mismo idioma: si una cambia el nombre de un parámetro y la otra no,
 * el kardex abriría vacío y cada prueba por separado seguiría en verde.
 */
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
      ubicacion: null,
      idProveedor: null,
      proveedor: null,
    },
    {
      idAvio: 2,
      avio: 'HIL-01',
      descripcion: 'Hilo blanco',
      unidad: 'cono',
      esGenerico: true,
      idAlmacen: 6,
      almacen: 'Bodega B',
      existencia: 80,
      ubicacion: null,
      idProveedor: null,
      proveedor: null,
    },
  ],
  totalExistencia: 580,
  porProveedor: [{ idProveedor: null, proveedor: null, existencia: 580, renglones: 2 }],
};

const kardex: KardexAvio = {
  idAvio: 2,
  avio: 'HIL-01',
  descripcion: 'Hilo blanco',
  desde: '2025-09-05',
  hasta: null,
  ventanaPorOmision: true,
  limite: 1000,
  truncado: false,
  saldosIniciales: [],
  renglones: [],
};

const consultaKardexAvio = vi.fn<(q: unknown) => void>();
vi.mock('@/api/inventario-materiales', () => ({
  useExistenciasAvio: () => ({ data: existencias, isPending: false, isError: false, error: null }),
  useFijarUbicacionAvio: () => ({ mutate: vi.fn(), isPending: false }),
  useKardexAvio: (q: unknown) => {
    consultaKardexAvio(q);
    return { data: q === undefined ? undefined : kardex, isPending: false, isError: false };
  },
  useKardexTela: () => ({ data: undefined, isPending: false, isError: false }),
  useCancelarAvio: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarTela: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/avios', () => ({
  useAvios: () => ({ data: { datos: [] }, isPending: false, isError: false }),
}));
vi.mock('@/api/telas', () => ({
  useTelas: () => ({ data: { datos: [] }, isPending: false, isError: false }),
}));

describe('⭐ 0.221 · de existencias de avíos al kardex de ESE avío en ESE almacén', () => {
  it('el botón del SEGUNDO renglón abre el kardex del segundo avío, en su almacén', () => {
    renderConProveedores(
      <Routes>
        <Route path="/inventarios/avios/existencias" element={<ExistenciasAviosPagina />} />
        <Route path={RUTA_KARDEX_MATERIALES} element={<KardexMaterialesPagina />} />
      </Routes>,
      {
        sesion: estadoSesionDePrueba(['inventario-avios.ver']),
        rutaInicial: '/inventarios/avios/existencias',
      },
    );
    fireEvent.click(screen.getByTestId('avios-movimientos-2-6'));

    expect(screen.getByRole('heading', { name: 'Kardex de materiales' })).toBeInTheDocument();
    expect(consultaKardexAvio).toHaveBeenLastCalledWith({ idAvio: 2, idAlmacen: 6 });
    expect(screen.getByTestId('kardex-avio-sel')).toHaveTextContent('HIL-01 — Hilo blanco');
    expect(screen.getByTestId('kardex-avio-almacen')).toHaveValue('6');
  });
});
