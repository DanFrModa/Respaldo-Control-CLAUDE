import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Proveedor, ProveedorCrear, RolProveedor } from '@/api/tipos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoProveedor } from './DialogoProveedor';

// Se controla la capa de datos: las pruebas no tocan la red. Se capturan los
// argumentos de crear/actualizar para verificar el cuerpo (roles incluidos).
const crearMutate = vi.fn();
const actualizarMutate = vi.fn();

/** Roles de ejemplo del catalogo (selector multiple). */
const ROLES_EJEMPLO: RolProveedor[] = [
  { id: 1, codigo: 'maquila-costura', nombre: 'Maquila — costura', activo: true },
  { id: 2, codigo: 'estampado', nombre: 'Estampado / aplicación', activo: true },
];

vi.mock('@/api/proveedores', () => ({
  useCrearProveedor: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarProveedor: () => ({ mutate: actualizarMutate, isPending: false }),
  useRolesProveedor: () => ({
    data: ROLES_EJEMPLO,
    isPending: false,
    isError: false,
    error: null,
  }),
  // Hooks que usa el AdjuntadorProveedor (solo se monta en edicion).
  useAdjuntosProveedor: () => ({ data: [], isPending: false, isError: false, error: null }),
  useSubirAdjuntoProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarAdjuntoProveedor: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Proveedor de ejemplo (enriquecido R15) para las pruebas de edicion. */
function proveedorEjemplo(sobre: Partial<Proveedor> = {}): Proveedor {
  return {
    id: 10,
    nombre: 'Textiles Prueba',
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
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...sobre,
  };
}

describe('<DialogoProveedor>', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
  });

  it('en alta renderiza las secciones plegables y el selector de roles', () => {
    renderConProveedores(
      <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
    );

    const dialogo = screen.getByRole('dialog');
    expect(within(dialogo).getByRole('heading', { name: 'Nuevo proveedor' })).toBeInTheDocument();
    // Las secciones del acordeon (botones de cabecera).
    for (const titulo of [
      'General',
      'Roles / servicios',
      'Fiscal',
      'Contacto',
      'Pago',
      'Operativo',
      'Adjuntos',
    ]) {
      expect(within(dialogo).getByRole('button', { name: titulo })).toBeInTheDocument();
    }
    // El selector de roles esta montado con las opciones del catalogo.
    expect(screen.getByTestId('selector-roles-proveedor')).toBeInTheDocument();
    expect(screen.getByTestId('rol-proveedor-opcion-1')).toBeInTheDocument();
  });

  it('en alta NO monta el adjuntador y muestra el aviso de guardar primero', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
    );

    // La sección Adjuntos está plegada por defecto; se expande para ver su contenido.
    await usuario.click(screen.getByRole('button', { name: 'Adjuntos' }));
    expect(await screen.findByTestId('adjuntos-aviso-alta')).toBeInTheDocument();
    expect(screen.queryByTestId('adjuntador-proveedor')).not.toBeInTheDocument();
  });

  it('exige al menos un rol antes de guardar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
    );

    await usuario.type(screen.getByLabelText('Nombre'), 'Sin roles');
    await usuario.click(screen.getByTestId('guardar-proveedor'));

    // No se llama a crear y se muestra el error de captura de roles.
    expect(crearMutate).not.toHaveBeenCalled();
    expect(await screen.findByText('Elige al menos un rol o servicio.')).toBeInTheDocument();
  });

  it('si marca ¿factura? y deja el RFC vacío, no envía y muestra el error', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
    );

    await usuario.type(screen.getByLabelText('Nombre'), 'Factura sin RFC');
    // Elige un rol (para aislar la regla fiscal de la regla de roles).
    await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
    // Expande Fiscal y marca "¿Emite factura (CFDI)?" sin capturar RFC.
    await usuario.click(screen.getByRole('button', { name: 'Fiscal' }));
    await usuario.click(await screen.findByTestId('proveedor-factura'));
    await usuario.click(screen.getByTestId('guardar-proveedor'));

    expect(crearMutate).not.toHaveBeenCalled();
    expect(
      await screen.findByText('Si el proveedor factura, captura su RFC y su régimen fiscal'),
    ).toBeInTheDocument();
  });

  it('crea un proveedor enviando los roles seleccionados inline', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: ProveedorCrear, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
        opciones?.onSuccess?.(proveedorEjemplo({ nombre: 'Nuevo Prov' }));
      },
    );
    const alCambiarAbierto = vi.fn();
    renderConProveedores(
      <DialogoProveedor abierto alCambiarAbierto={alCambiarAbierto} proveedor={undefined} />,
    );

    await usuario.type(screen.getByLabelText('Nombre'), 'Nuevo Prov');
    await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
    await usuario.click(screen.getByTestId('rol-proveedor-opcion-2'));
    await usuario.click(screen.getByTestId('guardar-proveedor'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as ProveedorCrear;
    expect(cuerpo.nombre).toBe('Nuevo Prov');
    expect(cuerpo.roles).toEqual([1, 2]);
    // Tras el exito cierra el dialogo.
    expect(alCambiarAbierto).toHaveBeenCalledWith(false);
  });

  // Fusión de terceros (D12/R15): la UI captura los datos de taller del proveedor.
  it('captura los datos de taller (corto/asegurado/obsPago) y los envía en el alta', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: ProveedorCrear, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
        opciones?.onSuccess?.(proveedorEjemplo({ nombre: 'Taller' }));
      },
    );
    renderConProveedores(
      <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
    );

    await usuario.type(screen.getByLabelText('Nombre'), 'Taller');
    await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
    // Expande "Datos de taller" y captura los tres campos.
    await usuario.click(screen.getByRole('button', { name: 'Datos de taller' }));
    await usuario.type(await screen.findByLabelText('Código corto'), 'TLR');
    await usuario.click(screen.getByTestId('proveedor-asegurado'));
    await usuario.type(screen.getByLabelText('Observaciones de pago'), 'paga viernes');
    await usuario.click(screen.getByTestId('guardar-proveedor'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as ProveedorCrear;
    expect(cuerpo.corto).toBe('TLR');
    expect(cuerpo.asegurado).toBe(true);
    expect(cuerpo.obsPago).toBe('paga viernes');
  });

  it('en edición monta el adjuntador y pre-carga los roles del proveedor', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoProveedor
        abierto
        alCambiarAbierto={vi.fn()}
        proveedor={proveedorEjemplo({
          roles: [{ id: 2, codigo: 'estampado', nombre: 'Estampado / aplicación' }],
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Editar proveedor' })).toBeInTheDocument();
    // El rol del proveedor llega marcado (sección Roles abierta por defecto).
    expect(screen.getByTestId('rol-proveedor-opcion-2')).toBeChecked();
    // Adjuntos está plegado: al expandir se monta el adjuntador (no el aviso de alta).
    await usuario.click(screen.getByRole('button', { name: 'Adjuntos' }));
    expect(await screen.findByTestId('adjuntador-proveedor')).toBeInTheDocument();
    expect(screen.queryByTestId('adjuntos-aviso-alta')).not.toBeInTheDocument();
  });

  it('en edición, si no se tocan los roles, envía los actuales (nunca vacío)', async () => {
    const usuario = userEvent.setup();
    actualizarMutate.mockImplementation(
      (_args, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
        opciones?.onSuccess?.(proveedorEjemplo());
      },
    );
    renderConProveedores(
      <DialogoProveedor
        abierto
        alCambiarAbierto={vi.fn()}
        proveedor={proveedorEjemplo({
          roles: [{ id: 1, codigo: 'maquila-costura', nombre: 'Maquila — costura' }],
        })}
      />,
    );

    await usuario.click(screen.getByTestId('guardar-proveedor'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as {
      id: number;
      cuerpo: { roles?: number[] };
    };
    expect(args.id).toBe(10);
    expect(args.cuerpo.roles).toEqual([1]);
  });

  // M1: en edición, vaciar un campo opcional ya capturado debe mandar `null` (borrar),
  // no omitirlo (omitir no tocaría el valor en el backend).
  it('en edición, vaciar un campo opcional manda null para borrarlo', async () => {
    const usuario = userEvent.setup();
    actualizarMutate.mockImplementation(
      (_args, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
        opciones?.onSuccess?.(proveedorEjemplo());
      },
    );
    renderConProveedores(
      <DialogoProveedor
        abierto
        alCambiarAbierto={vi.fn()}
        proveedor={proveedorEjemplo({
          telefono: '555-1234',
          roles: [{ id: 1, codigo: 'maquila-costura', nombre: 'Maquila — costura' }],
        })}
      />,
    );

    // Expande Contacto y borra el teléfono pre-cargado.
    await usuario.click(screen.getByRole('button', { name: 'Contacto' }));
    const telefono = await screen.findByLabelText('Teléfono');
    await usuario.clear(telefono);
    await usuario.click(screen.getByTestId('guardar-proveedor'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as {
      cuerpo: { telefono?: string | null };
    };
    // Vacío -> null (borrar), no se omite ni se manda ''.
    expect(args.cuerpo.telefono).toBeNull();
  });

  it('en edición, los enum y numéricos opcionales vacíos viajan como null', async () => {
    const usuario = userEvent.setup();
    actualizarMutate.mockImplementation(
      (_args, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
        opciones?.onSuccess?.(proveedorEjemplo());
      },
    );
    // Proveedor sin moneda ni días de crédito: en edición deben salir como null.
    renderConProveedores(
      <DialogoProveedor
        abierto
        alCambiarAbierto={vi.fn()}
        proveedor={proveedorEjemplo({
          roles: [{ id: 1, codigo: 'maquila-costura', nombre: 'Maquila — costura' }],
        })}
      />,
    );

    await usuario.click(screen.getByTestId('guardar-proveedor'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as { cuerpo: Record<string, unknown> };
    expect(args.cuerpo.moneda).toBeNull();
    expect(args.cuerpo.metodoPago).toBeNull();
    expect(args.cuerpo.diasCredito).toBeNull();
    expect(args.cuerpo.limiteCredito).toBeNull();
    expect(args.cuerpo.leadTimeDias).toBeNull();
  });

  it('en ALTA, los campos opcionales vacíos se OMITEN (no viajan como null)', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: ProveedorCrear, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
        opciones?.onSuccess?.(proveedorEjemplo({ nombre: 'Nuevo' }));
      },
    );
    renderConProveedores(
      <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
    );

    await usuario.type(screen.getByLabelText('Nombre'), 'Nuevo');
    await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
    await usuario.click(screen.getByTestId('guardar-proveedor'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    // Omitidos (no presentes), NO null.
    expect('telefono' in cuerpo).toBe(false);
    expect('rfc' in cuerpo).toBe(false);
    expect('moneda' in cuerpo).toBe(false);
    expect('diasCredito' in cuerpo).toBe(false);
  });
});
