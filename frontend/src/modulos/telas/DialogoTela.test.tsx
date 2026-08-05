import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tela, TelaCategoria, TelaCrear, TelaEditar } from '@/api/telas';
import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoTela } from './DialogoTela';

// Se controla la capa de datos: las pruebas no tocan la red. Se capturan los argumentos
// de crear/actualizar para verificar el cuerpo (colores incluidos).
const crearMutate = vi.fn();
const actualizarMutate = vi.fn();
const crearCategoriaMutate = vi.fn();

/** Categorias de ejemplo del selector. */
const CATEGORIAS: TelaCategoria[] = [
  {
    id: 7,
    nombre: 'Felpa',
    activo: true,
    creadoEn: '',
    creadoPorId: null,
    modificadoEn: '',
    modificadoPorId: null,
  },
];

vi.mock('@/api/telas', () => ({
  useCrearTela: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarTela: () => ({ mutate: actualizarMutate, isPending: false }),
  useCrearTelaCategoria: () => ({ mutate: crearCategoriaMutate, isPending: false }),
  useTelasCategorias: () => ({
    data: { datos: CATEGORIAS, total: 1, pagina: 1, porPagina: 100, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

// El editor de colores se aisla (tiene su propio test): se stubea el COMPONENTE para no
// arrastrar `useColores`. Los helpers puros (`aRenglones`/`aColoresCuerpo`) viven en
// `./colores-tela` y se dejan correr REALES: como el grid stub no agrega colores, el estado
// queda en `[]` y `aColoresCuerpo([])` devuelve `[]` (el cuerpo viaja con `colores: []`).
vi.mock('./EditorColoresTela', () => ({
  EditorColoresTela: () => <div data-testid="editor-colores-mock" />,
}));

/** Tela de ejemplo para las pruebas de edicion. */
function telaEjemplo(sobre: Partial<Tela> = {}): Tela {
  return {
    id: 10,
    nombre: 'Felpa algodón',
    descripcion: null,
    idCategoria: null,
    categoria: null,
    unidadMedida: 'KG',
    tipoComponente: 'OTRO',
    favorito: false,
    precioSugerido: null,
    paraProduccion: true,
    colores: [],
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...sobre,
  };
}

describe('<DialogoTela>', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
    crearCategoriaMutate.mockReset();
  });

  it('en alta renderiza los campos, el selector de categoría y el editor de colores', () => {
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    const dialogo = screen.getByRole('dialog');
    expect(within(dialogo).getByRole('heading', { name: 'Nueva tela' })).toBeInTheDocument();
    expect(within(dialogo).getByLabelText(/^Nombre/)).toBeInTheDocument();
    expect(within(dialogo).getByTestId('tela-categoria')).toBeInTheDocument();
    expect(screen.getByTestId('editor-colores-mock')).toBeInTheDocument();
  });

  it('en ALTA, los campos opcionales vacíos se OMITEN (no viajan como null) y manda colores', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: TelaCrear, opciones?: { onSuccess?: (r: Tela) => void }) => {
        opciones?.onSuccess?.(telaEjemplo());
      },
    );
    const alCambiarAbierto = vi.fn();
    renderConProveedores(
      <DialogoTela abierto alCambiarAbierto={alCambiarAbierto} tela={undefined} />,
    );

    await usuario.type(screen.getByLabelText(/^Nombre/), 'Jersey nuevo');
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'KG');
    await usuario.click(screen.getByTestId('guardar-tela'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(cuerpo.nombre).toBe('Jersey nuevo');
    // Omitidos (no presentes), NO null.
    expect('descripcion' in cuerpo).toBe(false);
    // La unidad NO es opcional: se eligió y viaja.
    expect(cuerpo.unidadMedida).toBe('KG');
    expect('idCategoria' in cuerpo).toBe(false);
    expect('precioSugerido' in cuerpo).toBe(false);
    // Banderas y colores siempre viajan.
    expect(cuerpo.favorito).toBe(false);
    expect(cuerpo.paraProduccion).toBe(true);
    expect(cuerpo.colores).toEqual([]);
    expect(alCambiarAbierto).toHaveBeenCalledWith(false);
  });

  // Sin default a propósito: si el combo arrancara en kilos, una popelina (metros) nacería mal
  // marcada nada más por no tocarlo — el fallo silencioso que la regla existe para evitar.
  it('el ALTA no se guarda sin elegir la unidad (no hay valor preseleccionado)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    expect(screen.getByTestId('tela-unidad')).toHaveValue('');

    await usuario.type(screen.getByLabelText(/^Nombre/), 'Popelina');
    await usuario.click(screen.getByTestId('guardar-tela'));

    // No se manda nada y se explica por qué.
    await screen.findByText('Elige la unidad: kilos o metros');
    expect(crearMutate).not.toHaveBeenCalled();

    // Elegida, ya guarda.
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'M');
    await usuario.click(screen.getByTestId('guardar-tela'));
    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect((crearMutate.mock.calls[0]?.[0] as { unidadMedida?: string }).unidadMedida).toBe('M');
  });

  it('en alta, elegir una categoría la incluye en el cuerpo como id numérico', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: TelaCrear, opciones?: { onSuccess?: (r: Tela) => void }) => {
        opciones?.onSuccess?.(telaEjemplo());
      },
    );
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.type(screen.getByLabelText(/^Nombre/), 'Con categoría');
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'M');
    await usuario.selectOptions(screen.getByTestId('tela-categoria'), '7');
    await usuario.click(screen.getByTestId('guardar-tela'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as { idCategoria?: number };
    expect(cuerpo.idCategoria).toBe(7);
  });

  it('en edición pre-carga los datos de la tela', () => {
    renderConProveedores(
      <DialogoTela
        abierto
        alCambiarAbierto={vi.fn()}
        tela={telaEjemplo({ nombre: 'Felpa', unidadMedida: 'KG', favorito: true })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Editar tela' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Felpa');
    expect(screen.getByTestId('tela-unidad')).toHaveValue('KG');
    expect(screen.getByTestId('tela-favorito')).toBeChecked();
  });

  // La unidad ya NO se puede vaciar (Daniel, 30-jul-2026: solo kilos o metros, y de ella dependen
  // el stock, el consumo y el costo por prenda): en edición se CAMBIA de una a la otra.
  it('en edición, la unidad se cambia de kilos a metros (no se puede vaciar)', async () => {
    const usuario = userEvent.setup();
    actualizarMutate.mockImplementation((_args, opciones?: { onSuccess?: (r: Tela) => void }) => {
      opciones?.onSuccess?.(telaEjemplo());
    });
    renderConProveedores(
      <DialogoTela abierto alCambiarAbierto={vi.fn()} tela={telaEjemplo({ unidadMedida: 'KG' })} />,
    );

    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'M');
    await usuario.click(screen.getByTestId('guardar-tela'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as { cuerpo: TelaEditar };
    expect(args.cuerpo.unidadMedida).toBe('M');
    // Y los colores siempre viajan en edición (reemplaza el grid).
    expect(args.cuerpo.colores).toEqual([]);
  });

  it('el botón "Nueva" abre el diálogo de alta rápida de categoría', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.click(screen.getByTestId('nueva-categoria-tela'));
    expect(screen.getByRole('heading', { name: 'Nueva categoría de tela' })).toBeInTheDocument();
  });
});
