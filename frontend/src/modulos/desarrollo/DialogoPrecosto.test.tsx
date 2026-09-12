import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Desarrollo } from '@/api/desarrollos';
import type { Precosto, PrecostoLinea, PrecostoResumen } from '@/api/precostos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoPrecosto } from './DialogoPrecosto';

/**
 * Las tres banderas del concepto TAL COMO LAS MANDA EL SERVIDOR (§Post-F9.210): ancla fija, sólo
 * precio y de qué catálogo sale su insumo. Se declara con `function` porque `vi.mock` se iza por
 * encima de todo lo demás del archivo.
 */
function banderas(codigo: string): {
  anclaFija: boolean;
  soloPrecio: boolean;
  insumoCatalogo: 'tela' | 'avio' | null;
} {
  const ancla = ['maquila', 'corte', 'empaque'].includes(codigo);
  return {
    anclaFija: ancla,
    soloPrecio: ancla,
    insumoCatalogo: codigo === 'tela' ? 'tela' : codigo === 'avios' ? 'avio' : null,
  };
}

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

vi.mock('@/api/telas', () => ({
  useTelas: () => ({
    data: {
      datos: [
        { id: 41, nombre: 'Felpa perchada', descripcion: 'Felpa 280g' },
        { id: 42, nombre: 'Jersey 30/1', descripcion: null },
      ],
    },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/api/conceptos-costo', () => ({
  useConceptosCosto: () => ({
    data: {
      // ⭐ §Post-F9.210: las banderas las calcula el SERVIDOR desde el código (un solo sitio:
      // `dominio/desarrollo/conceptos-precosto.ts`). La pantalla ya no lleva ninguna lista propia,
      // así que aquí se imitan tal como llegan del API.
      datos: [
        { id: 5, codigo: 'estampado', nombre: 'Estampado', fijo: false, ...banderas('estampado') },
        // R5/B12: se PUEDE agregar manual (no es ancla), pero su insumo sale del CATÁLOGO.
        { id: 1, codigo: 'tela', nombre: 'Tela', fijo: true, ...banderas('tela') },
        { id: 2, codigo: 'avios', nombre: 'Avíos', fijo: true, ...banderas('avios') },
        // Las TRES anclas. ⭐ V1-E8w: ya no se esconden siempre — se esconden sólo si ESTE
        // precosto las tiene puestas.
        { id: 3, codigo: 'maquila', nombre: 'Maquila', fijo: true, ...banderas('maquila') },
        { id: 8, codigo: 'corte', nombre: 'Corte', fijo: true, ...banderas('corte') },
        { id: 9, codigo: 'empaque', nombre: 'Empaque', fijo: true, ...banderas('empaque') },
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
    nombreApagadoPor: null,
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
    // Igual que el servidor: la bandera sale del CÓDIGO del concepto, no de una lista de la UI.
    soloPrecio: ['maquila', 'corte', 'empaque'].includes(over.conceptoCodigo),
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

  it('el alta manual esconde el ancla que ESTE precosto ya tiene, y ofrece la que le falta (R5/B12 + V1-E8w)', () => {
    historial = { data: [resumen({ id: 11, version: 1 })], isPending: false };
    precostoEstado = {
      data: precosto({
        // Este precosto tiene puesta UNA sola ancla: maquila. Corte y empaque le faltan.
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
    // R5/B12: se puede agregar un renglón scratch bajo cualquier concepto NO ancla, tela incluida.
    expect(within(select).getByRole('option', { name: 'Estampado' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Tela' })).toBeInTheDocument();
    // ⭐ V1-E8w, las DOS direcciones de la misma regla:
    // (a) el ancla YA PUESTA no se ofrece — es única por prenda, se edita, no se duplica.
    expect(within(select).queryByRole('option', { name: 'Maquila' })).not.toBeInTheDocument();
    // (b) el ancla que FALTA sí se ofrece: es la ÚNICA puerta por la que un borrador nacido antes
    //     de que existiera esa ancla puede recibirla (recalcular desde el BOM no toca los `manual`).
    //     Es el caso REAL de `empaque`, que estrena la 0.060 sobre precostos que ya existían.
    expect(within(select).getByRole('option', { name: 'Corte' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Empaque' })).toBeInTheDocument();
  });

  it('con las TRES anclas puestas, el alta manual no ofrece ninguna (no se duplican)', () => {
    historial = { data: [resumen({ id: 11, version: 1 })], isPending: false };
    precostoEstado = {
      data: precosto({
        lineas: [
          linea({ id: 2, conceptoCodigo: 'maquila', editable: true, eliminable: false }),
          linea({ id: 3, conceptoCodigo: 'corte', editable: true, eliminable: false }),
          linea({ id: 4, conceptoCodigo: 'empaque', editable: true, eliminable: false }),
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

    const select = screen.getByTestId('agregar-linea-concepto');
    expect(within(select).queryByRole('option', { name: 'Maquila' })).not.toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Corte' })).not.toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Empaque' })).not.toBeInTheDocument();
    // Y lo que NO es ancla sigue disponible: la regla esconde anclas puestas, no vacía el selector.
    expect(within(select).getByRole('option', { name: 'Tela' })).toBeInTheDocument();
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

  // ── ⭐ fila 0.152 · §Post-F9.210: el precosteo toma del CATÁLOGO, y las anclas sólo llevan precio ──

  it('bajo el concepto de TELA ofrece el catálogo de telas (no el de avíos) y la EXIGE', async () => {
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

    await usuario.selectOptions(screen.getByTestId('agregar-linea-concepto'), '1'); // Tela
    expect(screen.getByTestId('agregar-linea-tela-busqueda')).toBeInTheDocument();
    // La tela ya NO se teclea: bajo este concepto no hay puerta al catálogo equivocado.
    expect(screen.queryByTestId('agregar-linea-avio-busqueda')).not.toBeInTheDocument();

    // Sin elegir del catálogo no se manda nada, aunque haya precio tecleado (era la puerta por la
    // que entraba la "tela suelta" que se duplicaba).
    await usuario.type(screen.getByTestId('agregar-linea-precio'), '25');
    await usuario.click(screen.getByTestId('agregar-linea'));
    expect(agregarMutate).not.toHaveBeenCalled();
  });

  it('al elegir la tela del catálogo manda idTela y deja que el servidor resuelva su precio', async () => {
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

    await usuario.selectOptions(screen.getByTestId('agregar-linea-concepto'), '1'); // Tela
    await usuario.click(screen.getByTestId('agregar-linea-tela-busqueda'));
    const opciones = await screen.findAllByTestId('agregar-linea-tela-opcion');
    // `fireEvent`: la lista vive en un PORTAL y el combobox elige en `mousedown` (ver el caso del avío).
    fireEvent.mouseDown(opciones[0] as HTMLElement);
    const alta = screen.getByTestId('form-agregar-manual');
    await usuario.type(within(alta).getByLabelText('Consumo'), '1.5');

    await usuario.click(screen.getByTestId('agregar-linea'));
    expect(agregarMutate).toHaveBeenCalledWith(
      { id: 11, cuerpo: { idConceptoCosto: 1, idTela: 41, consumo: 1.5 } },
      expect.anything(),
    );
  });

  it('un concepto de SÓLO PRECIO (corte) no pinta Consumo al agregar, y no lo manda', async () => {
    const usuario = userEvent.setup();
    historial = { data: [resumen({ id: 11, version: 1 })], isPending: false };
    precostoEstado = {
      data: precosto({
        // Sólo maquila puesta: corte y empaque se pueden agregar a mano.
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

    const alta = screen.getByTestId('form-agregar-manual');
    // Con un concepto abierto (estampado) SÍ hay Consumo…
    await usuario.selectOptions(screen.getByTestId('agregar-linea-concepto'), '5');
    expect(within(alta).getByLabelText('Consumo')).toBeInTheDocument();
    // …y con corte desaparece (Daniel: "solo debe de llevar el precio. no la cantidad").
    await usuario.selectOptions(screen.getByTestId('agregar-linea-concepto'), '8');
    expect(within(alta).queryByLabelText('Consumo')).not.toBeInTheDocument();
    // Tampoco se ofrece catálogo de insumos: el corte es un monto por prenda.
    expect(screen.queryByTestId('agregar-linea-avio-busqueda')).not.toBeInTheDocument();

    await usuario.type(screen.getByTestId('agregar-linea-precio'), '7');
    await usuario.click(screen.getByTestId('agregar-linea'));
    expect(agregarMutate).toHaveBeenCalledWith(
      { id: 11, cuerpo: { idConceptoCosto: 8, precioUnit: 7 } },
      expect.anything(),
    );
  });

  it('al EDITAR un renglón de sólo precio no hay casilla de Consumo, y la edición no la manda', async () => {
    const usuario = userEvent.setup();
    historial = { data: [resumen({ id: 11, version: 1 })], isPending: false };
    precostoEstado = {
      data: precosto({
        lineas: [
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

    await usuario.click(screen.getByTestId('editar-linea'));
    // Acotado A LA FILA: el formulario de alta de abajo tiene su propio campo "Consumo".
    const fila = screen.getByTestId('linea-precosto');
    expect(within(fila).queryByLabelText('Consumo')).not.toBeInTheDocument();
    expect(within(fila).getByLabelText('Precio')).toBeInTheDocument();

    await usuario.clear(screen.getByTestId('editar-linea-precio'));
    await usuario.type(screen.getByTestId('editar-linea-precio'), '12');
    await usuario.click(screen.getByTestId('guardar-linea'));
    expect(editarMutate).toHaveBeenCalledWith(
      { id: 11, idLinea: 2, cuerpo: { descripcion: 'Maquila', precioUnit: 12 } },
      expect.anything(),
    );
  });

  it('un renglón que SÍ lleva cantidad conserva su casilla de Consumo al editar', async () => {
    const usuario = userEvent.setup();
    historial = { data: [resumen({ id: 11, version: 1 })], isPending: false };
    precostoEstado = {
      data: precosto({
        lineas: [
          linea({
            id: 1,
            conceptoCodigo: 'tela',
            descripcion: 'Felpa',
            origen: 'bom_tela',
            consumo: 2,
            editable: true,
            eliminable: true,
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

    await usuario.click(screen.getByTestId('editar-linea'));
    expect(
      within(screen.getByTestId('linea-precosto')).getByLabelText('Consumo'),
    ).toBeInTheDocument();
    await usuario.click(screen.getByTestId('guardar-linea'));
    expect(editarMutate).toHaveBeenCalledWith(
      { id: 11, idLinea: 1, cuerpo: { descripcion: 'Felpa', consumo: 2, precioUnit: 10 } },
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
