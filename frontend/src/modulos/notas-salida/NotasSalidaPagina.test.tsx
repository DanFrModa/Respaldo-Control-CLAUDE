import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { NotasSalidaPagina } from './NotasSalidaPagina';
import { notaDePrueba, renglonMigradoDePrueba } from './fixtures';

// ── Mocks de la capa de datos (sin red) ──────────────────────────────────────
const confirmarMutate = vi.fn();
const useNotasSalidaMock = vi.fn();
const useResumenNotasMock = vi.fn();

vi.mock('@/api/notas-salida', () => ({
  useNotasSalida: (q: unknown) => useNotasSalidaMock(q) as unknown,
  useResumenNotas: (q: unknown) => useResumenNotasMock(q) as unknown,
  useConfirmarNota: () => ({ mutate: confirmarMutate, isPending: false }),
  imprimirNota: vi.fn(),
}));

// V1-E7g: el filtro de proveedor/maquilero es el `SelectorProveedor` (combobox con búsqueda en
// SERVIDOR), que consulta por `useProveedoresPorRol`. El mock filtra por «contiene», igual que el
// servidor (`idsPorNombreSinAcentos` hace `LIKE %texto%`).
vi.mock('@/api/proveedores', () => ({
  COD_ROL_PROVEEDOR: { corte: 'corte' },
  useProveedoresPorRol: (_rol: string | undefined, filtros?: { busqueda?: string }) => {
    const todos = [{ id: 9, nombre: 'Costuras del Bajío' }];
    const busqueda = (filtros?.busqueda ?? '').toLowerCase();
    return {
      data: {
        datos:
          busqueda === '' ? todos : todos.filter((p) => p.nombre.toLowerCase().includes(busqueda)),
      },
      isPending: false,
    };
  },
}));

// La columna "Empresa" resuelve el nombre con el catálogo (lookup de presentación).
vi.mock('@/api/empresas', () => ({
  useEmpresas: () => ({ data: [{ id: 1, nombre: 'FR Moda', identificador: 'FR' }] }),
}));

// El detalle abre estos diálogos (montados solo al usarse): se simplifican.
vi.mock('./DialogoEditarNota', () => ({ DialogoEditarNota: () => null }));
vi.mock('./DialogoCancelarNota', () => ({ DialogoCancelarNota: () => null }));

function paginaConUna(estatus: ReturnType<typeof notaDePrueba>['estatus'] = 'borrador') {
  useNotasSalidaMock.mockReturnValue({
    data: {
      datos: [notaDePrueba({ estatus })],
      total: 1,
      pagina: 1,
      porPagina: 20,
      totalPaginas: 1,
    },
    isPending: false,
    isError: false,
    isFetching: false,
  });
}

/** Abre el cajón de detalle de la única nota (la tabla es "clic en la fila"; el cajón monta en portal). */
async function abrirDetalle(): Promise<HTMLElement> {
  fireEvent.click(screen.getByTestId('nota-fila'));
  return await screen.findByTestId('detalle-nota');
}

