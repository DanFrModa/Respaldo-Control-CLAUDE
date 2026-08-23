import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import type { RenglonTelaColor } from './CapturaRenglonesTelaColor';
import { SalidaTelaColorOrdenPagina } from './SalidaTelaColorOrdenPagina';

const mutate = vi.fn();

vi.mock('@/api/inventario-materiales', () => ({
  useSalidaTelaColorAOrden: () => ({ mutate, isPending: false }),
}));
const almacenesQuery = vi.fn();
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: (query: unknown) => {
    almacenesQuery(query);
    return {
      data: {
        datos: [
          { id: 5, nombre: 'Bodega A', idCortador: null, cortador: null },
          { id: 8, nombre: 'Taller Montaño', idCortador: 99, cortador: 'Montaño' },
        ],
      },
    };
  },
}));
// SelectorOrden emite una orden al hacer click.
vi.mock('@/modulos/produccion/SelectorOrden', () => ({
  SelectorOrden: ({
    alSeleccionar,
  }: {
    alSeleccionar: (o: {
      id: number;
      folio: number;
      codigoModelo: string;
      cliente: string;
    }) => void;
  }) => (
    <button
      type="button"
      data-testid="sel-orden"
      onClick={() =>
        alSeleccionar({ id: 9, folio: 123, codigoModelo: 'M-1', cliente: 'Cliente X' })
      }
    >
      elegir orden
    </button>
  ),
}));
// La captura por color se simula: un botón agrega un renglón felpa+cardigan.
vi.mock('./CapturaRenglonesTelaColor', () => ({
  CapturaRenglonesTelaColor: ({ onChange }: { onChange: (r: RenglonTelaColor[]) => void }) => (
    <button
      type="button"
      data-testid="captura-color-simulada"
      onClick={() =>
        onChange([
          {
            idTelaColor: 11,
            tela: 'Felpa Suiza',
            color: 'Marino',
            nombreComplemento: 'Cardigan',
            cantidad: 60,
            cantidadComplemento: 25,
          },
        ])
      }
    >
      agregar renglón
    </button>
  ),
}));
// La orden del deep-link (enlace "Descargar tela" del avance de producción) se carga por su id.
const useOrden = vi.fn<(id?: number) => unknown>();
vi.mock('@/api/ordenes', () => ({ useOrden: (id?: number) => useOrden(id) }));

describe('SalidaTelaColorOrdenPagina (A2 — salida por color)', () => {
  beforeEach(() => {
    mutate.mockReset();
    useOrden.mockReset();
    useOrden.mockReturnValue({ data: undefined, isError: false });
  });

  it('pide elegir una orden antes de capturar', () => {
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    expect(screen.getByText('Sin orden seleccionada.')).toBeInTheDocument();
  });

  it('con renglones muestra el AVISO DE RIESGO DE TONO sin bloquear el guardado', () => {
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    fireEvent.click(screen.getByTestId('sel-orden'));
    // Sin renglones: no hay aviso y no se puede guardar.
    expect(screen.queryByTestId('salida-color-aviso-tono')).not.toBeInTheDocument();
    expect(screen.getByTestId('salida-color-guardar')).toBeDisabled();
    // Con renglones + almacén: el aviso APARECE (Daniel §Post-F9.11 punto 2)…
    fireEvent.click(screen.getByTestId('captura-color-simulada'));
    fireEvent.change(screen.getByTestId('salida-color-almacen'), { target: { value: '5' } });
    expect(screen.getByTestId('salida-color-aviso-tono')).toHaveTextContent('Riesgo de tono');
    // …y NO bloquea: el botón queda habilitado y la mutación sale con ambas cantidades.
    const guardar = screen.getByTestId('salida-color-guardar');
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        idOrden: 9,
        idAlmacen: 5,
        lineas: [{ idTelaColor: 11, cantidad: 60, cantidadComplemento: 25 }],
      }),
      expect.anything(),
    );
  });

  // Enlace "Descargar tela del inventario" del avance de producción: la ruta es la MISMA que
  // servía la pantalla por lote, así que el deep-link sigue funcionando en la pantalla nueva.
  it('con deep-link llega con la ORDEN ya puesta (sin tener que buscarla)', async () => {
    useOrden.mockReturnValue({
      data: { id: 42, folio: 5424, codigoModelo: 'M-9', cliente: 'C&A' },
      isError: false,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
      rutaInicial: { pathname: '/inventarios/telas/salida-orden', state: { idOrden: 42 } },
    });

    await waitFor(() => {
      expect(screen.queryByText('Sin orden seleccionada.')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('salida-color-almacen')).toBeInTheDocument();
    expect(useOrden).toHaveBeenCalledWith(42);
  });
  it('solo ofrece almacenes de TELA (no bodegas de PT ni de avíos)', () => {
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    // El filtro lo aplica el SERVIDOR: la pantalla pide la lista ya acotada.
    expect(almacenesQuery).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'TELA' }));
  });

  it('con el CORTADOR en el deep-link arranca en SU almacén (§Post-F9.13)', async () => {
    useOrden.mockReturnValue({
      data: { id: 42, folio: 5424, codigoModelo: 'M-9', cliente: 'C&A' },
      isError: false,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
      rutaInicial: {
        pathname: '/inventarios/telas/salida-orden',
        state: { idOrden: 42, idCortador: 99 },
      },
    });

    await waitFor(() => {
      // El almacén ligado a ese cortador queda elegido sin que el usuario lo busque.
      expect(screen.getByTestId('salida-color-almacen')).toHaveValue('8');
    });
  });

  it('un cortador SIN almacén ligado no rompe nada: el campo queda vacío', async () => {
    useOrden.mockReturnValue({
      data: { id: 42, folio: 5424, codigoModelo: 'M-9', cliente: 'C&A' },
      isError: false,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
      rutaInicial: {
        pathname: '/inventarios/telas/salida-orden',
        state: { idOrden: 42, idCortador: 12345 },
      },
    });

    await waitFor(() => {
      expect(screen.queryByText('Sin orden seleccionada.')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('salida-color-almacen')).toHaveValue('');
  });
});
