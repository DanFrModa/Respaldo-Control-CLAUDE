import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Modelo, ModeloFicha, ModelosPagina as TipoPagina } from '@/api/modelos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ModelosPagina } from './ModelosPagina';

/**
 * Pruebas de componente de `<ModelosPagina>` (F1-E4): renderiza la pantalla con la capa de
 * datos SIMULADA (sin red) y la sesión inyectada. Cubre el contrato del patrón LISTA+DETALLE:
 * lista, detalle (datos generales + BOM), estado vacío/error, acciones ocultas sin permiso,
 * confirmación de descontinuar, el filtro por temporada, la galería de fotos (NoFoto) y las
 * pestañas del BOM.
 */
type EstadoLista = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
type EstadoFicha = {
  data: ModeloFicha | undefined;
  isPending: boolean;
  isError: boolean;
  error: ErrorDeApi | null;
};
type EstadoFotos = {
  data: { idFoto: number; tipo: string; orden: number; urlDescarga: string }[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: ErrorDeApi | null;
};

const useModelos = vi.fn<(query: unknown) => EstadoLista>();
const useFichaModelo = vi.fn<(id: number | undefined) => EstadoFicha>();
const useFotosModelo = vi.fn<(id: number | undefined) => EstadoFotos>();
const descontinuarMutate = vi.fn();
const reactivarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;

vi.mock('@/api/modelos', () => ({
  useModelos: (query: Record<string, unknown>) => {
    // Solo capturamos la query del LISTADO principal (porPagina 15); el diálogo "Copiar
    // receta" también usa `useModelos` (porPagina 20) y no debe pisar lo que medimos.
    if (query.porPagina === 15) {
      ultimaQuery = query;
    }
    return useModelos(query);
  },
  useFichaModelo: (id: number | undefined) => useFichaModelo(id),
  useFotosModelo: (id: number | undefined) => useFotosModelo(id),
  useCrearModelo: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarModelo: () => ({ mutate: vi.fn(), isPending: false }),
  useDescontinuarModelo: () => ({ mutate: descontinuarMutate, isPending: false }),
  useReactivarModelo: () => ({ mutate: reactivarMutate, isPending: false }),
  useGeneros: () => ({ data: [], isPending: false }),
  useSubirFotoModelo: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarFotoModelo: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarFotoModelo: () => ({ mutate: vi.fn(), isPending: false }),
  useReemplazarTelasBom: () => ({ mutate: vi.fn(), isPending: false }),
  useReemplazarAviosBom: () => ({ mutate: vi.fn(), isPending: false }),
  useReemplazarBordadosBom: () => ({ mutate: vi.fn(), isPending: false }),
  useCopiarBom: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Catálogos para los selectores (no se ejercita su red aquí).
vi.mock('@/api/temporadas', () => ({
  useTemporadas: () => ({ data: { datos: [{ id: 2, nombre: 'Verano 25', activo: true }] } }),
}));
vi.mock('@/api/tallas', () => ({ useCurvas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/telas', () => ({ useTelas: () => ({ data: { datos: [] }, isPending: false }) }));
vi.mock('@/api/avios', () => ({ useAvios: () => ({ data: { datos: [] }, isPending: false }) }));
vi.mock('@/api/bordados', () => ({
  useBordados: () => ({ data: { datos: [] }, isPending: false }),
}));

/** Modelo de ejemplo (listado). */
function modelo(id: number, codigo: string, activo = true, extra: Partial<Modelo> = {}): Modelo {
  return {
    id,
    codigo,
    descripcion: null,
    maquilaBase: null,
    idTemporada: null,
    temporada: null,
    idCurvaTalla: null,
    curvaTalla: null,
    idGenero: null,
    genero: null,
    cantidadFotos: 0,
    urlFotoPrincipal: null,
    activo,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...extra,
  };
}

/** Ficha de ejemplo (datos + BOM). */
function ficha(m: Modelo, extra: Partial<ModeloFicha> = {}): ModeloFicha {
  return { ...m, telas: [], avios: [], bordados: [], ...extra };
}

function pagina(datos: Modelo[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 15, totalPaginas: 1 };
}

function listaConDatos(datos: Modelo[]): EstadoLista {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

function fichaCargada(f: ModeloFicha): EstadoFicha {
  return { data: f, isPending: false, isError: false, error: null };
}

const SIN_FOTOS: EstadoFotos = { data: [], isPending: false, isError: false, error: null };

describe('<ModelosPagina>', () => {
  beforeEach(() => {
    useModelos.mockReset();
    useFichaModelo.mockReset();
    useFotosModelo.mockReset();
    descontinuarMutate.mockReset();
    reactivarMutate.mockReset();
    ultimaQuery = undefined;
    // Por defecto: ficha del seleccionado y sin fotos.
    useFichaModelo.mockImplementation((id) =>
      id === undefined
        ? { data: undefined, isPending: false, isError: false, error: null }
        : fichaCargada(ficha(modelo(id, '—'))),
    );
    useFotosModelo.mockReturnValue(SIN_FOTOS);
  });

  it('lista los modelos que devuelve el API', () => {
    useModelos.mockReturnValue(listaConDatos([modelo(1, '501'), modelo(2, '777')]));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });
    expect(screen.getAllByTestId('fila-modelo')).toHaveLength(2);
    expect(screen.getAllByText('501').length).toBeGreaterThan(0);
    expect(screen.getByText('777')).toBeInTheDocument();
  });

  it('muestra en el detalle los datos generales y la galería NoFoto', () => {
    const m = modelo(1, '501', true, {
      descripcion: 'Sudadera',
      maquilaBase: 35,
      temporada: 'Verano 25',
    });
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    const detalle = screen.getByTestId('detalle-modelo');
    expect(within(detalle).getByText('Sudadera')).toBeInTheDocument();
    expect(within(detalle).getByText('$35.00')).toBeInTheDocument();
    // Sin fotos → placeholder NoFoto.
    expect(within(detalle).getByTestId('modelo-sin-fotos')).toBeInTheDocument();
  });

  it('muestra las 3 pestañas del BOM y cambia de sección al hacer clic', async () => {
    const usuario = userEvent.setup();
    const m = modelo(1, '501');
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    // Pestañas presentes; por defecto Telas.
    expect(screen.getByTestId('tab-bom-telas')).toBeInTheDocument();
    expect(screen.getByTestId('tab-bom-avios')).toBeInTheDocument();
    expect(screen.getByTestId('tab-bom-bordados')).toBeInTheDocument();
    expect(screen.getByTestId('seccion-bom-telas')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('tab-bom-bordados'));
    expect(screen.getByTestId('seccion-bom-bordados')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay resultados', () => {
    useModelos.mockReturnValue(listaConDatos([]));
    renderConProveedores(<ModelosPagina />, { sesion: estadoSesionDePrueba(['modelos.ver']) });
    expect(screen.getByText('No hay modelos que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un botón de reintento cuando la consulta falla', () => {
    useModelos.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<ModelosPagina />, { sesion: estadoSesionDePrueba(['modelos.ver']) });
    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    const m = modelo(1, '501');
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m)));
    renderConProveedores(<ModelosPagina />, { sesion: estadoSesionDePrueba(['modelos.ver']) });
    expect(screen.queryByTestId('nuevo-modelo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-modelo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-modelo')).not.toBeInTheDocument();
    // Sin permiso, el BOM no ofrece "Guardar receta" ni "Copiar receta".
    expect(screen.queryByTestId('abrir-copiar-bom')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guardar-bom-telas')).not.toBeInTheDocument();
  });

  it('pide confirmación antes de descontinuar y llama a la mutación al confirmar', async () => {
    const usuario = userEvent.setup();
    const m = modelo(7, 'VIEJO');
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('desactivar-modelo'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Descontinuar modelo')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(descontinuarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('el filtro por temporada va en la query al servidor', async () => {
    const usuario = userEvent.setup();
    useModelos.mockReturnValue(listaConDatos([modelo(1, '501')]));
    renderConProveedores(<ModelosPagina />, { sesion: estadoSesionDePrueba(['modelos.ver']) });

    await usuario.selectOptions(screen.getByTestId('filtro-temporada-modelo'), '2');
    expect(ultimaQuery?.idTemporada).toBe(2);
  });

  it('deep-link: abre la ficha del modelo de `state.idModelo` (estando en la página visible)', async () => {
    // Lista con dos modelos; el deep-link apunta al SEGUNDO (no al primero/por defecto).
    const m2 = modelo(2, '777', true, { descripcion: 'Modelo deep-link' });
    useModelos.mockReturnValue(listaConDatos([modelo(1, '501'), m2]));
    useFichaModelo.mockImplementation((id) =>
      id === 2
        ? fichaCargada(ficha(m2))
        : id === undefined
          ? { data: undefined, isPending: false, isError: false, error: null }
          : fichaCargada(ficha(modelo(id, '501'))),
    );

    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
      rutaInicial: { pathname: '/modelos', state: { idModelo: 2 } },
    });

    // El detalle muestra el modelo 777 (el del deep-link), no el primero (501).
    const detalle = screen.getByTestId('detalle-modelo');
    expect(await within(detalle).findByRole('heading', { name: '777' })).toBeInTheDocument();
    expect(within(detalle).getByText('Modelo deep-link')).toBeInTheDocument();
  });

  it('deep-link: inyecta y abre la ficha aunque el modelo NO esté en la página visible', async () => {
    // La página visible NO contiene el modelo 999 (otra página/filtro); igual debe abrirse.
    useModelos.mockReturnValue(listaConDatos([modelo(1, '501')]));
    useFichaModelo.mockImplementation((id) =>
      id === 999
        ? fichaCargada(ficha(modelo(999, 'DEEP-999', true, { descripcion: 'Fuera de página' })))
        : id === undefined
          ? { data: undefined, isPending: false, isError: false, error: null }
          : fichaCargada(ficha(modelo(id, '501'))),
    );

    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
      rutaInicial: { pathname: '/modelos', state: { idModelo: 999 } },
    });

    const detalle = screen.getByTestId('detalle-modelo');
    expect(await within(detalle).findByRole('heading', { name: 'DEEP-999' })).toBeInTheDocument();
    expect(within(detalle).getByText('Fuera de página')).toBeInTheDocument();
    // Y aparece como un renglón inyectado en la lista (junto al visible 501): 2 renglones.
    expect(screen.getAllByTestId('fila-modelo')).toHaveLength(2);
    expect(screen.getAllByText('DEEP-999').length).toBeGreaterThan(0);
  });

  it('sin `state.idModelo` selecciona el primero (comportamiento por defecto intacto)', () => {
    useModelos.mockReturnValue(listaConDatos([modelo(1, '501'), modelo(2, '777')]));
    useFichaModelo.mockImplementation((id) =>
      id === undefined
        ? { data: undefined, isPending: false, isError: false, error: null }
        : fichaCargada(ficha(modelo(id, id === 1 ? '501' : '777'))),
    );

    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
      rutaInicial: '/modelos',
    });

    // Sin deep-link, el detalle muestra el PRIMER modelo (501).
    const detalle = screen.getByTestId('detalle-modelo');
    expect(within(detalle).getByRole('heading', { name: '501' })).toBeInTheDocument();
  });
});