describe('NotasSalidaPagina (F4-E5, re-vestida R9)', () => {
  beforeEach(() => {
    confirmarMutate.mockReset();
    useNotasSalidaMock.mockReset();
    useResumenNotasMock.mockReset();
    // Resumen de cabecera por defecto (los tests de KPIs lo sobreescriben).
    useResumenNotasMock.mockReturnValue({
      data: { notas: 0, borradores: 0, confirmadas: 0, ordenesSurtidas: 0 },
      isPending: false,
      isError: false,
    });
  });

  it('pinta los KPIs del resumen de cabecera (agregado en servidor, sin pivote en cliente)', () => {
    paginaConUna();
    useResumenNotasMock.mockReturnValue({
      data: { notas: 12, borradores: 3, confirmadas: 8, ordenesSurtidas: 5 },
      isPending: false,
      isError: false,
    });
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver']),
    });
    expect(within(screen.getByTestId('kpi-notas')).getByText('12')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-borradores')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-confirmadas')).getByText('8')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-ordenes-surtidas')).getByText('5')).toBeInTheDocument();
  });

  it('el resumen viaja con el MISMO universo del listado (maquilero), sin estatus', async () => {
    paginaConUna();
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver']),
    });
    // V1-E7g: el filtro ya no es un `<select>` sino el combobox con búsqueda en servidor. Se
    // teclea «bajío», que está EN MEDIO de «Costuras del Bajío» —lo que el `<select>` nativo no
    // podía encontrar— y se elige del popover (que vive en un PORTAL y elige en `mousedown`).
    fireEvent.focus(screen.getByTestId('filtro-maquilero-nota-busqueda'));
    fireEvent.change(screen.getByTestId('filtro-maquilero-nota-busqueda'), {
      target: { value: 'bajío' },
    });
    const opciones = await screen.findAllByTestId('filtro-maquilero-nota-opcion');
    expect(opciones.map((o) => o.textContent)).toEqual(['Costuras del Bajío']);
    fireEvent.mouseDown(opciones[0] as HTMLElement);
    expect(useResumenNotasMock).toHaveBeenLastCalledWith({ idMaquilero: 9 });
  });

  it('lista las notas y muestra su folio, maquilero y empresa', () => {
    paginaConUna();
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    expect(screen.getAllByText('Nota 77').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Costuras del Bajío').length).toBeGreaterThan(0);
    expect(screen.getAllByText('FR Moda').length).toBeGreaterThan(0);
  });

  it('muestra el estado VACÍO cuando no hay notas', () => {
    useNotasSalidaMock.mockReturnValue({
      data: { datos: [], total: 0, pagina: 1, porPagina: 20, totalPaginas: 0 },
      isPending: false,
      isError: false,
      isFetching: false,
    });
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver']),
    });
    expect(
      screen.getByText('No hay notas de salida que coincidan con la búsqueda.'),
    ).toBeInTheDocument();
  });

  it('muestra el estado de ERROR con el mensaje del backend', () => {
    useNotasSalidaMock.mockReturnValue({
      isPending: false,
      isError: true,
      error: { message: 'Falló la consulta' },
      isFetching: false,
    });
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver']),
    });
    expect(screen.getByText('Falló la consulta')).toBeInTheDocument();
  });

  it('SIN notas.administrar oculta el botón "Nueva nota de avíos"', () => {
    paginaConUna();
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver']),
    });
    expect(screen.queryByTestId('nuevo-nota')).not.toBeInTheDocument();
  });

  /**
   * La salida de TELA ya no se captura aquí: el diálogo que vivía en esta pantalla hablaba con el
   * motor LEGADO por lote (selector vacío) y decía «nota de tela registrada» sin crear ninguna
   * nota. Queda un ENLACE a la pantalla que sí opera, por color.
   */
  it('la salida de TELA es un ENLACE a la pantalla por color, no un diálogo', () => {
    paginaConUna();
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar', 'inventario-telas.mover']),
    });
    expect(screen.queryByTestId('nueva-nota-tela')).not.toBeInTheDocument();
    expect(screen.getByTestId('ir-salida-tela')).toHaveAttribute(
      'href',
      '/inventarios/telas/salida-orden',
    );
    // El botón que queda dice claramente que es de AVÍOS (no quedan dos botones ambiguos).
    expect(screen.getByTestId('nuevo-nota')).toHaveTextContent('Nueva nota de avíos');
  });

  it('SIN inventario-telas.mover no se ofrece el enlace de salida de tela (A4)', () => {
    paginaConUna();
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    expect(screen.queryByTestId('ir-salida-tela')).not.toBeInTheDocument();
  });

  it('el botón Confirmar SOLO aparece con notas.administrar y estatus borrador', async () => {
    paginaConUna('borrador');
    const { unmount } = renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    let detalle = await abrirDetalle();
    expect(within(detalle).getByTestId('confirmar-nota-accion')).toBeInTheDocument();
    unmount();

    // Una nota confirmada ya no ofrece Confirmar.
    paginaConUna('confirmada');
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    detalle = await abrirDetalle();
    expect(within(detalle).queryByTestId('confirmar-nota-accion')).not.toBeInTheDocument();
  });

  it('confirma una nota en borrador al pulsar Confirmar', async () => {
    paginaConUna('borrador');
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    const detalle = await abrirDetalle();
    fireEvent.click(within(detalle).getByTestId('confirmar-nota-accion'));
    expect(confirmarMutate).toHaveBeenCalledWith(1, expect.anything());
  });

  it('una nota confirmada NO ofrece Editar (solo Imprimir/Cancelar)', async () => {
    paginaConUna('confirmada');
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    const detalle = await abrirDetalle();
    expect(within(detalle).queryByTestId('editar-nota')).not.toBeInTheDocument();
    expect(within(detalle).getByTestId('imprimir-nota')).toBeInTheDocument();
  });

  it('el botón Cancelar aparece con notas.cancelar y la nota no cancelada', async () => {
    paginaConUna('confirmada');
    const { unmount } = renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar', 'notas.cancelar']),
    });
    let detalle = await abrirDetalle();
    expect(within(detalle).getByTestId('cancelar-nota')).toBeInTheDocument();
    unmount();

    // Sin notas.cancelar, no aparece.
    paginaConUna('confirmada');
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    detalle = await abrirDetalle();
    expect(within(detalle).queryByTestId('cancelar-nota')).not.toBeInTheDocument();
  });

  // §Post-F9.38 / V1-E3b — el renglón MIGRADO del sistema anterior: antes salía etiquetado "Tela"
  // con el material EN BLANCO (parecía que la migración había perdido el dato).
  it('el renglón MIGRADO muestra su texto libre y dice que no tiene movimiento de inventario', async () => {
    const nota = notaDePrueba({ estatus: 'confirmada', lineas: [renglonMigradoDePrueba()] });
    useNotasSalidaMock.mockReturnValue({
      data: { datos: [nota], total: 1, pagina: 1, porPagina: 20, totalPaginas: 1 },
      isPending: false,
      isError: false,
      isFetching: false,
    });
    renderConProveedores(<NotasSalidaPagina />, { sesion: estadoSesionDePrueba(['notas.ver']) });

    const detalle = await abrirDetalle();
    const renglon = within(detalle).getByTestId('nota-renglon');
    expect(renglon).toHaveTextContent('3 conos hilo negro y etiquetas');
    expect(renglon).toHaveTextContent('Migrado del sistema anterior');
    // La cantidad 0 del viejo NO se pinta como "0" (no se envió cero: no había desglose).
    expect(renglon).not.toHaveTextContent(/\b0\b/);
  });
});
