import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EstadoLista, EstadosListaPagina as ELPagina } from '@/api/estados-lista';
import type { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EstadosListaPagina } from './EstadosListaPagina';

type EstadoConsulta = {
  data: ELPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useEstadosLista = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();

vi.mock('@/api/estados-lista', () => ({
  useEstadosLista: (query: Record<string, unknown>) => useEstadosLista(query),
  useCrearEstadoLista: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarEstadoLista: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarEstadoLista: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarEstadoLista: () => ({ mutate: reactivarMutate, isPending: false }),
}));

function estado(
  id: number,
  codigo: string,
  nombre: string,
  esCierre = false,
  activo = true,
): EstadoLista {
  return {
    id,
    codigo,
    nombre,
    orden: id,
    esCierre,
    activo,
    creadoEn: '2026-07-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function pagina(datos: EstadoLista[]): ELPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

function consultaConDatos(datos: EstadoLista[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<EstadosListaPagina>', () => {
  beforeEach(() => {
    useEstadosLista.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
  });

  it('lista los estados de lista que devuelve el API', () => {
    useEstadosLista.mockReturnValue(
      consultaConDatos([estado(1, 'abierta', 'Abierta'), estado(2, 'cerrada', 'Cerrada', true)]),
    );
    renderConProveedores(<EstadosListaPagina />, {
      sesion: estadoSesionDePrueba(['estado-lista.ver', 'estado-lista.administrar']),
    });

    expect(screen.getAllByTestId('fila-estado-lista')).toHaveLength(2);
    expect(screen.getAllByText('Abierta').length).toBeGreaterThan(0);
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useEstadosLista.mockReturnValue(consultaConDatos([estado(1, 'abierta', 'Abierta')]));
    renderConProveedores(<EstadosListaPagina />, {
      sesion: estadoSesionDePrueba(['estado-lista.ver']),
    });

    expect(screen.queryByTestId('nuevo-estado-lista')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-estado-lista')).not.toBeInTheDocument();
  });

  it('marca los estados de cierre en el detalle', () => {
    useEstadosLista.mockReturnValue(consultaConDatos([estado(2, 'cerrada', 'Cerrada', true)]));
    renderConProveedores(<EstadosListaPagina />, {
      sesion: estadoSesionDePrueba(['estado-lista.ver', 'estado-lista.administrar']),
    });

    const detalle = screen.getByTestId('detalle-estado-lista');
    expect(within(detalle).getByText('Sí (bloquea nuevas rondas/ediciones)')).toBeInTheDocument();
  });

  it('un admin puede marcar "es de cierre" al dar de alta', async () => {
    const usuario = userEvent.setup();
    useEstadosLista.mockReturnValue(consultaConDatos([estado(1, 'abierta', 'Abierta')]));
    renderConProveedores(<EstadosListaPagina />, {
      sesion: estadoSesionDePrueba(['estado-lista.ver', 'estado-lista.administrar']),
    });

    await usuario.click(screen.getByTestId('nuevo-estado-lista'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByTestId('el-es-cierre')).toBeInTheDocument();
    expect(within(dialogo).getByTestId('el-es-cierre')).not.toBeChecked();
  });
});
