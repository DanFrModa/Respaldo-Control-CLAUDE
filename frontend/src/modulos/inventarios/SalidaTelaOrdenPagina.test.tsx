import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { SalidaTelaOrdenPagina } from './SalidaTelaOrdenPagina';

const mutate = vi.fn();

/**
 * La PREVIA de la fila 0.101: aunque esta pantalla sea LEGADA, sigue descontando tela contra una
 * orden, así que también lleva el aviso de SOBRE-SALIDA — y con la MISMA regla del servidor (los
 * renglones viajan como `lineasTela`, tela sin color). `previaArgs` captura la pregunta.
 */
type TelaPrevia = {
  idTela: number;
  tela: string;
  unidad: string | null;
  requerido: number | null;
  yaSalido: number;
  aSacar: number;
  excedente: number;
  sobreSalida: boolean;
  colores: string[];
};
const previaArgs = vi.fn();
let telasPrevia: TelaPrevia[] = [];
let tieneExplosion = true;

vi.mock('@/api/inventario-materiales', () => ({
  useSalidaTelaAOrden: () => ({ mutate, isPending: false }),
  useExistenciasTela: () => ({ data: { filas: [], totalExistencia: 0 }, isPending: false }),
  usePreviaSalidaTelaColor: (cuerpo: unknown) => {
    previaArgs(cuerpo);
    return {
      data:
        cuerpo === undefined
          ? undefined
          : {
              idOrden: 9,
              folioOrden: 123,
              idAlmacen: 5,
              tieneExplosion,
              telas: telasPrevia,
              colores: [],
              haySobreSalida: telasPrevia.some((t) => t.sobreSalida),
              hayRiesgoTono: false,
            },
    };
  },
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({ data: { datos: [{ id: 5, nombre: 'Bodega A' }] } }),
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
// La captura por lote se simula: un botón agrega un renglón de tela.
vi.mock('./CapturaRenglonesTela', () => ({
  CapturaRenglonesTela: ({
    onChange,
  }: {
    onChange: (r: { idTela: number; idLote: number; cantidad: number }[]) => void;
  }) => (
    <button
      type="button"
      data-testid="captura-renglones-tela"
      onClick={() => onChange([{ idTela: 1, idLote: 7, cantidad: 1200 }])}
    >
      agregar renglón
    </button>
  ),
}));
// La orden del deep-link (enlace "Descargar tela" del avance de producción) se carga por su id.
const useOrden = vi.fn<(id?: number) => unknown>();
vi.mock('@/api/ordenes', () => ({ useOrden: (id?: number) => useOrden(id) }));

describe('SalidaTelaOrdenPagina (F4-E1)', () => {
  beforeEach(() => {
    mutate.mockReset();
    previaArgs.mockReset();
    telasPrevia = [];
    tieneExplosion = true;
    useOrden.mockReset();
    useOrden.mockReturnValue({ data: undefined, isError: false });
  });

  it('pide elegir una orden antes de capturar', () => {
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    expect(screen.getByText('Sin orden seleccionada.')).toBeInTheDocument();
  });

  it('al elegir orden muestra el formulario de salida con su captura', () => {
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    fireEvent.click(screen.getByTestId('sel-orden'));
    expect(screen.getByTestId('salida-almacen')).toBeInTheDocument();
    expect(screen.getByTestId('captura-renglones-tela')).toBeInTheDocument();
    // Sin renglones ni almacén, el botón de guardar está deshabilitado.
    expect(screen.getByTestId('salida-guardar')).toBeDisabled();
  });

  // Enlace "Descargar tela del inventario" del avance de producción (petición de Daniel, 28-jul).
  it('con deep-link llega con la ORDEN ya puesta (sin tener que buscarla)', async () => {
    useOrden.mockReturnValue({
      data: { id: 42, folio: 5424, codigoModelo: 'M-9', cliente: 'C&A' },
      isError: false,
    });
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
      rutaInicial: { pathname: '/inventarios/telas/salida-orden', state: { idOrden: 42 } },
    });

    await waitFor(() => {
      expect(screen.queryByText('Sin orden seleccionada.')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('salida-almacen')).toBeInTheDocument();
    expect(useOrden).toHaveBeenCalledWith(42);
  });

  it('sin deep-link no pide ninguna orden al servidor', () => {
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    expect(useOrden).toHaveBeenCalledWith(undefined);
    expect(screen.getByText('Sin orden seleccionada.')).toBeInTheDocument();
  });

  // ═══ AVISO (a) — SOBRE-SALIDA también en la pantalla LEGADA (fila 0.101) ═══
  //
  // Esta captura sigue descontando tela contra una orden: dejarla sin aviso la convertía en la
  // puerta trasera por la que se saca de más sin que nadie diga nada.

  /**
   * Deja la pantalla con orden + almacén + un renglón capturado. El almacén va ANTES que los
   * renglones a propósito: cambiarlo los limpia (los lotes dependen del almacén).
   */
  function capturar(): void {
    fireEvent.click(screen.getByTestId('sel-orden'));
    fireEvent.change(screen.getByTestId('salida-almacen'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('captura-renglones-tela'));
  }

  it('le pregunta al servidor por los renglones SIN COLOR (lineasTela)', () => {
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    expect(previaArgs).toHaveBeenLastCalledWith({
      idOrden: 9,
      idAlmacen: 5,
      lineasTela: [{ idTela: 1, cantidad: 1200 }],
    });
  });

  it('sacar MÁS de lo que la orden pide avisa, y NO bloquea el guardado', () => {
    telasPrevia = [
      {
        idTela: 1,
        tela: 'Felpa Suiza',
        unidad: 'KG',
        requerido: 1000,
        yaSalido: 0,
        aSacar: 1200,
        excedente: 200,
        sobreSalida: true,
        colores: [],
      },
    ];
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    expect(screen.getByTestId('salida-aviso-sobre-salida')).toHaveTextContent(
      'la orden pide 1,000 KG y ahora sacas 1,200 de cuerpo → te pasas por 200',
    );
    const guardar = screen.getByTestId('salida-guardar');
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('una orden SIN explosión lo DICE en vez de callar (H3)', () => {
    tieneExplosion = false;
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    expect(screen.getByTestId('salida-aviso-sobre-salida-sin-explosion')).toHaveTextContent(
      'no hay contra qué comparar',
    );
  });

  it('cuando la salida CABE no enseña el aviso', () => {
    telasPrevia = [
      {
        idTela: 1,
        tela: 'Felpa Suiza',
        unidad: 'KG',
        requerido: 5000,
        yaSalido: 0,
        aSacar: 1200,
        excedente: 0,
        sobreSalida: false,
        colores: [],
      },
    ];
    renderConProveedores(<SalidaTelaOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    expect(screen.queryByTestId('salida-aviso-sobre-salida')).not.toBeInTheDocument();
  });
});
