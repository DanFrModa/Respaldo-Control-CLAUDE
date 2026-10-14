import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Cliente, ClienteDepartamento, ClientesPagina as TipoPagina } from '@/api/tipos';
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
/** Ficha de UN cliente (deep-link V1-E8t): por defecto no hay ninguna. */
const useCliente = vi.fn<(id: number | undefined) => { data: Cliente | undefined }>(() => ({
  data: undefined,
}));
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
/** Departamentos del cliente en el cajón: vacíos por defecto (las pruebas de la 0.239 ponen dos). */
const useDepartamentosCliente = vi.fn(() => ({
  data: [] as ClienteDepartamento[],
  isPending: false,
  isError: false,
  error: null,
}));
let ultimaQuery: Record<string, unknown> | undefined;

vi.mock('@/api/clientes', () => ({
  useClientes: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useClientes(query);
  },
  useCliente: (id: number | undefined) => useCliente(id),
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
  useDepartamentosCliente: () => useDepartamentosCliente(),
  useAgregarDepartamentoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarDepartamentoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarDepartamentoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivarDepartamentoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useFusionarDepartamentos: () => ({ mutate: vi.fn(), isPending: false }),
  // ⭐ V1-E8y: hooks del editor de CONTACTOS (montado en el detalle): inertes. Tiene su propia
  // prueba (`EditorContactosCliente.test.tsx`); aquí sólo hace falta que la página monte.
  useContactosCliente: () => ({ data: [], isPending: false, isError: false, error: null }),
  useCrearContactoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarContactoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  usePreviaFusionDepartamentos: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
  }),
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
    useCliente.mockReset();
    useCliente.mockReturnValue({ data: undefined });
    useDepartamentosCliente.mockClear();
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

  /**
   * ⭐⭐ Fila 0.239 (§Post-F9.248(b)) — DOS REJAS en la misma ficha. Daniel, sobre Aurora:
   * *«Administración o yo damos de alta al cliente. Ella puede meter información de compradores,
   * departamentos, datos de cada comprador»*. `clientes.modificar` abre las personas, los
   * departamentos y los campos de referencia; el alta, la edición de la ficha y la baja siguen en
   * `clientes.administrar`. Las tres pruebas fijan las tres combinaciones que importan.
   */
  describe('0.239: `clientes.modificar` captura lo que cuelga del cliente; el cliente mismo es de `administrar`', () => {
    /** Dos departamentos ACTIVOS: el mínimo para que «Juntar duplicados» pueda ofrecerse. */
    function dosDepartamentos(): ClienteDepartamento[] {
      return [1, 2].map((id) => ({
        id,
        idCliente: 1,
        nombre: id === 1 ? 'Caballeros' : '2-HOMBRE',
        activo: true,
        creadoEn: '2026-07-01T00:00:00.000Z',
        creadoPorId: null,
        modificadoEn: '2026-07-01T00:00:00.000Z',
        modificadoPorId: null,
      }));
    }

    async function abrirFicha(permisos: Parameters<typeof estadoSesionDePrueba>[0]) {
      const usuario = userEvent.setup();
      useDepartamentosCliente.mockReturnValue({
        data: dosDepartamentos(),
        isPending: false,
        isError: false,
        error: null,
      });
      useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool')]));
      renderConProveedores(<ClientesPagina />, { sesion: estadoSesionDePrueba(permisos) });
      await usuario.click(screen.getByTestId('fila-cliente'));
      return screen.getByTestId('detalle-cliente');
    }

    it('con SÓLO `clientes.modificar`: edita personas, departamentos y campos, pero NO da de alta, edita la ficha, desactiva ni junta duplicados', async () => {
      const detalle = await abrirFicha(['clientes.ver', 'clientes.modificar']);

      expect(within(detalle).getByTestId('editor-campos-cliente')).toBeInTheDocument();
      expect(within(detalle).getByTestId('nuevo-departamento')).toBeInTheDocument();
      expect(within(detalle).getByTestId('agregar-contacto-cliente')).toBeInTheDocument();
      // ⚠️ La fusión toca los factores de precio del dueño: con sólo `modificar` NO se ofrece,
      // aunque haya dos departamentos activos (hallazgo del reviewer de la 0.239).
      expect(within(detalle).queryByTestId('fusionar-departamentos')).not.toBeInTheDocument();

      expect(screen.queryByTestId('nuevo-cliente')).not.toBeInTheDocument();
      expect(screen.queryByTestId('editar-cliente')).not.toBeInTheDocument();
      expect(screen.queryByTestId('desactivar-cliente')).not.toBeInTheDocument();
    });

    it('con SÓLO `clientes.administrar` (sin `modificar`): también edita lo que cuelga —administrar lo implica—', async () => {
      const detalle = await abrirFicha(['clientes.ver', 'clientes.administrar']);

      expect(within(detalle).getByTestId('editor-campos-cliente')).toBeInTheDocument();
      expect(within(detalle).getByTestId('nuevo-departamento')).toBeInTheDocument();
      expect(within(detalle).getByTestId('agregar-contacto-cliente')).toBeInTheDocument();
      expect(within(detalle).getByTestId('fusionar-departamentos')).toBeInTheDocument();
      expect(screen.getByTestId('nuevo-cliente')).toBeInTheDocument();
      expect(screen.getByTestId('editar-cliente')).toBeInTheDocument();
      expect(screen.getByTestId('desactivar-cliente')).toBeInTheDocument();
    });

    it('sin ninguna de las dos: personas, departamentos y campos quedan en sólo lectura', async () => {
      const detalle = await abrirFicha(['clientes.ver']);

      expect(within(detalle).queryByTestId('editor-campos-cliente')).not.toBeInTheDocument();
      expect(within(detalle).queryByTestId('nuevo-departamento')).not.toBeInTheDocument();
      expect(within(detalle).queryByTestId('agregar-contacto-cliente')).not.toBeInTheDocument();
    });
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

  // §Post-F9.68 — esconder, no negar: la SECCIÓN ENTERA (con su rótulo) desaparece, en vez de
  // mostrar un letrero de permiso adentro. Va con su gemela positiva.
  //
  // ⭐ V1-E8b (§Post-F9.125): la REJA CAMBIÓ, y esta prueba se actualiza a propósito. Hasta la 0.038
  // bastaba `consultas.ver-importes` — que Aurora tiene — para VER los cuatro factores del cliente;
  // Daniel: *"los factores sólo yo los puedo mover y no son visibles para nadie más"*. Hoy la reja
  // es `listas.aprobar`, y por eso el caso de abajo —ver importes SIN aprobar precios, que es
  // exactamente el perfil de Desarrollo— pasó de positivo a NEGATIVO.
  it('con `consultas.ver-importes` pero SIN aprobar precios, la sección NO existe (V1-E8b)', async () => {
    const usuario = userEvent.setup();
    useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool')]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'listas.ver', 'consultas.ver-importes']),
    });

    await usuario.click(screen.getByTestId('fila-cliente'));
    const detalle = screen.getByTestId('detalle-cliente');
    expect(within(detalle).queryByText(/Factores de lista de precios/i)).toBeNull();
    expect(within(detalle).queryByTestId('editor-factores-cliente')).toBeNull();
    expect(detalle.textContent).not.toMatch(/permiso/i);
  });

  it('sin `listas.ver` la sección de factores tampoco existe (ni su rótulo)', async () => {
    const usuario = userEvent.setup();
    useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool')]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'listas.aprobar']),
    });

    await usuario.click(screen.getByTestId('fila-cliente'));
    const detalle = screen.getByTestId('detalle-cliente');
    expect(within(detalle).queryByText(/Factores de lista de precios/i)).toBeNull();
  });

  it('AL DUEÑO (`listas.aprobar`) sí le aparece la sección (gemela positiva)', async () => {
    const usuario = userEvent.setup();
    useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool')]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'listas.ver', 'listas.aprobar']),
    });

    await usuario.click(screen.getByTestId('fila-cliente'));
    const detalle = screen.getByTestId('detalle-cliente');
    expect(within(detalle).getByText(/Factores de lista de precios/i)).toBeInTheDocument();
    expect(within(detalle).getByTestId('editor-factores-cliente')).toBeInTheDocument();
  });

  /**
   * ⭐⭐ V1-E8t (§Post-F9.145) — EL DESTINO DE LA PUERTA «Capturar factores». De nada sirve el botón
   * del diálogo de crear lista si al aterrizar aquí no pasa nada: se prueba que el cajón se abre EN
   * ESE cliente y que la sección de factores está a la vista.
   *
   * ⚠️ El cliente del deep-link NO viene en la página visible del listado —hay ~117 y la página
   * trae 10—: es el caso REAL, y el que revienta si nadie inyecta su ficha (el cajón abriría vacío).
   */
  it('el deep-link abre la ficha del cliente en sus factores, aunque no esté en la página visible', () => {
    useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool'), cliente(2, 'Pumas')]));
    useCliente.mockReturnValue({ data: cliente(77, 'C&A') });
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'listas.ver', 'listas.aprobar']),
      rutaInicial: {
        pathname: '/catalogos/clientes',
        state: { idCliente: 77, seccion: 'factores' },
      },
    });

    const detalle = screen.getByTestId('detalle-cliente');
    // Es la ficha del cliente que pidió la puerta, no la del primero de la lista.
    expect(screen.getByRole('dialog')).toHaveTextContent('C&A');
    expect(within(detalle).getByTestId('seccion-factores-cliente')).toBeInTheDocument();
    expect(within(detalle).getByTestId('editor-factores-cliente')).toBeInTheDocument();
  });

  it('sin deep-link el cajón NO se abre solo (la gemela: la pantalla se comporta como siempre)', () => {
    useClientes.mockReturnValue(consultaConDatos([cliente(1, 'Liverpool')]));
    renderConProveedores(<ClientesPagina />, {
      sesion: estadoSesionDePrueba(['clientes.ver', 'listas.ver', 'listas.aprobar']),
    });

    expect(screen.queryByTestId('detalle-cliente')).not.toBeInTheDocument();
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
