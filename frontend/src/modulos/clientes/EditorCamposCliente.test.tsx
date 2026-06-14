import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClienteCampo, ClienteCampoCrear } from '@/api/tipos';
import type { ErrorDeApi } from '@/api/errores';
import { renderConProveedores } from '@/pruebas/utilidades';

import { EditorCamposCliente } from './EditorCamposCliente';

// Se controla la capa de datos: las pruebas no tocan la red. `useCamposCliente` se
// configura por test; se capturan los argumentos de las mutaciones.
type EstadoCampos = {
  data: ClienteCampo[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: ErrorDeApi | null;
};
const useCamposCliente = vi.fn<() => EstadoCampos>();
const agregarMutate = vi.fn();
const actualizarMutate = vi.fn();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();

vi.mock('@/api/clientes', () => ({
  useCamposCliente: () => useCamposCliente(),
  useAgregarCampoCliente: () => ({ mutate: agregarMutate, isPending: false }),
  useActualizarCampoCliente: () => ({ mutate: actualizarMutate, isPending: false }),
  useDesactivarCampoCliente: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarCampoCliente: () => ({ mutate: reactivarMutate, isPending: false }),
}));

/** Campo de referencia de ejemplo. */
function campo(sobre: Partial<ClienteCampo> = {}): ClienteCampo {
  return {
    id: 1,
    idCliente: 7,
    etiqueta: 'No. pedido',
    tipo: 'TEXTO',
    orden: 0,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...sobre,
  };
}

/** Estado "con campos". */
function conCampos(campos: ClienteCampo[]): EstadoCampos {
  return { data: campos, isPending: false, isError: false, error: null };
}

describe('<EditorCamposCliente>', () => {
  beforeEach(() => {
    useCamposCliente.mockReset();
    agregarMutate.mockReset();
    actualizarMutate.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
  });

  it('lista los campos del cliente (activos e inactivos)', () => {
    useCamposCliente.mockReturnValue(
      conCampos([
        campo({ id: 1, etiqueta: 'No. pedido', tipo: 'TEXTO' }),
        campo({ id: 2, etiqueta: 'Fecha límite', tipo: 'FECHA', activo: false }),
      ]),
    );
    renderConProveedores(<EditorCamposCliente idCliente={7} />);

    expect(screen.getAllByTestId('fila-campo')).toHaveLength(2);
    expect(screen.getByText('No. pedido')).toBeInTheDocument();
    expect(screen.getByText('Fecha límite')).toBeInTheDocument();
    // El inactivo ofrece Activar; el activo ofrece Desactivar.
    expect(screen.getByTestId('activar-campo')).toBeInTheDocument();
    expect(screen.getByTestId('desactivar-campo')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay campos', () => {
    useCamposCliente.mockReturnValue(conCampos([]));
    renderConProveedores(<EditorCamposCliente idCliente={7} />);

    expect(screen.getByTestId('campos-vacio')).toBeInTheDocument();
  });

  it('agrega un campo desde el diálogo', async () => {
    const usuario = userEvent.setup();
    agregarMutate.mockImplementation(
      (
        _args: { cuerpo: ClienteCampoCrear },
        opciones?: { onSuccess?: (r: ClienteCampo) => void },
      ) => {
        opciones?.onSuccess?.(campo({ etiqueta: 'Cedis' }));
      },
    );
    useCamposCliente.mockReturnValue(conCampos([]));
    renderConProveedores(<EditorCamposCliente idCliente={7} />);

    await usuario.click(screen.getByTestId('nuevo-campo'));
    const dialogo = await screen.findByRole('dialog');
    expect(
      within(dialogo).getByRole('heading', { name: 'Nuevo campo de referencia' }),
    ).toBeInTheDocument();

    await usuario.type(within(dialogo).getByLabelText('Etiqueta'), 'Cedis');
    await usuario.selectOptions(within(dialogo).getByLabelText('Tipo de dato'), 'NUMERO');
    await usuario.type(within(dialogo).getByLabelText('Orden'), '2');
    await usuario.click(screen.getByTestId('guardar-campo'));

    await waitFor(() => expect(agregarMutate).toHaveBeenCalledTimes(1));
    const args = agregarMutate.mock.calls[0]?.[0] as {
      idCliente: number;
      cuerpo: ClienteCampoCrear;
    };
    expect(args.idCliente).toBe(7);
    // El orden capturado viaja como número (no como texto del input).
    expect(args.cuerpo).toMatchObject({ etiqueta: 'Cedis', tipo: 'NUMERO', orden: 2 });
  });

  it('si no se captura orden, se OMITE del cuerpo (el backend lo coloca al final)', async () => {
    const usuario = userEvent.setup();
    agregarMutate.mockImplementation(
      (
        _args: { cuerpo: ClienteCampoCrear },
        opciones?: { onSuccess?: (r: ClienteCampo) => void },
      ) => {
        opciones?.onSuccess?.(campo({ etiqueta: 'Sin orden' }));
      },
    );
    useCamposCliente.mockReturnValue(conCampos([]));
    renderConProveedores(<EditorCamposCliente idCliente={7} />);

    await usuario.click(screen.getByTestId('nuevo-campo'));
    const dialogo = await screen.findByRole('dialog');
    await usuario.type(within(dialogo).getByLabelText('Etiqueta'), 'Sin orden');
    await usuario.click(screen.getByTestId('guardar-campo'));

    await waitFor(() => expect(agregarMutate).toHaveBeenCalledTimes(1));
    const cuerpo = (agregarMutate.mock.calls[0]?.[0] as { cuerpo: Record<string, unknown> }).cuerpo;
    expect('orden' in cuerpo).toBe(false);
  });

  it('exige la etiqueta del campo antes de guardar', async () => {
    const usuario = userEvent.setup();
    useCamposCliente.mockReturnValue(conCampos([]));
    renderConProveedores(<EditorCamposCliente idCliente={7} />);

    await usuario.click(screen.getByTestId('nuevo-campo'));
    await usuario.click(screen.getByTestId('guardar-campo'));

    expect(agregarMutate).not.toHaveBeenCalled();
    expect(await screen.findByText('La etiqueta es obligatoria')).toBeInTheDocument();
  });

  it('edita un campo: el diálogo pre-carga sus valores', async () => {
    const usuario = userEvent.setup();
    actualizarMutate.mockImplementation(
      (_args, opciones?: { onSuccess?: (r: ClienteCampo) => void }) => {
        opciones?.onSuccess?.(campo({ etiqueta: 'No. pedido (cliente)' }));
      },
    );
    useCamposCliente.mockReturnValue(
      conCampos([campo({ id: 5, etiqueta: 'No. pedido', tipo: 'TEXTO' })]),
    );
    renderConProveedores(<EditorCamposCliente idCliente={7} />);

    await usuario.click(screen.getByTestId('editar-campo'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByRole('heading', { name: 'Editar campo' })).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Etiqueta')).toHaveValue('No. pedido');

    await usuario.clear(within(dialogo).getByLabelText('Etiqueta'));
    await usuario.type(within(dialogo).getByLabelText('Etiqueta'), 'No. pedido (cliente)');
    await usuario.click(screen.getByTestId('guardar-campo'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as {
      idCliente: number;
      idCampo: number;
      cuerpo: { etiqueta?: string };
    };
    expect(args).toMatchObject({ idCliente: 7, idCampo: 5 });
    expect(args.cuerpo.etiqueta).toBe('No. pedido (cliente)');
  });

  it('pide confirmación antes de desactivar un campo y llama a la mutación al confirmar', async () => {
    const usuario = userEvent.setup();
    useCamposCliente.mockReturnValue(conCampos([campo({ id: 3, etiqueta: 'Borrar' })]));
    renderConProveedores(<EditorCamposCliente idCliente={7} />);

    await usuario.click(screen.getByTestId('desactivar-campo'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar campo')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith({ idCliente: 7, idCampo: 3 }, expect.anything());
  });

  it('reactiva un campo inactivo directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useCamposCliente.mockReturnValue(
      conCampos([campo({ id: 4, etiqueta: 'Apagado', activo: false })]),
    );
    renderConProveedores(<EditorCamposCliente idCliente={7} />);

    await usuario.click(screen.getByTestId('activar-campo'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith({ idCliente: 7, idCampo: 4 }, expect.anything());
  });

  it('en modo deshabilitado no muestra acciones de escritura', () => {
    useCamposCliente.mockReturnValue(conCampos([campo()]));
    renderConProveedores(<EditorCamposCliente idCliente={7} deshabilitado />);

    expect(screen.queryByTestId('nuevo-campo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-campo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-campo')).not.toBeInTheDocument();
  });
});
