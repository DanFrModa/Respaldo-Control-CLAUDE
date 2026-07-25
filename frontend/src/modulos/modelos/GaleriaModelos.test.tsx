import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ReactRouterDom from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Modelo, ModelosPagina as TipoPagina } from '@/api/modelos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { GaleriaModelos } from './GaleriaModelos';

/**
 * Pruebas de componente de `<GaleriaModelos>` (F1-E5): la galería visual de fotos de modelos en
 * rejilla, con la capa de datos SIMULADA. Cubre los estados carga / vacío / error, el caso
 * NoFoto (placeholder cuando `urlFotoPrincipal` es null) vs con foto, que tocar una celda navegue
 * a la ficha, y que la búsqueda y los filtros (temporada/estado) viajen a la query del servidor.
 */
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useModelos = vi.fn<(query: unknown) => EstadoConsulta>();
let ultimaQuery: Record<string, unknown> | undefined;
const navegar = vi.fn();

vi.mock('@/api/modelos', () => ({
  useModelos: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useModelos(query);
  },
}));

vi.mock('@/api/temporadas', () => ({
  useTemporadas: () => ({
    data: { datos: [{ id: 7, nombre: 'Verano 26', activo: true }], total: 1, pagina: 1 },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('react-router-dom', async (importarOriginal) => {
  const actual = await importarOriginal<typeof ReactRouterDom>();
  return { ...actual, useNavigate: () => navegar };
});

/** Modelo de ejemplo. `urlFoto` null = sin foto (placeholder NoFoto). */
function modelo(id: number, codigo: string, urlFoto: string | null = null): Modelo {
  return {
    id,
    codigo,
    descripcion: null,
    composicion: null,
    maquilaBase: null,
    idTemporada: null,
    temporada: null,
    idCurvaTalla: null,
    curvaTalla: null,
    idGenero: null,
    genero: null,
    cantidadFotos: urlFoto === null ? 0 : 1,
    urlFotoPrincipal: urlFoto,
    idTipoProducto: null,
    tipoProducto: null,
    numOperaciones: null,
    corteBase: null,
    idMaquileroCotizado: null,
    maquileroCotizado: null,
    secuenciaEstampado: 'antes',
    telaPrincipal: null,
    stockPt: null,
    costoActual: null,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function pagina(datos: Modelo[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 24, totalPaginas: 1 };
}

function consultaConDatos(datos: Modelo[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

function estadoVacioConsulta(parcial: Partial<EstadoConsulta>): EstadoConsulta {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...parcial,
  };
}

describe('<GaleriaModelos>', () => {
  beforeEach(() => {
    useModelos.mockReset();
    navegar.mockReset();
    ultimaQuery = undefined;
  });

  it('muestra el esqueleto de carga mientras llega la primera página', () => {
    useModelos.mockReturnValue(estadoVacioConsulta({ isPending: true }));
    const { container } = renderConProveedores(<GaleriaModelos />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });
    // El grid de datos aún no existe; hay skeletons (animate-pulse) en su lugar.
    expect(screen.queryByTestId('galeria-modelos-grid')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('pinta una celda por modelo, con foto y con placeholder NoFoto', () => {
    useModelos.mockReturnValue(
      consultaConDatos([
        modelo(1, 'MOD-001', 'https://r2.example/MOD-001.jpg'),
        modelo(2, 'MOD-002', null),
      ]),
    );
    renderConProveedores(<GaleriaModelos />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });

    expect(screen.getAllByTestId('celda-galeria-modelo')).toHaveLength(2);
    expect(screen.getByText('MOD-001')).toBeInTheDocument();
    expect(screen.getByText('MOD-002')).toBeInTheDocument();
    // El primero tiene foto; el segundo, placeholder NoFoto.
    expect(screen.getByTestId('miniatura-modelo-foto')).toBeInTheDocument();
    expect(screen.getByTestId('miniatura-modelo-sin-foto')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay resultados', () => {
    useModelos.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<GaleriaModelos />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });
    expect(screen.getByText('No hay modelos que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error cuando la consulta falla', () => {
    useModelos.mockReturnValue(
      estadoVacioConsulta({
        isError: true,
        error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar.' }),
      }),
    );
    renderConProveedores(<GaleriaModelos />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });
    expect(screen.getByText('No se pudo cargar.')).toBeInTheDocument();
  });

  it('al tocar una celda navega a la ficha del modelo', async () => {
    const usuario = userEvent.setup();
    useModelos.mockReturnValue(consultaConDatos([modelo(5, 'MOD-005')]));
    renderConProveedores(<GaleriaModelos />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });

    await usuario.click(screen.getByTestId('celda-galeria-modelo'));
    expect(navegar).toHaveBeenCalledWith('/modelos', { state: { idModelo: 5 } });
  });

  it('el filtro por temporada va en la query al servidor', async () => {
    const usuario = userEvent.setup();
    useModelos.mockReturnValue(consultaConDatos([modelo(1, 'MOD-001')]));
    renderConProveedores(<GaleriaModelos />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });

    await usuario.selectOptions(screen.getByTestId('filtro-temporada-galeria-modelo'), '7');
    expect(ultimaQuery?.idTemporada).toBe(7);
  });

  it('el filtro de estado incluye inactivos cuando se piden descontinuados/todos', async () => {
    const usuario = userEvent.setup();
    useModelos.mockReturnValue(consultaConDatos([modelo(1, 'MOD-001')]));
    renderConProveedores(<GaleriaModelos />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });

    // Por defecto: solo activos.
    expect(ultimaQuery?.incluirInactivos).toBe('false');
    await usuario.selectOptions(screen.getByTestId('filtro-estado-galeria-modelo'), 'TODOS');
    expect(ultimaQuery?.incluirInactivos).toBe('true');
  });
});
