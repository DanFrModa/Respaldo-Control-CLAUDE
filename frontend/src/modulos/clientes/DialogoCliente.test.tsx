import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Cliente, ClienteCrear } from '@/api/tipos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoCliente } from './DialogoCliente';

// Se controla la capa de datos: las pruebas no tocan la red. Se capturan los argumentos
// de crear/actualizar para verificar el cuerpo (omitir en alta, null en edición).
const crearMutate = vi.fn();
const actualizarMutate = vi.fn();

vi.mock('@/api/clientes', () => ({
  useCrearCliente: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarCliente: () => ({ mutate: actualizarMutate, isPending: false }),
}));

/** Cliente de ejemplo para las pruebas de edición. */
function clienteEjemplo(sobre: Partial<Cliente> = {}): Cliente {
  return {
    id: 10,
    nombre: 'Liverpool',
    contacto: null,
    telefono: null,
    email: null,
    direccion: null,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    campos: [],
    ...sobre,
  };
}

describe('<DialogoCliente>', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
  });

  it('en alta muestra el formulario vacío con el título de alta', () => {
    renderConProveedores(<DialogoCliente abierto alCambiarAbierto={vi.fn()} cliente={undefined} />);

    expect(screen.getByRole('heading', { name: 'Nuevo cliente' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });

  it('exige el nombre antes de guardar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoCliente abierto alCambiarAbierto={vi.fn()} cliente={undefined} />);

    await usuario.click(screen.getByTestId('guardar-cliente'));

    expect(crearMutate).not.toHaveBeenCalled();
    expect(await screen.findByText('El nombre es obligatorio')).toBeInTheDocument();
  });

  it('rechaza un email inválido y no envía', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoCliente abierto alCambiarAbierto={vi.fn()} cliente={undefined} />);

    await usuario.type(screen.getByLabelText('Nombre'), 'Liverpool');
    await usuario.type(screen.getByLabelText('Email'), 'no-es-email');
    await usuario.click(screen.getByTestId('guardar-cliente'));

    expect(crearMutate).not.toHaveBeenCalled();
    expect(await screen.findByText('El email no es válido')).toBeInTheDocument();
  });

  it('crea un cliente OMITIENDO los opcionales vacíos', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: ClienteCrear, opciones?: { onSuccess?: (r: Cliente) => void }) => {
        opciones?.onSuccess?.(clienteEjemplo({ nombre: 'Nuevo Cliente' }));
      },
    );
    const alCambiarAbierto = vi.fn();
    renderConProveedores(
      <DialogoCliente abierto alCambiarAbierto={alCambiarAbierto} cliente={undefined} />,
    );

    await usuario.type(screen.getByLabelText('Nombre'), 'Nuevo Cliente');
    await usuario.type(screen.getByLabelText('Contacto'), 'Ana');
    await usuario.click(screen.getByTestId('guardar-cliente'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(cuerpo.nombre).toBe('Nuevo Cliente');
    expect(cuerpo.contacto).toBe('Ana');
    // Los opcionales vacíos NO viajan (se omiten), no van como null.
    expect('telefono' in cuerpo).toBe(false);
    expect('email' in cuerpo).toBe(false);
    expect('direccion' in cuerpo).toBe(false);
    expect(alCambiarAbierto).toHaveBeenCalledWith(false);
  });

  it('en edición pre-carga los datos y vaciar un opcional manda null para borrarlo', async () => {
    const usuario = userEvent.setup();
    actualizarMutate.mockImplementation(
      (_args, opciones?: { onSuccess?: (r: Cliente) => void }) => {
        opciones?.onSuccess?.(clienteEjemplo());
      },
    );
    renderConProveedores(
      <DialogoCliente
        abierto
        alCambiarAbierto={vi.fn()}
        cliente={clienteEjemplo({ telefono: '555-1234', contacto: 'Ana' })}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Editar cliente' })).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveValue('555-1234');

    // Borra el teléfono pre-cargado y guarda.
    await usuario.clear(screen.getByLabelText('Teléfono'));
    await usuario.click(screen.getByTestId('guardar-cliente'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as {
      id: number;
      cuerpo: { telefono?: string | null; contacto?: string | null };
    };
    expect(args.id).toBe(10);
    // Vacío -> null (borrar); el que no se tocó conserva su valor.
    expect(args.cuerpo.telefono).toBeNull();
    expect(args.cuerpo.contacto).toBe('Ana');
  });
});
