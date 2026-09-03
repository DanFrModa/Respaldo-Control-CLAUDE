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
const crearContactoMutate = vi.fn();
const actualizarContactoMutate = vi.fn();
const analizarConstanciaMutate = vi.fn();
const subirAdjuntoMutate = vi.fn();

/** Roles de ejemplo del catalogo (selector multiple). */
const ROLES_EJEMPLO: RolProveedor[] = [
  { id: 1, codigo: 'maquila-costura', nombre: 'Maquila — costura', activo: true },
  { id: 2, codigo: 'estampado', nombre: 'Estampador', activo: true },
  // Rol COMERCIAL (no es taller): con solo éste, los datos de taller no deben salir.
  { id: 3, codigo: 'vende-telas', nombre: 'Telas', activo: true },
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
  useSubirAdjuntoProveedor: () => ({ mutate: subirAdjuntoMutate, isPending: false }),
  useQuitarAdjuntoProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  // Hooks de V1-E3f pieza B: contactos (§Post-F9.56 punto 1) y constancia (§Post-F9.55).
  useCrearContactoProveedor: () => ({ mutate: crearContactoMutate, isPending: false }),
  useActualizarContactoProveedor: () => ({ mutate: actualizarContactoMutate, isPending: false }),
  useAnalizarConstancia: () => ({ mutate: analizarConstanciaMutate, isPending: false }),
}));

