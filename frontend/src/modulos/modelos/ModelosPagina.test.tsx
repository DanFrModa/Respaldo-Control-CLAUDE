import { fireEvent, screen, within } from '@testing-library/react';
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
const crearVersionMutate = vi.fn();
const aprobarRevisionMutate = vi.fn();
const rechazarRevisionMutate = vi.fn();
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
  // ⭐ V1-E7b — «Crear versión» (§Post-F9.110).
  useCrearVersionModelo: () => ({ mutate: crearVersionMutate, isPending: false }),
  // ⭐ V1-E7d — las dos firmas de la REVISIÓN (§Post-F9.110).
  useAprobarRevisionModelo: () => ({ mutate: aprobarRevisionMutate, isPending: false }),
  useRechazarRevisionModelo: () => ({ mutate: rechazarRevisionMutate, isPending: false }),
  useGeneros: () => ({ data: [], isPending: false }),
  usePropuestaProduccion: () => ({ data: undefined, isPending: false, isError: false }),
  usePasarAProduccion: () => ({ mutate: vi.fn(), isPending: false }),
  // V1-E3r: el bloque de la curva de la ficha (tiene su propia prueba en `CurvaDelModelo.test.tsx`).
  useCurvasSugeridas: () => ({ data: { idModelo: 1, yaTieneCurva: false, sugerencias: [] } }),
  useAsignarCurvaDesdeOrdenes: () => ({ mutate: vi.fn(), isPending: false }),
  useSubirFotoModelo: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarFotoModelo: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarFotoModelo: () => ({ mutate: vi.fn(), isPending: false }),
  useMarcarFotoPrincipal: () => ({ mutate: vi.fn(), isPending: false }),
  useMarcarArtePrincipal: () => ({ mutate: vi.fn(), isPending: false }),
  useReemplazarTelasBom: () => ({ mutate: vi.fn(), isPending: false }),
  useReemplazarAviosBom: () => ({ mutate: vi.fn(), isPending: false }),
  useReemplazarBordadosBom: () => ({ mutate: vi.fn(), isPending: false }),
  useCopiarBom: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Existencias PT del cajón (matriz color×talla): mock con rollup vacío por defecto; los tests
// de la matriz lo sobreescriben. La página lo consulta SOLO con `inventario-pt.ver`.
const useExistenciasPtMock = vi.fn<(query: unknown, habilitado?: boolean) => unknown>(() => ({
  data: undefined,
  isPending: false,
  isError: false,
}));
vi.mock('@/api/inventarios', () => ({
  useExistenciasPt: (query: unknown, habilitado?: boolean) =>
    useExistenciasPtMock(query, habilitado),
}));

