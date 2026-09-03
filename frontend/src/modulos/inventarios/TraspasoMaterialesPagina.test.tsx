import { screen } from '@testing-library/react';
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
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));
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
