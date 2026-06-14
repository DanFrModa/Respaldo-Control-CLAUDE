import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tela, TelaCategoria, TelasPagina as TipoPagina } from '@/api/telas';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TelasPagina } from './TelasPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `useTelas` captura la query
// con la que se le llama, para verificar el filtro por categoria.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useTelas = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;

/** Categorias de ejemplo para el filtro. */
const CATEGORIAS: TelaCategoria[] = [
  {
    id: 7,
    nombre: 'Felpa',
    activo: true,
    creadoEn: '',
    creadoPorId: null,
    modificadoEn: '',
    modificadoPorId: null,
  },
];

vi.mock('@/api/telas', () => ({
  useTelas: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useTelas(query);
  },
  useCrearTela: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarTela: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarTela: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarTela: () => ({ mutate: reactivarMutate, isPending: false }),
  useTelasCategorias: () => ({
    data: { datos: CATEGORIAS, total: 1, pagina: 1, porPagina: 100, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

// El diálogo se aisla (tiene su propio test): evita arrastrar el form completo.
vi.mock('./DialogoTela', () => ({ DialogoTela: () => null }));

/** Tela de ejemplo. */
function tela(id: number, nombre: string, sobre: Partial<Tela> = {}): Tela {
  return {
    id,
    nombre,
    descripcion: null,
    idCategoria: 7,
    categoria: 'Felpa',
    unidadMedida: 'KILOGRAMO',
    tipoComponente: 'CUERPO',
    favorito: false,
    precioSugerido: null,
    paraProduccion: true,
    colores: [],
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...sobre,
  };
}

/** Respuesta paginada de ejemplo. */
function pagina(datos: Tela[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos". */
function consultaConDatos(datos: Tela[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<TelasPagina>', () => {
  beforeEach(() => {
    useTelas.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
    ultimaQuery = undefined;
  });

  it('lista las telas que devuelve el API', () => {
    useTelas.mockReturnValue(consultaConDatos([tela(1, 'Felpa A'), tela(2, 'Jersey B')]));
    renderConProveedores(<TelasPagina />, {
      sesion: estadoSesionDePrueba(['telas.ver', 'telas.administrar']),
    });

    expect(screen.getAllByTestId('fila-tela')).toHaveLength(2);
    expect(screen.getAllByText('Felpa A').length).toBeGreaterThan(0);
    expect(screen.getByText('Jersey B')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay resultados', () => {
    useTelas.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });
    expect(screen.getByText('No hay telas que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el error y un botón de reintento cuando la consulta falla', () => {
    useTelas.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });
    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useTelas.mockReturnValue(consultaConDatos([tela(1, 'Felpa A')]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });
    expect(screen.queryByTestId('nuevo-tela')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-tela')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-tela')).not.toBeInTheDocument();
  });

  it('el filtro por categoría se refleja en la consulta del API (como id numérico)', async () => {
    const usuario = userEvent.setup();
    useTelas.mockReturnValue(consultaConDatos([tela(1, 'Felpa A')]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });

    expect(ultimaQuery?.idCategoria).toBeUndefined();
    await usuario.selectOptions(screen.getByTestId('filtro-categoria-tela'), '7');
    expect(ultimaQuery?.idCategoria).toBe(7);
  });

  it('muestra los colores de la tela con su precio en el detalle', () => {
    const conColores = tela(3, 'Felpa C', {
      colores: [
        { idColor: 1, nombre: 'Negro', precio: 95 },
        { idColor: 2, nombre: 'Blanco', precio: null },
      ],
    });
    useTelas.mockReturnValue(consultaConDatos([conColores]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });

    const detalle = screen.getByTestId('tela-colores-detalle');
    expect(within(detalle).getByText('Negro')).toBeInTheDocument();
    expect(within(detalle).getByText('Blanco')).toBeInTheDocument();
    // El precio capturado se muestra; el color sin precio dice "Sin precio".
    expect(within(detalle).getByText('Sin precio')).toBeInTheDocument();
  });

  it('una tela sin colores muestra el aviso correspondiente en el detalle', () => {
    useTelas.mockReturnValue(consultaConDatos([tela(4, 'Sin colores', { colores: [] })]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });
    expect(screen.getByTestId('tela-sin-colores')).toBeInTheDocument();
  });

  it('pide confirmación antes de desactivar y llama a la mutación al confirmar', async () => {
    const usuario = userEvent.setup();
    useTelas.mockReturnValue(consultaConDatos([tela(7, 'Vieja')]));
    renderConProveedores(<TelasPagina />, {
      sesion: estadoSesionDePrueba(['telas.ver', 'telas.administrar']),
    });

    await usuario.click(screen.getByTestId('desactivar-tela'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar tela')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('una tela inactiva ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useTelas.mockReturnValue(consultaConDatos([tela(9, 'Apagada', { activo: false })]));
    renderConProveedores(<TelasPagina />, {
      sesion: estadoSesionDePrueba(['telas.ver', 'telas.administrar']),
    });

    const detalle = screen.getByTestId('detalle-tela');
    expect(within(detalle).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByTestId('activar-tela')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('activar-tela'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });
});
