import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClienteDepartamento } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { renderConProveedores } from '@/pruebas/utilidades';

import { EditorDepartamentosCliente } from './EditorDepartamentosCliente';

type EstadoConsulta = {
  data: ClienteDepartamento[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: ErrorDeApi | null;
};

const useDepartamentosCliente = vi.fn<() => EstadoConsulta>();
const agregarMutate = vi.fn();
const desactivarMutate = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: (m: string): void => {
      toastError(m);
    },
  },
}));

vi.mock('@/api/clientes', () => ({
  useDepartamentosCliente: () => useDepartamentosCliente(),
  useAgregarDepartamentoCliente: () => ({ mutate: agregarMutate, isPending: false }),
  useActualizarDepartamentoCliente: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarDepartamentoCliente: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarDepartamentoCliente: () => ({ mutate: vi.fn(), isPending: false }),
}));

function departamento(id: number, nombre: string, activo = true): ClienteDepartamento {
  return {
    id,
    idCliente: 1,
    nombre,
    activo,
    creadoEn: '2026-07-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function consultaConDatos(datos: ClienteDepartamento[]): EstadoConsulta {
  return { data: datos, isPending: false, isError: false, error: null };
}

describe('<EditorDepartamentosCliente>', () => {
  beforeEach(() => {
    useDepartamentosCliente.mockReset();
    agregarMutate.mockReset();
    desactivarMutate.mockReset();
    toastError.mockReset();
  });

  it('lista los departamentos del cliente', () => {
    useDepartamentosCliente.mockReturnValue(
      consultaConDatos([departamento(1, 'Dama'), departamento(2, 'Caballero')]),
    );
    renderConProveedores(<EditorDepartamentosCliente idCliente={1} />);

    const filas = screen.getAllByTestId('fila-departamento');
    expect(filas).toHaveLength(2);
    expect(screen.getByText('Dama')).toBeInTheDocument();
    expect(screen.getByText('Caballero')).toBeInTheDocument();
  });

  it('muestra el estado vacío', () => {
    useDepartamentosCliente.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<EditorDepartamentosCliente idCliente={1} />);
    expect(screen.getByTestId('departamentos-vacio')).toBeInTheDocument();
  });

  it('oculta las acciones cuando está deshabilitado (sin permiso / cliente inactivo)', () => {
    useDepartamentosCliente.mockReturnValue(consultaConDatos([departamento(1, 'Dama')]));
    renderConProveedores(<EditorDepartamentosCliente idCliente={1} deshabilitado />);

    // El listado se ve (lectura), pero no hay botones de alta ni de fila.
    expect(screen.getByText('Dama')).toBeInTheDocument();
    expect(screen.queryByTestId('nuevo-departamento')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-departamento')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-departamento')).not.toBeInTheDocument();
  });

  it('agrega un departamento con el nombre capturado', async () => {
    const usuario = userEvent.setup();
    useDepartamentosCliente.mockReturnValue(consultaConDatos([]));
    agregarMutate.mockImplementation(
      (_args, opciones?: { onSuccess?: (r: ClienteDepartamento) => void }) => {
        opciones?.onSuccess?.(departamento(9, 'Niño'));
      },
    );
    renderConProveedores(<EditorDepartamentosCliente idCliente={1} />);

    await usuario.click(screen.getByTestId('nuevo-departamento'));
    const dialogo = await screen.findByRole('dialog');
    await usuario.type(within(dialogo).getByLabelText('Nombre'), 'Niño');
    await usuario.click(screen.getByTestId('guardar-departamento'));

    await waitFor(() => expect(agregarMutate).toHaveBeenCalledTimes(1));
    const args = agregarMutate.mock.calls[0]?.[0] as {
      idCliente: number;
      cuerpo: { nombre: string };
    };
    expect(args.idCliente).toBe(1);
    expect(args.cuerpo.nombre).toBe('Niño');
  });

  it('muestra el error de nombre duplicado que devuelve el backend', async () => {
    const usuario = userEvent.setup();
    useDepartamentosCliente.mockReturnValue(consultaConDatos([departamento(1, 'Dama')]));
    agregarMutate.mockImplementation((_args, opciones?: { onError?: (e: ErrorDeApi) => void }) => {
      opciones?.onError?.(
        new ErrorDeApi({
          codigo: 'CONFLICTO',
          mensaje: 'Ya existe un departamento con ese nombre para este cliente.',
        }),
      );
    });
    renderConProveedores(<EditorDepartamentosCliente idCliente={1} />);

    await usuario.click(screen.getByTestId('nuevo-departamento'));
    const dialogo = await screen.findByRole('dialog');
    await usuario.type(within(dialogo).getByLabelText('Nombre'), 'Dama');
    await usuario.click(screen.getByTestId('guardar-departamento'));

    await waitFor(() => expect(agregarMutate).toHaveBeenCalledTimes(1));
    // El mensaje del backend se muestra como toast de error (sonner mockeado).
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Ya existe un departamento con ese nombre para este cliente.',
      ),
    );
  });
});
