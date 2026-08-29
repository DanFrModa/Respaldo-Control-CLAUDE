import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorDeApi } from '@/api/errores';
import type { Desarrollo, EstadoDesarrollo } from '@/api/desarrollos';
import type { CandidatoLista, DescartadoLista, DiagnosticoCandidatos } from '@/api/listas-precios';
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
  useCrearDesarrolloModeloNuevo: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  // Selectores del alta de desarrollo con MODELO NUEVO (V1-E3n): de ellos salen los dos dígitos
  // del código que arma el sistema.
  useGeneros: () => ({ data: [], isPending: false }),
}));
vi.mock('@/api/calidad', () => ({
  useTiposProductoActivos: () => ({ data: { datos: [] }, isPending: false }),
}));
// Candidatos a la lista: es la FUENTE DE VERDAD del botón «Generar lista de precios» (la misma
// consulta que abre el diálogo). Se controla por prueba para cubrir los dos lados.
let candidatos: {
  data: DiagnosticoCandidatos | undefined;
  isPending: boolean;
  isError: boolean;
  error: ErrorDeApi | null;
};
vi.mock('@/api/listas-precios', () => ({
  useCandidatosLista: () => candidatos,
  useCrearLista: () => ({ mutate: vi.fn(), isPending: false }),
}));

/**
 * Un DESCARTADO de ejemplo (V1-E8f): el backend ya clasificó POR QUÉ ese modelo no puede entrar a
 * una lista, y el frontend sólo lo redacta.
 */
function descartado(
  idDesarrollo: number,
  codigoModelo: string,
  motivo: DescartadoLista['motivo'],
  versionPrecosto: number | null = null,
): DescartadoLista {
  return {
    idDesarrollo,
    idProyecto: 1,
    folioProyecto: 101,
    nombreProyecto: 'Joggers',
    codigoModelo,
    numeroCliente: null,
    motivo,
    versionPrecosto,
    idLista: null,
    folioLista: null,
  };
}

/** Un candidato de ejemplo (el backend ya aplicó "congelado + sin renglón de lista"). */
function candidato(idDesarrollo: number, codigoModelo: string): CandidatoLista {
  return {
    idDesarrollo,
    idProyecto: 1,
    folioProyecto: 101,
    nombreProyecto: 'Joggers',
    codigoModelo,
    descripcionModelo: null,
    numeroCliente: null,
    idPrecosto: 500 + idDesarrollo,
    versionPrecosto: 1,
    costoTotal: 40,
  };
}