/** Proveedor de ejemplo (enriquecido R15) para las pruebas de edicion. */
function proveedorEjemplo(sobre: Partial<Proveedor> = {}): Proveedor {
  return {
    id: 10,
    nombre: 'Textiles Prueba',
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
    metodoPago: null,
    banco: null,
    clabe: null,
    limiteCredito: null,
    leadTimeDias: null,
    notas: null,
    asegurado: null,
    obsPago: null,
    modalidadFacturacion: 'solo_con',
    roles: [],
    contactos: [],
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
    crearContactoMutate.mockReset();
    actualizarContactoMutate.mockReset();
    analizarConstanciaMutate.mockReset();
    subirAdjuntoMutate.mockReset();
  });

  /**
   * Elige la modalidad de facturación (fila 0.110). Es OBLIGATORIA, así que sin ella NINGÚN alta
   * llega a enviarse: se llama en las pruebas que están midiendo OTRA regla, para que su fallo no
   * se confunda con éste. Las pruebas que miden esta regla NO la llaman, a propósito.
   */
  async function elegirModalidad(
    usuario: ReturnType<typeof userEvent.setup>,
    valor: 'solo_con' | 'solo_sin' | 'ambos' = 'solo_con',
  ): Promise<void> {
    await usuario.selectOptions(screen.getByTestId('proveedor-modalidad-facturacion'), valor);
  }

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
      'Contactos',
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

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Sin roles');
    await elegirModalidad(usuario);
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

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Factura sin RFC');
    // Elige un rol (para aislar la regla fiscal de la regla de roles).
    await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
    // Expande Fiscal y marca "¿Emite factura (CFDI)?" sin capturar RFC.
    await usuario.click(screen.getByRole('button', { name: 'Fiscal' }));
    await usuario.click(await screen.findByTestId('proveedor-factura'));
    await elegirModalidad(usuario);
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

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Nuevo Prov');
    await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
    await usuario.click(screen.getByTestId('rol-proveedor-opcion-2'));
    await elegirModalidad(usuario);
    await usuario.click(screen.getByTestId('guardar-proveedor'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as ProveedorCrear;
    expect(cuerpo.nombre).toBe('Nuevo Prov');
    expect(cuerpo.roles).toEqual([1, 2]);
    // Tras el exito cierra el dialogo.
    expect(alCambiarAbierto).toHaveBeenCalledWith(false);
  });

  // A1.1: el nombre corto de uso diario ("Bloom" para BLOOM TEXTIL) viaja en el alta y,
  // vacío en edición, se manda null para borrarlo (M1).
  it('captura el nombre corto en el alta y lo borra con null en edición', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: ProveedorCrear, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
        opciones?.onSuccess?.(proveedorEjemplo({ nombre: 'BLOOM TEXTIL' }));
      },
    );
    const { unmount } = renderConProveedores(
      <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
    );

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'BLOOM TEXTIL');
    await usuario.type(screen.getByTestId('proveedor-nombre-corto'), 'Bloom');
    await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
    await elegirModalidad(usuario);
    await usuario.click(screen.getByTestId('guardar-proveedor'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect((crearMutate.mock.calls[0]?.[0] as ProveedorCrear).nombreCorto).toBe('Bloom');
    unmount();

    // EDICIÓN: pre-carga el nombre corto y, si se vacía, viaja como null (borrar).
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
          nombreCorto: 'Bloom',
          roles: [{ id: 1, codigo: 'maquila-costura', nombre: 'Maquila — costura' }],
        })}
      />,
    );

    const campoCorto = screen.getByTestId('proveedor-nombre-corto');
    expect(campoCorto).toHaveValue('Bloom');
    await usuario.clear(campoCorto);
    await elegirModalidad(usuario);
    await usuario.click(screen.getByTestId('guardar-proveedor'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as {
      cuerpo: { nombreCorto?: string | null };
    };
    expect(args.cuerpo.nombreCorto).toBeNull();
  });

  // Fusión de terceros (D12/R15) + §Post-F9.56 punto 7: los datos de taller SOLO salen si el
  // proveedor tiene un rol de servicio. El rol 1 del catálogo falso es `maquila-costura`.
  it('captura los datos de taller (asegurado/obsPago) y los envía en el alta', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: ProveedorCrear, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
        opciones?.onSuccess?.(proveedorEjemplo({ nombre: 'Taller' }));
      },
    );
    renderConProveedores(
      <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
    );

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Taller');
    await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
    // Expande "Datos de taller" y captura los dos campos (el corto vive ya en General).
    await usuario.click(screen.getByRole('button', { name: 'Datos de taller' }));
    await usuario.click(await screen.findByTestId('proveedor-asegurado'));
    await usuario.type(screen.getByLabelText('Observaciones de pago'), 'paga viernes');
    await elegirModalidad(usuario);
    await usuario.click(screen.getByTestId('guardar-proveedor'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as ProveedorCrear;
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

    await elegirModalidad(usuario);
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
    await elegirModalidad(usuario);
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

    await elegirModalidad(usuario);
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

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Nuevo');
    await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
    await elegirModalidad(usuario);
    await usuario.click(screen.getByTestId('guardar-proveedor'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    // Omitidos (no presentes), NO null.
    expect('telefono' in cuerpo).toBe(false);
    expect('rfc' in cuerpo).toBe(false);
    expect('moneda' in cuerpo).toBe(false);
    expect('diasCredito' in cuerpo).toBe(false);
  });

  // ── §Post-F9.56 punto 4: la pantalla OBEDECE la bandera de factura ──────────
  describe('si no emite CFDI, no se piden datos fiscales (§Post-F9.56 punto 4)', () => {
    it('con la casilla APAGADA esconde RFC, régimen, uso de CFDI y CP, y lo explica', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await usuario.click(screen.getByRole('button', { name: 'Fiscal' }));

      expect(await screen.findByTestId('aviso-sin-cfdi')).toBeInTheDocument();
      expect(screen.queryByLabelText('RFC')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Régimen fiscal (SAT)')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Uso de CFDI habitual')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('CP de expedición')).not.toBeInTheDocument();
    });

    it('al ENCENDERLA aparecen los campos fiscales', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await usuario.click(screen.getByRole('button', { name: 'Fiscal' }));
      await usuario.click(await screen.findByTestId('proveedor-factura'));

      expect(await screen.findByLabelText('RFC')).toBeInTheDocument();
      expect(screen.getByLabelText('Régimen fiscal (SAT)')).toBeInTheDocument();
      expect(screen.queryByTestId('aviso-sin-cfdi')).not.toBeInTheDocument();
    });
  });

  // ── §Post-F9.56 punto 7: "está asegurado" solo aplica a maquila ─────────────
  describe('los datos de taller solo salen si el proveedor presta un servicio', () => {
    it('con SOLO un rol comercial (vende telas) la sección NO existe', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await usuario.click(screen.getByTestId('rol-proveedor-opcion-3'));
      expect(screen.queryByRole('button', { name: 'Datos de taller' })).not.toBeInTheDocument();
    });

    it('al marcar un rol de taller la sección aparece', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await usuario.click(screen.getByTestId('rol-proveedor-opcion-3'));
      expect(screen.queryByRole('button', { name: 'Datos de taller' })).not.toBeInTheDocument();
      await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
      expect(await screen.findByRole('button', { name: 'Datos de taller' })).toBeInTheDocument();
    });
  });

  // ── §Post-F9.55: la constancia PROPONE, la persona CONFIRMA ─────────────────
  describe('lector de la Constancia de Situación Fiscal', () => {
    /** Propuesta de ejemplo con DOS regímenes (persona física). */
    const PROPUESTA = {
      tipoPersona: 'fisica' as const,
      rfc: 'MASD850101H29',
      razonSocial: 'DANIELA MARTINEZ SOLIS',
      curp: 'MASD850101HDFRRN04',
      regimenes: [
        { clave: '612', descripcion: 'Personas Físicas con Actividades Empresariales' },
        { clave: '626', descripcion: 'Régimen Simplificado de Confianza' },
      ],
      codigoPostalExpedicion: '06600',
      direccion: 'TAINE No. 412, Col. POLANCO, MIGUEL HIDALGO, C.P. 06600',
      advertencias: ['La constancia trae 2 regímenes: escoge cuál usar para el CFDI.'],
    };

    /** Simula que el API devolvió `PROPUESTA` al subir el PDF. */
    function conPropuesta(): void {
      analizarConstanciaMutate.mockImplementation(
        (_b: string, opciones?: { onSuccess?: (d: typeof PROPUESTA) => void }) => {
          opciones?.onSuccess?.(PROPUESTA);
        },
      );
    }

    /** Sube un PDF falso al input de la constancia. */
    async function subirPdf(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
      const archivo = new File(['%PDF-1.4 falso'], 'constancia.pdf', { type: 'application/pdf' });
      await usuario.upload(screen.getByTestId('constancia-archivo'), archivo);
    }

    it('⭐ NO llena nada hasta que la persona CONFIRMA', async () => {
      const usuario = userEvent.setup();
      conPropuesta();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await subirPdf(usuario);

      // Ya se ve la propuesta…
      expect(await screen.findByTestId('constancia-propuesta')).toBeInTheDocument();
      expect(screen.getByTestId('constancia-rfc')).toHaveTextContent('MASD850101H29');
      // …pero el formulario sigue INTACTO: el nombre no se llenó solo.
      expect(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/)).toHaveValue('');

      await usuario.click(screen.getByTestId('usar-constancia'));
      expect(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/)).toHaveValue(
        'DANIELA MARTINEZ SOLIS',
      );
    });

    it('⭐ con VARIOS regímenes ofrece los dos y usa el que se escoja', async () => {
      const usuario = userEvent.setup();
      conPropuesta();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await subirPdf(usuario);

      const selector = await screen.findByTestId('constancia-regimen');
      expect(within(selector).getAllByRole('option')).toHaveLength(2);
      await usuario.selectOptions(selector, '626');
      await usuario.click(screen.getByTestId('usar-constancia'));

      // Al confirmar enciende la casilla de factura, así que los campos fiscales ya se ven.
      await usuario.click(screen.getByRole('button', { name: 'Fiscal' }));
      expect(await screen.findByLabelText('Régimen fiscal (SAT)')).toHaveValue('626');
      expect(screen.getByLabelText('RFC')).toHaveValue('MASD850101H29');
    });

    it('⭐ CONSERVA el PDF como adjunto CONSTANCIA al guardar (no se lee y se tira)', async () => {
      const usuario = userEvent.setup();
      conPropuesta();
      crearMutate.mockImplementation(
        (_cuerpo: ProveedorCrear, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
          opciones?.onSuccess?.(proveedorEjemplo({ id: 42, nombre: 'DANIELA MARTINEZ SOLIS' }));
        },
      );
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await subirPdf(usuario);
      await usuario.click(await screen.findByTestId('usar-constancia'));
      await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
      await elegirModalidad(usuario);
      await usuario.click(screen.getByTestId('guardar-proveedor'));

      await waitFor(() => expect(subirAdjuntoMutate).toHaveBeenCalledTimes(1));
      const args = subirAdjuntoMutate.mock.calls[0]?.[0] as {
        idProveedor: number;
        tipo: string;
        archivo: File;
      };
      // Se sube DESPUÉS de guardar, con el id que devolvió el alta (en el alta no existía).
      expect(args.idProveedor).toBe(42);
      expect(args.tipo).toBe('CONSTANCIA');
      expect(args.archivo.name).toBe('constancia.pdf');
    });

    it('sin constancia leída NO sube ningún adjunto', async () => {
      const usuario = userEvent.setup();
      crearMutate.mockImplementation(
        (_cuerpo: ProveedorCrear, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
          opciones?.onSuccess?.(proveedorEjemplo());
        },
      );
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Sin constancia');
      await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
      await elegirModalidad(usuario);
      await usuario.click(screen.getByTestId('guardar-proveedor'));

      await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
      expect(subirAdjuntoMutate).not.toHaveBeenCalled();
    });

    it('⭐ si NO se reconoció el régimen, NO enciende «emite factura» (no deja el alta trabada)', async () => {
      const usuario = userEvent.setup();
      // Formato que el lector no supo mapear: devuelve el texto crudo con clave ''.
      analizarConstanciaMutate.mockImplementation(
        (_b: string, opciones?: { onSuccess?: (d: typeof PROPUESTA) => void }) => {
          opciones?.onSuccess?.({
            ...PROPUESTA,
            regimenes: [{ clave: '', descripcion: 'Régimen Marciano de Nueva Creación' }],
            advertencias: ['El régimen no está en el catálogo del SAT que conoce el sistema.'],
          });
        },
      );
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await subirPdf(usuario);
      await usuario.click(await screen.findByTestId('usar-constancia'));

      // La casilla queda apagada: con `factura` encendida y sin régimen, la regla de captura
      // (`factura ⇒ RFC + régimen`) trabaría el guardado por un dato que el papel no traía.
      await usuario.click(screen.getByRole('button', { name: 'Fiscal' }));
      expect(await screen.findByTestId('proveedor-factura')).not.toBeChecked();
      expect(screen.getByTestId('aviso-sin-cfdi')).toBeInTheDocument();
    });

    it('muestra las advertencias del papel sin bloquear el alta', async () => {
      const usuario = userEvent.setup();
      conPropuesta();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await subirPdf(usuario);
      expect(await screen.findByTestId('constancia-advertencias')).toHaveTextContent('2 regímenes');
      // Y el botón de guardar sigue disponible: nunca bloquea.
      expect(screen.getByTestId('guardar-proveedor')).toBeEnabled();
    });

    it('si no se pudo leer, avisa y deja capturar a mano (degradar con gracia)', async () => {
      const usuario = userEvent.setup();
      analizarConstanciaMutate.mockImplementation(
        (_b: string, opciones?: { onError?: (e: { message: string }) => void }) => {
          opciones?.onError?.({ message: 'No se pudo leer el documento.' });
        },
      );
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await subirPdf(usuario);

      expect(await screen.findByTestId('constancia-captura-manual')).toBeInTheDocument();
      expect(screen.queryByTestId('constancia-propuesta')).not.toBeInTheDocument();
      expect(screen.getByTestId('guardar-proveedor')).toBeEnabled();
    });
  });

  // ── §Post-F9.56 punto 1: contactos, N por proveedor ─────────────────────────
  describe('contactos del proveedor', () => {
    it('en ALTA no se pueden capturar todavía: pide guardar primero', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await usuario.click(screen.getByRole('button', { name: 'Contactos' }));
      expect(await screen.findByTestId('contactos-requiere-guardar')).toBeInTheDocument();
      expect(screen.queryByTestId('editor-contactos')).not.toBeInTheDocument();
    });

    it('en EDICIÓN lista los contactos con su puesto y permite agregar otro', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(
        <DialogoProveedor
          abierto
          alCambiarAbierto={vi.fn()}
          proveedor={proveedorEjemplo({
            contactos: [
              {
                id: 1,
                idProveedor: 10,
                nombre: 'Ana',
                puesto: 'crédito y cobranza',
                telefono: '555-1',
                email: null,
                notas: null,
                activo: true,
              },
            ],
          })}
        />,
      );
      await usuario.click(screen.getByRole('button', { name: 'Contactos' }));

      const editor = await screen.findByTestId('editor-contactos');
      expect(within(editor).getByText('Ana')).toBeInTheDocument();
      expect(within(editor).getByText(/crédito y cobranza/)).toBeInTheDocument();

      await usuario.type(screen.getByTestId('contacto-nombre'), 'Beto');
      await usuario.type(screen.getByTestId('contacto-puesto'), 'encargado del taller');
      await usuario.click(screen.getByTestId('agregar-contacto'));

      expect(crearContactoMutate).toHaveBeenCalledTimes(1);
      const args = crearContactoMutate.mock.calls[0]?.[0] as {
        id: number;
        cuerpo: { nombre: string; puesto?: string };
      };
      expect(args.id).toBe(10);
      expect(args.cuerpo).toMatchObject({ nombre: 'Beto', puesto: 'encargado del taller' });
    });

    it('agregar sin nombre no llama al API y muestra el error', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={proveedorEjemplo()} />,
      );
      await usuario.click(screen.getByRole('button', { name: 'Contactos' }));
      await usuario.click(await screen.findByTestId('agregar-contacto'));

      expect(crearContactoMutate).not.toHaveBeenCalled();
      expect(screen.getByText('Escribe el nombre de la persona.')).toBeInTheDocument();
    });

    it('archivar un contacto manda activo:false (borrado suave, D3)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(
        <DialogoProveedor
          abierto
          alCambiarAbierto={vi.fn()}
          proveedor={proveedorEjemplo({
            contactos: [
              {
                id: 7,
                idProveedor: 10,
                nombre: 'Rosa',
                puesto: 'supervisora',
                telefono: null,
                email: null,
                notas: null,
                activo: true,
              },
            ],
          })}
        />,
      );
      await usuario.click(screen.getByRole('button', { name: 'Contactos' }));
      await usuario.click(await screen.findByTestId('archivar-contacto'));

      expect(actualizarContactoMutate).toHaveBeenCalledTimes(1);
      expect(actualizarContactoMutate.mock.calls[0]?.[0]).toMatchObject({
        id: 10,
        idContacto: 7,
        cuerpo: { activo: false },
      });
    });
  });
  // ── ⭐ MODALIDAD DE FACTURACIÓN OBLIGATORIA (fila 0.110, §Post-F9.186(a)) ──────────────────────
  //
  // Daniel: *"es un campo **obligatorio** de llenar. A fuerzas hay que definir si es con, sin o
  // ambas"*. No es cosmético: decide de dónde sale el pago del proveedor (§Post-F9.184(f)).
  describe('modalidad de facturación: obligatoria al dar de alta y al editar', () => {
    it('⭐ un ALTA sin elegir modalidad NO se envía, y lo dice', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );

      await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Sin clasificar');
      await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
      // A propósito NO se llama a `elegirModalidad`.
      await usuario.click(screen.getByTestId('guardar-proveedor'));

      expect(crearMutate).not.toHaveBeenCalled();
      expect(
        await screen.findByText(
          'Indica cómo factura este proveedor: solo con, solo sin, o de las dos formas',
        ),
      ).toBeInTheDocument();
    });

    it('elegida la modalidad, el alta la manda en el cuerpo', async () => {
      const usuario = userEvent.setup();
      crearMutate.mockImplementation(
        (_cuerpo: ProveedorCrear, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
          opciones?.onSuccess?.(proveedorEjemplo({ nombre: 'Ambos' }));
        },
      );
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );

      await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Ambos');
      await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
      await elegirModalidad(usuario, 'ambos');
      await usuario.click(screen.getByTestId('guardar-proveedor'));

      await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
      const cuerpo = crearMutate.mock.calls[0]?.[0] as ProveedorCrear;
      expect(cuerpo.modalidadFacturacion).toBe('ambos');
    });

    // ⚠️ REGLA 0-B: el proveedor MIGRADO (modalidad en null) se LEE con toda normalidad. Lo que no
    // se puede es dejarlo así al guardar. Nada de auditar ni rellenar el dato viejo por detrás.
    it('⭐ un proveedor MIGRADO sin modalidad se ABRE y se LEE sin que truene nada', () => {
      renderConProveedores(
        <DialogoProveedor
          abierto
          alCambiarAbierto={vi.fn()}
          proveedor={proveedorEjemplo({ nombre: 'Migrado de Access', modalidadFacturacion: null })}
        />,
      );

      // La ficha abre, el nombre se ve, y el selector simplemente está sin elegir.
      expect(screen.getByRole('heading', { name: 'Editar proveedor' })).toBeInTheDocument();
      expect(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/)).toHaveValue('Migrado de Access');
      expect(screen.getByTestId('proveedor-modalidad-facturacion')).toHaveValue('');
    });

    // ⚠️ Fila 0.124 (los DOS campos que contestan lo mismo): esta fila puso las dos preguntas en la
    // misma pantalla, así que al menos la contradicción se ve. El aviso NO bloquea el guardado a
    // propósito — bloquear sería inventar la regla que Daniel todavía no dictó.
    it('avisa (sin bloquear) si dice que NO emite CFDI pero que sí factura', async () => {
      const usuario = userEvent.setup();
      crearMutate.mockImplementation(
        (_cuerpo: ProveedorCrear, opciones?: { onSuccess?: (r: Proveedor) => void }) => {
          opciones?.onSuccess?.(proveedorEjemplo({ nombre: 'Contradictorio' }));
        },
      );
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );

      await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Contradictorio');
      await usuario.click(screen.getByTestId('rol-proveedor-opcion-1'));
      // «¿Emite factura?» arranca APAGADA; elegir «solo con factura» es la contradicción.
      await elegirModalidad(usuario, 'solo_con');
      expect(await screen.findByTestId('aviso-facturacion-contradictoria')).toBeInTheDocument();

      // …y aun así deja guardar: el aviso informa, no manda.
      await usuario.click(screen.getByTestId('guardar-proveedor'));
      await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    });

    // ⭐ EL SENTIDO INVERSO — y es el CARO. Sus cargos por CFDI nacerían `esFiscal: true` (van por el
    // banco) mientras sus capturas manuales de CxP nacen `false` (van por la relación). Es el caso
    // que el TSDoc de `segmento-motor.ts` marca como el peor: degradar una factura timbrada, con el
    // UUID ya consumido para siempre. Un aviso que viera sólo el otro sentido enseñaría que "sin
    // aviso = consistente", que es mentira justo aquí.
    it('⭐ avisa TAMBIÉN al revés: dice que SÍ emite CFDI pero que todo va sin factura', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );

      // Enciende «¿Emite factura?» (vive en la sección Fiscal, plegada) y elige «solo sin factura».
      await usuario.click(screen.getByRole('button', { name: 'Fiscal' }));
      await usuario.click(await screen.findByTestId('proveedor-factura'));
      await elegirModalidad(usuario, 'solo_sin');

      const aviso = await screen.findByTestId('aviso-facturacion-contradictoria');
      // Y el texto dice CUÁL de los dos sentidos es: un aviso que no distingue no sirve de guía.
      expect(aviso).toHaveTextContent(/SÍ emite factura/);
      expect(aviso).toHaveTextContent(/todo lo suyo va sin factura/);
    });

    it('y cada sentido trae su propio texto (no un genérico para los dos)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      // «¿Emite factura?» apagada + «solo con factura» = el otro sentido.
      await elegirModalidad(usuario, 'solo_con');
      expect(await screen.findByTestId('aviso-facturacion-contradictoria')).toHaveTextContent(
        /NO emite factura/,
      );
    });

    // Las dos combinaciones que NO son contradicción: si el aviso saltara aquí, sería ruido y la
    // gente aprendería a ignorarlo — que es la otra forma de que un guardián deje de servir.
    it('calla cuando NO hay contradicción (los dos casos legítimos)', async () => {
      const usuario = userEvent.setup();
      const { unmount } = renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      // No timbra + todo sin factura: coherente.
      await elegirModalidad(usuario, 'solo_sin');
      expect(screen.queryByTestId('aviso-facturacion-contradictoria')).not.toBeInTheDocument();
      unmount();

      // Timbra + «de las dos formas»: coherente (unas cosas con factura, otras no).
      renderConProveedores(
        <DialogoProveedor abierto alCambiarAbierto={vi.fn()} proveedor={undefined} />,
      );
      await usuario.click(screen.getByRole('button', { name: 'Fiscal' }));
      await usuario.click(await screen.findByTestId('proveedor-factura'));
      await elegirModalidad(usuario, 'ambos');
      expect(screen.queryByTestId('aviso-facturacion-contradictoria')).not.toBeInTheDocument();
    });

    it('⭐ …pero GUARDARLO sin elegirla NO envía; al elegirla, sí', async () => {
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
            modalidadFacturacion: null,
            roles: [{ id: 1, codigo: 'maquila-costura', nombre: 'Maquila — costura' }],
          })}
        />,
      );

      await usuario.click(screen.getByTestId('guardar-proveedor'));
      expect(actualizarMutate).not.toHaveBeenCalled();

      await elegirModalidad(usuario, 'solo_sin');
      await usuario.click(screen.getByTestId('guardar-proveedor'));

      await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
      const args = actualizarMutate.mock.calls[0]?.[0] as {
        cuerpo: { modalidadFacturacion?: string | null };
      };
      // Y nunca viaja como `null`: vaciarla es justo lo que el backend rechaza.
      expect(args.cuerpo.modalidadFacturacion).toBe('solo_sin');
    });
  });
});
