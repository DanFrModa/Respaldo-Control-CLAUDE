import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Proveedor, ProveedoresPagina as TipoPagina, RolProveedor } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ProveedoresPagina } from './ProveedoresPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `useProveedores`
// captura la query con la que se le llama, para verificar los filtros por tipo y rol.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useProveedores = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;

/** Roles de ejemplo para el catalogo del selector/filtro. */
const ROLES_EJEMPLO: RolProveedor[] = [
  { id: 1, codigo: 'maquila-costura', nombre: 'Maquila — costura', activo: true },
  { id: 2, codigo: 'estampado', nombre: 'Estampado / aplicación', activo: true },
];

vi.mock('@/api/proveedores', () => ({
  useProveedores: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useProveedores(query);
  },
  useCrearProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarProveedor: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarProveedor: () => ({ mutate: reactivarMutate, isPending: false }),
  useRolesProveedor: () => ({
    data: ROLES_EJEMPLO,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

/** Proveedor de ejemplo (enriquecido R15; los campos nuevos vacios por defecto). */
function proveedor(id: number, nombre: string, activo = true): Proveedor {
  return {
    id,
    nombre,
    razonSocial: null,
    tipo: 'TELAS',
    telefono: null,
    contacto: null,
    condiciones: null,
    factura: null,
    rfc: null,
    regimenFiscalSat: null,
    usoCfdiHabitual: null,
    codigoPostalExpedicion: null,
    retieneIva: null,
    retieneIsr: null,
    email: null,
    direccion: null,
    diasCredito: null,
    moneda: null,
    formaPago: null,
    metodoPago: null,
    banco: null,
    clabe: null,
    limiteCredito: null,
    leadTimeDias: null,
    notas: null,
    corto: null,
    asegurado: null,
    obsPago: null,
    modalidadFacturacion: null,
    roles: [],
    cantidadAdjuntos: 0,
    activo,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Respuesta paginada de ejemplo con los proveedores dados. */
function pagina(datos: Proveedor[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos" (forma minima que usa el componente). */
function consultaConDatos(datos: Proveedor[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<ProveedoresPagina>', () => {
  beforeEach(() => {
    useProveedores.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
    ultimaQuery = undefined;
  });

  it('lista los proveedores que devuelve el API', () => {
    useProveedores.mockReturnValue(
      consultaConDatos([proveedor(1, 'Telas del Norte'), proveedor(2, 'Avíos SA')]),
    );
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    // Hay dos renglones; el primero queda auto-seleccionado (aparece tambien en
    // el detalle), por eso su nombre se busca con getAllByText.
    expect(screen.getAllByTestId('fila-proveedor')).toHaveLength(2);
    expect(screen.getAllByText('Telas del Norte').length).toBeGreaterThan(0);
    expect(screen.getByText('Avíos SA')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useProveedores.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    expect(
      screen.getByText('No hay proveedores que coincidan con la búsqueda.'),
    ).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un boton de reintento cuando la consulta falla', () => {
    useProveedores.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useProveedores.mockReturnValue(consultaConDatos([proveedor(1, 'Telas del Norte')]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });

    // Ni el boton "Nuevo", ni las acciones del detalle (editar/desactivar).
    expect(screen.queryByTestId('nuevo-proveedor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-proveedor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-proveedor')).not.toBeInTheDocument();
  });

  it('pide confirmacion antes de desactivar y llama a la mutacion al confirmar', async () => {
    const usuario = userEvent.setup();
    useProveedores.mockReturnValue(consultaConDatos([proveedor(7, 'Telas Viejas')]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    // El registro queda auto-seleccionado: "Desactivar" es un boton directo del detalle.
    await usuario.click(screen.getByTestId('desactivar-proveedor'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar proveedor')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('un proveedor inactivo ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useProveedores.mockReturnValue(consultaConDatos([proveedor(9, 'Proveedor Apagado', false)]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    // El detalle del registro inactivo muestra su estado y ofrece "Activar".
    const detalle = screen.getByTestId('detalle-proveedor');
    expect(within(detalle).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByTestId('activar-proveedor')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-proveedor')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-proveedor'));
    // Reactivar es no destructivo: NO abre diálogo de confirmación.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  it('el filtro por tipo se refleja en la consulta del API', async () => {
    const usuario = userEvent.setup();
    useProveedores.mockReturnValue(consultaConDatos([proveedor(1, 'Telas del Norte')]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });

    // Sin filtro, la query no lleva `tipo` (todos los tipos).
    expect(ultimaQuery?.tipo).toBeUndefined();

    await usuario.selectOptions(screen.getByTestId('filtro-tipo-proveedor'), 'AVIOS');

    // Tras elegir un tipo, la siguiente consulta lo incluye.
    expect(ultimaQuery?.tipo).toBe('AVIOS');
  });

  it('el filtro por rol se refleja en la consulta del API (como id numérico)', async () => {
    const usuario = userEvent.setup();
    useProveedores.mockReturnValue(consultaConDatos([proveedor(1, 'Telas del Norte')]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });

    // Sin filtro, la query no lleva `rol` (todos los roles).
    expect(ultimaQuery?.rol).toBeUndefined();

    // El selector ofrece los roles del catálogo; al elegir uno, la query lo manda
    // como número (no como texto del `<select>`).
    await usuario.selectOptions(screen.getByTestId('filtro-rol-proveedor'), '2');
    expect(ultimaQuery?.rol).toBe(2);
  });

  it('muestra los roles del proveedor como chips en el detalle', () => {
    const conRoles = proveedor(3, 'Maquilas Unidas');
    conRoles.roles = [
      { id: 1, codigo: 'maquila-costura', nombre: 'Maquila — costura' },
      { id: 2, codigo: 'estampado', nombre: 'Estampado / aplicación' },
    ];
    useProveedores.mockReturnValue(consultaConDatos([conRoles]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });

    const chips = screen.getByTestId('roles-proveedor-detalle');
    expect(within(chips).getByText('Maquila — costura')).toBeInTheDocument();
    expect(within(chips).getByText('Estampado / aplicación')).toBeInTheDocument();
  });

  // M2: el detalle muestra los datos R15 (fiscal/pago/operativo) y el conteo de
  // adjuntos, agrupados en secciones, mostrando solo lo que tiene valor.
  it('muestra los datos enriquecidos (fiscal/pago/operativo) y el conteo de adjuntos', () => {
    const completo = proveedor(5, 'Proveedor Completo');
    completo.factura = true;
    completo.rfc = 'PCO010101AB1';
    completo.regimenFiscalSat = '601';
    completo.usoCfdiHabitual = 'G03';
    completo.codigoPostalExpedicion = '54000';
    completo.retieneIva = true;
    completo.email = 'compras@completo.mx';
    completo.direccion = 'Av. Siempre Viva 123';
    completo.diasCredito = 30;
    completo.moneda = 'USD';
    completo.formaPago = '03 — Transferencia';
    completo.metodoPago = 'PPD';
    completo.banco = 'BBVA';
    completo.clabe = '002010077777777771';
    completo.limiteCredito = 50000;
    completo.leadTimeDias = 12;
    completo.notas = 'Cliente preferente';
    completo.cantidadAdjuntos = 2;
    useProveedores.mockReturnValue(consultaConDatos([completo]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });

    const detalle = screen.getByTestId('detalle-proveedor');
    // Secciones agrupadas (encabezados).
    expect(within(detalle).getByText('Fiscal')).toBeInTheDocument();
    expect(within(detalle).getByText('Pago')).toBeInTheDocument();
    expect(within(detalle).getByText('Operativo')).toBeInTheDocument();
    // Datos fiscales.
    expect(within(detalle).getByText('PCO010101AB1')).toBeInTheDocument();
    expect(within(detalle).getByText('601')).toBeInTheDocument();
    expect(within(detalle).getByText('G03')).toBeInTheDocument();
    // Datos de pago (la moneda y el método se muestran con su etiqueta legible).
    expect(within(detalle).getByText('30 días')).toBeInTheDocument();
    expect(within(detalle).getByText('Dólar (USD)')).toBeInTheDocument();
    expect(within(detalle).getByText('BBVA')).toBeInTheDocument();
    expect(within(detalle).getByText('002010077777777771')).toBeInTheDocument();
    // Operativo + adjuntos.
    expect(within(detalle).getByText('12 días')).toBeInTheDocument();
    expect(within(detalle).getByText('Cliente preferente')).toBeInTheDocument();
    expect(within(detalle).getByText('2 archivos')).toBeInTheDocument();
  });

  it('no muestra las secciones enriquecidas si el proveedor no tiene esos datos', () => {
    // proveedor() crea todos los campos R15 en null/0 -> sin secciones extra.
    useProveedores.mockReturnValue(consultaConDatos([proveedor(6, 'Proveedor Pelón')]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });

    const detalle = screen.getByTestId('detalle-proveedor');
    // La sección General siempre está; las enriquecidas (sin datos) no.
    expect(within(detalle).getByText('Datos del proveedor')).toBeInTheDocument();
    expect(within(detalle).queryByText('Fiscal')).not.toBeInTheDocument();
    expect(within(detalle).queryByText('Pago')).not.toBeInTheDocument();
    expect(within(detalle).queryByText('Operativo')).not.toBeInTheDocument();
  });
});
