import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Desarrollo } from '@/api/desarrollos';
import type { Precosto, PrecostoLinea, PrecostoResumen } from '@/api/precostos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoPrecosto } from './DialogoPrecosto';

// ── Estado controlado de la capa de datos (sin red) ──────────────────────────────
let historial: { data: PrecostoResumen[]; isPending: boolean };
let precostoEstado: {
  data: Precosto | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
};
const generarMutate = vi.fn();
const recalcularMutate = vi.fn();
const congelarMutate = vi.fn();
const agregarMutate = vi.fn();
const editarMutate = vi.fn();
const eliminarMutate = vi.fn();
const restaurarMutate = vi.fn();

vi.mock('@/api/precostos', () => ({
  usePrecostosDesarrollo: () => historial,
  usePrecosto: () => precostoEstado,
  useGenerarPrecosto: () => ({ mutate: generarMutate, isPending: false }),
  useRecalcularPrecosto: () => ({ mutate: recalcularMutate, isPending: false }),
  useCongelarPrecosto: () => ({ mutate: congelarMutate, isPending: false }),
  useAgregarLinea: () => ({ mutate: agregarMutate, isPending: false }),
  useEditarLinea: () => ({ mutate: editarMutate, isPending: false }),
  useEliminarLinea: () => ({ mutate: eliminarMutate, isPending: false }),
  useRestaurarLinea: () => ({ mutate: restaurarMutate, isPending: false }),
}));

