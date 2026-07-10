import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Avio, AviosPagina as TipoPagina } from '@/api/avios';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { AviosPagina } from './AviosPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `useAvios` captura la query
// con la que se le llama, para verificar el filtro por género.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useAvios = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;

vi.mock('@/api/avios', () => ({
  useAvios: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useAvios(query);
  },
  useCrearAvio: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarAvio: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarAvio: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarAvio: () => ({ mutate: reactivarMutate, isPending: false }),
}));

// El diálogo usa el catálogo de proveedores; lo simulamos vacío (no se abre en estos tests).
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({
    data: { datos: [], total: 0, pagina: 1, porPagina: 100, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

// El renglón expandido embebe MedidasAvio (su propia query): se simula sin medidas. El objeto `data`
// es ESTABLE (misma referencia entre renders), igual que TanStack Query en la app real — un objeto
// nuevo por render dispararía el `useEffect([consulta.data])` de MedidasAvio en bucle (OOM).
vi.mock('@/api/medidas-avio', () => {
  const datosMedidas = { datos: [], promedioPreCosto: null };
  return {
    useMedidasAvio: () => ({
      data: datosMedidas,
      isPending: false,
      isError: false,
      error: null,
    }),
    useGuardarMedidasAvio: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

/** Avío de ejemplo (campos opcionales en null/sin proveedores por defecto). */
function avio(id: number, clave: string, activo = true): Avio {
  return {
    id,
    clave,
    descripcion: `${clave} descripción`,
    unidad: 'pza',
    presentacion: 'CAJA',
    favorito: false,
    cantFav: null,
    esGenerico: false,
    precioReferencia: null,
    proveedores: [],
    activo,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Respuesta paginada de ejemplo con los avíos dados. */
function pagina(datos: Avio[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos" (forma mínima que usa el componente). */
function consultaConDatos(datos: Avio[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<AviosPagina>', () => {
  beforeEach(() => {
    useAvios.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
    ultimaQuery = undefined;
  });

  it('lista los avíos que devuelve el API (tabla densa)', () => {
    useAvios.mockReturnValue(consultaConDatos([avio(1, 'BTN-01'), avio(2, 'HIL-09')]));
    renderConProveedores(<AviosPagina />, {
      sesion: estadoSesionDePrueba(['avios.ver', 'avios.administrar']),
    });

    // Un renglón por avío (colapsados por defecto, R9: filas expandibles).
    expect(screen.getAllByTestId('fila-avio')).toHaveLength(2);
    expect(screen.getAllByText('BTN-01').length).toBeGreaterThan(0);
    expect(screen.getByText('HIL-09')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay resultados', () => {
    useAvios.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<AviosPagina />, {
      sesion: estadoSesionDePrueba(['avios.ver', 'avios.administrar']),
    });

    expect(screen.getByText('No hay avíos que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un botón de reintento cuando la consulta falla', () => {
    useAvios.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<AviosPagina />, {
      sesion: estadoSesionDePrueba(['avios.ver', 'avios.administrar']),
    });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useAvios.mockReturnValue(consultaConDatos([avio(1, 'BTN-01')]));
    renderConProveedores(<AviosPagina />, {
      sesion: estadoSesionDePrueba(['avios.ver']),
    });

    // "Nuevo avío" no aparece; editar/desactivar solo viven en el renglón expandido y son admin.
    expect(screen.queryByTestId('nuevo-avio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('fila-avio'));
    expect(screen.queryByTestId('editar-avio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-avio')).not.toBeInTheDocument();
  });

  it('pide confirmación antes de desactivar y llama a la mutación al confirmar', async () => {
    const usuario = userEvent.setup();
    useAvios.mockReturnValue(consultaConDatos([avio(7, 'VIEJO')]));
    renderConProveedores(<AviosPagina />, {
      sesion: estadoSesionDePrueba(['avios.ver', 'avios.administrar']),
    });

    // El detalle (con las acciones) se abre al expandir el renglón (tabla-first, R9).
    await usuario.click(screen.getByTestId('fila-avio'));
    await usuario.click(screen.getByTestId('desactivar-avio'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar avío')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('un avío inactivo ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useAvios.mockReturnValue(consultaConDatos([avio(9, 'APAGADO', false)]));
    renderConProveedores(<AviosPagina />, {
      sesion: estadoSesionDePrueba(['avios.ver', 'avios.administrar']),
    });

    // El estado "Inactivo" se ve en el propio renglón; las acciones, al expandir.
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('fila-avio'));
    expect(screen.getByTestId('activar-avio')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-avio')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-avio'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  it('el filtro por género se refleja en la consulta del API (esGenerico)', async () => {
    const usuario = userEvent.setup();
    useAvios.mockReturnValue(consultaConDatos([avio(1, 'BTN-01')]));
    renderConProveedores(<AviosPagina />, {
      sesion: estadoSesionDePrueba(['avios.ver']),
    });

    // Sin filtro, la query no lleva `esGenerico`.
    expect(ultimaQuery?.esGenerico).toBeUndefined();

    // Los filtros son CHIPS excluyentes (proto `.chip`), ya no un select.
    await usuario.click(screen.getByTestId('filtro-genero-generico'));
    expect(ultimaQuery?.esGenerico).toBe('true');

    await usuario.click(screen.getByTestId('filtro-genero-normal'));
    expect(ultimaQuery?.esGenerico).toBe('false');

    await usuario.click(screen.getByTestId('filtro-genero-todos'));
    expect(ultimaQuery?.esGenerico).toBeUndefined();
  });

  it('distingue los avíos genéricos con un chip en el renglón', () => {
    const generico = avio(3, 'GEN-1');
    generico.esGenerico = true;
    useAvios.mockReturnValue(consultaConDatos([generico]));
    renderConProveedores(<AviosPagina />, {
      sesion: estadoSesionDePrueba(['avios.ver']),
    });

    expect(screen.getAllByText('Genérico · stock').length).toBeGreaterThan(0);
  });

  it('muestra los proveedores y precios del avío al expandir el renglón (R1)', () => {
    const conProveedores = avio(5, 'BTN-05');
    conProveedores.proveedores = [
      { idProveedor: 1, nombreProveedor: 'Botones SA', precio: 0.5, condiciones: 'contado' },
      { idProveedor: 2, nombreProveedor: 'Hilos del Norte', precio: null, condiciones: null },
    ];
    useAvios.mockReturnValue(consultaConDatos([conProveedores]));
    renderConProveedores(<AviosPagina />, {
      sesion: estadoSesionDePrueba(['avios.ver']),
    });

    fireEvent.click(screen.getByTestId('fila-avio'));
    const lista = screen.getByTestId('avio-proveedores-detalle');
    expect(within(lista).getByText('Botones SA')).toBeInTheDocument();
    expect(within(lista).getByText('Hilos del Norte')).toBeInTheDocument();
  });

  it('muestra "sin proveedores" al expandir un avío sin proveedores', () => {
    useAvios.mockReturnValue(consultaConDatos([avio(6, 'SOLO')]));
    renderConProveedores(<AviosPagina />, {
      sesion: estadoSesionDePrueba(['avios.ver']),
    });

    fireEvent.click(screen.getByTestId('fila-avio'));
    expect(screen.getByTestId('avio-sin-proveedores')).toBeInTheDocument();
  });
});
