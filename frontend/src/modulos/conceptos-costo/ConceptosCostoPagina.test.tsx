import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConceptoCosto, ConceptosCostoPagina as CCPagina } from '@/api/conceptos-costo';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ConceptosCostoPagina } from './ConceptosCostoPagina';

type EstadoConsulta = {
  data: CCPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useConceptosCosto = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();

vi.mock('@/api/conceptos-costo', () => ({
  useConceptosCosto: (query: Record<string, unknown>) => useConceptosCosto(query),
  useCrearConceptoCosto: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarConceptoCosto: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarConceptoCosto: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarConceptoCosto: () => ({ mutate: reactivarMutate, isPending: false }),
}));

function concepto(
  id: number,
  codigo: string,
  nombre: string,
  fijo = false,
  activo = true,
): ConceptoCosto {
  return {
    id,
    codigo,
    nombre,
    orden: id,
    fijo,
    activo,
    creadoEn: '2026-07-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function pagina(datos: ConceptoCosto[]): CCPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

function consultaConDatos(datos: ConceptoCosto[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<ConceptosCostoPagina>', () => {
  beforeEach(() => {
    useConceptosCosto.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
  });

  it('lista los conceptos de costo que devuelve el API', () => {
    useConceptosCosto.mockReturnValue(
      consultaConDatos([concepto(1, 'tela', 'Tela', true), concepto(2, 'flete', 'Flete')]),
    );
    renderConProveedores(<ConceptosCostoPagina />, {
      sesion: estadoSesionDePrueba(['concepto-costo.ver', 'concepto-costo.administrar']),
    });

    expect(screen.getAllByTestId('fila-concepto-costo')).toHaveLength(2);
    expect(screen.getAllByText('Tela').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Flete').length).toBeGreaterThan(0);
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useConceptosCosto.mockReturnValue(consultaConDatos([concepto(1, 'flete', 'Flete')]));
    renderConProveedores(<ConceptosCostoPagina />, {
      sesion: estadoSesionDePrueba(['concepto-costo.ver']),
    });

    expect(screen.queryByTestId('nuevo-concepto-costo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-concepto-costo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-concepto-costo')).not.toBeInTheDocument();
  });

  it('un concepto FIJO no se puede desactivar: el botón se muestra deshabilitado', () => {
    // Tabla-first (R9): las acciones van inline en el renglón del concepto.
    useConceptosCosto.mockReturnValue(consultaConDatos([concepto(1, 'tela', 'Tela', true)]));
    renderConProveedores(<ConceptosCostoPagina />, {
      sesion: estadoSesionDePrueba(['concepto-costo.ver', 'concepto-costo.administrar']),
    });

    const fila = screen.getByTestId('fila-concepto-costo');
    expect(within(fila).getByTestId('desactivar-concepto-costo')).toBeDisabled();
    // Editar sí está disponible (se puede renombrar/reordenar un fijo).
    expect(within(fila).getByTestId('editar-concepto-costo')).toBeEnabled();
  });

  it('un concepto ABIERTO sí ofrece Desactivar habilitado', () => {
    useConceptosCosto.mockReturnValue(consultaConDatos([concepto(3, 'flete', 'Flete', false)]));
    renderConProveedores(<ConceptosCostoPagina />, {
      sesion: estadoSesionDePrueba(['concepto-costo.ver', 'concepto-costo.administrar']),
    });

    const fila = screen.getByTestId('fila-concepto-costo');
    expect(within(fila).getByTestId('desactivar-concepto-costo')).toBeEnabled();
  });

  it('muestra el estado de error con reintentar', () => {
    useConceptosCosto.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'PERMISO', mensaje: 'No tienes acceso.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<ConceptosCostoPagina />, {
      sesion: estadoSesionDePrueba(['concepto-costo.ver']),
    });
    expect(screen.getByText('No tienes acceso.')).toBeInTheDocument();
  });
});
