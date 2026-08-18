import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TelaProveedor } from '@/api/tela-proveedores';
import { renderConProveedores } from '@/pruebas/utilidades';

import { EditorProveedoresTela } from './EditorProveedoresTela';

type EstadoConsulta = {
  data: TelaProveedor[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
};

const useTelaProveedores = vi.fn<() => EstadoConsulta>();
const crearMutate = vi.fn();

vi.mock('@/api/tela-proveedores', () => ({
  useTelaProveedores: () => useTelaProveedores(),
  useCrearTelaProveedor: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarTelaProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarTelaProveedor: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivarTelaProveedor: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Catálogo de proveedores para el selector del diálogo.
// V1-E3f (§Post-F9.52 punto 7): el selector de proveedor de la tela pasó del `<select>` con tope
// de 100 al `ComboboxBuscable` con búsqueda en el SERVIDOR, que consume `useProveedoresPorRol`.
const CATALOGO_PROVEEDORES = {
  data: {
    datos: [
      { id: 11, nombre: 'Textiles del Norte' },
      { id: 12, nombre: 'Hilos SA' },
    ],
  },
  isPending: false,
  isError: false,
  error: null,
};

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => CATALOGO_PROVEEDORES,
  useProveedoresPorRol: () => CATALOGO_PROVEEDORES,
  useRolesProveedor: () => ({ data: [], isPending: false }),
}));

function proveedorTela(sobre: Partial<TelaProveedor> = {}): TelaProveedor {
  return {
    id: 1,
    idTela: 5,
    idProveedor: 11,
    nombreProveedor: 'Textiles del Norte',
    precio: 50,
    manejaPrecioPorColor: false,
    condiciones: null,
    activo: true,
    colores: [],
    creadoEn: '2026-07-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-01T00:00:00.000Z',
    modificadoPorId: null,
    ...sobre,
  };
}

const COLORES = [
  { idColor: 1, nombre: 'Rojo' },
  { idColor: 2, nombre: 'Azul' },
];

describe('<EditorProveedoresTela>', () => {
  beforeEach(() => {
    useTelaProveedores.mockReset();
    crearMutate.mockReset();
  });

  it('lista los proveedores con su precio cuando se pueden ver importes', () => {
    useTelaProveedores.mockReturnValue({
      data: [proveedorTela({ precio: 50 })],
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorProveedoresTela idTela={5} colores={COLORES} puedeVerImportes />);

    expect(screen.getByTestId('fila-proveedor-tela')).toBeInTheDocument();
    expect(screen.getByText('Textiles del Norte')).toBeInTheDocument();
    expect(screen.getByText(/\$50\.00/)).toBeInTheDocument();
  });

  it('oculta el precio cuando la sesión no puede ver importes', () => {
    useTelaProveedores.mockReturnValue({
      data: [proveedorTela({ precio: 50 })],
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(
      <EditorProveedoresTela idTela={5} colores={COLORES} puedeVerImportes={false} />,
    );

    expect(screen.queryByText(/\$50\.00/)).not.toBeInTheDocument();
    // Se muestra el marcador "—" en lugar del importe.
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('en modo deshabilitado lista pero no muestra acciones', () => {
    useTelaProveedores.mockReturnValue({
      data: [proveedorTela()],
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(
      <EditorProveedoresTela idTela={5} colores={COLORES} deshabilitado puedeVerImportes />,
    );

    expect(screen.getByText('Textiles del Norte')).toBeInTheDocument();
    expect(screen.queryByTestId('nuevo-proveedor-tela')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-proveedor-tela')).not.toBeInTheDocument();
  });

  it('al activar "precio por color" despliega el grid color × precio', async () => {
    const usuario = userEvent.setup();
    useTelaProveedores.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorProveedoresTela idTela={5} colores={COLORES} puedeVerImportes />);

    await usuario.click(screen.getByTestId('nuevo-proveedor-tela'));
    const dialogo = await screen.findByRole('dialog');
    // El grid no está hasta activar el toggle.
    expect(within(dialogo).queryByTestId('grid-precio-por-color')).not.toBeInTheDocument();

    await usuario.click(within(dialogo).getByTestId('maneja-precio-por-color'));
    expect(within(dialogo).getByTestId('grid-precio-por-color')).toBeInTheDocument();
    // Un input por cada color de la tela.
    expect(within(dialogo).getByTestId('precio-color-proveedor-1')).toBeInTheDocument();
    expect(within(dialogo).getByTestId('precio-color-proveedor-2')).toBeInTheDocument();
  });

  it('al agregar envía idProveedor y el grid de precio por color', async () => {
    const usuario = userEvent.setup();
    useTelaProveedores.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      error: null,
    });
    crearMutate.mockImplementation(
      (_args, opciones?: { onSuccess?: (r: TelaProveedor) => void }) => {
        opciones?.onSuccess?.(proveedorTela());
      },
    );
    renderConProveedores(<EditorProveedoresTela idTela={5} colores={COLORES} puedeVerImportes />);

    await usuario.click(screen.getByTestId('nuevo-proveedor-tela'));
    const dialogo = await screen.findByRole('dialog');
    // V1-E3f: el proveedor ya no se elige de un `<select>` sino del combobox con búsqueda en
    // servidor — se abre el popover y se toca la opción.
    await usuario.click(within(dialogo).getByTestId('selector-proveedor-tela-busqueda'));
    // La lista vive en un PORTAL fuera del diálogo y en jsdom (sin CSS) hereda el
    // `pointer-events:none` que radix pone en el body; el combobox elige en `mousedown`.
    const opciones = await screen.findAllByTestId('selector-proveedor-tela-opcion');
    fireEvent.mouseDown(opciones[0] as HTMLElement);
    await usuario.click(within(dialogo).getByTestId('maneja-precio-por-color'));
    await usuario.type(within(dialogo).getByTestId('precio-color-proveedor-1'), '42');
    await usuario.click(within(dialogo).getByTestId('guardar-proveedor-tela'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const args = crearMutate.mock.calls[0]?.[0] as {
      idTela: number;
      cuerpo: {
        idProveedor: number;
        manejaPrecioPorColor: boolean;
        colores: { idColor: number; precio?: number }[];
      };
    };
    expect(args.idTela).toBe(5);
    expect(args.cuerpo.idProveedor).toBe(11);
    expect(args.cuerpo.manejaPrecioPorColor).toBe(true);
    // Viaja el grid completo: el color con precio lo lleva; el sin precio va sin `precio`.
    expect(args.cuerpo.colores).toEqual([{ idColor: 1, precio: 42 }, { idColor: 2 }]);
  });

  // R2-2 (§Post-F9.11): las telas NUEVAS no tienen colores LIGADOS al catálogo de prenda →
  // el modo por-color de R17 no aplica y la pantalla lo dice tal cual (no miente con un
  // grid vacío ni con "captura sus colores primero").
  it('SIN colores ligados, deshabilita el modo por-color y dice la verdad', async () => {
    const usuario = userEvent.setup();
    useTelaProveedores.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<EditorProveedoresTela idTela={5} colores={[]} puedeVerImportes />);

    await usuario.click(screen.getByTestId('nuevo-proveedor-tela'));
    const dialogo = await screen.findByRole('dialog');

    // El checkbox está deshabilitado (no se puede activar el modo por-color)…
    expect(within(dialogo).getByTestId('maneja-precio-por-color')).toBeDisabled();
    // …y el aviso honesto explica el porqué.
    expect(within(dialogo).getByTestId('aviso-por-color-solo-migradas')).toHaveTextContent(
      'El precio por color solo aplica a telas migradas del sistema viejo. En telas nuevas, ' +
        'usa el precio base del proveedor.',
    );
    expect(within(dialogo).queryByTestId('grid-precio-por-color')).not.toBeInTheDocument();
  });
});
