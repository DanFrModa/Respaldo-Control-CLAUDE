import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Defecto, DefectosPagina as TipoPagina } from '@/api/tipos';
import { renderConProveedores, estadoSesionDePrueba } from '@/pruebas/utilidades';

import { DefectosPagina } from './DefectosPagina';

// Mock de la capa de datos (los tests no tocan la red).
vi.mock('@/api/calidad', () => ({
  useDefectos: () => defectosResult,
  useDesactivarDefecto: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivarDefecto: () => ({ mutate: vi.fn(), isPending: false }),
  useCrearDefecto: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarDefecto: () => ({ mutate: vi.fn(), isPending: false }),
  useTiposProductoActivos: () => ({
    data: { datos: [], total: 0, pagina: 1, totalPaginas: 0, porPagina: 100 },
    isPending: false,
  }),
}));

function crearDefecto(id: number, clave: string, activo = true): Defecto {
  return {
    id,
    clave,
    descripcion: `Descripción de ${clave}`,
    nivelAQL: 2.5,
    severidad: 'mayor',
    favorito: false,
    aplicaGeneral: true,
    categoria: null,
    pag: null,
    activo,
    tiposProducto: [],
    creadoEn: '2026-01-01T00:00:00Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00Z',
    modificadoPorId: null,
  };
}

function crearPagina(datos: Defecto[] = [crearDefecto(1, 'D-001')]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, totalPaginas: 1, porPagina: 10 };
}

let defectosResult: {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: null;
  refetch: () => void;
};

const sesionConPermisos = estadoSesionDePrueba(['calidad.ver', 'calidad.administrar-catalogo']);

beforeEach(() => {
  defectosResult = {
    data: crearPagina(),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
});

describe('DefectosPagina', () => {
  it('muestra el título del módulo', () => {
    renderConProveedores(<DefectosPagina />, { sesion: sesionConPermisos });
    expect(screen.getByText('Catálogo de defectos')).toBeDefined();
  });

  it('lista los defectos de la página', () => {
    defectosResult.data = crearPagina([crearDefecto(1, 'D-001'), crearDefecto(2, 'D-002')]);
    renderConProveedores(<DefectosPagina />, { sesion: sesionConPermisos });
    // getAllByText porque el ListaDetalle auto-selecciona el primero y muestra la clave
    // tanto en la fila como en el panel de detalle.
    expect(screen.getAllByText('D-001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('D-002').length).toBeGreaterThan(0);
  });

  it('muestra mensaje cuando no hay defectos', () => {
    defectosResult.data = crearPagina([]);
    renderConProveedores(<DefectosPagina />, { sesion: sesionConPermisos });
    expect(screen.getByText(/no hay defectos/i)).toBeDefined();
  });

  it('muestra los filtros de severidad, nivel AQL y favoritos', () => {
    renderConProveedores(<DefectosPagina />, { sesion: sesionConPermisos });
    expect(screen.getByTestId('filtro-severidad')).toBeDefined();
    expect(screen.getByTestId('filtro-nivel-aql')).toBeDefined();
    expect(screen.getByTestId('filtro-favoritos')).toBeDefined();
  });

  it('el botón Nuevo defecto abre el diálogo', async () => {
    const user = userEvent.setup();
    renderConProveedores(<DefectosPagina />, { sesion: sesionConPermisos });

    const boton = screen.getByTestId('nuevo-defecto');
    await user.click(boton);

    expect(screen.getByTestId('guardar-defecto')).toBeDefined();
  });

  it('sin permiso administrar-catalogo no muestra el botón Nuevo', () => {
    const sesionSolo = estadoSesionDePrueba(['calidad.ver']);
    renderConProveedores(<DefectosPagina />, { sesion: sesionSolo });
    expect(screen.queryByTestId('nuevo-defecto')).toBeNull();
  });
});