// Catálogos para los selectores (no se ejercita su red aquí).
vi.mock('@/api/temporadas', () => ({
  useTemporadas: () => ({ data: { datos: [{ id: 2, nombre: 'Verano 25', activo: true }] } }),
}));
vi.mock('@/api/tallas', () => ({ useCurvas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/telas', () => ({ useTelas: () => ({ data: { datos: [] }, isPending: false }) }));
vi.mock('@/api/avios', () => ({ useAvios: () => ({ data: { datos: [] }, isPending: false }) }));
vi.mock('@/api/calidad', () => ({
  useTiposProductoActivos: () => ({
    data: { datos: [], total: 0, pagina: 1, totalPaginas: 0, porPagina: 100 },
    isPending: false,
  }),
}));

/** Modelo de ejemplo (listado). */
function modelo(id: number, codigo: string, activo = true, extra: Partial<Modelo> = {}): Modelo {
  return {
    id,
    codigo,
    origen: 'produccion',
    codigoDesarrollo: null,
    numeroProduccion: null,
    // Linaje de versiones (V1-E7b): estos fixtures son de modelos RAÍZ (no nacieron de otro).
    idModeloPadre: null,
    codigoPadre: null,
    versionDesarrollo: null,
    // ⭐ V1-E7d — no son versiones, así que NO llevan revisión: los cuatro campos en null.
    revisionEstado: null,
    idRevisadoPor: null,
    revisadoPor: null,
    revisadoEn: null,
    revisionNota: null,
    descripcion: null,
    composicion: null,
    maquilaBase: null,
    idTemporada: null,
    temporada: null,
    idCurvaTalla: null,
    curvaTalla: null,
    idGenero: null,
    genero: null,
    cantidadFotos: 0,
    urlFotoPrincipal: null,
    idTipoProducto: null,
    tipoProducto: null,
    numOperaciones: null,
    corteBase: null,
    idMaquileroCotizado: null,
    maquileroCotizado: null,
    secuenciaEstampado: 'antes',
    llevaArte: true,
    telaPrincipal: null,
    stockPt: null,
    costoActual: null,
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
  return { ...m, telas: [], avios: [], artes: [], tallasCurva: [], avisosCurva: [], ...extra };
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
    useExistenciasPtMock.mockReset();
    useExistenciasPtMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    descontinuarMutate.mockReset();
    reactivarMutate.mockReset();
    crearVersionMutate.mockReset();
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
    // Tabla-first: el detalle NO se auto-abre; cada modelo sale en su renglón. La tabla y las
    // tarjetas móviles coexisten en el DOM (jsdom ignora `lg:hidden`): se acota a la tabla de
    // escritorio para no chocar con el duplicado de la tarjeta.
    expect(screen.getAllByTestId('fila-modelo')).toHaveLength(2);
    const tabla = within(screen.getByTestId('modelos-tabla'));
    expect(tabla.getByText('501')).toBeInTheDocument();
    expect(tabla.getByText('777')).toBeInTheDocument();
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

    // Tabla-first: se abre el cajón con clic en el renglón.
    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    const detalle = screen.getByTestId('detalle-modelo');
    expect(within(detalle).getByText('Sudadera')).toBeInTheDocument();
    expect(within(detalle).getByText('$35.00')).toBeInTheDocument();
    // Sin fotos → placeholder NoFoto.
    expect(within(detalle).getByTestId('modelo-sin-fotos')).toBeInTheDocument();
  });

  // ── ¿Lleva arte? (Daniel 26-jul-2026) ──
  it('la ficha avisa cuando el modelo LLEVA arte y aún no está capturado', () => {
    const m = modelo(1, '501', true, { llevaArte: true });
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m))); // BOM sin arte
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });

    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    const detalle = screen.getByTestId('detalle-modelo');
    expect(within(detalle).getByText('Lleva arte — falta capturarlo')).toBeInTheDocument();
  });

  it('la ficha dice "No lleva arte" cuando la casilla está desmarcada (prenda lisa)', () => {
    const m = modelo(1, '501', true, { llevaArte: false });
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });

    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    const detalle = screen.getByTestId('detalle-modelo');
    expect(within(detalle).getByText('No lleva arte')).toBeInTheDocument();
  });

  it('muestra las 3 pestañas del BOM y cambia de sección al hacer clic', async () => {
    const usuario = userEvent.setup();
    const m = modelo(1, '501');
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('fila-modelo'));
    // Pestañas presentes; por defecto Telas.
    expect(screen.getByTestId('tab-bom-telas')).toBeInTheDocument();
    expect(screen.getByTestId('tab-bom-avios')).toBeInTheDocument();
    expect(screen.getByTestId('tab-bom-artes')).toBeInTheDocument();
    expect(screen.getByTestId('seccion-bom-telas')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('tab-bom-artes'));
    expect(screen.getByTestId('seccion-bom-artes')).toBeInTheDocument();
  });

  it('pinta las columnas Tela principal, Stock PT y Costo con los agregados del listado', () => {
    useModelos.mockReturnValue(
      listaConDatos([
        modelo(1, '501', true, { telaPrincipal: 'Felpa premium', stockPt: 1240, costoActual: 118 }),
        // Sin BOM/costeo (o sin permiso de importes): guiones; stock 0 se pinta atenuado.
        modelo(2, '777', true, { telaPrincipal: null, stockPt: 0, costoActual: null }),
      ]),
    );
    renderConProveedores(<ModelosPagina />, { sesion: estadoSesionDePrueba(['modelos.ver']) });

    // Acotado a la tabla de escritorio: las tarjetas móviles repiten estos datos en el DOM de jsdom.
    const tabla = within(screen.getByTestId('modelos-tabla'));
    expect(tabla.getByText('Felpa premium')).toBeInTheDocument();
    expect(tabla.getByText('1,240')).toBeInTheDocument();
    expect(tabla.getByText('$118.00')).toBeInTheDocument();
    // El segundo renglón trae el stock en 0 y los guiones de tela/costo.
    const filas = screen.getAllByTestId('fila-modelo');
    expect(within(filas[1] as HTMLElement).getByText('0')).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('la matriz del cajón consume el rollup `porColorTalla` del servidor (sin pivote local)', () => {
    const m = modelo(1, '501');
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m)));
    useExistenciasPtMock.mockReturnValue({
      data: {
        filas: [],
        totalExistencia: 55,
        porColorTalla: [
          {
            idColor: 1,
            color: 'Rojo',
            idTalla: 1,
            etiquetaTalla: 'CH',
            ordenTalla: 1,
            existencia: 50,
          },
          {
            idColor: 1,
            color: 'Rojo',
            idTalla: 2,
            etiquetaTalla: 'M',
            ordenTalla: 2,
            existencia: 5,
          },
        ],
      },
      isPending: false,
      isError: false,
    });
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'inventario-pt.ver']),
    });

    fireEvent.click(screen.getByTestId('fila-modelo'));
    // La consulta pide el rollup al servidor (agrupar=color-talla) para ESTE modelo.
    expect(useExistenciasPtMock).toHaveBeenLastCalledWith(
      { idModelo: 1, agrupar: 'color-talla' },
      true,
    );
    const matriz = screen.getByTestId('matriz-existencia-modelo');
    expect(within(matriz).getByText('Rojo')).toBeInTheDocument();
    expect(within(matriz).getByText('50')).toBeInTheDocument();
    expect(within(matriz).getByText('5')).toBeInTheDocument();
    // Σ del renglón = 55 (las celdas ya vienen sumadas del servidor).
    expect(within(matriz).getByText('55')).toBeInTheDocument();
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
    // Abre el cajón (lectura): igual no debe haber acciones de escritura.
    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
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

    await usuario.click(screen.getByTestId('fila-modelo'));
    await usuario.click(screen.getByTestId('desactivar-modelo'));
    // El diálogo de confirmación es el que trae `confirmar-accion`.
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

  /**
   * Separación desarrollo/producción (§Post-F9.34 punto 2): el catálogo enseña PRODUCCIÓN por
   * default —Daniel pidió no llenarlo de los modelos de desarrollo que nunca salen— y los de
   * desarrollo quedan detrás del filtro, no escondidos.
   */
  it('el catálogo pide SOLO producción por default, y el filtro cambia el origen en la query', async () => {
    const usuario = userEvent.setup();
    useModelos.mockReturnValue(listaConDatos([modelo(1, '51001')]));
    renderConProveedores(<ModelosPagina />, { sesion: estadoSesionDePrueba(['modelos.ver']) });

    // El valor concreto importa: con 'todos' (o sin el campo) la vitrina traería los desarrollos.
    expect(ultimaQuery?.origen).toBe('produccion');

    await usuario.click(screen.getByTestId('origen-desarrollo'));
    expect(ultimaQuery?.origen).toBe('desarrollo');

    await usuario.click(screen.getByTestId('origen-todos'));
    expect(ultimaQuery?.origen).toBe('todos');
  });

  it('un modelo promovido enseña sus DOS números; uno de producción puro, sólo el suyo', () => {
    const promovido = modelo(1, '71050', true, {
      codigoDesarrollo: 'CYA-26-71-003',
      numeroProduccion: 71_050,
    });
    const dePlano = modelo(2, '51001', true, { numeroProduccion: 51_001 });
    useModelos.mockReturnValue(listaConDatos([promovido, dePlano]));
    renderConProveedores(<ModelosPagina />, { sesion: estadoSesionDePrueba(['modelos.ver']) });

    const filas = screen.getAllByTestId('fila-modelo');
    // El nº de desarrollo se conserva y se ve (D3): el texto exacto lo delata.
    expect(filas[0]).toHaveTextContent('desarrollo CYA-26-71-003');
    // Y al que nunca fue de desarrollo no se le inventa una segunda línea.
    expect(filas[1]).not.toHaveTextContent('desarrollo');
  });

  it('«Pasar a producción» sólo se ofrece en los modelos de DESARROLLO', async () => {
    const enDesarrollo = modelo(1, 'CYA-26-71-001', true, {
      origen: 'desarrollo',
      codigoDesarrollo: 'CYA-26-71-001',
    });
    useModelos.mockReturnValue(listaConDatos([enDesarrollo]));
    useFichaModelo.mockImplementation((id) =>
      id === undefined
        ? { data: undefined, isPending: false, isError: false, error: null }
        : fichaCargada(ficha(enDesarrollo)),
    );
    const usuario = userEvent.setup();
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    expect(await screen.findByTestId('pasar-a-produccion')).toBeInTheDocument();
  });

  it('un modelo YA de producción no ofrece «Pasar a producción»', async () => {
    const enProduccion = modelo(1, '71050', true, { numeroProduccion: 71_050 });
    useModelos.mockReturnValue(listaConDatos([enProduccion]));
    useFichaModelo.mockImplementation((id) =>
      id === undefined
        ? { data: undefined, isPending: false, isError: false, error: null }
        : fichaCargada(ficha(enProduccion)),
    );
    const usuario = userEvent.setup();
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    await screen.findByTestId('editar-modelo');
    expect(screen.queryByTestId('pasar-a-produccion')).toBeNull();
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

    // El cajón se abre con el modelo 777 (el del deep-link), no el primero (501).
    // El código va en el TÍTULO del cajón (h2, junto al badge de estado); la descripción, en el cuerpo.
    expect(await screen.findByRole('heading', { name: /777/ })).toBeInTheDocument();
    const detalle = screen.getByTestId('detalle-modelo');
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

    expect(await screen.findByRole('heading', { name: /DEEP-999/ })).toBeInTheDocument();
    const detalle = screen.getByTestId('detalle-modelo');
    expect(within(detalle).getByText('Fuera de página')).toBeInTheDocument();
    // Y aparece como un renglón inyectado en la lista (junto al visible 501): 2 renglones.
    expect(screen.getAllByTestId('fila-modelo')).toHaveLength(2);
    expect(screen.getAllByText('DEEP-999').length).toBeGreaterThan(0);
  });

  it('sin `state.idModelo` NO auto-abre el cajón; se abre al hacer clic en un renglón', () => {
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

    // Tabla-first: sin deep-link no hay detalle abierto.
    expect(screen.queryByTestId('detalle-modelo')).not.toBeInTheDocument();
    // Al hacer clic en el primer renglón se abre su ficha (501).
    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    expect(screen.getByRole('heading', { name: /501/ })).toBeInTheDocument();
  });

  it('deep-link con la ficha aún en vuelo: el cajón abre CARGANDO, no en blanco', async () => {
    // El modelo del deep-link no está en la página visible y su ficha todavía viaja.
    useModelos.mockReturnValue(listaConDatos([modelo(1, '501')]));
    useFichaModelo.mockImplementation((id) =>
      id === 999
        ? { data: undefined, isPending: true, isError: false, error: null }
        : id === undefined
          ? { data: undefined, isPending: false, isError: false, error: null }
          : fichaCargada(ficha(modelo(id, '501'))),
    );

    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
      rutaInicial: { pathname: '/modelos', state: { idModelo: 999 } },
    });

    expect(await screen.findByTestId('detalle-modelo-cargando')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Abriendo modelo…' })).toBeInTheDocument();
  });

  it('deep-link a un modelo que no se pudo traer: el cajón muestra el error del API', async () => {
    useModelos.mockReturnValue(listaConDatos([modelo(1, '501')]));
    useFichaModelo.mockImplementation((id) =>
      id === 999
        ? {
            data: undefined,
            isPending: false,
            isError: true,
            error: new ErrorDeApi({ codigo: 'NO_ENCONTRADO', mensaje: 'El modelo no existe.' }),
          }
        : id === undefined
          ? { data: undefined, isPending: false, isError: false, error: null }
          : fichaCargada(ficha(modelo(id, '501'))),
    );

    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
      rutaInicial: { pathname: '/modelos', state: { idModelo: 999 } },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('El modelo no existe.');
    expect(screen.queryByTestId('detalle-modelo-cargando')).not.toBeInTheDocument();
  });

  /**
   * Ancla del arreglo de `arte.spec.ts` / `galeria-modelos.spec.ts` (CI de V1-E3d): el cajón del
   * modelo es MODAL (Radix `Dialog` → `hideOthers()`), así que mientras está abierto todo lo que
   * queda fuera del portal lleva `aria-hidden="true"` y SALE del árbol de accesibilidad. El
   * `<h1>Modelos</h1>` sigue en el DOM, pero ni `getByRole` de Testing Library ni el de Playwright
   * lo alcanzan. Es el comportamiento CORRECTO de un modal: por eso los e2e del deep-link se
   * anclan en la URL y en el cajón, nunca en el encabezado del fondo. Si esta prueba se pone en
   * rojo es que el cajón dejó de ser modal — y entonces sí se puede volver a anclar en el <h1>.
   */
  it('deep-link: con el cajón abierto, el <h1> del fondo sale del árbol de accesibilidad', async () => {
    const m999 = modelo(999, 'DEEP-999');
    useModelos.mockReturnValue(listaConDatos([modelo(1, '501')]));
    useFichaModelo.mockImplementation((id) =>
      id === 999
        ? fichaCargada(ficha(m999))
        : id === undefined
          ? { data: undefined, isPending: false, isError: false, error: null }
          : fichaCargada(ficha(modelo(id, '501'))),
    );

    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
      rutaInicial: { pathname: '/modelos', state: { idModelo: 999 } },
    });

    await screen.findByTestId('detalle-modelo');
    // El encabezado SIGUE en el DOM…
    expect(document.querySelector('h1')).toHaveTextContent('Modelos');
    // …pero no es consultable por rol mientras el modal esté encima. (En Testing Library el
    // `name` en cadena YA es coincidencia exacta; el `exact: true` del e2e es de Playwright.)
    expect(screen.queryByRole('heading', { name: 'Modelos' })).not.toBeInTheDocument();
    // Lo que SÍ es consultable —y en lo que se anclan los e2e— es el cajón con su modelo.
    expect(screen.getByRole('heading', { name: /DEEP-999/ })).toBeInTheDocument();
  });

  // ── ⭐ V1-E7b — «Crear versión» (§Post-F9.110) ──────────────────────────────

  /** Un modelo de DESARROLLO, que es el que puede versionarse (el sufijo cuelga de su código). */
  function enDesarrollo(id = 1, codigo = 'CYA-26-71-001'): Modelo {
    return modelo(id, codigo, true, { origen: 'desarrollo', codigoDesarrollo: codigo });
  }

  it('⭐ el botón «Crear versión» se pinta con `modelos.aprobar-receta`, aunque NO se administren modelos', () => {
    // Es el reparto que pidió Daniel: Gerencial (Aurora) aprueba recetas pero NO administra
    // catálogos. Si el botón colgara de `modelos.administrar`, ella no lo vería nunca.
    const m = enDesarrollo();
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.aprobar-receta']),
    });

    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    expect(screen.getByTestId('crear-version-modelo')).toBeInTheDocument();
    // Y sin administrar, las acciones de escritura del catálogo siguen escondidas.
    expect(screen.queryByTestId('editar-modelo')).not.toBeInTheDocument();
  });

  it('⭐ sin `modelos.aprobar-receta` NO se pinta, aunque se administren modelos', () => {
    const m = enDesarrollo();
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    expect(screen.queryByTestId('crear-version-modelo')).not.toBeInTheDocument();
  });

  it('⭐ un modelo SIN número de desarrollo no ofrece el botón (no se abre una puerta cerrada)', () => {
    // El servidor lo rechaza porque el sufijo cuelga del código de desarrollo. Enseñar el botón
    // sería mandar al usuario a una puerta que ya está cerrada.
    const migrado = modelo(1, '71001');
    useModelos.mockReturnValue(listaConDatos([migrado]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(migrado)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.aprobar-receta']),
    });

    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    expect(screen.queryByTestId('crear-version-modelo')).not.toBeInTheDocument();
  });

  it('pide confirmación diciendo qué va a pasar, y sólo entonces crea la versión', async () => {
    const usuario = userEvent.setup();
    const m = enDesarrollo(7);
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.aprobar-receta']),
    });

    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    await usuario.click(screen.getByTestId('crear-version-modelo'));

    // Abre confirmación y todavía NO llamó al API.
    expect(await screen.findByText('Crear versión del modelo')).toBeInTheDocument();
    expect(screen.getByText(/queda igual/)).toBeInTheDocument();
    // Nombra de qué modelo nace. NO afirma un código de ejemplo: el sufijo lo decide el servidor
    // leyendo la familia bajo lock, y el que había aquí era justo el que mentía (ver la prueba
    // del padre `-01`, abajo).
    expect(
      within(await screen.findByRole('dialog')).getByText('CYA-26-71-001'),
    ).toBeInTheDocument();
    expect(crearVersionMutate).not.toHaveBeenCalled();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(crearVersionMutate).toHaveBeenCalledTimes(1);
    expect(crearVersionMutate.mock.calls[0]?.[0]).toEqual({ id: 7 });
  });

  it('⭐ al versionar una VERSIÓN, el diálogo NO promete un código ANIDADO', async () => {
    // 🔴 EL CASO QUE LA PRUEBA DE ARRIBA NO CUBRÍA, y por el que un defecto vivió en verde: con un
    // padre RAÍZ, «código del padre + -01» acierta por casualidad. Con un padre que YA es versión,
    // el mismo texto escribía `CYA-26-71-001-01-01` — la forma anidada que Daniel descartó
    // (*"en tres temporadas hay -01-02-01 y nadie lo lee"*), enseñada como promesa a quien aprueba.
    // El servidor siempre creó bien el `-02`; el que mentía era el diálogo.
    const usuario = userEvent.setup();
    const v1 = modelo(9, 'CYA-26-71-001-01', true, {
      origen: 'desarrollo',
      codigoDesarrollo: 'CYA-26-71-001-01',
      versionDesarrollo: 1,
      idModeloPadre: 7,
      codigoPadre: 'CYA-26-71-001',
    });
    useModelos.mockReturnValue(listaConDatos([v1]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(v1)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.aprobar-receta']),
    });

    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    await usuario.click(screen.getByTestId('crear-version-modelo'));
    const dialogo = await screen.findByRole('dialog');

    // Ni el código anidado exacto…
    expect(dialogo).not.toHaveTextContent('CYA-26-71-001-01-01');
    // …ni ningún otro sufijo colgado del código del padre (`-01-02`, `-01-2`…): la familia se
    // numera contra la RAÍZ, así que cualquier cosa que cuelgue del `-01` es falsa.
    expect(dialogo.textContent ?? '').not.toMatch(/CYA-26-71-001-01-\d/);

    // Y no pasa por callarse: sigue diciendo de qué modelo nace y qué se hereda.
    expect(within(dialogo).getByText('CYA-26-71-001-01')).toBeInTheDocument();
    expect(within(dialogo).getByText(/la misma receta/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/queda igual/)).toBeInTheDocument();
  });

  it('enseña el LINAJE de una versión con liga al modelo del que nació', () => {
    const version = modelo(9, 'CYA-26-71-001-02', true, {
      origen: 'desarrollo',
      codigoDesarrollo: 'CYA-26-71-001-02',
      versionDesarrollo: 2,
      idModeloPadre: 7,
      codigoPadre: 'CYA-26-71-001-01',
    });
    useModelos.mockReturnValue(listaConDatos([version]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(version)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });

    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
    const linaje = screen.getByTestId('linaje-modelo');
    expect(linaje).toHaveTextContent('Versión 2 de');
    expect(within(linaje).getByRole('button', { name: 'CYA-26-71-001-01' })).toBeInTheDocument();
  });

  // ── ⭐ V1-E7d — LA REVISIÓN antes de mandar a producir (§Post-F9.110) ────────

  /**
   * ⚠️ Lo que estas pruebas fijan es lo que la PANTALLA enseña y manda; NO son la garantía de que
   * una versión sin revisar no se produzca — eso lo niega el backend dentro del núcleo de la
   * promoción, y por eso cubre también «generar la OP». Con la URL a mano, un botón escondido no
   * protege nada.
   */
  function versionPendiente(extra: Partial<Modelo> = {}): Modelo {
    return modelo(9, 'CYA-26-71-001-01', true, {
      origen: 'desarrollo',
      codigoDesarrollo: 'CYA-26-71-001-01',
      versionDesarrollo: 1,
      idModeloPadre: 7,
      codigoPadre: 'CYA-26-71-001',
      revisionEstado: 'pendiente',
      ...extra,
    });
  }

  function abrirModelo(m: Modelo, permisos: string[]): void {
    useModelos.mockReturnValue(listaConDatos([m]));
    useFichaModelo.mockReturnValue(fichaCargada(ficha(m)));
    renderConProveedores(<ModelosPagina />, {
      sesion: estadoSesionDePrueba(permisos as never),
    });
    fireEvent.click(screen.getAllByTestId('fila-modelo')[0] as HTMLElement);
  }

  it('⭐ una versión PENDIENTE lo dice, y con `modelos.aprobar-receta` ofrece las dos firmas', () => {
    abrirModelo(versionPendiente(), ['modelos.ver', 'modelos.aprobar-receta']);

    expect(screen.getByTestId('revision-modelo')).toHaveTextContent('Revisión pendiente');
    expect(screen.getByTestId('aprobar-revision-modelo')).toBeInTheDocument();
    expect(screen.getByTestId('rechazar-revision-modelo')).toBeInTheDocument();
  });

  it('⭐ una versión SIN firma (`revisionEstado` en NULL) también se ve y SE PUEDE firmar', () => {
    // 🔴 EL CALLEJÓN SIN SALIDA que dejaba el predicado viejo. La pantalla preguntaba «¿tiene
    // `revisionEstado`?» para decidir si esto es una versión — un PROXY que sólo acierta porque
    // «crear versión» siempre escribe `'pendiente'`. Las versiones que nacieron antes de que esta
    // etapa se desplegara (las que estrenó V1-E7b en `prueba`, que no tenían ni la columna) llegan
    // con NULL: el backend las lee como PENDIENTES y les niega producción, y aquí no se pintaba ni
    // el chip ni los botones. Resultado: una versión que no se puede producir y que nadie puede
    // firmar. Ahora las dos puertas preguntan lo mismo —el LINAJE—, y el null se pinta como lo que
    // significa: nadie la ha revisado.
    abrirModelo(versionPendiente({ revisionEstado: null }), [
      'modelos.ver',
      'modelos.aprobar-receta',
    ]);

    const chip = screen.getByTestId('revision-modelo');
    expect(chip).toHaveTextContent('Revisión pendiente');
    expect(chip).toHaveTextContent('Nadie la ha revisado todavía');
    expect(screen.getByTestId('aprobar-revision-modelo')).toBeInTheDocument();
    expect(screen.getByTestId('rechazar-revision-modelo')).toBeInTheDocument();
  });

  it('⭐ sin `modelos.aprobar-receta` se VE el estado pero no se puede firmar', () => {
    // El estado es información que le sirve a cualquiera que mire el modelo; la firma no.
    abrirModelo(versionPendiente(), ['modelos.ver', 'modelos.administrar']);

    expect(screen.getByTestId('revision-modelo')).toHaveTextContent('Revisión pendiente');
    expect(screen.queryByTestId('aprobar-revision-modelo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rechazar-revision-modelo')).not.toBeInTheDocument();
  });

  it('⭐ un modelo migrado (producción) no enseña revisión ninguna', () => {
    // Los ~4,987 migrados del Access: esta etapa no les cambió nada, ni siquiera en pantalla.
    abrirModelo(modelo(1, '71001'), ['modelos.ver', 'modelos.aprobar-receta']);

    expect(screen.queryByTestId('revision-modelo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('aprobar-revision-modelo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rechazar-revision-modelo')).not.toBeInTheDocument();
  });

  it('⭐ un DESARROLLO NORMAL (que no nació de otro modelo) tampoco lleva revisión', () => {
    // 🔴 EL CASO QUE LA PRUEBA DE ARRIBA NO CUBRÍA, y que dejó viva una mutación: con un modelo de
    // PRODUCCIÓN, los botones se esconden igual por el filtro `origen === 'desarrollo'`, así que
    // quitar la condición de la revisión no rompía nada. El caso que de verdad la ejercita es un
    // desarrollo normal —el caso COMÚN del módulo—: es de desarrollo y NO es versión, así que la
    // revisión no le toca. Si la condición desapareciera, aquí saldrían dos botones que no van.
    const desarrolloNormal = modelo(3, 'CYA-26-71-005', true, {
      origen: 'desarrollo',
      codigoDesarrollo: 'CYA-26-71-005',
      revisionEstado: null,
    });
    abrirModelo(desarrolloNormal, ['modelos.ver', 'modelos.aprobar-receta']);

    expect(screen.queryByTestId('revision-modelo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('aprobar-revision-modelo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rechazar-revision-modelo')).not.toBeInTheDocument();
    // Y lo que SÍ le toca sigue estando: versionarlo es lo que le abre la puerta a la revisión.
    expect(screen.getByTestId('crear-version-modelo')).toBeInTheDocument();
  });

  it('una versión APROBADA ya no ofrece aprobar (no hay nada que firmar dos veces)', () => {
    abrirModelo(
      versionPendiente({
        revisionEstado: 'aprobada',
        revisadoPor: 'Aurora',
        revisadoEn: '2026-08-25T18:00:00.000Z',
      }),
      ['modelos.ver', 'modelos.aprobar-receta'],
    );

    const chip = screen.getByTestId('revision-modelo');
    expect(chip).toHaveTextContent('Revisión aprobada');
    expect(chip).toHaveTextContent('por Aurora');
    expect(screen.queryByTestId('aprobar-revision-modelo')).not.toBeInTheDocument();
    expect(screen.getByTestId('rechazar-revision-modelo')).toBeInTheDocument();
  });

  it('una versión RECHAZADA enseña el MOTIVO (que es lo único que sirve para corregir)', () => {
    abrirModelo(
      versionPendiente({
        revisionEstado: 'rechazada',
        revisadoPor: 'Daniel',
        revisadoEn: '2026-08-25T18:00:00.000Z',
        revisionNota: 'el cierre que se quitó sí costaba',
      }),
      ['modelos.ver', 'modelos.aprobar-receta'],
    );

    expect(screen.getByTestId('revision-modelo')).toHaveTextContent(
      'el cierre que se quitó sí costaba',
    );
  });

  // ── ⭐ V1-E7e — La aprobación se invalida si la receta cambia (§Post-F9.116) ──

  /**
   * Desde V1-E7e, «pendiente» ya no significa una sola cosa: puede ser una versión que nadie ha
   * mirado, o una que Aurora SÍ aprobó y perdió la firma porque después le cambiaron la receta.
   * La pantalla tiene que distinguirlas — si dijera "nadie la ha revisado" de la segunda, estaría
   * borrando en la cara del usuario el hecho de que hubo una firma y de qué la tumbó.
   */
  const NOTA_INVALIDACION =
    'Se INVALIDÓ automáticamente el 2026-08-25: después de aprobarse cambió las TELAS de la ' +
    'receta, así que la firma anterior ya no corresponde a lo que se va a fabricar. La ' +
    'aprobación era del 2026-08-12. Hay que volver a revisarla antes de mandarla a producir.';

  it('⭐ una versión INVALIDADA enseña POR QUÉ perdió la firma (no "nadie la ha revisado")', () => {
    abrirModelo(
      // Así queda la fila tras la invalidación: pendiente, SIN firmante (nadie ha revisado la
      // receta que hay ahora) y con la nota que cuenta qué pasó.
      versionPendiente({ revisionEstado: 'pendiente', revisionNota: NOTA_INVALIDACION }),
      ['modelos.ver', 'modelos.aprobar-receta'],
    );

    const chip = screen.getByTestId('revision-modelo');
    expect(chip).toHaveTextContent('Revisión pendiente');
    expect(chip).toHaveTextContent('cambió las TELAS');
    // 🔴 La frase que MENTIRÍA: aquí sí hubo revisión, y se perdió.
    expect(chip).not.toHaveTextContent('Nadie la ha revisado todavía');
    // Y (d) no es un callejón sin salida: se vuelve a firmar con el mismo permiso.
    expect(screen.getByTestId('aprobar-revision-modelo')).toBeInTheDocument();
  });

  it('una versión pendiente que NADIE ha mirado sigue diciéndolo tal cual', () => {
    // El otro lado del mismo `if`: sin nota, el texto de siempre. Si alguien cambiara la condición
    // por el estado en vez de por la nota, este caso se quedaría mudo.
    abrirModelo(versionPendiente({ revisionNota: null }), [
      'modelos.ver',
      'modelos.aprobar-receta',
    ]);

    expect(screen.getByTestId('revision-modelo')).toHaveTextContent('Nadie la ha revisado todavía');
  });

  it('una versión APROBADA no arrastra la nota de la firma anterior', () => {
    // La nota de una aprobación es una observación del aprobador, no una alarma: enseñarla en rojo
    // junto al chip verde diría que algo está mal cuando no lo está.
    abrirModelo(
      versionPendiente({
        revisionEstado: 'aprobada',
        revisadoPor: 'Aurora',
        revisadoEn: '2026-08-25T18:00:00.000Z',
        revisionNota: 'la revisé con Daniel',
      }),
      ['modelos.ver', 'modelos.aprobar-receta'],
    );

    const chip = screen.getByTestId('revision-modelo');
    expect(chip).toHaveTextContent('por Aurora');
    expect(chip).not.toHaveTextContent('la revisé con Daniel');
  });

  it('⭐ el rechazo NO se manda sin motivo, y cuando lo hay lo lleva', async () => {
    const usuario = userEvent.setup();
    abrirModelo(versionPendiente(), ['modelos.ver', 'modelos.aprobar-receta']);

    await usuario.click(screen.getByTestId('rechazar-revision-modelo'));
    const confirmar = await screen.findByTestId('confirmar-revision-modelo');
    // Sin motivo el botón está cerrado: un rechazo mudo no le dice nada a quien tiene que corregir.
    expect(confirmar).toBeDisabled();

    await usuario.type(screen.getByTestId('modelo-revision-texto'), 'el pantone no es el de la OP');
    await usuario.click(screen.getByTestId('confirmar-revision-modelo'));

    expect(rechazarRevisionMutate).toHaveBeenCalledTimes(1);
    expect(rechazarRevisionMutate.mock.calls[0]?.[0]).toEqual({
      id: 9,
      texto: 'el pantone no es el de la OP',
    });
  });

  it('la aprobación sí se puede firmar sin escribir nada (la nota es opcional)', async () => {
    const usuario = userEvent.setup();
    abrirModelo(versionPendiente(), ['modelos.ver', 'modelos.aprobar-receta']);

    await usuario.click(screen.getByTestId('aprobar-revision-modelo'));
    await usuario.click(await screen.findByTestId('confirmar-revision-modelo'));

    expect(aprobarRevisionMutate).toHaveBeenCalledTimes(1);
    expect(aprobarRevisionMutate.mock.calls[0]?.[0]).toEqual({ id: 9, texto: '' });
  });
});
