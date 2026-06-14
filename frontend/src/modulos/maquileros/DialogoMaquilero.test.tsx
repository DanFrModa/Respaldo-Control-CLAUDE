import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Maquilero, MaquileroCrear, TipoProceso } from '@/api/tipos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoMaquilero } from './DialogoMaquilero';

// Se controla la capa de datos: las pruebas no tocan la red. Se capturan los argumentos
// de crear/actualizar para verificar el cuerpo (tipos incluidos).
const crearMutate = vi.fn();
const actualizarMutate = vi.fn();

/** Tipos de proceso de ejemplo del catalogo (selector multiple). */
const TIPOS_EJEMPLO: TipoProceso[] = [
  { id: 1, codigo: 'costura', nombre: 'Costura', activo: true },
  { id: 2, codigo: 'estampado', nombre: 'Estampado', activo: true },
];

vi.mock('@/api/maquileros', () => ({
  useCrearMaquilero: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarMaquilero: () => ({ mutate: actualizarMutate, isPending: false }),
  useTiposProceso: () => ({
    data: TIPOS_EJEMPLO,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

/** Maquilero de ejemplo para las pruebas de edicion. */
function maquileroEjemplo(sobre: Partial<Maquilero> = {}): Maquilero {
  return {
    id: 10,
    corto: 'Intersew',
    nombre: 'Intersew',
    apellidos: null,
    telefonos: null,
    direccion: null,
    observaciones: null,
    obsPago: null,
    asegurado: false,
    tipos: [{ id: 1, codigo: 'costura', nombre: 'Costura' }],
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...sobre,
  };
}

describe('<DialogoMaquilero>', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
  });

  it('en alta renderiza los campos y el selector de tipos de proceso', () => {
    renderConProveedores(
      <DialogoMaquilero abierto alCambiarAbierto={vi.fn()} maquilero={undefined} />,
    );

    const dialogo = screen.getByRole('dialog');
    expect(within(dialogo).getByRole('heading', { name: 'Nuevo maquilero' })).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Código corto')).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Nombre')).toBeInTheDocument();
    // El selector de tipos esta montado con las opciones del catalogo.
    expect(screen.getByTestId('selector-tipos-proceso')).toBeInTheDocument();
    expect(screen.getByTestId('tipo-proceso-opcion-1')).toBeInTheDocument();
  });

  it('exige al menos un tipo de proceso antes de guardar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoMaquilero abierto alCambiarAbierto={vi.fn()} maquilero={undefined} />,
    );

    await usuario.type(screen.getByLabelText('Código corto'), 'Sin tipos');
    await usuario.type(screen.getByLabelText('Nombre'), 'Sin tipos');
    await usuario.click(screen.getByTestId('guardar-maquilero'));

    // No se llama a crear y se muestra el error de captura de tipos.
    expect(crearMutate).not.toHaveBeenCalled();
    expect(await screen.findByText('Elige al menos un tipo de proceso.')).toBeInTheDocument();
  });

  it('crea un maquilero enviando los tipos seleccionados inline', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: MaquileroCrear, opciones?: { onSuccess?: (r: Maquilero) => void }) => {
        opciones?.onSuccess?.(maquileroEjemplo({ corto: 'Nuevo' }));
      },
    );
    const alCambiarAbierto = vi.fn();
    renderConProveedores(
      <DialogoMaquilero abierto alCambiarAbierto={alCambiarAbierto} maquilero={undefined} />,
    );

    await usuario.type(screen.getByLabelText('Código corto'), 'Nuevo');
    await usuario.type(screen.getByLabelText('Nombre'), 'Nuevo Taller');
    await usuario.click(screen.getByTestId('tipo-proceso-opcion-1'));
    await usuario.click(screen.getByTestId('tipo-proceso-opcion-2'));
    await usuario.click(screen.getByTestId('guardar-maquilero'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as MaquileroCrear;
    expect(cuerpo.corto).toBe('Nuevo');
    expect(cuerpo.nombre).toBe('Nuevo Taller');
    expect(cuerpo.tipos).toEqual([1, 2]);
    // Tras el exito cierra el dialogo.
    expect(alCambiarAbierto).toHaveBeenCalledWith(false);
  });

  it('en ALTA, los campos opcionales vacíos se OMITEN (no viajan como null)', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: MaquileroCrear, opciones?: { onSuccess?: (r: Maquilero) => void }) => {
        opciones?.onSuccess?.(maquileroEjemplo({ corto: 'Nuevo' }));
      },
    );
    renderConProveedores(
      <DialogoMaquilero abierto alCambiarAbierto={vi.fn()} maquilero={undefined} />,
    );

    await usuario.type(screen.getByLabelText('Código corto'), 'Nuevo');
    await usuario.type(screen.getByLabelText('Nombre'), 'Nuevo');
    await usuario.click(screen.getByTestId('tipo-proceso-opcion-1'));
    await usuario.click(screen.getByTestId('guardar-maquilero'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    // Omitidos (no presentes), NO null.
    expect('telefonos' in cuerpo).toBe(false);
    expect('apellidos' in cuerpo).toBe(false);
    expect('observaciones' in cuerpo).toBe(false);
    // `asegurado` (bandera) siempre viaja como boolean.
    expect(cuerpo.asegurado).toBe(false);
  });

  it('en edición pre-carga los datos y los tipos del maquilero', () => {
    renderConProveedores(
      <DialogoMaquilero
        abierto
        alCambiarAbierto={vi.fn()}
        maquilero={maquileroEjemplo({
          apellidos: 'Bosh',
          tipos: [{ id: 2, codigo: 'estampado', nombre: 'Estampado' }],
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Editar maquilero' })).toBeInTheDocument();
    expect(screen.getByLabelText('Código corto')).toHaveValue('Intersew');
    expect(screen.getByLabelText('Apellidos')).toHaveValue('Bosh');
    // El tipo del maquilero llega marcado.
    expect(screen.getByTestId('tipo-proceso-opcion-2')).toBeChecked();
    expect(screen.getByTestId('tipo-proceso-opcion-1')).not.toBeChecked();
  });

  it('en edición, si no se tocan los tipos, envía los actuales (nunca vacío)', async () => {
    const usuario = userEvent.setup();
    actualizarMutate.mockImplementation(
      (_args, opciones?: { onSuccess?: (r: Maquilero) => void }) => {
        opciones?.onSuccess?.(maquileroEjemplo());
      },
    );
    renderConProveedores(
      <DialogoMaquilero
        abierto
        alCambiarAbierto={vi.fn()}
        maquilero={maquileroEjemplo({
          tipos: [{ id: 1, codigo: 'costura', nombre: 'Costura' }],
        })}
      />,
    );

    await usuario.click(screen.getByTestId('guardar-maquilero'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as {
      id: number;
      cuerpo: { tipos?: number[] };
    };
    expect(args.id).toBe(10);
    expect(args.cuerpo.tipos).toEqual([1]);
  });

  // M1: en edición, vaciar un campo opcional ya capturado debe mandar `null` (borrar).
  it('en edición, vaciar un campo opcional manda null para borrarlo', async () => {
    const usuario = userEvent.setup();
    actualizarMutate.mockImplementation(
      (_args, opciones?: { onSuccess?: (r: Maquilero) => void }) => {
        opciones?.onSuccess?.(maquileroEjemplo());
      },
    );
    renderConProveedores(
      <DialogoMaquilero
        abierto
        alCambiarAbierto={vi.fn()}
        maquilero={maquileroEjemplo({
          telefonos: '555-1234',
          tipos: [{ id: 1, codigo: 'costura', nombre: 'Costura' }],
        })}
      />,
    );

    // Borra el teléfono pre-cargado.
    const telefonos = screen.getByLabelText('Teléfonos');
    await usuario.clear(telefonos);
    await usuario.click(screen.getByTestId('guardar-maquilero'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as {
      cuerpo: { telefonos?: string | null };
    };
    // Vacío -> null (borrar), no se omite ni se manda ''.
    expect(args.cuerpo.telefonos).toBeNull();
  });
});
