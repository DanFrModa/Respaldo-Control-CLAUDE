import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlanAql, PlanesAqlPagina as TipoPagina } from '@/api/tipos';
import { renderConProveedores, estadoSesionDePrueba } from '@/pruebas/utilidades';

import { PlanesAqlPagina } from './PlanesAqlPagina';

// Mock de la capa de datos: la pantalla y su diálogo usan estos hooks de Calidad.
vi.mock('@/api/calidad', () => ({
  usePlanesAql: () => planesResult,
  useDesactivarPlanAql: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivarPlanAql: () => ({ mutate: vi.fn(), isPending: false }),
  useCrearPlanAql: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarPlanAql: () => ({ mutate: vi.fn(), isPending: false }),
  // El preview en vivo: sin lote+nivel no resuelve (data undefined).
  useResolverPlan: () => ({ data: undefined, isFetching: false, isError: false, error: null }),
}));

function crearPlan(id: number, nombre: string, activo = true): PlanAql {
  return {
    id,
    nombre,
    activo,
    renglones: [
      {
        id: 1,
        loteMin: 281,
        loteMax: 500,
        tamanoMuestra: 50,
        limites: [{ nivelAQL: 2.5, aceptar: 3, rechazar: 4 }],
      },
    ],
    creadoEn: '2026-01-01T00:00:00Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00Z',
    modificadoPorId: null,
  };
}

function crearPagina(datos: PlanAql[] = [crearPlan(1, 'Plan ISO II')]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, totalPaginas: 1, porPagina: 10 };
}

let planesResult: {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: null;
  refetch: () => void;
};

const sesionConPermisos = estadoSesionDePrueba(['calidad.ver', 'calidad.administrar-catalogo']);

beforeEach(() => {
  planesResult = {
    data: crearPagina(),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
});

describe('PlanesAqlPagina', () => {
  it('muestra el título y lista los planes con su tabla de renglones', () => {
    renderConProveedores(<PlanesAqlPagina />, { sesion: sesionConPermisos });
    expect(screen.getByText('Planes AQL')).toBeDefined();
    expect(screen.getAllByText('Plan ISO II').length).toBeGreaterThan(0);
    // El detalle del plan muestra el límite Ac/Re del renglón.
    expect(screen.getByText(/AQL 2\.5: 3\/4/)).toBeDefined();
  });

  it('muestra mensaje cuando no hay planes', () => {
    planesResult.data = crearPagina([]);
    renderConProveedores(<PlanesAqlPagina />, { sesion: sesionConPermisos });
    expect(screen.getByText(/no hay planes/i)).toBeDefined();
  });

  it('sin permiso administrar-catalogo no muestra el botón Nuevo', () => {
    const sesionSolo = estadoSesionDePrueba(['calidad.ver']);
    renderConProveedores(<PlanesAqlPagina />, { sesion: sesionSolo });
    expect(screen.queryByTestId('nuevo-plan-aql')).toBeNull();
  });
});
