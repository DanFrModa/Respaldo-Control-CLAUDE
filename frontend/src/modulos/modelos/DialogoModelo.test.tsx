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
  // ⭐ V1-E8j — el alta EXIGE género y tipo de prenda, así que los catálogos ya no pueden ir
  // vacíos: sin opciones no habría cómo cumplir la regla (y la prueba mediría el mock, no el alta).
  useGeneros: () => ({ data: [{ id: 1, nombre: 'Caballero', activo: true }], isPending: false }),
}));
vi.mock('@/api/temporadas', () => ({ useTemporadas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/tallas', () => ({ useCurvas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/calidad', () => ({
  useTiposProductoActivos: () => ({
    data: { datos: [{ id: 7, nombre: 'Pantalón', activo: true }] },
    isPending: false,
  }),
}));
vi.mock('@/api/dificultad', () => ({
  useDificultad: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isFetching: false }),
  // V1-E3f (§Post-F9.52 punto 7): los selectores de proveedor pasaron al `ComboboxBuscable` con
  // búsqueda en el SERVIDOR, que consume estos dos hooks.
  useProveedoresPorRol: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useRolesProveedor: () => ({ data: [], isPending: false }),
}));

/**
 * ⭐ V1-E8j (§Post-F9.134) — elige los DOS DÍGITOS, que el alta exige. Se hace *como lo haría
 * Daniel* (eligiéndolos en la pantalla), no aflojando el esquema: son el primer y el segundo dígito
 * del nº de producción y sin ellos el modelo no se podría promover.
 */
function elegirNomenclatura(): void {
  fireEvent.change(screen.getByLabelText(/Tipo de producto/), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText(/Género/), { target: { value: '1' } });
}

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
    elegirNomenclatura();
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
    elegirNomenclatura();
    fireEvent.click(screen.getByTestId('guardar-modelo'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect(crearMutate.mock.calls[0]?.[0]).toMatchObject({
      codigo: 'M-COMP',
      composicion: '60% algodón 40% poliéster',
    });
  });

  // ── ¿Lleva arte? (Daniel 26-jul-2026: "por default sí lleva") ──
  it('la casilla "Lleva arte" nace MARCADA y el alta manda llevaArte: true', async () => {
    renderConProveedores(<DialogoModelo abierto alCambiarAbierto={vi.fn()} modelo={undefined} />);

    const casilla = screen.getByTestId('modelo-lleva-arte');
    expect(casilla).toBeChecked();
    expect(
      screen.getByText(/desmárcala; si no, la orden quedará incompleta hasta capturar el arte/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: 'M-ARTE' } });
    elegirNomenclatura();
    fireEvent.click(screen.getByTestId('guardar-modelo'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect(crearMutate.mock.calls[0]?.[0]).toMatchObject({ codigo: 'M-ARTE', llevaArte: true });
  });

  it('desmarcarla manda llevaArte: false (prenda lisa)', async () => {
    renderConProveedores(<DialogoModelo abierto alCambiarAbierto={vi.fn()} modelo={undefined} />);

    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: 'M-LISA' } });
    fireEvent.click(screen.getByTestId('modelo-lleva-arte'));
    expect(screen.getByTestId('modelo-lleva-arte')).not.toBeChecked();
    elegirNomenclatura();
    fireEvent.click(screen.getByTestId('guardar-modelo'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect(crearMutate.mock.calls[0]?.[0]).toMatchObject({ codigo: 'M-LISA', llevaArte: false });
  });
});
