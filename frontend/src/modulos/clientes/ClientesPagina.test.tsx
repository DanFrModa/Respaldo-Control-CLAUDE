import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Cliente, ClientesPagina as TipoPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ClientesPagina } from './ClientesPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `useClientes` captura la
// query con la que se le llama, para verificar la búsqueda. Los hooks de campos (que
// usa el editor del detalle) se mockean a estados inertes.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useClientes = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;

vi.mock('@/api/clientes', () => ({
  useClientes: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useClientes(query);
  },
  useCrearCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarCliente: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarCliente: () => ({ mutate: reactivarMutate, isPending: false }),
  // Hooks del editor de campos (montado en el detalle): inertes.
  useCamposCliente: () => ({ data: [], isPending: false, isError: false, error: null }),
  useAgregarCampoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarCampoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarCampoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivarCampoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  // Hooks del editor de departamentos (montado en el detalle): inertes.
  useDepartamentosCliente: () => ({ data: [], isPending: false, isError: false, error: null }),
  useAgregarDepartamentoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarDepartamentoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarDepartamentoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivarDepartamentoCliente: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Hooks de los FACTORES de lista (sección del detalle): inertes.
vi.mock('@/api/cliente-factores', () => ({
  useFactoresCliente: () => ({ data: [], isPending: false, isError: false, error: null }),
  useGuardarFactoresCliente: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Cliente de ejemplo (con sus campos embebidos, vacíos por defecto). */
function cliente(id: number, nombre: string, activo = true): Cliente {
  return {
    id,
    nombre,
    abreviatura: null,
    razonSocial: null,
    contacto: null,
    telefono: null,
    email: null,
    direccion: null,
    rfc: null,
    diasCredito: null,
    activo,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    campos: [],
  };
}

/** Respuesta paginada de ejemplo con los clientes dados. */
function pagina(datos: Cliente[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos" (forma mínima que usa el componente). */
function consultaConDatos(datos: Cliente[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<ClientesPagina>', () => {
  beforeEach(() => {
    useClientes.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
    ultimaQuery = undefined;
  });

  it('lista los clientes que devuelve el API', () => {
    useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool'), cliente(2, 'Pumas')]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'clientes.administrar']),
    });

    expect(screen.getAllByTestId('fila-cliente')).toHaveLength(2);
    // Tabla-first: el detalle NO se auto-abre; ambos clientes salen en sus renglones.
    expect(screen.getByText('Liverpool')).toBeInTheDocument();
    expect(screen.getByText('Pumas')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay resultados', () => {
    useClientes.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'clientes.administrar']),
    });

    expect(screen.getByText('No hay clientes que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un botón de reintento cuando la consulta falla', () => {
    useClientes.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'clientes.administrar']),
    });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool')]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver']),
    });

    expect(screen.queryByTestId('nuevo-cliente')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-cliente')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-cliente')).not.toBeInTheDocument();
    // Sin permiso de administrar el editor de campos no se monta (modo lectura).
    expect(screen.queryByTestId('editor-campos-cliente')).not.toBeInTheDocument();
  });

  it('pide confirmación antes de desactivar y llama a la mutación al confirmar', async () => {
    const usuario = userEvent.setup();
    useClientes.mockReturnValue(consultaConDatos([cliente(7, 'Liverpool Viejo')]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'clientes.administrar']),
    });

    // Tabla-first: primero se abre el cajón haciendo clic en el renglón.
    await usuario.click(screen.getByTestId('fila-cliente'));
    await usuario.click(screen.getByTestId('desactivar-cliente'));

    // El diálogo de confirmación es el que trae el botón `confirmar-accion` (el cajón
    // también es role="dialog").
    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('un cliente inactivo ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useClientes.mockReturnValue(consultaConDatos([cliente(9, 'Cliente Apagado', false)]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'clientes.administrar']),
    });

    await usuario.click(screen.getByTestId('fila-cliente'));
    // El estado "Inactivo" se pinta en el título del cajón.
    const cajon = screen.getByTestId('detalle-cliente').closest('[data-slot="cajon-detalle"]');
    expect(cajon).not.toBeNull();
    expect(within(cajon as HTMLElement).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByTestId('activar-cliente')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-cliente')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-cliente'));
    expect(screen.queryByTestId('confirmar-accion')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  it('la búsqueda se refleja en la consulta del API', async () => {
    const usuario = userEvent.setup();
    useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool')]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver']),
    });

    expect(ultimaQuery?.busqueda).toBeUndefined();
    await usuario.type(screen.getByTestId('buscar-cliente'), 'liver');
    // El debounce es de 300ms; tras escribir, la query termina llevando la búsqueda.
    await vi.waitFor(() => expect(ultimaQuery?.busqueda).toBe('liver'));
  });

  it('muestra el contacto del cliente en el detalle (solo lo capturado)', async () => {
    const usuario = userEvent.setup();
    const conContacto = cliente(3, 'Liverpool');
    conContacto.contacto = 'Ana López';
    conContacto.email = 'compras@liverpool.mx';
    useClientes.mockReturnValue(consultaConDatos([conContacto]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver']),
    });

    await usuario.click(screen.getByTestId('fila-cliente'));
    const detalle = screen.getByTestId('detalle-cliente');
    expect(within(detalle).getByText('Datos de contacto')).toBeInTheDocument();
    expect(within(detalle).getByText('Ana López')).toBeInTheDocument();
    expect(within(detalle).getByText('compras@liverpool.mx')).toBeInTheDocument();
  });

  it('muestra la sección de campos de referencia (D7) y el editor si puede administrar', async () => {
    const usuario = userEvent.setup();
    useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool')]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'clientes.administrar']),
    });

    await usuario.click(screen.getByTestId('fila-cliente'));
    const detalle = screen.getByTestId('detalle-cliente');
    expect(within(detalle).getByText('Campos de referencia (D7)')).toBeInTheDocument();
    expect(within(detalle).getByTestId('editor-campos-cliente')).toBeInTheDocument();
  });

  // §Post-F9.68 — esconder, no negar: los factores SON dinero, así que sin
  // `consultas.ver-importes` la SECCIÓN ENTERA (con su rótulo) desaparece, en vez
  // de mostrar un letrero de permiso adentro. Va con su gemela positiva.
  it('sin permiso de importes la sección de factores no existe (ni su rótulo)', async () => {
    const usuario = userEvent.setup();
    useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool')]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'listas.ver']),
    });

    await usuario.click(screen.getByTestId('fila-cliente'));
    const detalle = screen.getByTestId('detalle-cliente');
    expect(within(detalle).queryByText(/Factores de lista de precios/i)).toBeNull();
    expect(within(detalle).queryByTestId('editor-factores-cliente')).toBeNull();
    expect(detalle.textContent).not.toMatch(/permiso/i);
  });

  it('CON permiso de importes la sección de factores sí aparece (gemela positiva)', async () => {
    const usuario = userEvent.setup();
    useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool')]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'listas.ver', 'consultas.ver-importes']),
    });

    await usuario.click(screen.getByTestId('fila-cliente'));
    const detalle = screen.getByTestId('detalle-cliente');
    expect(within(detalle).getByText(/Factores de lista de precios/i)).toBeInTheDocument();
    expect(within(detalle).getByTestId('editor-factores-cliente')).toBeInTheDocument();
  });

  it('en modo lectura lista los campos embebidos del cliente sin acciones', async () => {
    const usuario = userEvent.setup();
    const conCampos = cliente(4, 'Liverpool');
    conCampos.campos = [
      {
        id: 10,
        idCliente: 4,
        etiqueta: 'No. pedido',
        tipo: 'TEXTO',
        orden: 0,
        activo: true,
        creadoEn: '2026-01-01T00:00:00.000Z',
        creadoPorId: null,
        modificadoEn: '2026-01-01T00:00:00.000Z',
        modificadoPorId: null,
      },
    ];
    useClientes.mockReturnValue(consultaConDatos([conCampos]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver']),
    });

    await usuario.click(screen.getByTestId('fila-cliente'));
    const lectura = screen.getByTestId('campos-solo-lectura');
    expect(within(lectura).getByText('No. pedido')).toBeInTheDocument();
    // No hay editor ni botones de acción de campo.
    expect(screen.queryByTestId('editor-campos-cliente')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nuevo-campo')).not.toBeInTheDocument();
  });
});
