import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Maquilero, MaquilerosPagina as TipoPagina, TipoProceso } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { MaquilerosPagina } from './MaquilerosPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `useMaquileros` captura la
// query con la que se le llama, para verificar el filtro por tipo de proceso.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useMaquileros = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;

/** Tipos de proceso de ejemplo para el catalogo del selector/filtro. */
const TIPOS_EJEMPLO: TipoProceso[] = [
  { id: 1, codigo: 'costura', nombre: 'Costura', activo: true },
  { id: 2, codigo: 'estampado', nombre: 'Estampado', activo: true },
];

vi.mock('@/api/maquileros', () => ({
  useMaquileros: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useMaquileros(query);
  },
  useCrearMaquilero: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarMaquilero: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarMaquilero: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarMaquilero: () => ({ mutate: reactivarMutate, isPending: false }),
  useTiposProceso: () => ({
    data: TIPOS_EJEMPLO,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

/** Maquilero de ejemplo (campos opcionales vacios por defecto). El `nombre` se hace
 * distinto del `corto` para que el titulo de la lista (corto) sea inequivoco en los
 * asserts (la linea secundaria muestra el nombre completo). */
function maquilero(id: number, corto: string, activo = true): Maquilero {
  return {
    id,
    corto,
    nombre: `${corto} Taller`,
    apellidos: null,
    telefonos: null,
    direccion: null,
    observaciones: null,
    obsPago: null,
    asegurado: false,
    tipos: [{ id: 1, codigo: 'costura', nombre: 'Costura' }],
    activo,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Respuesta paginada de ejemplo con los maquileros dados. */
function pagina(datos: Maquilero[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos" (forma minima que usa el componente). */
function consultaConDatos(datos: Maquilero[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<MaquilerosPagina>', () => {
  beforeEach(() => {
    useMaquileros.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
    ultimaQuery = undefined;
  });

  it('lista los maquileros que devuelve el API', () => {
    useMaquileros.mockReturnValue(
      consultaConDatos([maquilero(1, 'Intersew'), maquilero(2, 'Karil')]),
    );
    renderConProveedores(<MaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['maquileros.ver', 'maquileros.administrar']),
    });

    // Hay dos renglones; el primero queda auto-seleccionado (aparece tambien en el
    // detalle), por eso su corto se busca con getAllByText.
    expect(screen.getAllByTestId('fila-maquilero')).toHaveLength(2);
    expect(screen.getAllByText('Intersew').length).toBeGreaterThan(0);
    expect(screen.getByText('Karil')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useMaquileros.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<MaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['maquileros.ver', 'maquileros.administrar']),
    });

    expect(
      screen.getByText('No hay maquileros que coincidan con la búsqueda.'),
    ).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un boton de reintento cuando la consulta falla', () => {
    useMaquileros.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<MaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['maquileros.ver', 'maquileros.administrar']),
    });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useMaquileros.mockReturnValue(consultaConDatos([maquilero(1, 'Intersew')]));
    renderConProveedores(<MaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['maquileros.ver']),
    });

    // Ni el boton "Nuevo", ni las acciones del detalle (editar/desactivar).
    expect(screen.queryByTestId('nuevo-maquilero')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-maquilero')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-maquilero')).not.toBeInTheDocument();
  });

  it('pide confirmacion antes de desactivar y llama a la mutacion al confirmar', async () => {
    const usuario = userEvent.setup();
    useMaquileros.mockReturnValue(consultaConDatos([maquilero(7, 'Viejo')]));
    renderConProveedores(<MaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['maquileros.ver', 'maquileros.administrar']),
    });

    // El registro queda auto-seleccionado: "Desactivar" es un boton directo del detalle.
    await usuario.click(screen.getByTestId('desactivar-maquilero'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar maquilero')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('un maquilero inactivo ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useMaquileros.mockReturnValue(consultaConDatos([maquilero(9, 'Apagado', false)]));
    renderConProveedores(<MaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['maquileros.ver', 'maquileros.administrar']),
    });

    // El detalle del registro inactivo muestra su estado y ofrece "Activar".
    const detalle = screen.getByTestId('detalle-maquilero');
    expect(within(detalle).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByTestId('activar-maquilero')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-maquilero')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-maquilero'));
    // Reactivar es no destructivo: NO abre diálogo de confirmación.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  it('el filtro por tipo de proceso se refleja en la consulta del API (como id numérico)', async () => {
    const usuario = userEvent.setup();
    useMaquileros.mockReturnValue(consultaConDatos([maquilero(1, 'Intersew')]));
    renderConProveedores(<MaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['maquileros.ver']),
    });

    // Sin filtro, la query no lleva `tipoProceso` (todos los procesos).
    expect(ultimaQuery?.tipoProceso).toBeUndefined();

    // El selector ofrece los tipos del catálogo; al elegir uno, la query lo manda como
    // número (no como texto del `<select>`).
    await usuario.selectOptions(screen.getByTestId('filtro-tipo-proceso'), '2');
    expect(ultimaQuery?.tipoProceso).toBe(2);
  });

  it('muestra las capacidades (tipos) del maquilero como chips en el detalle', () => {
    const conTipos = maquilero(3, 'Multi');
    conTipos.tipos = [
      { id: 1, codigo: 'costura', nombre: 'Costura' },
      { id: 2, codigo: 'estampado', nombre: 'Estampado' },
    ];
    useMaquileros.mockReturnValue(consultaConDatos([conTipos]));
    renderConProveedores(<MaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['maquileros.ver']),
    });

    const chips = screen.getByTestId('tipos-maquilero-detalle');
    expect(within(chips).getByText('Costura')).toBeInTheDocument();
    expect(within(chips).getByText('Estampado')).toBeInTheDocument();
  });

  it('muestra las observaciones en el detalle solo si existen', () => {
    const conObs = maquilero(5, 'ConObs');
    conObs.observaciones = 'Buena calidad';
    conObs.obsPago = 'Pago semanal';
    useMaquileros.mockReturnValue(consultaConDatos([conObs]));
    renderConProveedores(<MaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['maquileros.ver']),
    });

    const detalle = screen.getByTestId('detalle-maquilero');
    // La sección "Observaciones" es un encabezado (hay además un campo homónimo dentro).
    expect(within(detalle).getByRole('heading', { name: 'Observaciones' })).toBeInTheDocument();
    expect(within(detalle).getByText('Buena calidad')).toBeInTheDocument();
    expect(within(detalle).getByText('Pago semanal')).toBeInTheDocument();
  });

  it('no muestra la sección de observaciones si el maquilero no tiene ninguna', () => {
    // maquilero() crea observaciones/obsPago en null -> sin sección extra.
    useMaquileros.mockReturnValue(consultaConDatos([maquilero(6, 'Pelón')]));
    renderConProveedores(<MaquilerosPagina />, {
      sesion: estadoSesionDePrueba(['maquileros.ver']),
    });

    const detalle = screen.getByTestId('detalle-maquilero');
    // La sección General siempre está; la de Observaciones (sin datos) no.
    expect(within(detalle).getByText('Datos del maquilero')).toBeInTheDocument();
    expect(within(detalle).queryByText('Observaciones')).not.toBeInTheDocument();
  });
});
