import { fireEvent, screen, within } from '@testing-library/react';
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
  // Avíos que surte (B17): el cajón los muestra vía `AviosQueSurte`.
  useAviosProveedor: () => ({
    data: [],
    isPending: false,
    isError: false,
    error: null,
  }),
  useAsignarAvioProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarAvioProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  // Hooks que monta el diálogo de proveedor (adjuntos + V1-E3f pieza B: contactos y constancia).
  useAdjuntosProveedor: () => ({ data: [], isPending: false, isError: false, error: null }),
  useSubirAdjuntoProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarAdjuntoProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useCrearContactoProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarContactoProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useAnalizarConstancia: () => ({ mutate: vi.fn(), isPending: false }),
  // Cuentas de pago (0.112): el diálogo monta su editor si se abre esa sección.
  useCrearCuentaPagoProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarCuentaPagoProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useCuentasPagoProveedor: () => ({
    data: undefined,
    isPending: true,
    isError: false,
    error: null,
  }),
}));

// El selector de avíos del cajón (B17) consulta el catálogo de avíos.
vi.mock('@/api/avios', () => ({
  useAvios: () => ({
    data: { datos: [], total: 0, pagina: 1, porPagina: 20, totalPaginas: 1 },
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
  }),
}));

/** Proveedor de ejemplo (enriquecido R15; los campos nuevos vacios por defecto). */
function proveedor(id: number, nombre: string, activo = true): Proveedor {
  return {
    id,
    nombre,
    nombreCorto: null,
    razonSocial: null,
    telefono: null,
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
    formaPagoPreferida: null,
    metodoPago: null,
    banco: null,
    clabe: null,
    limiteCredito: null,
    leadTimeDias: null,
    notas: null,
    asegurado: null,
    obsPago: null,
    modalidadFacturacion: null,
    roles: [],
    contactos: [],
    cuentasPago: [],
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

    // Tabla-first: dos renglones; el cajón de detalle se abre al hacer clic (no hay
    // auto-selección), así que ambos nombres aparecen una vez en la tabla.
    expect(screen.getAllByTestId('fila-proveedor')).toHaveLength(2);
    expect(screen.getByText('Telas del Norte')).toBeInTheDocument();
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

    // Se abre el cajón del renglón; "Desactivar" es un botón del encabezado del cajón.
    await usuario.click(screen.getByTestId('fila-proveedor'));
    await usuario.click(screen.getByTestId('desactivar-proveedor'));

    const dialogo = await screen.findByText('Desactivar proveedor');
    expect(dialogo).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('un proveedor inactivo ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useProveedores.mockReturnValue(consultaConDatos([proveedor(9, 'Proveedor Apagado', false)]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    // Al abrir el cajón del registro inactivo, ofrece "Activar" (no "Desactivar").
    await usuario.click(screen.getByTestId('fila-proveedor'));
    expect(screen.getByTestId('detalle-proveedor')).toBeInTheDocument();
    expect(screen.getByTestId('activar-proveedor')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-proveedor')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-proveedor'));
    // Reactivar es no destructivo: NO abre diálogo de confirmación (sí sigue abierto el
    // cajón de detalle, que también es un dialog — por eso se busca el botón de confirmar).
    expect(screen.queryByTestId('confirmar-accion')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  // V1-E3f pieza B (§Post-F9.56 punto 3): el filtro por TIPO se retiró con el campo. Lo que queda
  // es el filtro por ROL, que sí cubre el caso que el tipo único no podía (vender telas Y maquilar).
  it('ya NO hay filtro por tipo: el selector desapareció de la barra', () => {
    useProveedores.mockReturnValue(consultaConDatos([proveedor(1, 'Telas del Norte')]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });
    expect(screen.queryByTestId('filtro-tipo-proveedor')).not.toBeInTheDocument();
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

  // §Post-F9.56 punto 1: la columna Contacto muestra el PRIMER contacto activo con su puesto.
  it('la columna Contacto muestra el primer contacto con su puesto (ya no un campo suelto)', () => {
    const conGente = proveedor(7, 'Taller con gente');
    conGente.contactos = [
      {
        id: 1,
        idProveedor: 7,
        nombre: 'Ana',
        puesto: 'vendedor',
        telefono: null,
        email: null,
        notas: null,
        activo: true,
      },
      {
        id: 2,
        idProveedor: 7,
        nombre: 'Beto',
        puesto: 'crédito y cobranza',
        telefono: null,
        email: null,
        notas: null,
        activo: true,
      },
    ];
    useProveedores.mockReturnValue(consultaConDatos([conGente]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });
    expect(screen.getByText('Ana · vendedor')).toBeInTheDocument();
  });

  it('sin contactos, la columna Contacto queda con guion (no truena)', () => {
    useProveedores.mockReturnValue(consultaConDatos([proveedor(8, 'Sin gente')]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('muestra los roles del proveedor como chips en el detalle', async () => {
    const usuario = userEvent.setup();
    const conRoles = proveedor(3, 'Maquilas Unidas');
    conRoles.roles = [
      { id: 1, codigo: 'maquila-costura', nombre: 'Maquila — costura' },
      { id: 2, codigo: 'estampado', nombre: 'Estampado / aplicación' },
    ];
    useProveedores.mockReturnValue(consultaConDatos([conRoles]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });

    await usuario.click(screen.getByTestId('fila-proveedor'));
    const chips = screen.getByTestId('roles-proveedor-detalle');
    expect(within(chips).getByText('Maquila — costura')).toBeInTheDocument();
    expect(within(chips).getByText('Estampado / aplicación')).toBeInTheDocument();
  });

  // M2: el detalle muestra los datos R15 (fiscal/pago/operativo) y el conteo de
  // adjuntos, agrupados en secciones, mostrando solo lo que tiene valor.
  it('muestra los datos enriquecidos (fiscal/pago/operativo) y el conteo de adjuntos', async () => {
    const usuario = userEvent.setup();
    const completo = proveedor(5, 'Proveedor Completo');
    // ⭐ Fila 0.124: la ÚNICA pregunta de facturación es la modalidad. `factura` se deja poblado —y
    // en CONTRA— a propósito: la ficha ya no lo lee (columna histórica, REGLA 0-B).
    completo.modalidadFacturacion = 'ambos';
    completo.factura = false;
    completo.rfc = 'PCO010101AB1';
    completo.regimenFiscalSat = '601';
    completo.usoCfdiHabitual = 'G03';
    completo.codigoPostalExpedicion = '54000';
    completo.retieneIva = true;
    completo.email = 'compras@completo.mx';
    completo.direccion = 'Av. Siempre Viva 123';
    completo.diasCredito = 30;
    completo.moneda = 'USD';
    // 0.113: la forma de pago que la ficha enseña es la POR OMISIÓN de la corrida semanal
    // (efectivo/transferencia). El `formaPago` viejo —texto libre con la clave del SAT— quedó
    // superado y ya no se pinta: se deja poblado a propósito para comprobar que NO sale.
    completo.formaPago = '03 — Transferencia';
    completo.formaPagoPreferida = 'transferencia';
    completo.metodoPago = 'PPD';
    // 0.112: el dato bancario ya no es `banco`/`clabe` del proveedor, son sus CUENTAS —cada una a
    // nombre de SU beneficiario, que casi nunca es el proveedor— con una marcada por omisión.
    completo.cuentasPago = [
      {
        id: 77,
        idProveedor: 5,
        beneficiario: 'Fulana de Tal',
        banco: 'BBVA',
        tipoCuenta: 'clabe',
        cuenta: '002010077777777771',
        alias: '1',
        esFiscal: true,
        esDefault: true,
        notas: null,
        activo: true,
      },
    ];
    completo.limiteCredito = 50000;
    completo.leadTimeDias = 12;
    completo.notas = 'Cliente preferente';
    completo.cantidadAdjuntos = 2;
    useProveedores.mockReturnValue(consultaConDatos([completo]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });

    await usuario.click(screen.getByTestId('fila-proveedor'));
    const detalle = screen.getByTestId('detalle-proveedor');
    // Secciones agrupadas (encabezados).
    expect(within(detalle).getByText('Fiscal')).toBeInTheDocument();
    expect(within(detalle).getByText('Pago')).toBeInTheDocument();
    expect(within(detalle).getByText('Operativo')).toBeInTheDocument();
    // ⭐ La facturación se lee de la MODALIDAD, y la fila vieja ya no existe (fila 0.124).
    expect(within(detalle).getByText('¿Cómo factura?')).toBeInTheDocument();
    expect(within(detalle).getByText('De las dos formas (con y sin factura)')).toBeInTheDocument();
    expect(within(detalle).queryByText('¿Emite factura (CFDI)?')).not.toBeInTheDocument();
    // Datos fiscales.
    expect(within(detalle).getByText('PCO010101AB1')).toBeInTheDocument();
    expect(within(detalle).getByText('601')).toBeInTheDocument();
    expect(within(detalle).getByText('G03')).toBeInTheDocument();
    // Datos de pago (la moneda y el método se muestran con su etiqueta legible).
    expect(within(detalle).getByText('30 días')).toBeInTheDocument();
    expect(within(detalle).getByText('Dólar (USD)')).toBeInTheDocument();
    // 0.113: la forma de pago que se enseña es la POR OMISIÓN de la corrida (efectivo/transferencia).
    expect(within(detalle).getByText('Forma de pago por omisión')).toBeInTheDocument();
    expect(within(detalle).getByText('Transferencia')).toBeInTheDocument();
    // ⭐ Y el campo VIEJO (texto libre con la clave del SAT) NO sale, aunque esté poblado: dos
    // respuestas a la misma pregunta en la misma ficha es el defecto que la fila 0.124 corrige.
    expect(within(detalle).queryByText('03 — Transferencia')).not.toBeInTheDocument();
    // La cuenta se lee con su BENEFICIARIO y sus marcas (por omisión / fiscal).
    const cuentas = within(detalle).getByTestId('cuentas-pago-detalle');
    expect(within(cuentas).getByText('Fulana de Tal')).toBeInTheDocument();
    // R3: en el cajón el número va ENMASCARADO (aquí se RECONOCE la cuenta, no se transfiere).
    expect(within(cuentas).getByText('BBVA · CLABE · •••• 7771')).toBeInTheDocument();
    expect(within(cuentas).queryByText(/0020 1007/)).not.toBeInTheDocument();
    expect(within(cuentas).getByText('Por omisión')).toBeInTheDocument();
    expect(within(cuentas).getByText('Cuenta fiscal')).toBeInTheDocument();
    // Operativo + adjuntos.
    expect(within(detalle).getByText('12 días')).toBeInTheDocument();
    expect(within(detalle).getByText('Cliente preferente')).toBeInTheDocument();
    expect(within(detalle).getByText('2 archivos')).toBeInTheDocument();
  });

  /**
   * ⭐ EL DIÁLOGO LEE LA VERSIÓN FRESCA, NO LA FOTO DE CUANDO SE ABRIÓ (0.112).
   *
   * `proveedorEnEdicion` se DERIVA de la consulta por id (`filas.find(...)`) en vez de guardarse en
   * un `useState` al abrir. Sin eso, todo lo que se agrega DESDE DENTRO del diálogo —cuentas de
   * pago, contactos— se guardaba bien pero el diálogo seguía mostrando el mundo de hace tres altas:
   * capturando 150 cuentas no había forma de ver qué llevabas, y al reintentar salía un 409.
   *
   * Se comprueba con CONTACTOS porque es lo que el diálogo pinta directamente desde el objeto del
   * proveedor. Si alguien devuelve la derivación a un `useState`, esta prueba se pone roja.
   */
  it('⭐ el diálogo de edición refleja lo que llega DESPUÉS de abrirlo (no una foto)', async () => {
    const usuario = userEvent.setup();
    const contacto = (id: number, nombre: string) => ({
      id,
      idProveedor: 7,
      nombre,
      puesto: null,
      telefono: null,
      email: null,
      notas: null,
      activo: true,
    });
    const conUno = proveedor(7, 'Proveedor Vivo');
    conUno.contactos = [contacto(1, 'Ana')];
    useProveedores.mockReturnValue(consultaConDatos([conUno]));

    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver', 'proveedores.administrar']),
    });

    // Se abre el cajón de la fila y, desde él, el diálogo de edición.
    await usuario.click(screen.getByTestId('fila-proveedor'));
    await usuario.click(await screen.findByTestId('editar-proveedor'));
    await usuario.click(await screen.findByRole('button', { name: 'Contactos' }));
    const editor = await screen.findByTestId('editor-contactos');
    expect(within(editor).getByText('Ana')).toBeInTheDocument();
    expect(within(editor).queryByText('Beto')).not.toBeInTheDocument();

    // Llega un contacto nuevo (como lo haría el refetch que dispara agregarlo desde el diálogo):
    // OBJETO NUEVO, con un contacto más.
    const conDos = proveedor(7, 'Proveedor Vivo');
    conDos.contactos = [contacto(1, 'Ana'), contacto(2, 'Beto')];
    useProveedores.mockReturnValue(consultaConDatos([conDos]));
    // Se fuerza el re-render de la página. `fireEvent` y no `userEvent`: con un diálogo de radix
    // abierto, jsdom deja el resto del body con `pointer-events: none` y un click no llegaría.
    fireEvent.change(screen.getByTestId('buscar-proveedor'), { target: { value: 'Prov' } });

    // El diálogo YA muestra el contacto nuevo: leyó la versión fresca, no la del momento de abrir.
    expect(
      await within(screen.getByTestId('editor-contactos')).findByText('Beto'),
    ).toBeInTheDocument();
  });

  it('no muestra las secciones enriquecidas si el proveedor no tiene esos datos', async () => {
    const usuario = userEvent.setup();
    // proveedor() crea todos los campos R15 en null/0 -> sin secciones extra.
    useProveedores.mockReturnValue(consultaConDatos([proveedor(6, 'Proveedor Pelón')]));
    renderConProveedores(<ProveedoresPagina />, {
      sesion: estadoSesionDePrueba(['proveedores.ver']),
    });

    await usuario.click(screen.getByTestId('fila-proveedor'));
    const detalle = screen.getByTestId('detalle-proveedor');
    // La sección General siempre está; las enriquecidas (sin datos) no.
    expect(within(detalle).getByText('Datos del proveedor')).toBeInTheDocument();
    expect(within(detalle).queryByText('Fiscal')).not.toBeInTheDocument();
    expect(within(detalle).queryByText('Pago')).not.toBeInTheDocument();
    expect(within(detalle).queryByText('Operativo')).not.toBeInTheDocument();
  });
});