/** Un desarrollo de ejemplo. */
function desarrollo(id: number, codigo: string, estado: EstadoDesarrollo): Desarrollo {
  const apagado = estado === 'apagado';
  return {
    id,
    idProyecto: 1,
    idCliente: 3,
    cliente: 'C&A',
    idClienteDepartamento: 5,
    departamento: 'NIÑOS',
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

// Generar la lista exige AMBOS permisos de listas (la ruta del backend los encadena).
const PERM_TODOS = [
  'desarrollo.ver',
  'desarrollo.administrar',
  'listas.administrar',
  'listas.ver',
] as const;

describe('<ProyectosPagina>', () => {
  beforeEach(() => {
    useProyectos.mockReset();
    archivarMutate.mockReset();
    ultimaQuery = undefined;
    // Por default: sin candidatos (el proyecto de `detalle` sólo tiene un modelo en desarrollo).
    // Por default: ningún candidato y UN modelo descartado porque su precosto sigue en borrador
    // (V1-E8f) — el caso con el que Daniel se topó, y el que la mayoría de las pruebas asume.
    candidatos = {
      data: {
        datos: [],
        descartados: [descartado(1, 'A-100', 'precosto-borrador', 1)],
        faltanFactores: false,
      },
      isPending: false,
      isError: false,
      error: null,
    };
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
  it('el botón «Generar lista de precios» se DESHABILITA con su motivo cuando no hay precosto congelado', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    // El único modelo está "en-desarrollo": todavía NO hay precosto congelado → 0 candidatos.
    detalle = {
      ...proyecto(1, 101, 'Joggers'),
      desarrollos: [desarrollo(1, 'A-100', 'en-desarrollo')],
    };
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });
    await usuario.click(screen.getByTestId('fila-proyecto'));

    // Regla §Post-F9.16: el botón NO se esconde — se ve deshabilitado y CON la explicación.
    expect(screen.getByTestId('generar-lista-proyecto')).toBeDisabled();
    // V1-E8f: el motivo lo dicta el SERVIDOR y nombra el remedio con su nombre («Congelar
    // versión»), en vez de la disyunción que antes se adivinaba en el cliente.
    expect(screen.getByTestId('motivo-sin-lista')).toHaveTextContent(
      /1 con el precosto en borrador/i,
    );
    expect(screen.getByTestId('motivo-sin-lista')).toHaveTextContent(/Congelar versión/i);
  });

  it('con candidatos del servidor el botón se habilita y abre el diálogo con el cliente del proyecto', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    detalle = {
      ...proyecto(1, 101, 'Joggers'),
      desarrollos: [desarrollo(1, 'A-100', 'cotizado')],
    };
    candidatos = {
      data: { datos: [candidato(1, 'A-100')], descartados: [], faltanFactores: false },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });
    await usuario.click(screen.getByTestId('fila-proyecto'));

    expect(screen.queryByTestId('motivo-sin-lista')).not.toBeInTheDocument();
    const boton = screen.getByTestId('generar-lista-proyecto');
    expect(boton).toBeEnabled();

    await usuario.click(boton);
    // Llega precargado: cliente + departamento del proyecto, sin selectores que elegir.
    const contexto = await screen.findByTestId('crear-lista-contexto-proyecto');
    expect(contexto).toHaveTextContent('C&A');
    expect(contexto).toHaveTextContent('NIÑOS');
  });

  it('REGRESIÓN: un modelo LIGADO A PRODUCCIÓN que el servidor devuelve como candidato NO se bloquea', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    // `ligado-produccion` PISA a `en-lista`/`cotizado` en la precedencia del estado derivado: por el
    // estado no se puede saber si está o no en una lista. El backend sí lo devuelve como candidato
    // (filtra `listaLineas: none`, nunca las órdenes) → el botón tiene que quedar HABILITADO. Antes
    // se bloqueaba con el motivo FALSO "ya están en una lista de precios".
    detalle = {
      ...proyecto(1, 101, 'Joggers'),
      desarrollos: [desarrollo(1, 'A-100', 'ligado-produccion')],
    };
    candidatos = {
      data: { datos: [candidato(1, 'A-100')], descartados: [], faltanFactores: false },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });
    await usuario.click(screen.getByTestId('fila-proyecto'));

    expect(screen.getByTestId('generar-lista-proyecto')).toBeEnabled();
    expect(screen.queryByTestId('motivo-sin-lista')).not.toBeInTheDocument();
  });

  // ⭐ V1-E8f: la MEZCLA que antes obligaba a mentir. Con el estado derivado no se podía separar
  // "ya está en una lista" de "le falta congelar", y el texto salía como disyunción. Ahora el
  // servidor manda el motivo DE CADA MODELO, así que se dicen los dos hechos por separado y con su
  // conteo — sin disyunción y sin adivinar.
  it('con motivos MEZCLADOS los dice por separado, con su conteo, sin disyunción', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    detalle = {
      ...proyecto(1, 101, 'Joggers'),
      desarrollos: [
        desarrollo(1, 'A-100', 'ligado-produccion'),
        desarrollo(2, 'B-200', 'en-desarrollo'),
      ],
    };
    candidatos = {
      data: {
        datos: [],
        descartados: [
          descartado(1, 'A-100', 'ya-en-lista'),
          descartado(2, 'B-200', 'precosto-borrador', 2),
        ],
        faltanFactores: false,
      },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });
    await usuario.click(screen.getByTestId('fila-proyecto'));

    expect(screen.getByTestId('generar-lista-proyecto')).toBeDisabled();
    const motivo = screen.getByTestId('motivo-sin-lista');
    expect(motivo).toHaveTextContent(/1 con el precosto en borrador/i);
    expect(motivo).toHaveTextContent(/1 ya en una lista/i);
    // El remedio ACCIONABLE va primero: lo que el usuario puede arreglar ahora mismo.
    expect(motivo).toHaveTextContent(/Congelar versión/i);
    // Y ya NO se ofrece la disyunción vieja ("…o les falta congelar su precosto").
    expect(motivo).not.toHaveTextContent(/no se vuelven a incluir/i);
  });

  it('con TODOS los modelos apagados el motivo dice eso (no "no tiene modelos") y manda reactivar', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    // Sin modelos ACTIVOS, pero el proyecto SÍ tiene modelos: a un centímetro se pinta el control
    // «Mostrar apagados (1)», así que decir "todavía no tiene modelos" sería falso — y el remedio
    // que corresponde es REACTIVAR, no agregar.
    detalle = {
      ...proyecto(1, 101, 'Joggers'),
      desarrollos: [desarrollo(1, 'A-100', 'apagado')],
    };
    candidatos = {
      data: { datos: [], descartados: [descartado(1, 'A-100', 'apagado')], faltanFactores: false },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });
    await usuario.click(screen.getByTestId('fila-proyecto'));

    expect(screen.getByTestId('mostrar-apagados-desarrollos')).toBeInTheDocument();
    const motivo = screen.getByTestId('motivo-sin-lista');
    expect(motivo).toHaveTextContent(/apagados/i);
    expect(motivo).toHaveTextContent(/Reactívalos/i);
    expect(motivo).not.toHaveTextContent(/todavía no tiene modelos/i);
  });

  it('si la consulta de candidatos FALLA, lo dice en vez de inventar un motivo', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    candidatos = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'Se cayó el servidor.' }),
    };
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });
    await usuario.click(screen.getByTestId('fila-proyecto'));

    expect(screen.getByTestId('generar-lista-proyecto')).toBeDisabled();
    expect(screen.getByTestId('motivo-sin-lista')).toHaveTextContent('Se cayó el servidor.');
  });

  it('sin permiso de listas no ofrece generar la lista', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    renderConProveedores(<ProyectosPagina />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']),
    });
    await usuario.click(screen.getByTestId('fila-proyecto'));

    expect(screen.queryByTestId('generar-lista-proyecto')).not.toBeInTheDocument();
  });

  it('con listas.administrar pero SIN listas.ver tampoco se ofrece (el backend exige los dos)', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    renderConProveedores(<ProyectosPagina />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver', 'listas.administrar']),
    });
    await usuario.click(screen.getByTestId('fila-proyecto'));

    expect(screen.queryByTestId('generar-lista-proyecto')).not.toBeInTheDocument();
  });

  it('la ficha del desarrollo muestra el cliente y el departamento (heredados del proyecto)', async () => {
    const usuario = userEvent.setup();
    useProyectos.mockReturnValue(consultaConDatos([proyecto(1, 101, 'Joggers')]));
    renderConProveedores(<ProyectosPagina />, { sesion: estadoSesionDePrueba([...PERM_TODOS]) });
    await usuario.click(screen.getByTestId('fila-proyecto'));

    expect(screen.getByTestId('desarrollo-cliente')).toHaveTextContent('C&A / NIÑOS');
  });
});
