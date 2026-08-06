import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComposicionTela, Tela, TelaCategoria, TelaCrear, TelaEditar } from '@/api/telas';
import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoTela } from './DialogoTela';

// Se controla la capa de datos: las pruebas no tocan la red. Se capturan los argumentos
// de crear/actualizar para verificar el cuerpo (colores incluidos).
const crearMutate = vi.fn();
const actualizarMutate = vi.fn();
const crearCategoriaMutate = vi.fn();
const crearComposicionMutate = vi.fn();

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

/** Composiciones de ejemplo del selector (§Post-F9.11). */
const COMPOSICIONES: ComposicionTela[] = [
  {
    id: 3,
    nombre: '50% Algodón, 50% Poliéster',
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
  useCrearComposicionTela: () => ({ mutate: crearComposicionMutate, isPending: false }),
  useTelasCategorias: () => ({
    data: { datos: CATEGORIAS, total: 1, pagina: 1, porPagina: 100, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  }),
  useComposicionesTela: () => ({
    data: { datos: COMPOSICIONES, total: 1, pagina: 1, porPagina: 100, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

// El selector de proveedor se aisla (usa busqueda server-side de `useProveedores`): el stub
// expone un boton que "elige" al proveedor 5 — suficiente para probar el flujo del dialogo.
vi.mock('@/modulos/cxp/SelectorProveedor', () => ({
  SelectorProveedor: ({
    idSeleccionado,
    alSeleccionar,
  }: {
    idSeleccionado: number | undefined;
    alSeleccionar: (proveedor: { id: number; nombre: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="selector-proveedor-stub"
      data-seleccionado={idSeleccionado ?? ''}
      onClick={() => alSeleccionar({ id: 5, nombre: 'Alsatex' })}
    >
      {idSeleccionado === undefined ? 'Elegir proveedor' : `Proveedor ${idSeleccionado}`}
    </button>
  ),
}));

// El editor de colores se aisla (tiene su propio test): se stubea el COMPONENTE para no
// arrastrar `useColores`. Los helpers puros (`aRenglones`/`aColoresCuerpo`) viven en
// `./colores-tela` y se dejan correr REALES: como el grid stub no agrega colores, el estado
// queda en `[]` y `aColoresCuerpo([])` devuelve `[]` (el cuerpo viaja con `colores: []`).
vi.mock('./EditorColoresTela', () => ({
  EditorColoresTela: ({
    llevaComplemento,
    nombreComplemento,
  }: {
    llevaComplemento?: boolean;
    nombreComplemento?: string;
  }) => (
    <div
      data-testid="editor-colores-mock"
      data-lleva-complemento={llevaComplemento === true ? 'si' : 'no'}
      data-nombre-complemento={nombreComplemento ?? ''}
    />
  ),
}));

/** Tela de ejemplo para las pruebas de edicion. */
function telaEjemplo(sobre: Partial<Tela> = {}): Tela {
  return {
    id: 10,
    nombre: 'Felpa algodón',
    descripcion: null,
    idCategoria: null,
    categoria: null,
    idComposicion: null,
    composicion: null,
    idProveedor: 5,
    proveedor: 'Alsatex',
    nombreProveedor: null,
    nombreCuerpo: null,
    nombreComplemento: null,
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
    crearComposicionMutate.mockReset();
  });

  it('en alta renderiza los campos, el selector de categoría y el editor de colores', () => {
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    const dialogo = screen.getByRole('dialog');
    expect(within(dialogo).getByRole('heading', { name: 'Nueva tela' })).toBeInTheDocument();
    expect(within(dialogo).getByLabelText(/^Nombre\* \(obligatorio\)$/)).toBeInTheDocument();
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

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Jersey nuevo');
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'KG');
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
    await usuario.click(screen.getByTestId('guardar-tela'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(cuerpo.nombre).toBe('Jersey nuevo');
    // El proveedor dueño elegido viaja (obligatorio en alta, §Post-F9.11).
    expect(cuerpo.idProveedor).toBe(5);
    // Omitidos (no presentes), NO null.
    expect('descripcion' in cuerpo).toBe(false);
    expect('nombreProveedor' in cuerpo).toBe(false);
    expect('nombreCuerpo' in cuerpo).toBe(false);
    // Sin complemento declarado, el nombre del complemento NO viaja (null = no lleva).
    expect('nombreComplemento' in cuerpo).toBe(false);
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

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Popelina');
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
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

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Con categoría');
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'M');
    await usuario.selectOptions(screen.getByTestId('tela-categoria'), '7');
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
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
    expect(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/)).toHaveValue('Felpa');
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

  it('el botón "Nuevo" abre el diálogo de alta rápida de tipo de tela', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.click(screen.getByTestId('nueva-categoria-tela'));
    expect(screen.getByRole('heading', { name: 'Nuevo tipo de tela' })).toBeInTheDocument();
  });
  it('el ALTA no se guarda SIN proveedor (obligatorio, §Post-F9.11) y explica por qué', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: TelaCrear, opciones?: { onSuccess?: (r: Tela) => void }) => {
        opciones?.onSuccess?.(telaEjemplo());
      },
    );
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Sin dueño');
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'KG');
    await usuario.click(screen.getByTestId('guardar-tela'));

    // No se manda nada y se explica por qué.
    await screen.findByTestId('error-proveedor-tela');
    expect(crearMutate).not.toHaveBeenCalled();

    // Elegido el proveedor, ya guarda (y viaja su id).
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
    await usuario.click(screen.getByTestId('guardar-tela'));
    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect((crearMutate.mock.calls[0]?.[0] as { idProveedor?: number }).idProveedor).toBe(5);
  });

  it('marcar "lleva complemento" pide su nombre, lo manda y condiciona el editor de colores', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: TelaCrear, opciones?: { onSuccess?: (r: Tela) => void }) => {
        opciones?.onSuccess?.(telaEjemplo());
      },
    );
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    // Sin marcar, el editor de colores NO muestra el precio del complemento.
    expect(screen.getByTestId('editor-colores-mock')).toHaveAttribute(
      'data-lleva-complemento',
      'no',
    );
    expect(screen.queryByTestId('tela-nombre-complemento')).not.toBeInTheDocument();

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Felpa con cardigán');
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'KG');
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
    await usuario.click(screen.getByTestId('tela-lleva-complemento'));

    // Marcado, el editor condiciona la columna y el form exige el nombre del complemento.
    expect(screen.getByTestId('editor-colores-mock')).toHaveAttribute(
      'data-lleva-complemento',
      'si',
    );
    await usuario.click(screen.getByTestId('guardar-tela'));
    await screen.findByText('Ponle nombre al complemento (p. ej. Cardigán)');
    expect(crearMutate).not.toHaveBeenCalled();

    await usuario.type(screen.getByTestId('tela-nombre-cuerpo'), 'Felpa');
    await usuario.type(screen.getByTestId('tela-nombre-complemento'), 'Cardigán');
    expect(screen.getByTestId('editor-colores-mock')).toHaveAttribute(
      'data-nombre-complemento',
      'Cardigán',
    );
    await usuario.click(screen.getByTestId('guardar-tela'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(cuerpo.nombreCuerpo).toBe('Felpa');
    expect(cuerpo.nombreComplemento).toBe('Cardigán');
  });

  it('en alta, elegir una composición la incluye como id numérico (y "Nueva" abre su alta rápida)', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: TelaCrear, opciones?: { onSuccess?: (r: Tela) => void }) => {
        opciones?.onSuccess?.(telaEjemplo());
      },
    );
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Con composición');
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'KG');
    await usuario.selectOptions(screen.getByTestId('tela-composicion'), '3');
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
    await usuario.click(screen.getByTestId('guardar-tela'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect((crearMutate.mock.calls[0]?.[0] as { idComposicion?: number }).idComposicion).toBe(3);
  });

  it('el botón "Nueva" de composición abre el diálogo de alta rápida', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.click(screen.getByTestId('nueva-composicion-tela'));
    expect(screen.getByRole('heading', { name: 'Nueva composición de tela' })).toBeInTheDocument();
  });

  it('en edición de una MIGRADA sin proveedor NO se exige (guarda sin él y sin mandarlo)', async () => {
    const usuario = userEvent.setup();
    actualizarMutate.mockImplementation((_args, opciones?: { onSuccess?: (r: Tela) => void }) => {
      opciones?.onSuccess?.(telaEjemplo());
    });
    renderConProveedores(
      <DialogoTela
        abierto
        alCambiarAbierto={vi.fn()}
        tela={telaEjemplo({ idProveedor: null, proveedor: null })}
      />,
    );

    await usuario.click(screen.getByTestId('guardar-tela'));
    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as { cuerpo: TelaEditar };
    // El proveedor ni se exige ni viaja (omitir = no tocar).
    expect('idProveedor' in args.cuerpo).toBe(false);
  });
});
