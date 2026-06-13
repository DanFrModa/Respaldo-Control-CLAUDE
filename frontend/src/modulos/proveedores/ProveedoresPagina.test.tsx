import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Proveedor, ProveedoresPagina as TipoPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ProveedoresPagina } from './ProveedoresPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `useProveedores`
// captura la query con la que se le llama, para verificar el filtro por tipo.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useProveedores = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;
vi.mock('@/api/proveedores', () => ({
  useProveedores: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useProveedores(query);
  },
  useCrearProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarProveedor: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarProveedor: () => ({ mutate: reactivarMutate, isPending: false }),
}));

/** Proveedor de ejemplo. */
function proveedor(id: number, nombre: string, activo = true): Proveedor {
  return {
    id,
    nombre,
    razonSocial: null,
    tipo: 'TELAS',
    telefono: null,
    contacto: null,
    condiciones: null,
    activo,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Respuesta paginada de ejemplo con los proveedores dados. */
function pagina(datos: Proveedor[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos" (forma minima que usa el componente). */
function consultaConDatos(datos: Proveedor[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<ProveedoresPagina>', () => {
  beforeEach(() => {
    useProveedores.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
    ultimaQuery = undefined;
  });

  it('lista los proveedores que devuelve el API', () => {
    useProveedores.mockReturnValue(
      consultaConDatos([proveedor(1, 'Telas del Norte'), proveedor(2, 'Avíos SA')]),
    );
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    // Hay dos renglones; el primero queda auto-seleccionado (aparece tambien en
    // el detalle), por eso su nombre se busca con getAllByText.
    expect(screen.getAllByTestId('fila-proveedor')).toHaveLength(2);
    expect(screen.getAllByText('Telas del Norte').length).toBeGreaterThan(0);
    expect(screen.getByText('Avíos SA')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useProveedores.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    expect(
      screen.getByText('No hay proveedores que coincidan con la búsqueda.'),
    ).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un boton de reintento cuando la consulta falla', () => {
    useProveedores.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useProveedores.mockReturnValue(consultaConDatos([proveedor(1, 'Telas del Norte')]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });

    // Ni el boton "Nuevo", ni las acciones del detalle (editar/desactivar).
    expect(screen.queryByTestId('nuevo-proveedor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-proveedor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-proveedor')).not.toBeInTheDocument();
  });

  it('pide confirmacion antes de desactivar y llama a la mutacion al confirmar', async () => {
    const usuario = userEvent.setup();
    useProveedores.mockReturnValue(consultaConDatos([proveedor(7, 'Telas Viejas')]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    // El registro queda auto-seleccionado: "Desactivar" es un boton directo del detalle.
    await usuario.click(screen.getByTestId('desactivar-proveedor'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar proveedor')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('un proveedor inactivo ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useProveedores.mockReturnValue(consultaConDatos([proveedor(9, 'Proveedor Apagado', false)]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    // El detalle del registro inactivo muestra su estado y ofrece "Activar".
    const detalle = screen.getByTestId('detalle-proveedor');
    expect(within(detalle).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByTestId('activar-proveedor')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-proveedor')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-proveedor'));
    // Reactivar es no destructivo: NO abre diálogo de confirmación.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  it('el filtro por tipo se refleja en la consulta del API', async () => {
    const usuario = userEvent.setup();
    useProveedores.mockReturnValue(consultaConDatos([proveedor(1, 'Telas del Norte')]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });

    // Sin filtro, la query no lleva `tipo` (todos los tipos).
    expect(ultimaQuery?.tipo).toBeUndefined();

    await usuario.selectOptions(screen.getByTestId('filtro-tipo-proveedor'), 'AVIOS');

    // Tras elegir un tipo, la siguiente consulta lo incluye.
    expect(ultimaQuery?.tipo).toBe('AVIOS');
  });
});
