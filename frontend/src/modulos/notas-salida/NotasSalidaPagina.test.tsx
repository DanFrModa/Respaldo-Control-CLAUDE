import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { NotasSalidaPagina } from './NotasSalidaPagina';
import { notaDePrueba } from './fixtures';

// ── Mocks de la capa de datos (sin red) ──────────────────────────────────────
const confirmarMutate = vi.fn();
const useNotasSalidaMock = vi.fn();

vi.mock('@/api/notas-salida', () => ({
  useNotasSalida: (q: unknown) => useNotasSalidaMock(q) as unknown,
  useConfirmarNota: () => ({ mutate: confirmarMutate, isPending: false }),
  imprimirNota: vi.fn(),
}));

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [{ id: 9, nombre: 'Costuras del Bajío' }] } }),
}));

// El detalle abre estos diálogos (montados solo al usarse): se simplifican.
vi.mock('./DialogoEditarNota', () => ({ DialogoEditarNota: () => null }));
vi.mock('./DialogoCancelarNota', () => ({ DialogoCancelarNota: () => null }));
vi.mock('./DialogoNotaTela', () => ({ DialogoNotaTela: () => null }));

function paginaConUna(estatus: ReturnType<typeof notaDePrueba>['estatus'] = 'borrador') {
  useNotasSalidaMock.mockReturnValue({
    data: {
      datos: [notaDePrueba({ estatus })],
      total: 1,
      pagina: 1,
      porPagina: 10,
      totalPaginas: 1,
    },
    isPending: false,
    isError: false,
    isFetching: false,
  });
}

describe('NotasSalidaPagina (F4-E5)', () => {
  beforeEach(() => {
    confirmarMutate.mockReset();
    useNotasSalidaMock.mockReset();
  });

  it('lista las notas y muestra su folio y maquilero', () => {
    paginaConUna();
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    expect(screen.getAllByText('Nota 77').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Costuras del Bajío').length).toBeGreaterThan(0);
  });

  it('muestra el estado VACÍO cuando no hay notas', () => {
    useNotasSalidaMock.mockReturnValue({
      data: { datos: [], total: 0, pagina: 1, porPagina: 10, totalPaginas: 0 },
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

  it('SIN notas.administrar oculta el botón "Nueva nota"', () => {
    paginaConUna();
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver']),
    });
    expect(screen.queryByTestId('nuevo-nota')).not.toBeInTheDocument();
  });

  it('el botón Confirmar SOLO aparece con notas.administrar y estatus borrador', () => {
    paginaConUna('borrador');
    const { unmount } = renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    const detalle = screen.getByTestId('detalle-nota');
    expect(within(detalle).getByTestId('confirmar-nota-accion')).toBeInTheDocument();
    unmount();

    // Una nota confirmada ya no ofrece Confirmar.
    paginaConUna('confirmada');
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    expect(screen.queryByTestId('confirmar-nota-accion')).not.toBeInTheDocument();
  });

  it('confirma una nota en borrador al pulsar Confirmar', () => {
    paginaConUna('borrador');
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    const detalle = screen.getByTestId('detalle-nota');
    within(detalle).getByTestId('confirmar-nota-accion').click();
    expect(confirmarMutate).toHaveBeenCalledWith(1, expect.anything());
  });

  it('una nota confirmada ofrece "Ver" (solo lectura), no "Editar"', () => {
    paginaConUna('confirmada');
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    const detalle = screen.getByTestId('detalle-nota');
    expect(within(detalle).queryByTestId('editar-nota')).not.toBeInTheDocument();
    expect(within(detalle).getByTestId('ver-nota')).toBeInTheDocument();
  });

  it('el botón Cancelar aparece con notas.cancelar y la nota no cancelada', () => {
    paginaConUna('confirmada');
    const { unmount } = renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar', 'notas.cancelar']),
    });
    expect(screen.getByTestId('cancelar-nota')).toBeInTheDocument();
    unmount();

    // Sin notas.cancelar, no aparece.
    paginaConUna('confirmada');
    renderConProveedores(<NotasSalidaPagina />, {
      sesion: estadoSesionDePrueba(['notas.ver', 'notas.administrar']),
    });
    expect(screen.queryByTestId('cancelar-nota')).not.toBeInTheDocument();
  });
});
