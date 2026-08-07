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

/** Categorias de ejemplo del selector (la 2ª, multi-palabra, prueba el pre-llenado A1.1). */
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
  {
    id: 8,
    nombre: 'Felpa 50/50',
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
// expone dos botones que "eligen" un proveedor CON nombre corto (Alsatex/Alsa) y uno SIN
// (Bloom Textil) — suficiente para probar el flujo del dialogo y el nombre compuesto (A1.1).
vi.mock('@/modulos/cxp/SelectorProveedor', () => ({
  SelectorProveedor: ({
    idSeleccionado,
    alSeleccionar,
    rol,
  }: {
    idSeleccionado: number | undefined;
    alSeleccionar: (proveedor: { id: number; nombre: string; nombreCorto: string | null }) => void;
    /** Código de rol al que el diálogo acota la búsqueda (debe ser "vende-telas"). */
    rol?: string | undefined;
  }) => (
    <>
      <button
        type="button"
        data-testid="selector-proveedor-stub"
        data-rol={rol ?? ''}
        data-seleccionado={idSeleccionado ?? ''}
        onClick={() => alSeleccionar({ id: 5, nombre: 'Alsatex', nombreCorto: 'Alsa' })}
      >
        {idSeleccionado === undefined ? 'Elegir proveedor' : `Proveedor ${idSeleccionado}`}
      </button>
      <button
        type="button"
        data-testid="selector-proveedor-stub-sin-corto"
        onClick={() => alSeleccionar({ id: 6, nombre: 'Bloom Textil', nombreCorto: null })}
      >
        Elegir proveedor sin corto
      </button>
    </>
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
    proveedorCorto: null,
    nombreProveedor: null,
    nombreCuerpo: null,
    nombreComplemento: null,
    unidadMedida: 'KG',
    tipoComponente: 'OTRO',
    favorito: false,
    precioSugerido: null,
    peso: null,
    ancho: null,
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

  it('acota el proveedor dueño al rol «Vende telas» (decisión P.2)', () => {
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    // La tela es DE quien la vende: el combobox nunca debe ofrecer maquileros ni servicios.
    expect(screen.getByTestId('selector-proveedor-stub')).toHaveAttribute(
      'data-rol',
      'vende-telas',
    );
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
    // Peso y ancho vacíos también se omiten (A1.1 punto 1).
    expect('peso' in cuerpo).toBe(false);
    expect('ancho' in cuerpo).toBe(false);
    // `tipoComponente` y `paraProduccion` ya NO viajan (A1.1 puntos 4-5): caen al default
    // del contrato (OTRO / true) en el servidor.
    expect('tipoComponente' in cuerpo).toBe(false);
    expect('paraProduccion' in cuerpo).toBe(false);
    // La bandera de favorita y los colores siempre viajan; en el ALTA arranca MARCADA
    // (A1.1 punto 2 — solo la UI; el default del modelo no cambió).
    expect(cuerpo.favorito).toBe(true);
    expect(cuerpo.colores).toEqual([]);
    expect(alCambiarAbierto).toHaveBeenCalledWith(false);
  });

  // A1.1 punto 2: la casilla "favorita" arranca MARCADA en el alta (y se puede desmarcar).
  it('en ALTA la casilla de favorita viene marcada por default y se puede desmarcar', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: TelaCrear, opciones?: { onSuccess?: (r: Tela) => void }) => {
        opciones?.onSuccess?.(telaEjemplo());
      },
    );
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    expect(screen.getByTestId('tela-favorito')).toBeChecked();

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'No favorita');
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'KG');
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
    await usuario.click(screen.getByTestId('tela-favorito'));
    await usuario.click(screen.getByTestId('guardar-tela'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect((crearMutate.mock.calls[0]?.[0] as { favorito?: boolean }).favorito).toBe(false);
  });

  // A1.1 punto 1: peso (gr/m²) y ancho (m) viajan como número cuando se capturan.
  it('en ALTA, el peso y el ancho capturados viajan como número', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: TelaCrear, opciones?: { onSuccess?: (r: Tela) => void }) => {
        opciones?.onSuccess?.(telaEjemplo());
      },
    );
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Con ficha');
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'KG');
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
    await usuario.type(screen.getByTestId('tela-peso'), '280');
    await usuario.type(screen.getByTestId('tela-ancho'), '1.8');
    await usuario.click(screen.getByTestId('guardar-tela'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as { peso?: number; ancho?: number };
    expect(cuerpo.peso).toBe(280);
    expect(cuerpo.ancho).toBe(1.8);
  });

  // Ronda de corrección A1.1 (hallazgo 2): el tope del DECIMAL(8,2) se espeja en captura —
  // un peso de 1,000,000 se rechaza aquí con mensaje legible, no con un 400/500 del API.
  it('un peso fuera del tope (>99,999.99) se rechaza en captura y no viaja', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Desborde');
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'KG');
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
    await usuario.type(screen.getByTestId('tela-peso'), '1000000');
    await usuario.click(screen.getByTestId('guardar-tela'));

    await screen.findByText('El peso debe ser un número entre 0 y 99,999.99');
    expect(crearMutate).not.toHaveBeenCalled();
  });

  it('en EDICIÓN, vaciar el peso lo manda como null (borrar) y pre-carga los valores', async () => {
    const usuario = userEvent.setup();
    actualizarMutate.mockImplementation((_args, opciones?: { onSuccess?: (r: Tela) => void }) => {
      opciones?.onSuccess?.(telaEjemplo());
    });
    renderConProveedores(
      <DialogoTela
        abierto
        alCambiarAbierto={vi.fn()}
        tela={telaEjemplo({ peso: 280, ancho: 1.8 })}
      />,
    );

    expect(screen.getByTestId('tela-peso')).toHaveValue(280);
    expect(screen.getByTestId('tela-ancho')).toHaveValue(1.8);

    await usuario.clear(screen.getByTestId('tela-peso'));
    await usuario.click(screen.getByTestId('guardar-tela'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as { cuerpo: TelaEditar };
    expect(args.cuerpo.peso).toBeNull();
    expect(args.cuerpo.ancho).toBe(1.8);
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

  it('marcar "lleva complemento" PRE-LLENA "Cardigan" (editable) y condiciona el editor', async () => {
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

    // Marcado: el editor condiciona la columna y el nombre del complemento se PRE-LLENA
    // con "Cardigan" (A1.1 punto 6), editable.
    expect(screen.getByTestId('editor-colores-mock')).toHaveAttribute(
      'data-lleva-complemento',
      'si',
    );
    expect(screen.getByTestId('tela-nombre-complemento')).toHaveValue('Cardigan');
    expect(screen.getByTestId('editor-colores-mock')).toHaveAttribute(
      'data-nombre-complemento',
      'Cardigan',
    );

    // Si el usuario lo VACÍA, el form sigue exigiendo el nombre del complemento.
    await usuario.clear(screen.getByTestId('tela-nombre-complemento'));
    await usuario.click(screen.getByTestId('guardar-tela'));
    await screen.findByText('Ponle nombre al complemento (p. ej. Cardigán)');
    expect(crearMutate).not.toHaveBeenCalled();

    await usuario.type(screen.getByTestId('tela-nombre-cuerpo'), 'Felpa');
    await usuario.type(screen.getByTestId('tela-nombre-complemento'), 'Cardigán');
    await usuario.click(screen.getByTestId('guardar-tela'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(cuerpo.nombreCuerpo).toBe('Felpa');
    expect(cuerpo.nombreComplemento).toBe('Cardigán');
  });

  // A1.1 punto 6: al elegir el tipo de tela se propone la PRIMERA PALABRA de su nombre
  // como nombre del cuerpo ("Felpa 50/50" → "Felpa"), sin pisar lo ya tecleado. Ronda de
  // corrección: el prefill SOLO corre con "lleva complemento" — al marcar la casilla
  // después del tipo, la casilla propone entonces (este test cubre ese flujo).
  it('elegir el tipo de tela propone la primera palabra como nombre del cuerpo (alta)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.selectOptions(screen.getByTestId('tela-categoria'), '8'); // "Felpa 50/50"
    await usuario.click(screen.getByTestId('tela-lleva-complemento'));
    expect(screen.getByTestId('tela-nombre-cuerpo')).toHaveValue('Felpa');
  });

  it('y en el flujo inverso (marcar primero, elegir tipo después) también propone', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.click(screen.getByTestId('tela-lleva-complemento'));
    expect(screen.getByTestId('tela-nombre-cuerpo')).toHaveValue('');
    await usuario.selectOptions(screen.getByTestId('tela-categoria'), '8');
    expect(screen.getByTestId('tela-nombre-cuerpo')).toHaveValue('Felpa');
  });

  // Ronda de corrección A1.1 (hallazgo 4): SIN complemento el campo del cuerpo ni se ve —
  // el prefill NO debe correr, o un alta "sin complemento" persistiría un nombreCuerpo
  // invisible que aflora después en inventario.
  it('SIN complemento, elegir el tipo NO pre-llena el cuerpo (ni viaja en el alta)', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: TelaCrear, opciones?: { onSuccess?: (r: Tela) => void }) => {
        opciones?.onSuccess?.(telaEjemplo());
      },
    );
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.type(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/), 'Sin complemento');
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'KG');
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
    await usuario.selectOptions(screen.getByTestId('tela-categoria'), '8'); // "Felpa 50/50"
    await usuario.click(screen.getByTestId('guardar-tela'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    const cuerpo = crearMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('nombreCuerpo' in cuerpo).toBe(false);
  });

  it('el pre-llenado del cuerpo NO pisa lo que el usuario ya tecleó', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.click(screen.getByTestId('tela-lleva-complemento'));
    const campoCuerpo = screen.getByTestId('tela-nombre-cuerpo');
    await usuario.type(campoCuerpo, 'Terry');
    await usuario.selectOptions(screen.getByTestId('tela-categoria'), '8');
    expect(campoCuerpo).toHaveValue('Terry');
  });

  it('en EDICIÓN elegir el tipo de tela NO re-llena el nombre del cuerpo', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoTela
        abierto
        alCambiarAbierto={vi.fn()}
        tela={telaEjemplo({ nombreComplemento: 'Cardigan' })}
      />,
    );

    await usuario.selectOptions(screen.getByTestId('tela-categoria'), '8');
    expect(screen.getByTestId('tela-nombre-cuerpo')).toHaveValue('');
  });

  // ── Nombre COMPUESTO (A1.1 punto 8): corto del proveedor + nombre del proveedor ──

  it('el nombre se AUTO-ARMA con el corto del proveedor + el nombre que él le da', async () => {
    const usuario = userEvent.setup();
    crearMutate.mockImplementation(
      (_cuerpo: TelaCrear, opciones?: { onSuccess?: (r: Tela) => void }) => {
        opciones?.onSuccess?.(telaEjemplo());
      },
    );
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    // Elegir proveedor (Alsatex, corto "Alsa") y teclear el nombre del proveedor.
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
    await usuario.type(screen.getByTestId('tela-nombre-proveedor'), 'Felpa España');
    expect(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/)).toHaveValue('Alsa Felpa España');

    // Sigue siendo editable y viaja tal cual al guardar.
    await usuario.selectOptions(screen.getByTestId('tela-unidad'), 'KG');
    await usuario.click(screen.getByTestId('guardar-tela'));
    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect((crearMutate.mock.calls[0]?.[0] as { nombre?: string }).nombre).toBe(
      'Alsa Felpa España',
    );
  });

  it('sin nombre corto, el compuesto usa el NOMBRE del proveedor', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    await usuario.click(screen.getByTestId('selector-proveedor-stub-sin-corto'));
    await usuario.type(screen.getByTestId('tela-nombre-proveedor'), 'Felpa');
    expect(screen.getByLabelText(/^Nombre\* \(obligatorio\)$/)).toHaveValue('Bloom Textil Felpa');
  });

  it('el auto-armado NO pisa un nombre tecleado a mano', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoTela abierto alCambiarAbierto={vi.fn()} tela={undefined} />);

    const campoNombre = screen.getByLabelText(/^Nombre\* \(obligatorio\)$/);
    await usuario.type(campoNombre, 'Mi tela especial');
    await usuario.click(screen.getByTestId('selector-proveedor-stub'));
    await usuario.type(screen.getByTestId('tela-nombre-proveedor'), 'Felpa España');
    expect(campoNombre).toHaveValue('Mi tela especial');
  });

  it('en EDICIÓN el nombre NO se re-arma solo; solo si el usuario lo VACÍA (y usa el CORTO)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoTela
        abierto
        alCambiarAbierto={vi.fn()}
        tela={telaEjemplo({
          nombre: 'Nombre histórico',
          nombreProveedor: 'Felpa España',
          // Ronda de corrección (hallazgo 3): la salida de la tela YA trae el corto del
          // dueño — el re-armado debe usar "Alsa", no el nombre largo "Alsatex".
          proveedorCorto: 'Alsa',
        })}
      />,
    );

    const campoNombre = screen.getByLabelText(/^Nombre\* \(obligatorio\)$/);
    // Cambiar el nombre del proveedor NO re-arma el nombre guardado…
    await usuario.type(screen.getByTestId('tela-nombre-proveedor'), ' 2');
    expect(campoNombre).toHaveValue('Nombre histórico');

    // …pero VACIARLO vuelve a soltar el armado, con el nombre CORTO del dueño.
    await usuario.clear(campoNombre);
    await waitFor(() => expect(campoNombre).toHaveValue('Alsa Felpa España 2'));
  });

  it('en EDICIÓN sin corto del dueño, el re-armado cae a su nombre completo', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoTela
        abierto
        alCambiarAbierto={vi.fn()}
        tela={telaEjemplo({
          nombre: 'Nombre histórico',
          nombreProveedor: 'Felpa España',
          proveedorCorto: null,
        })}
      />,
    );

    const campoNombre = screen.getByLabelText(/^Nombre\* \(obligatorio\)$/);
    await usuario.clear(campoNombre);
    await waitFor(() => expect(campoNombre).toHaveValue('Alsatex Felpa España'));
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
