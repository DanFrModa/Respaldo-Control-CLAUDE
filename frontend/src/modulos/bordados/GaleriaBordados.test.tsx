import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ReactRouterDom from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bordado, BordadosPagina as TipoPagina } from '@/api/bordados';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { GaleriaBordados } from './GaleriaBordados';

/**
 * Pruebas de componente de `<GaleriaBordados>` (F1-E3): la galeria visual de fotos en
 * rejilla, con la capa de datos SIMULADA. Cubre: pinta una celda por bordado, el estado
 * vacio, que tocar una celda navegue a la ficha, y que el filtro por tipo vaya a la
 * query del servidor. `useFotoBordado` se mockea (sin foto: placeholder NoFoto).
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
let ultimaQuery: Record<string, unknown> | undefined;
const navegar = vi.fn();

vi.mock('@/api/bordados', () => ({
  useBordados: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useBordados(query);
  },
  useFotoBordado: () => ({ data: undefined, isPending: false, isError: false, error: null }),
}));

vi.mock('react-router-dom', async (importarOriginal) => {
  const actual = await importarOriginal<typeof ReactRouterDom>();
  return { ...actual, useNavigate: () => navegar };
});

/** Bordado de ejemplo (sin foto). */
function bordado(id: number, nombre: string): Bordado {
  return {
    id,
    nombre,
    descripcion: null,
    puntadas: null,
    precio: null,
    tipo: 'BORDADO',
    idArchivoFoto: null,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function pagina(datos: Bordado[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 24, totalPaginas: 1 };
}

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

describe('<GaleriaBordados>', () => {
  beforeEach(() => {
    useBordados.mockReset();
    navegar.mockReset();
    ultimaQuery = undefined;
  });

  it('pinta una celda por bordado', () => {
    useBordados.mockReturnValue(consultaConDatos([bordado(1, 'Logo'), bordado(2, 'Escudo')]));
    renderConProveedores(<GaleriaBordados />, {
      sesion: estadoSesionDePrueba(['bordados.ver']),
    });

    expect(screen.getAllByTestId('celda-galeria')).toHaveLength(2);
    expect(screen.getByText('Logo')).toBeInTheDocument();
    expect(screen.getByText('Escudo')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useBordados.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<GaleriaBordados />, {
      sesion: estadoSesionDePrueba(['bordados.ver']),
    });
    expect(screen.getByText('No hay bordados que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('al tocar una celda navega a la ficha del bordado', async () => {
    const usuario = userEvent.setup();
    useBordados.mockReturnValue(consultaConDatos([bordado(5, 'Logo')]));
    renderConProveedores(<GaleriaBordados />, {
      sesion: estadoSesionDePrueba(['bordados.ver']),
    });

    await usuario.click(screen.getByTestId('celda-galeria'));
    expect(navegar).toHaveBeenCalledWith('/catalogos/bordados', { state: { idBordado: 5 } });
  });

  it('el filtro por tipo va en la query al servidor', async () => {
    const usuario = userEvent.setup();
    useBordados.mockReturnValue(consultaConDatos([bordado(1, 'Logo')]));
    renderConProveedores(<GaleriaBordados />, {
      sesion: estadoSesionDePrueba(['bordados.ver']),
    });

    await usuario.selectOptions(screen.getByTestId('filtro-tipo-galeria'), 'BORDADO');
    expect(ultimaQuery?.tipo).toBe('BORDADO');
  });

  it('muestra el mensaje de error cuando la consulta falla', () => {
    useBordados.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<GaleriaBordados />, {
      sesion: estadoSesionDePrueba(['bordados.ver']),
    });
    expect(screen.getByText('No se pudo cargar.')).toBeInTheDocument();
  });
});
