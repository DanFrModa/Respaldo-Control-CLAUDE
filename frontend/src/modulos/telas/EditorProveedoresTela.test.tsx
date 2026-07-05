import { screen, waitFor, within } from '@testing-library/react';
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
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({
    data: {
      datos: [
        { id: 11, nombre: 'Textiles del Norte' },
        { id: 12, nombre: 'Hilos SA' },
      ],
    },
    isPending: false,
    isError: false,
    error: null,
  }),
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
    await usuario.selectOptions(within(dialogo).getByTestId('selector-proveedor-tela'), '11');
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
});
