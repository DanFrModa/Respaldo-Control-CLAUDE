import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorDeApi } from '@/api/errores';
import type { Desarrollo, EstadoDesarrollo } from '@/api/desarrollos';
import type { Proyecto, ProyectoDetalle, ProyectosPagina as TipoPagina } from '@/api/proyectos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ProyectosPagina } from './ProyectosPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `useProyectos` captura la query.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useProyectos = vi.fn<(query: unknown) => EstadoConsulta>();
const archivarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;
let detalle: ProyectoDetalle | undefined;

vi.mock('@/api/proyectos', () => ({
  useProyectos: (query: Record<string, unknown>) => {
    // La página también consulta un CONTEO para el KPI (porPagina:1); aquí interesa la query
    // del LISTADO (la que refleja búsqueda/filtros), así que el conteo no se registra.
    if (query['porPagina'] !== 1) {
      ultimaQuery = query;
    }
    return useProyectos(query);
  },
  useProyecto: () => ({ data: detalle, isPending: false, isError: false, error: null }),
  useCrearProyecto: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarProyecto: () => ({ mutate: vi.fn(), isPending: false }),
  useArchivarProyecto: () => ({ mutate: archivarMutate, isPending: false }),
  useDesarchivarProyecto: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/desarrollos', () => ({
  useReactivarDesarrollo: () => ({ mutate: vi.fn(), isPending: false }),
  useCrearDesarrollo: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApagarDesarrollo: () => ({ mutate: vi.fn(), isPending: false }),
}));

// KPIs de servidor (tablero por estado, F8-E6): inertes en estas pruebas.
vi.mock('@/api/liga-orden', () => ({
  useTableroDesarrollos: () => ({ data: undefined, isPending: false, isError: false }),
}));

// Selectores de los diálogos/filtros: inertes.
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isPending: false }),
  useDepartamentosCliente: () => ({ data: [], isPending: false }),
}));
vi.mock('@/api/temporadas', () => ({
  useTemporadas: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/modelos', () => ({
  useModelos: () => ({ data: { datos: [] }, isPending: false }),
  useCrearModelo: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

/** Un desarrollo de ejemplo. */
function desarrollo(id: number, codigo: string, estado: EstadoDesarrollo): Desarrollo {
  const apagado = estado === 'apagado';
  return {
    id,
    idProyecto: 1,
    idModelo: id * 10,
    codigoModelo: codigo,
    descripcionModelo: null,
    numeroCliente: 'CLI-1',
    notas: null,
    estado,
    apagado,
    apagadoEn: apagado ? '2026-07-04T00:00:00.000Z' : null,
    apagadoPorId: apagado ? 'usuario-x' : null,
    motivoApagado: apagado ? 'Fuera de temporada' : null,
    creadoEn: '2026-07-04T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-04T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Un proyecto (lista) de ejemplo. */
function proyecto(id: number, folio: number, nombre: string, archivado = false): Proyecto {
  return {
    id,
    folio,
    idEmpresa: 1,
    idCliente: 3,
    cliente: 'C&A',
    idClienteDepartamento: 5,
    departamento: 'NIÑOS',
    nombre,
    idTemporada: null,
    temporada: null,
    notas: null,
    archivado,
    conteos: {
      total: 1,
      enDesarrollo: 1,
      cotizado: 0,
      enLista: 0,
      ligadoProduccion: 0,
      apagado: 0,
    },
    creadoEn: '2026-07-04T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-04T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function pagina(datos: Proyecto[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

function consultaConDatos(datos: Proyecto[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

const PERM_TODOS = ['desarrollo.ver', 'desarrollo.administrar'] as const;

describe('<ProyectosPagina>', () => {
  beforeEach(() => {
    useProyectos.mockReset();
    archivarMutate.mockReset();
    ultimaQuery = undefined;
    detalle = {
      ...proyecto(1, 101, 'Joggers'),
      desarrollos: [desarrollo(1, 'A-100', 'en-desarrollo')],
    };
  });

  it('lista los proyectos que devuelve el API', () => {
    useProyectos.mockReturnValue(
      consultaConDatos([proyecto(1, 101, 'Joggers'), proyecto(2, 102, 'Básicos')]),
    );
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    expect(screen.getAllByTestId('fila-proyecto')).toHaveLength(2);
    expect(screen.getByText(/Básicos/)).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay resultados', () => {
    useProyectos.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba(['desarrollo.ver']) });

    expect(screen.getByText('No hay proyectos que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el error y un botón de reintento cuando falla', () => {
    useProyectos.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba(['desarrollo.ver']) });

    expect(screen.getByText('No se pudo cargar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba(['desarrollo.ver']) });

    expect(screen.queryByTestId('nuevo-proyecto')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agregar-desarrollo')).not.toBeInTheDocument();
  });

  it('al hacer clic en un renglón abre el proyecto (drill-in) con sus desarrollos y estado', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    // El drill-in está cerrado hasta elegir un renglón (patrón tabla-first R9).
    expect(screen.queryByTestId('detalle-proyecto')).not.toBeInTheDocument();
    await usuario.click(screen.getByTestId('fila-proyecto'));

    const panel = screen.getByTestId('detalle-proyecto');
    const tarjeta = within(panel).getByTestId('fila-desarrollo');
    expect(within(tarjeta).getAllByText(/A-100/).length).toBeGreaterThan(0);
    expect(within(tarjeta).getByText('En desarrollo')).toBeInTheDocument();
  });

  it('pide confirmación antes de archivar y llama a la mutación al confirmar', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(7, 107, 'Joggers')]));
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });

    await usuario.click(screen.getByTestId('fila-proyecto'));
    await usuario.click(screen.getByTestId('desactivar-proyecto'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByRole('heading', { name: 'Archivar proyecto' })).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(archivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('la búsqueda se refleja en la consulta del API', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba(['desarrollo.ver']) });

    expect(ultimaQuery?.busqueda).toBeUndefined();
    await usuario.type(screen.getByTestId('buscar-proyecto'), 'joggers');
    await vi.waitFor(() => expect(ultimaQuery?.busqueda).toBe('joggers'));
  });
});
