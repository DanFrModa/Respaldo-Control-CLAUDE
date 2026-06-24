import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProcesoRc, ProcesosRcPagina as ProcPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ProcesosPagina } from './ProcesosPagina';

type EstadoConsulta = {
  data: ProcPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useProcesosRc = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
vi.mock('@/api/ruta-critica', () => ({
  useProcesosRc: (query: Record<string, unknown>) => useProcesosRc(query),
  useCrearProcesoRc: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarProcesoRc: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarProcesoRc: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarProcesoRc: () => ({ mutate: reactivarMutate, isPending: false }),
  useFijarRolesProcesoRc: () => ({ mutate: vi.fn(), isPending: false }),
  useFijarChecklistProcesoRc: () => ({ mutate: vi.fn(), isPending: false }),
}));
// El editor de roles lista los roles del RBAC; en estos tests no importan los datos reales.
vi.mock('@/api/roles', () => ({
  useRoles: () => ({ data: [], isPending: false, isError: false, error: null }),
}));

function proceso(
  id: number,
  codigo: string,
  nombre: string,
  extra: Partial<ProcesoRc> = {},
): ProcesoRc {
  return {
    id,
    codigo,
    nombre,
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    activo: true,
    roles: [],
    antecesores: [],
    checklist: [],
    creadoEn: '2026-06-22T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-06-22T00:00:00.000Z',
    modificadoPorId: null,
    ...extra,
  };
}

function pagina(datos: ProcesoRc[]): ProcPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

function consultaConDatos(datos: ProcesoRc[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<ProcesosPagina>', () => {
  beforeEach(() => {
    useProcesosRc.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
  });

  it('lista los procesos que devuelve el API', () => {
    useProcesosRc.mockReturnValue(
      consultaConDatos([proceso(1, 'corte', 'Corte'), proceso(2, 'empaque', 'Empaque')]),
    );
    renderConProveedores(<ProcesosPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver', 'rc.catalogo-administrar']),
    });

    const filas = screen.getAllByTestId('fila-proceso-rc');
    expect(filas).toHaveLength(2);
    expect(screen.getAllByText('Corte').length).toBeGreaterThan(0);
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useProcesosRc.mockReturnValue(consultaConDatos([proceso(1, 'corte', 'Corte')]));
    renderConProveedores(<ProcesosPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver']),
    });

    expect(screen.queryByTestId('nuevo-proceso-rc')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-proceso-rc')).not.toBeInTheDocument();
  });

  it('muestra el estado vacío y el de error', () => {
    useProcesosRc.mockReturnValue(consultaConDatos([]));
    const { unmount } = renderConProveedores(<ProcesosPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver']),
    });
    expect(screen.getByText('No hay procesos que coincidan con la búsqueda.')).toBeInTheDocument();
    unmount();

    useProcesosRc.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<ProcesosPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver']),
    });
    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('el diálogo de alta permite capturar 2 roles vía el detalle (banderas y tipos en el alta)', async () => {
    const usuario = userEvent.setup();
    useProcesosRc.mockReturnValue(consultaConDatos([proceso(1, 'corte', 'Corte')]));
    renderConProveedores(<ProcesosPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver', 'rc.catalogo-administrar']),
    });

    await usuario.click(screen.getByTestId('nuevo-proceso-rc'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByLabelText('Código')).toBeInTheDocument();
    expect(within(dialogo).getByTestId('proc-critico')).toBeInTheDocument();
  });

  it('pide confirmación antes de desactivar y llama a la mutación al confirmar', async () => {
    const usuario = userEvent.setup();
    useProcesosRc.mockReturnValue(consultaConDatos([proceso(7, 'empaque', 'Empaque')]));
    renderConProveedores(<ProcesosPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver', 'rc.catalogo-administrar']),
    });

    await usuario.click(screen.getByTestId('desactivar-proceso-rc'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar proceso')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });
});