vi.mock('@/api/avios', () => ({
  useAvios: () => ({
    data: {
      datos: [
        { id: 77, clave: 'BOT-4H', descripcion: 'Botón 4 hoyos', esGenerico: false },
        { id: 78, clave: 'ELAS-2', descripcion: 'Elástico 2cm', esGenerico: true },
      ],
    },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/api/conceptos-costo', () => ({
  useConceptosCosto: () => ({
    data: {
      datos: [
        { id: 5, codigo: 'estampado', nombre: 'Estampado', fijo: false },
        { id: 1, codigo: 'tela', nombre: 'Tela', fijo: true }, // R5/B12: se PUEDE agregar manual (no es ancla)
        { id: 3, codigo: 'maquila', nombre: 'Maquila', fijo: true }, // ancla → NO se ofrece (único por prenda)
        { id: 8, codigo: 'corte', nombre: 'Corte', fijo: true }, // ancla → NO se ofrece (único por prenda)
      ],
    },
    isPending: false,
  }),
}));

function desarrollo(): Desarrollo {
  return {
    id: 1,
    idProyecto: 1,
    idCliente: 3,
    cliente: 'C&A',
    idClienteDepartamento: 5,
    departamento: 'NIÑOS',
    idModelo: 10,
    codigoModelo: 'A-100',
    descripcionModelo: null,
    numeroCliente: null,
    notas: null,
    estado: 'en-desarrollo',
    apagado: false,
    apagadoEn: null,
    apagadoPorId: null,
    motivoApagado: null,
    creadoEn: '2026-07-05T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-05T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function linea(
  over: Partial<PrecostoLinea> & Pick<PrecostoLinea, 'id' | 'conceptoCodigo'>,
): PrecostoLinea {
  return {
    idConceptoCosto: 1,
    conceptoNombre: over.conceptoCodigo === 'tela' ? 'Tela' : 'Maquila',
    conceptoOrden: over.conceptoCodigo === 'tela' ? 1 : 3,
    conceptoFijo: true,
    origen: 'manual',
    descripcion: 'x',
    consumo: null,
    precioUnit: 10,
    importe: 10,
    notas: null,
    idTela: null,
    idTelaProveedor: null,
    idAvio: null,
    idAvioProveedor: null,
    idModeloArte: null,
    editable: false,
    eliminable: false,
    ajustado: false,
    ...over,
  };
}

function precosto(over: Partial<Precosto>): Precosto {
  return {
    id: 11,
    idDesarrollo: 1,
    version: 1,
    estado: 'borrador',
    congelado: false,
    congeladoEn: null,
    congeladoPorId: null,
    costoTotal: 40,
    lineas: [],
    creadoEn: '2026-07-05T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-05T00:00:00.000Z',
    modificadoPorId: null,
    ...over,
  };
}

function resumen(
  over: Partial<PrecostoResumen> & Pick<PrecostoResumen, 'id' | 'version'>,
): PrecostoResumen {
  return {
    estado: 'borrador',
    congelado: false,
    costoTotal: 40,
    congeladoEn: null,
    congeladoPorId: null,
    creadoEn: '2026-07-05T00:00:00.000Z',
    ...over,
  };
}

const PERM = ['desarrollo.ver', 'desarrollo.precostear', 'consultas.ver-importes'] as const;

describe('<DialogoPrecosto>', () => {
  beforeEach(() => {
    generarMutate.mockReset();
    recalcularMutate.mockReset();
    congelarMutate.mockReset();
    agregarMutate.mockReset();
    editarMutate.mockReset();
    eliminarMutate.mockReset();
    historial = { data: [], isPending: false };
    precostoEstado = { data: undefined, isPending: false, isError: false, error: null };
  });

  it('sin versiones ofrece generar el precosto y lo dispara al confirmar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoPrecosto abierto alCambiarAbierto={() => {}} desarrollo={desarrollo()} />,
      { sesion: estadoSesionDePrueba([...PERM]) },
    );

    const boton = screen.getByTestId('generar-precosto');
    expect(boton).toBeInTheDocument();
    await usuario.click(boton);
    expect(generarMutate).toHaveBeenCalledWith(1, expect.anything());
  });

  it('un BORRADOR muestra renglones por concepto y congela con confirmación', async () => {
    const usuario = userEvent.setup();
    historial = { data: [resumen({ id: 11, version: 1 })], isPending: false };
    precostoEstado = {
      data: precosto({
        lineas: [
          // Tela viene del BOM: editable + eliminable (no es ancla). Maquila es ancla: editable, no eliminable.
          linea({
            id: 1,
            conceptoCodigo: 'tela',
            descripcion: 'Felpa',
            origen: 'bom_tela',
            editable: true,
            eliminable: true,
          }),
          linea({
            id: 2,
            conceptoCodigo: 'maquila',
            descripcion: 'Maquila',
            editable: true,
            eliminable: false,
          }),
        ],
      }),
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(
      <DialogoPrecosto abierto alCambiarAbierto={() => {}} desarrollo={desarrollo()} />,
      { sesion: estadoSesionDePrueba([...PERM]) },
    );

    const editor = screen.getByTestId('editor-precosto');
    expect(within(editor).getByTestId('grupo-tela')).toBeInTheDocument();
    expect(within(editor).getByTestId('grupo-maquila')).toBeInTheDocument();
    // R5/B12: en un borrador CUALQUIER renglón se edita (tela BOM + maquila ancla) → 2 botones "Editar".
    expect(within(editor).getAllByTestId('editar-linea')).toHaveLength(2);
    // La maquila es ancla (no eliminable); la tela sí se puede quitar → 1 solo botón eliminar.
    expect(within(editor).getAllByTestId('eliminar-linea')).toHaveLength(1);

    // Congelar pide confirmación y luego dispara la mutación.
    await usuario.click(within(editor).getByTestId('congelar-precosto'));
    await usuario.click(screen.getByTestId('confirmar-precosto'));
    expect(congelarMutate).toHaveBeenCalledWith(11, expect.anything());
  });

  it('una versión CONGELADA es de solo lectura (sin editar ni congelar)', () => {
    historial = {
      data: [resumen({ id: 11, version: 1, estado: 'congelado', congelado: true })],
      isPending: false,
    };
    precostoEstado = {
      data: precosto({
        estado: 'congelado',
        congelado: true,
        lineas: [linea({ id: 2, conceptoCodigo: 'maquila', editable: true, eliminable: false })],
      }),
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(
      <DialogoPrecosto abierto alCambiarAbierto={() => {}} desarrollo={desarrollo()} />,
      { sesion: estadoSesionDePrueba([...PERM]) },
    );

    expect(screen.queryByTestId('congelar-precosto')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recalcular-precosto')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-linea')).not.toBeInTheDocument();
    expect(screen.queryByTestId('form-agregar-manual')).not.toBeInTheDocument();
  });

  it('oculta los importes cuando el backend los manda en null', () => {
    historial = { data: [resumen({ id: 11, version: 1, costoTotal: null })], isPending: false };
    precostoEstado = {
      data: precosto({
        costoTotal: null,
        lineas: [linea({ id: 1, conceptoCodigo: 'tela', precioUnit: null, importe: null })],
      }),
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(
      <DialogoPrecosto abierto alCambiarAbierto={() => {}} desarrollo={desarrollo()} />,
      { sesion: estadoSesionDePrueba(['desarrollo.ver']) },
    );

    // Total y precios como "—"; sin permiso de precostear no hay acciones de edición.
    expect(screen.getByTestId('editor-precosto')).toBeInTheDocument();
    expect(screen.queryByTestId('congelar-precosto')).not.toBeInTheDocument();
  });

  it('el alta manual oculta SOLO los conceptos ancla maquila/corte (R5/B12)', () => {
    historial = { data: [resumen({ id: 11, version: 1 })], isPending: false };
    precostoEstado = {
      data: precosto({
        lineas: [linea({ id: 2, conceptoCodigo: 'maquila', editable: true, eliminable: false })],
      }),
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(
      <DialogoPrecosto abierto alCambiarAbierto={() => {}} desarrollo={desarrollo()} />,
      { sesion: estadoSesionDePrueba([...PERM]) },
    );

    const select = screen.getByTestId('agregar-linea-concepto');
    // R5/B12: para negociar se puede agregar un renglón scratch bajo cualquier concepto NO ancla,
    // incluyendo tela (antes bloqueada por B1). Solo maquila/corte quedan fuera (únicos por prenda).
    expect(within(select).getByRole('option', { name: 'Estampado' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Tela' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Maquila' })).not.toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Corte' })).not.toBeInTheDocument();
  });

  it('sin ver-importes bloquea editar/agregar (no sobrescribe a ciegas) pero deja recalcular/congelar', () => {
    historial = { data: [resumen({ id: 11, version: 1, costoTotal: null })], isPending: false };
    precostoEstado = {
      data: precosto({
        costoTotal: null,
        lineas: [
          linea({
            id: 2,
            conceptoCodigo: 'maquila',
            editable: true,
            eliminable: false,
            precioUnit: null,
            importe: null,
          }),
        ],
      }),
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(
      <DialogoPrecosto abierto alCambiarAbierto={() => {}} desarrollo={desarrollo()} />,
      { sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.precostear']) },
    );

    expect(screen.getByTestId('editor-precosto')).toBeInTheDocument();
    // Recalcular/congelar SÍ (no capturan precio); editar/agregar NO (tocarían el precio oculto).
    expect(screen.getByTestId('congelar-precosto')).toBeInTheDocument();
    expect(screen.getByTestId('recalcular-precosto')).toBeInTheDocument();
    expect(screen.queryByTestId('editar-linea')).not.toBeInTheDocument();
    expect(screen.queryByTestId('form-agregar-manual')).not.toBeInTheDocument();
  });
  it('muestra el CLIENTE y el departamento del proyecto (el precosteo va dirigido a un cliente)', () => {
    historial = { data: [resumen({ id: 11, version: 1 })], isPending: false };
    precostoEstado = {
      data: precosto({ lineas: [linea({ id: 1, conceptoCodigo: 'tela' })] }),
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(
      <DialogoPrecosto abierto alCambiarAbierto={() => {}} desarrollo={desarrollo()} />,
      { sesion: estadoSesionDePrueba([...PERM]) },
    );

    const encabezado = screen.getByTestId('precosto-cliente');
    expect(encabezado).toHaveTextContent('C&A');
    expect(encabezado).toHaveTextContent('NIÑOS');
  });

  it('el alta manual permite ELEGIR un avío del catálogo y deja que el servidor resuelva su precio', async () => {
    const usuario = userEvent.setup();
    historial = { data: [resumen({ id: 11, version: 1 })], isPending: false };
    precostoEstado = {
      data: precosto({
        lineas: [linea({ id: 2, conceptoCodigo: 'maquila', editable: true, eliminable: false })],
      }),
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(
      <DialogoPrecosto abierto alCambiarAbierto={() => {}} desarrollo={desarrollo()} />,
      { sesion: estadoSesionDePrueba([...PERM]) },
    );

    await usuario.selectOptions(screen.getByTestId('agregar-linea-concepto'), '5');
    // Enfocar el combobox abre la lista con el catálogo (sin teclear nada ya hay opciones).
    await usuario.click(screen.getByTestId('agregar-linea-avio-busqueda'));
    const opciones = await screen.findAllByTestId('agregar-linea-avio-opcion');
    // `fireEvent`: la lista vive en un PORTAL fuera del diálogo y en jsdom (sin CSS) hereda el
    // `pointer-events:none` que radix pone en el body; el combobox elige en `mousedown`.
    fireEvent.mouseDown(opciones[0] as HTMLElement);

    // Precio EN BLANCO: no se manda `precioUnit` — la cascada la resuelve el backend (A1).
    await usuario.click(screen.getByTestId('agregar-linea'));
    expect(agregarMutate).toHaveBeenCalledWith(
      {
        id: 11,
        cuerpo: { idConceptoCosto: 5, idAvio: 77, consumo: null },
      },
      expect.anything(),
    );
  });

  it('sin avío el precio sigue siendo obligatorio (no se manda una alta sin precio)', async () => {
    const usuario = userEvent.setup();
    historial = { data: [resumen({ id: 11, version: 1 })], isPending: false };
    precostoEstado = {
      data: precosto({
        lineas: [linea({ id: 2, conceptoCodigo: 'maquila', editable: true, eliminable: false })],
      }),
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(
      <DialogoPrecosto abierto alCambiarAbierto={() => {}} desarrollo={desarrollo()} />,
      { sesion: estadoSesionDePrueba([...PERM]) },
    );

    await usuario.selectOptions(screen.getByTestId('agregar-linea-concepto'), '5');
    await usuario.click(screen.getByTestId('agregar-linea'));
    expect(agregarMutate).not.toHaveBeenCalled();
  });
});
