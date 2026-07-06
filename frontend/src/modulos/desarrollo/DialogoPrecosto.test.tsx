import { screen, within } from '@testing-library/react';
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

vi.mock('@/api/precostos', () => ({
  usePrecostosDesarrollo: () => historial,
  usePrecosto: () => precostoEstado,
  useGenerarPrecosto: () => ({ mutate: generarMutate, isPending: false }),
  useRecalcularPrecosto: () => ({ mutate: recalcularMutate, isPending: false }),
  useCongelarPrecosto: () => ({ mutate: congelarMutate, isPending: false }),
  useAgregarLinea: () => ({ mutate: agregarMutate, isPending: false }),
  useEditarLinea: () => ({ mutate: editarMutate, isPending: false }),
  useEliminarLinea: () => ({ mutate: eliminarMutate, isPending: false }),
}));

vi.mock('@/api/conceptos-costo', () => ({
  useConceptosCosto: () => ({
    data: {
      datos: [
        { id: 5, nombre: 'Estampado', fijo: false },
        { id: 1, nombre: 'Tela', fijo: true }, // fijo → NO debe ofrecerse en el alta manual (B1)
      ],
    },
    isPending: false,
  }),
}));

function desarrollo(): Desarrollo {
  return {
    id: 1,
    idProyecto: 1,
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
    idBordado: null,
    editable: false,
    eliminable: false,
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
          linea({ id: 1, conceptoCodigo: 'tela', descripcion: 'Felpa', editable: false }),
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
    // La maquila (editable) tiene botón editar; la tela (BOM) muestra "del BOM".
    expect(within(editor).getByTestId('editar-linea')).toBeInTheDocument();

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

  it('el alta manual NO ofrece conceptos FIJOS en el selector (B1)', () => {
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
    expect(within(select).getByRole('option', { name: 'Estampado' })).toBeInTheDocument();
    // "Tela" es fijo → NO debe aparecer como opción del alta manual.
    expect(within(select).queryByRole('option', { name: 'Tela' })).not.toBeInTheDocument();
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
});
