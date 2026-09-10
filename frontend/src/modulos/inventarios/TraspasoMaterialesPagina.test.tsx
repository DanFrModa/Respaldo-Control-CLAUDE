import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TraspasoMaterialesPagina } from './TraspasoMaterialesPagina';

/**
 * 🔴 fila 0.098 — esta pantalla era «Traspaso de materiales» y ARRANCABA en una pestaña de TELAS
 * atada al motor LEGADO por lote, así que traspasar tela desde aquí NO movía «Inventario de telas».
 * Mismo defecto y mismo arreglo que «Ajuste de materiales» en agosto. ⚠️ La pata NO se retira por
 * «estar muerta» —opera la misma dimensión legada que el kardex, que SÍ se conserva—: se retira
 * porque **tiene reemplazo vigente dictado por Daniel** (§Post-F9.32, el traspaso va por COLOR), o
 * sea porque hay a dónde mandar al usuario. El criterio, entero, en `TraspasoMaterialesPagina.tsx`.
 */
vi.mock('@/api/inventario-materiales', () => ({
  useTraspasarAvio: () => ({ mutate: vi.fn(), isPending: false }),
}));
/**
 * Catálogo de mentiras con LOS TRES tipos de almacén (fila 0.137). El mock de `useAlmacenes` filtra
 * por el `tipo` que pide la pantalla: si la pantalla se olvidara de pedirlo, los tres saldrían en el
 * desplegable y la prueba lo cazaría — que es justo lo que se quiere fijar, y no un
 * `toHaveBeenCalledWith` que solo mira la consulta.
 */
const ALMACENES_TODOS = [
  { id: 3, nombre: 'Primeras', tipo: 'PT' },
  { id: 5, nombre: 'Naucalpan', tipo: 'TELA' },
  { id: 7, nombre: 'Almacén de avíos', tipo: 'AVIO' },
];

/** Los del `tipo` pedido (o todos si la pantalla no filtra — el caso que la prueba caza). */
function almacenesDelTipo(query: { tipo?: string } | undefined) {
  const tipo = query?.tipo;
  return tipo === undefined ? ALMACENES_TODOS : ALMACENES_TODOS.filter((a) => a.tipo === tipo);
}

vi.mock('@/api/almacenes', () => ({
  useAlmacenes: (query: { tipo?: string } | undefined) => ({
    data: { datos: almacenesDelTipo(query) },
  }),
}));
vi.mock('./CapturaRenglonesAvio', () => ({
  CapturaRenglonesAvio: () => <div data-testid="captura-renglones-avio" />,
}));

describe('TraspasoMaterialesPagina — SOLO AVÍOS (fila 0.098)', () => {
  it('captura avíos directo: sin pestañas de dimensión y sin captura de tela', () => {
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover', 'inventario-avios.mover']),
    });
    expect(screen.getByTestId('traspaso-origen')).toBeInTheDocument();
    expect(screen.getByTestId('traspaso-destino')).toBeInTheDocument();
    expect(screen.getByTestId('captura-renglones-avio')).toBeInTheDocument();
    // La pata de TELA por lote se retiró: ni pestaña ni captura (si volviera, esto muere).
    expect(screen.queryByTestId('traspaso-dim-tela')).not.toBeInTheDocument();
    expect(screen.queryByTestId('traspaso-dim-avio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('captura-renglones-tela')).not.toBeInTheDocument();
    // Sin almacenes ni renglones, guardar deshabilitado.
    expect(screen.getByTestId('traspaso-guardar')).toBeDisabled();
  });

  /**
   * Fila 0.137 — origen y destino sólo ofrecen almacenes de AVIO. Si la pantalla dejara de pedir el
   * tipo, el mock devolvería los tres y la bodega de telas se podría elegir de destino: justo el
   * cruce que el dominio rechaza (`exigirAlmacenDelTipo`) desde esta fila.
   */
  it('origen y destino SOLO ofrecen almacenes de AVIO (fila 0.137)', () => {
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.mover']),
    });
    for (const testId of ['traspaso-origen', 'traspaso-destino']) {
      const selector = within(screen.getByTestId(testId));
      expect(selector.getByRole('option', { name: 'Almacén de avíos' })).toBeInTheDocument();
      expect(selector.queryByRole('option', { name: 'Naucalpan' })).not.toBeInTheDocument();
      expect(selector.queryByRole('option', { name: 'Primeras' })).not.toBeInTheDocument();
    }
  });

  it('se llama «Traspaso de avíos» y manda al traspaso por color a quien puede mover tela', () => {
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.mover', 'inventario-telas.mover']),
    });
    expect(screen.getByRole('heading', { name: 'Traspaso de avíos' })).toBeInTheDocument();
    const nota = screen.getByTestId('traspaso-avios-nota-tela');
    expect(nota).toBeInTheDocument();
    expect(nota.querySelector('a')).toHaveAttribute('href', '/inventarios/telas/traspaso');
  });

  it('NO pasea al que no puede mover tela: sin ese permiso, no hay puntero (A4)', () => {
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.mover']),
    });
    expect(screen.queryByTestId('traspaso-avios-nota-tela')).not.toBeInTheDocument();
    // …pero la pantalla sigue operable para avíos (el permiso que de verdad usa).
    expect(screen.getByTestId('traspaso-origen')).not.toBeDisabled();
  });

  it('sin inventario-avios.mover la captura queda deshabilitada (el gate real, A4)', () => {
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    expect(screen.getByTestId('traspaso-origen')).toBeDisabled();
    expect(screen.getByTestId('traspaso-guardar')).toBeDisabled();
  });
});
