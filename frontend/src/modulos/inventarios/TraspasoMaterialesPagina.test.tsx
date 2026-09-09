import { fireEvent, screen, within } from '@testing-library/react';
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
 *
 * ⭐ Fila 0.172 — y el MOTIVO obligatorio: sin él la pantalla no deja guardar (antes eran unas
 * observaciones opcionales, así que mover avío de un almacén a otro no exigía una palabra).
 */
const mutate = vi.fn();

vi.mock('@/api/inventario-materiales', () => ({
  useTraspasarAvio: () => ({ mutate, isPending: false }),
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
  // Un SEGUNDO almacén de avíos: sin él no hay traspaso posible que medir (origen ≠ destino).
  { id: 9, nombre: 'Bodega de avíos', tipo: 'AVIO' },
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
// La captura de renglones se simula: un botón que emite un renglón ya armado (así el gate de
// guardar se puede medir con renglones de verdad, que es donde el motivo estorba o no).
vi.mock('./CapturaRenglonesAvio', () => ({
  CapturaRenglonesAvio: ({ onChange }: { onChange: (r: unknown[]) => void }) => (
    <button
      type="button"
      data-testid="captura-renglones-avio"
      onClick={() => {
        onChange([{ idAvio: 4, avio: 'Botón', cantidad: 120 }]);
      }}
    >
      capturar
    </button>
  ),
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
    // Sin almacenes, sin renglones y sin motivo (fila 0.172), guardar deshabilitado: aquí falta
    // TODO, así que esta aserción no distingue cuál de los tres bloquea. La del motivo, sola y con
    // lo demás ya listo, es la de «sin MOTIVO no deja guardar» de más abajo.
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

  /**
   * ⭐ Fila 0.172 — LA GUARDA. Con almacenes distintos y un renglón capturado, el botón sigue muerto
   * hasta que hay motivo, y el campo se marca en rojo. Si alguien quitara el `motivoOk` del gate,
   * esta prueba muere en el primer `toBeDisabled`.
   */
  it('sin MOTIVO no deja guardar, aunque todo lo demás esté listo (fila 0.172)', () => {
    mutate.mockReset();
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.mover']),
    });

    fireEvent.change(screen.getByTestId('traspaso-origen'), { target: { value: '7' } });
    fireEvent.change(screen.getByTestId('traspaso-destino'), { target: { value: '9' } });
    fireEvent.click(screen.getByTestId('captura-renglones-avio'));

    const motivo = screen.getByTestId('traspaso-avio-motivo');
    const guardar = screen.getByTestId('traspaso-guardar');
    expect(guardar).toBeDisabled();
    expect(motivo.closest('[data-invalid="true"]')).not.toBeNull();

    // Dos caracteres NO bastan: el mínimo es el mismo que exige el contrato (3, ya recortado).
    fireEvent.change(motivo, { target: { value: ' ab ' } });
    expect(guardar).toBeDisabled();

    fireEvent.change(motivo, { target: { value: 'Surtido al taller' } });
    expect(guardar).toBeEnabled();
    expect(motivo.closest('[data-invalid="true"]')).toBeNull();
    fireEvent.click(guardar);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        idAlmacenOrigen: 7,
        idAlmacenDestino: 9,
        motivo: 'Surtido al taller',
        lineas: [{ idAvio: 4, cantidad: 120 }],
      }),
      expect.anything(),
    );
    mutate.mockReset();
  });

  it('sin inventario-avios.mover la captura queda deshabilitada (el gate real, A4)', () => {
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    expect(screen.getByTestId('traspaso-origen')).toBeDisabled();
    expect(screen.getByTestId('traspaso-guardar')).toBeDisabled();
  });
});
