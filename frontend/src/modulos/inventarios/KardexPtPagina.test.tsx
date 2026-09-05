/**
 * Tests del KARDEX de PT, modo POR FOLIO — fila 0.100: la **reimpresión** de la hoja del traspaso.
 *
 * ⚠️ POR QUÉ EXISTEN: la hoja nació con UNA sola puerta, la barra que aparece al guardar en
 * `TraspasosPtPagina`. Con esa sola puerta, una impresora atascada, una pestaña cerrada o la simple
 * necesidad de una segunda copia dejaban el papel irrecuperable — en una fila que se llama «el
 * traspaso deja rastro». Ésta es la segunda puerta, la misma que la hoja de TELA ya tenía en
 * `ExistenciasTelasColorPagina` desde §Post-F9.38.
 *
 * Lo que se mide es la GUARDA, no sólo que el botón exista: la hoja es de traspasos, así que un
 * movimiento manual no la ofrece, y un traspaso CANCELADO tampoco (su papel no debe volver a salir
 * con un bulto). El backend rechaza los dos casos igual; el botón sólo evita ofrecer un camino que
 * terminaría en error.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiInventarios from '@/api/inventarios';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { KardexPtPagina } from './KardexPtPagina';

const usePorFolioMock = vi.fn<() => Record<string, unknown>>();

vi.mock('@/api/inventarios', async (importarOriginal) => {
  // Solo se sustituyen los hooks (los que tocan la red). `urlImpresoTraspasoPt` se toma DEL MÓDULO
  // REAL: re-escribir aquí su literal haría que esta prueba afirmara su propio texto y no el del
  // código — con una copia, apuntar el helper a la ruta de TELA dejaba este archivo en VERDE. La
  // ruta en sí la fija `src/api/inventarios.impreso-traspaso.test.ts` contra el contrato.
  const real = await importarOriginal<typeof ApiInventarios>();
  return {
    useKardexPt: () => ({ data: undefined, isPending: false, isError: false }),
    useMovimientoPtPorFolio: () => usePorFolioMock(),
    useCancelarMovimientoPt: () => ({ mutate: vi.fn(), isPending: false }),
    urlImpresoTraspasoPt: real.urlImpresoTraspasoPt,
  };
});

vi.mock('@/api/modelos', () => ({
  useModelos: () => ({
    data: { datos: [], total: 0, pagina: 1, porPagina: 8, totalPaginas: 0 },
    isPending: false,
    isError: false,
  }),
}));

/**
 * Un movimiento devuelto por «buscar por folio». `origenTipo` y `cancelado` YA venían en esta
 * respuesta antes de la fila 0.100: por eso la reimpresión no necesitó tocar el contrato.
 */
function movimiento(sobrescribir: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 200,
    folio: 9910,
    idEmpresa: 1,
    idTipoMov: 5,
    tipoMov: 'Transferencia (salida)',
    direccion: 'salida',
    idAlmacen: 3,
    almacen: 'Primeras',
    idModelo: 1,
    modelo: 'A-100',
    fecha: '2026-09-04',
    observaciones: 'Embarque del viernes',
    origenTipo: 'traspaso',
    cancelado: false,
    idMovimientoInverso: null,
    lineas: [
      {
        idColor: 7,
        color: 'Rojo',
        idOrden: null,
        folioOrden: null,
        tallas: [{ idTalla: 11, etiquetaTalla: 'CH', cantidad: 5 }],
        totalPiezas: 5,
      },
    ],
    totalPiezas: 5,
    creadoEn: '2026-09-04T10:00:00.000Z',
    creadoPorId: 'u-almacen',
    ...sobrescribir,
  };
}

const sesion = () => estadoSesionDePrueba(['inventario-pt.ver', 'inventario-pt.mover']);

/** Entra al modo «Por folio», escribe un folio y busca. */
async function buscarFolio(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  await usuario.click(screen.getByTestId('kardex-modo-folio'));
  await usuario.type(screen.getByTestId('kardex-folio-input'), '9910');
  await usuario.click(screen.getByTestId('kardex-folio-buscar'));
}

describe('KardexPtPagina · modo por folio — fila 0.100 (reimpresión de la hoja)', () => {
  beforeEach(() => {
    usePorFolioMock.mockReset();
    usePorFolioMock.mockReturnValue({
      data: movimiento(),
      isPending: false,
      isError: false,
    });
  });

  it('⭐ un TRASPASO vivo ofrece «Hoja del traspaso» y apunta al folio buscado', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await buscarFolio(usuario);

    const boton = screen.getByTestId('kardex-folio-imprimir');
    expect(boton).toBeInTheDocument();

    // Y ABRE la hoja de ESE movimiento: sin esto el botón podría existir apuntando a cualquier lado.
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    await usuario.click(boton);
    expect(abrir).toHaveBeenCalledWith(
      '/api/inventarios/pt/traspasos/200/impreso',
      '_blank',
      'noopener',
    );
    abrir.mockRestore();
  });

  it('un movimiento MANUAL no ofrece la hoja (no es un traspaso)', async () => {
    usePorFolioMock.mockReturnValue({
      data: movimiento({ origenTipo: 'movimiento-manual' }),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await buscarFolio(usuario);

    expect(screen.queryByTestId('kardex-folio-imprimir')).not.toBeInTheDocument();
    // Pero el detalle SÍ salió: lo que falta es el botón, no la pantalla.
    expect(screen.getByTestId('kardex-folio-detalle')).toBeInTheDocument();
  });

  it('⭐ un traspaso CANCELADO no se reimprime (su papel no vuelve a salir con un bulto)', async () => {
    usePorFolioMock.mockReturnValue({
      data: movimiento({ cancelado: true }),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await buscarFolio(usuario);

    expect(screen.queryByTestId('kardex-folio-imprimir')).not.toBeInTheDocument();
  });

  it('un movimiento con `origenTipo` NULL (migrado) tampoco la ofrece, y no truena', async () => {
    // REGLA 0-B: lo viejo se lee tal cual. `origenTipo` null no es un traspaso reconocible.
    usePorFolioMock.mockReturnValue({
      data: movimiento({ origenTipo: null }),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await buscarFolio(usuario);

    expect(screen.queryByTestId('kardex-folio-imprimir')).not.toBeInTheDocument();
    expect(screen.getByTestId('kardex-folio-detalle')).toBeInTheDocument();
  });

  it('la hoja se ofrece con SOLO `inventario-pt.ver` (leer y reimprimir no es mover)', async () => {
    // La reimpresión va con el permiso de VER, igual que la ruta del backend. Quien no puede mover
    // sigue pudiendo sacar el papel — y no ve el botón de cancelar.
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, {
      sesion: estadoSesionDePrueba(['inventario-pt.ver']),
    });
    await buscarFolio(usuario);

    expect(screen.getByTestId('kardex-folio-imprimir')).toBeInTheDocument();
    expect(screen.queryByTestId('kardex-folio-cancelar')).not.toBeInTheDocument();
  });
});
