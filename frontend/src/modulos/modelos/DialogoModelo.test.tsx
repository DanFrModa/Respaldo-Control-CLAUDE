import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoModelo } from './DialogoModelo';

/**
 * Unit de los props que el IMPORTADOR de OC necesita del alta estándar (reuso, no duplica forms):
 * `prellenadoAlta` (proponer la descripción de la OC en el alta, dejando el código al usuario) y
 * `alCrear` (avisar al llamador el modelo creado, para dejarlo ligado). El resto del alta ya se
 * cubre por `ModelosPagina.test`.
 */

// `useCrearModelo`: espía del POST. La prueba que envía el alta le pone una implementación que
// simula el éxito (invoca `onSuccess` con el modelo creado); las demás lo dejan como espía inerte.
const crearMutate = vi.fn();

vi.mock('@/api/modelos', () => ({
  useCrearModelo: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarModelo: () => ({ mutate: vi.fn(), isPending: false }),
  useGeneros: () => ({ data: [], isPending: false }),
}));
vi.mock('@/api/temporadas', () => ({ useTemporadas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/tallas', () => ({ useCurvas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/calidad', () => ({
  useTiposProductoActivos: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/dificultad', () => ({
  useDificultad: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isFetching: false }),
  useRolesProveedor: () => ({ data: [] }),
}));

describe('DialogoModelo · props del importador', () => {
  beforeEach(() => crearMutate.mockReset());

  it('en alta, precarga la descripción propuesta y deja el código vacío (lo captura el usuario)', () => {
    renderConProveedores(
      <DialogoModelo
        abierto
        alCambiarAbierto={vi.fn()}
        modelo={undefined}
        prellenadoAlta={{ descripcion: 'PLAYERA ML SINGLE JERSEY' }}
      />,
    );

    expect(screen.getByLabelText('Descripción')).toHaveValue('PLAYERA ML SINGLE JERSEY');
    expect(screen.getByLabelText(/Código/)).toHaveValue('');
  });

  it('al crear, invoca alCrear con el modelo recién creado', async () => {
    // El alta llama `crear.mutate(cuerpo, { onSuccess, onError })`; simulamos el éxito devolviendo
    // el modelo creado (con el código capturado) para que dispare el `onSuccess` interno → `alCrear`.
    crearMutate.mockImplementation(
      (
        cuerpo?: { codigo: string; descripcion?: string },
        opciones?: { onSuccess: (m: unknown) => void },
      ) => {
        opciones?.onSuccess?.({
          id: 999,
          codigo: cuerpo?.codigo ?? '',
          descripcion: cuerpo?.descripcion ?? null,
        });
      },
    );
    const alCrear = vi.fn();
    renderConProveedores(
      <DialogoModelo
        abierto
        alCambiarAbierto={vi.fn()}
        modelo={undefined}
        prellenadoAlta={{ descripcion: 'PLAYERA ML' }}
        alCrear={alCrear}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: 'CYA-NUEVO' } });
    fireEvent.click(screen.getByTestId('guardar-modelo'));

    await waitFor(() =>
      expect(alCrear).toHaveBeenCalledWith(
        expect.objectContaining({ id: 999, codigo: 'CYA-NUEVO' }),
      ),
    );
  });
});

describe('DialogoModelo · composición del desarrollo (Daniel 24-jul-2026)', () => {
  beforeEach(() => crearMutate.mockReset());

  it('captura la composición en la ficha del modelo y la manda en el alta', async () => {
    renderConProveedores(<DialogoModelo abierto alCambiarAbierto={vi.fn()} modelo={undefined} />);

    const campo = screen.getByLabelText('Composición');
    expect(screen.getByText(/Las órdenes de este modelo la heredan solas/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: 'M-COMP' } });
    fireEvent.change(campo, { target: { value: '60% algodón 40% poliéster' } });
    fireEvent.click(screen.getByTestId('guardar-modelo'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect(crearMutate.mock.calls[0]?.[0]).toMatchObject({
      codigo: 'M-COMP',
      composicion: '60% algodón 40% poliéster',
    });
  });
});
