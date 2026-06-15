import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bordado, BordadosPagina as TipoPagina } from '@/api/bordados';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { BordadosPagina } from './BordadosPagina';

/**
 * Pruebas de componente de `<BordadosPagina>` (F1-E3): renderiza la pantalla con la
 * capa de datos SIMULADA (sin red) y la sesion inyectada. Cubre el contrato del patron
 * CRUD: lista, detalle (tipo/puntadas/precio), estado vacio/error, acciones ocultas sin
 * permiso, confirmacion de desactivar, reactivar sin confirmacion, y el filtro por tipo.
 *
 * `useFotoBordado` se mockea para no pedir la foto en cada miniatura; aqui los bordados
 * de ejemplo no tienen foto (idArchivoFoto null), asi que se pinta el avatar de iniciales.
 */
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useBordados = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;

vi.mock('@/api/bordados', () => ({
  useBordados: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useBordados(query);
  },
  useCrearBordado: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarBordado: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarBordado: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarBordado: () => ({ mutate: reactivarMutate, isPending: false }),
  // Para MiniaturaFoto / FotoBordado (no se ejercita la red de la foto aqui).
  useFotoBordado: () => ({ data: undefined, isPending: false, isError: false, error: null }),
  useSubirFotoBordado: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarFotoBordado: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Bordado de ejemplo (sin foto por defecto). */
function bordado(id: number, nombre: string, activo = true, extra: Partial<Bordado> = {}): Bordado {
  return {
    id,
    nombre,
    descripcion: null,
    puntadas: null,
    precio: null,
    tipo: 'BORDADO',
    idArchivoFoto: null,
    activo,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...extra,
  };
}

/** Respuesta paginada de ejemplo. */
function pagina(datos: Bordado[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 12, totalPaginas: 1 };
}

/** Estado de consulta "con datos". */
function consultaConDatos(datos: Bordado[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<BordadosPagina>', () => {
  beforeEach(() => {
    useBordados.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
    ultimaQuery = undefined;
  });

  it('lista los bordados que devuelve el API', () => {
    useBordados.mockReturnValue(
      consultaConDatos([bordado(1, 'Logo Águila'), bordado(2, 'Escudo Sol')]),
    );
    renderConProveedores(<BordadosPagina />, {
      sesion: estadoSesionDePrueba(['bordados.ver', 'bordados.administrar']),
    });

    expect(screen.getAllByTestId('fila-bordado')).toHaveLength(2);
    expect(screen.getAllByText('Logo Águila').length).toBeGreaterThan(0);
    expect(screen.getByText('Escudo Sol')).toBeInTheDocument();
  });

  it('muestra en el detalle el tipo, puntadas y precio', () => {
    useBordados.mockReturnValue(
      consultaConDatos([
        bordado(1, 'Logo', true, { tipo: 'ESTAMPADO', puntadas: 12000, precio: 45 }),
      ]),
    );
    renderConProveedores(<BordadosPagina />, {
      sesion: estadoSesionDePrueba(['bordados.ver', 'bordados.administrar']),
    });

    const detalle = screen.getByTestId('detalle-bordado');
    expect(within(detalle).getByText('12,000')).toBeInTheDocument();
    expect(within(detalle).getByText('$45.00')).toBeInTheDocument();
    // El tipo aparece como chip (Estampado / aplicación) en el detalle.
    expect(within(detalle).getAllByText('Estampado / aplicación').length).toBeGreaterThan(0);
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useBordados.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<BordadosPagina />, {
      sesion: estadoSesionDePrueba(['bordados.ver']),
    });
    expect(screen.getByText('No hay bordados que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un boton de reintento cuando la consulta falla', () => {
    useBordados.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<BordadosPagina />, {
      sesion: estadoSesionDePrueba(['bordados.ver']),
    });
    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useBordados.mockReturnValue(consultaConDatos([bordado(1, 'Logo')]));
    renderConProveedores(<BordadosPagina />, {
      sesion: estadoSesionDePrueba(['bordados.ver']),
    });
    expect(screen.queryByTestId('nuevo-bordado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-bordado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-bordado')).not.toBeInTheDocument();
  });

  it('pide confirmacion antes de desactivar y llama a la mutacion al confirmar', async () => {
    const usuario = userEvent.setup();
    useBordados.mockReturnValue(consultaConDatos([bordado(7, 'Viejo')]));
    renderConProveedores(<BordadosPagina />, {
      sesion: estadoSesionDePrueba(['bordados.ver', 'bordados.administrar']),
    });

    await usuario.click(screen.getByTestId('desactivar-bordado'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar bordado')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('un bordado inactivo ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useBordados.mockReturnValue(consultaConDatos([bordado(9, 'Apagado', false)]));
    renderConProveedores(<BordadosPagina />, {
      sesion: estadoSesionDePrueba(['bordados.ver', 'bordados.administrar']),
    });

    const detalle = screen.getByTestId('detalle-bordado');
    expect(within(detalle).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByTestId('activar-bordado')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-bordado')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-bordado'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  it('el filtro por tipo va en la query al servidor', async () => {
    const usuario = userEvent.setup();
    useBordados.mockReturnValue(consultaConDatos([bordado(1, 'Logo')]));
    renderConProveedores(<BordadosPagina />, {
      sesion: estadoSesionDePrueba(['bordados.ver']),
    });

    await usuario.selectOptions(screen.getByTestId('filtro-tipo-bordado'), 'ESTAMPADO');
    expect(ultimaQuery?.tipo).toBe('ESTAMPADO');
  });
});
