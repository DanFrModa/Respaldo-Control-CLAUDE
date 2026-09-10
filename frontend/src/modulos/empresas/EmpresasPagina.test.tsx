import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorDeApi } from '@/api/errores';
import type { Empresa, EmpresasLista } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EmpresasPagina } from './EmpresasPagina';

// Se controla la capa de datos: las pruebas no tocan la red.
type EstadoConsulta = {
  data: EmpresasLista | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useEmpresas = vi.fn<() => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
const actualizarMutate = vi.fn();

vi.mock('@/api/empresas', () => ({
  useEmpresas: () => useEmpresas(),
  useCrearEmpresa: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarEmpresa: () => ({ mutate: actualizarMutate, isPending: false }),
  useDesactivarEmpresa: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarEmpresa: () => ({ mutate: reactivarMutate, isPending: false }),
  // Configuracion (dialogo secundario): no se ejercita aqui.
  useConfiguracionEmpresa: () => ({ data: undefined, isPending: true, isError: false }),
  useActualizarConfiguracion: () => ({ mutate: vi.fn(), isPending: false }),
  // Logo (seccion del cajon): su comportamiento propio se prueba en `LogoEmpresa.test.tsx`.
  useLogoEmpresa: () => ({ data: undefined, isPending: false, isError: false, error: null }),
  useSubirLogoEmpresa: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarLogoEmpresa: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Empresa de ejemplo (OJO: flag `activa`). */
function empresa(id: number, nombre: string, sobre: Partial<Empresa> = {}): Empresa {
  return {
    id,
    nombre,
    razonSocial: null,
    rfc: null,
    regimenFiscalSat: null,
    codigoPostalFiscal: null,
    identificador: null,
    favorita: false,
    idArchivoLogo: null,
    paraIpt: false,
    paraEdr: false,
    activa: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...sobre,
  };
}

/** Estado de consulta "con datos". */
function consultaConDatos(datos: Empresa[]): EstadoConsulta {
  return {
    data: datos,
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

const ADMIN = ['empresas.administrar'] as const;

/** Atajo: el cuerpo del cajón de detalle (datos/banderas de la empresa). */
function detalle(): HTMLElement {
  return screen.getByTestId('detalle-empresa');
}

/** Atajo: el cajón completo (su TÍTULO trae el estado Activo/Inactivo y la Favorita). */
function cajon(): HTMLElement {
  const el = detalle().closest('[data-slot="cajon-detalle"]');
  if (el === null) {
    throw new Error('No se encontró el cajón de detalle.');
  }
  return el as HTMLElement;
}

describe('<EmpresasPagina>', () => {
  beforeEach(() => {
    useEmpresas.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
    actualizarMutate.mockReset();
  });

  it('lista las empresas que devuelve el API', () => {
    useEmpresas.mockReturnValue(
      consultaConDatos([empresa(1, 'FR Moda', { favorita: true }), empresa(2, 'Otra SA')]),
    );
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    // Tabla-first: el detalle NO se auto-abre; cada empresa sale en su renglón.
    expect(screen.getAllByTestId('fila-empresa')).toHaveLength(2);
    expect(screen.getByText('FR Moda')).toBeInTheDocument();
    expect(screen.getByText('Otra SA')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useEmpresas.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    expect(screen.getByText('No hay empresas que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un boton de reintento cuando la consulta falla', () => {
    useEmpresas.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien no puede administrar', () => {
    useEmpresas.mockReturnValue(consultaConDatos([empresa(1, 'FR Moda')]));
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([]) });

    expect(screen.queryByTestId('nuevo-empresa')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-empresa')).not.toBeInTheDocument();
    expect(screen.queryByTestId('configurar-empresa')).not.toBeInTheDocument();
  });

  it('pide confirmacion antes de desactivar y llama a la mutacion al confirmar', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(consultaConDatos([empresa(7, 'Vieja SA')]));
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    // Tabla-first: primero se abre el cajón con clic en el renglón; "Desactivar" vive ahí.
    await u.click(screen.getByTestId('fila-empresa'));
    await u.click(screen.getByTestId('desactivar-empresa'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar empresa')).toBeInTheDocument();

    await u.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('una empresa inactiva ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(consultaConDatos([empresa(9, 'Apagada SA', { activa: false })]));
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    // Por defecto las inactivas se ocultan: hay que mostrarlas (chip "Todas") y abrir su cajón.
    await u.click(screen.getByTestId('mostrar-desactivados'));
    await u.click(screen.getByTestId('fila-empresa'));

    // El estado "Inactivo" se pinta en el título del cajón; el detalle ofrece "Activar".
    expect(within(cajon()).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByTestId('activar-empresa')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-empresa')).not.toBeInTheDocument();

    await u.click(screen.getByTestId('activar-empresa'));
    // Reactivar es no destructivo: NO abre diálogo de confirmación (ojo: el cajón
    // abierto también es un dialog, por eso se consulta el botón de confirmar).
    expect(screen.queryByTestId('confirmar-accion')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  it('por defecto oculta las empresas inactivas hasta pedir mostrarlas', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(
      consultaConDatos([empresa(1, 'Activa SA'), empresa(2, 'Inactiva SA', { activa: false })]),
    );
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    expect(screen.getByText('Activa SA')).toBeInTheDocument();
    expect(screen.queryByText('Inactiva SA')).not.toBeInTheDocument();

    await u.click(screen.getByTestId('mostrar-desactivados'));
    expect(screen.getByText('Inactiva SA')).toBeInTheDocument();
  });

  it('abre la configuración de la empresa desde las acciones del detalle', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(consultaConDatos([empresa(5, 'Config SA')]));
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    // "Configurar" vive en las acciones del cajón: primero se abre con clic en el renglón.
    await u.click(screen.getByTestId('fila-empresa'));
    await u.click(screen.getByTestId('configurar-empresa'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Configuración de Config SA')).toBeInTheDocument();
  });

  it('edita el identificador de una empresa y lo envía en el cuerpo del PATCH', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(
      consultaConDatos([empresa(3, 'Marca SA', { identificador: 'MS-01' })]),
    );
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    // "Editar" vive en las acciones del cajón: primero se abre con clic en el renglón.
    await u.click(screen.getByTestId('fila-empresa'));
    await u.click(screen.getByTestId('editar-empresa'));

    const dialogo = await screen.findByRole('dialog');
    const identificador = within(dialogo).getByLabelText('Identificador');
    expect(identificador).toHaveValue('MS-01');

    await u.clear(identificador);
    await u.type(identificador, 'MS-02');
    await u.click(screen.getByTestId('guardar-empresa'));

    expect(actualizarMutate).toHaveBeenCalledTimes(1);
    const [args] = actualizarMutate.mock.calls[0] as [
      { id: number; cuerpo: { identificador?: string } },
    ];
    expect(args.id).toBe(3);
    expect(args.cuerpo.identificador).toBe('MS-02');
  });

  it('captura el RFC fiscal (F9-E3) y lo envía en el cuerpo del PATCH', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(consultaConDatos([empresa(4, 'Fiscal SA', { rfc: null })]));
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    await u.click(screen.getByTestId('fila-empresa'));
    await u.click(screen.getByTestId('editar-empresa'));

    const dialogo = await screen.findByRole('dialog');
    const rfc = within(dialogo).getByLabelText('RFC');
    await u.type(rfc, 'XAXX010101000');
    await u.click(screen.getByTestId('guardar-empresa'));

    const [args] = actualizarMutate.mock.calls[0] as [{ id: number; cuerpo: { rfc?: string } }];
    expect(args.id).toBe(4);
    expect(args.cuerpo.rfc).toBe('XAXX010101000');
  });

  /**
   * ⭐ LA FICHA FISCAL DEL RECEPTOR (fila 0.118, §Post-F9.186(k)). Sin régimen y sin CP fiscal, el
   * proveedor no puede timbrar a nombre de la empresa y el documento para facturar NO se emite. El
   * único sitio donde se capturan es aquí, así que aquí se mide que existan y que viajen.
   */
  it('captura el régimen fiscal y el CP fiscal, y los envía en el cuerpo del PATCH', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(
      consultaConDatos([
        empresa(6, 'Receptor SA', { regimenFiscalSat: null, codigoPostalFiscal: null }),
      ]),
    );
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    await u.click(screen.getByTestId('fila-empresa'));
    await u.click(screen.getByTestId('editar-empresa'));

    const dialogo = await screen.findByRole('dialog');
    await u.type(within(dialogo).getByLabelText('Régimen fiscal'), '601');
    await u.type(within(dialogo).getByLabelText('Código postal fiscal'), '11000');
    await u.click(screen.getByTestId('guardar-empresa'));

    const [args] = actualizarMutate.mock.calls[0] as [
      { id: number; cuerpo: { regimenFiscalSat?: string; codigoPostalFiscal?: string } },
    ];
    expect(args.id).toBe(6);
    expect(args.cuerpo.regimenFiscalSat).toBe('601');
    expect(args.cuerpo.codigoPostalFiscal).toBe('11000');
  });

  it('⭐ un CP fiscal que no son 5 dígitos NO se guarda (se avisa en el campo)', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(consultaConDatos([empresa(7, 'Receptor SA')]));
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    await u.click(screen.getByTestId('fila-empresa'));
    await u.click(screen.getByTestId('editar-empresa'));

    const dialogo = await screen.findByRole('dialog');
    await u.type(within(dialogo).getByLabelText('Código postal fiscal'), '110');
    await u.click(screen.getByTestId('guardar-empresa'));

    expect(actualizarMutate).not.toHaveBeenCalled();
    expect(
      await within(dialogo).findByText('El código postal debe tener 5 dígitos'),
    ).toBeInTheDocument();
  });

  it('el detalle enseña la ficha fiscal, y marca en vacío lo que falta por capturar', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(
      consultaConDatos([
        empresa(8, 'Receptor SA', {
          rfc: 'XAXX010101000',
          regimenFiscalSat: '601',
          codigoPostalFiscal: null,
        }),
      ]),
    );
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });
    await u.click(screen.getByTestId('fila-empresa'));

    const cuerpo = detalle();
    expect(within(cuerpo).getByText('Ficha fiscal (con la que nos facturan)')).toBeInTheDocument();
    expect(within(cuerpo).getByText('XAXX010101000')).toBeInTheDocument();
    expect(within(cuerpo).getByText('601')).toBeInTheDocument();
  });
});
