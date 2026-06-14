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
}));

/** Empresa de ejemplo (OJO: flag `activa`). */
function empresa(id: number, nombre: string, sobre: Partial<Empresa> = {}): Empresa {
  return {
    id,
    nombre,
    razonSocial: null,
    identificador: null,
    upc: null,
    favorita: false,
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

/** Atajo: el panel de detalle (donde viven las acciones del registro seleccionado). */
function detalle(): HTMLElement {
  return screen.getByTestId('detalle-empresa');
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

    // Dos renglones; la primera queda auto-seleccionada (su nombre aparece tambien
    // en el detalle), por eso se busca con getAllByText.
    expect(screen.getAllByTestId('fila-empresa')).toHaveLength(2);
    expect(screen.getAllByText('FR Moda').length).toBeGreaterThan(0);
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

    // La empresa queda auto-seleccionada: "Desactivar" es un boton directo del detalle.
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

    // Por defecto las inactivas se ocultan: hay que mostrarlas.
    await u.click(screen.getByTestId('mostrar-desactivados'));

    expect(within(detalle()).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByTestId('activar-empresa')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-empresa')).not.toBeInTheDocument();

    await u.click(screen.getByTestId('activar-empresa'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  it('por defecto oculta las empresas inactivas hasta pedir mostrarlas', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(
      consultaConDatos([empresa(1, 'Activa SA'), empresa(2, 'Inactiva SA', { activa: false })]),
    );
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    // "Activa SA" queda auto-seleccionada (aparece en lista y detalle).
    expect(screen.getAllByText('Activa SA').length).toBeGreaterThan(0);
    expect(screen.queryByText('Inactiva SA')).not.toBeInTheDocument();

    await u.click(screen.getByTestId('mostrar-desactivados'));
    expect(screen.getByText('Inactiva SA')).toBeInTheDocument();
  });

  it('abre la configuración de la empresa desde las acciones del detalle', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(consultaConDatos([empresa(5, 'Config SA')]));
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    // "Configurar" es una accion extra del detalle de la empresa seleccionada.
    await u.click(screen.getByTestId('configurar-empresa'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Configuración de Config SA')).toBeInTheDocument();
  });

  it('edita el UPC de una empresa y lo envía en el cuerpo del PATCH', async () => {
    const u = userEvent.setup();
    useEmpresas.mockReturnValue(consultaConDatos([empresa(3, 'Marca SA', { upc: '750' })]));
    renderConProveedores(<EmpresasPagina />, { sesion: estadoSesionDePrueba([...ADMIN]) });

    // "Editar" es un boton directo del detalle de la empresa auto-seleccionada.
    await u.click(screen.getByTestId('editar-empresa'));

    const dialogo = await screen.findByRole('dialog');
    const upc = within(dialogo).getByLabelText('UPC');
    expect(upc).toHaveValue('750');

    await u.clear(upc);
    await u.type(upc, '780');
    await u.click(screen.getByTestId('guardar-empresa'));

    expect(actualizarMutate).toHaveBeenCalledTimes(1);
    const [args] = actualizarMutate.mock.calls[0] as [{ id: number; cuerpo: { upc?: string } }];
    expect(args.id).toBe(3);
    expect(args.cuerpo.upc).toBe('780');
  });
});
