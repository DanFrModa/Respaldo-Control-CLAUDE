import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalizarPdf, ClavePermiso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ImportadorPedidoPdf } from './ImportadorPedidoPdf';

/**
 * Unit del IMPORTADOR de OC por PDF (petición Daniel — C&A) SIN red (capa de datos mockeada). Cubre lo
 * central de la pantalla: al analizar los PDFs, la VISTA PREVIA pinta un renglón por PDF con su liga de
 * modelo SUGERIDA (aprendida) marcada, el color/tallas "nuevos" y que confirmar dispara el alta con el
 * cliente correcto (los renglones sugeridos no mandan liga manual → el backend usa la aprendida).
 */

const analizarMock = vi.fn();
const confirmarMock = vi.fn();

vi.mock('@/api/importacion-pdf', () => ({
  useAnalizarPdf: () => ({
    mutate: (...a: unknown[]) => {
      analizarMock(...a);
    },
    isPending: false,
  }),
  useConfirmarPdf: () => ({
    mutate: (...a: unknown[]) => {
      confirmarMock(...a);
    },
    isPending: false,
  }),
  usePlantillaVigente: () => ({ data: undefined, isFetching: false }),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [{ id: 1, nombre: 'C&A' }] }, isFetching: false }),
}));
vi.mock('@/api/modelos', () => ({
  useModelos: () => ({
    data: { datos: [{ id: 42, codigo: 'DEV-1', descripcion: 'Playera' }] },
    isFetching: false,
  }),
}));
vi.mock('@/api/importacion-pedido', () => ({
  archivoABase64: vi.fn(() => Promise.resolve('QkFTRTY0')),
}));
// El alta de modelo se reusa como caja negra: aquí se stub-ea para ejercitar el CABLEADO del
// importador (prefill que recibe + `alCrear` que dispara la liga). El comportamiento del alta en
// sí se prueba en `DialogoModelo.test.tsx`.
vi.mock('@/modulos/modelos/DialogoModelo', () => ({
  DialogoModelo: ({
    abierto,
    prellenadoAlta,
    alCrear,
  }: {
    abierto: boolean;
    prellenadoAlta?: { descripcion?: string };
    alCrear?: (m: { id: number; codigo: string }) => void;
  }) =>
    abierto ? (
      <div data-testid="stub-dialogo-modelo">
        <span data-testid="stub-prefill-desc">{prellenadoAlta?.descripcion}</span>
        <button
          type="button"
          data-testid="stub-crear-modelo"
          onClick={() => alCrear?.({ id: 999, codigo: 'CYA-NUEVO' })}
        >
          simular crear
        </button>
      </div>
    ) : null,
}));

/** Renglón canónico: un PDF con liga aprendida (modelo 42), color nuevo y una talla nueva (sin % adicional). */
const RENGLON: AnalizarPdf['renglones'][number] = {
  nombreArchivo: 'oc-620884.pdf',
  error: null,
  numeroOrden: '620884',
  modeloCliente: '3138277',
  descripcionArticulo: 'PLAYERA ML SINGLE JERSEY',
  division: '3- KIDS',
  subDivision: '',
  idColorCliente: '200',
  colorGenerico: 'BLANCO',
  codigoUnico: '26/4/001435/200',
  semanaCliente: '202646',
  pantone: '',
  costoUnitario: 97,
  piezasTotales: 1903,
  piezasFabricar: 1903,
  montoTotal: 184591,
  fechaEntrega: '2026-11-09',
  tallas: [
    { talla: '5-6', piezas: 305, piezasFabricar: 305 },
    { talla: '6-7', piezas: 126, piezasFabricar: 126 },
    { talla: '7-8', piezas: 129, piezasFabricar: 129 },
    { talla: '9-10', piezas: 488, piezasFabricar: 488 },
    { talla: '11-12', piezas: 490, piezasFabricar: 490 },
    { talla: '13-14', piezas: 365, piezasFabricar: 365 },
  ],
  grupos: [],
  idModeloSugerido: 42,
  codigoModeloSugerido: 'DEV-1',
  descripcionModeloSugerido: 'Playera',
  colorNuevo: true,
  tallasNuevas: ['5-6'],
  advertencias: [],
  yaImportado: null,
};

/** Vista previa canónica: un PDF con su renglón (sin % adicional). */
const PREVIEW: AnalizarPdf = {
  totalPiezas: 1903,
  totalPiezasFabricar: 1903,
  porcentajeAdicional: 0,
  totalReconocidos: 1,
  renglones: [RENGLON],
};

/**
 * Vista previa con sobre-pedido por PACKS (fixture real 620884, C&A = 7%): la propuesta a fabricar por
 * talla (326-134-138-521-523-390 = 2032, NO ceil por talla) + el desglose por grupo (A 119→127 packs).
 */
const PREVIEW_7: AnalizarPdf = {
  ...PREVIEW,
  totalPiezasFabricar: 2032,
  porcentajeAdicional: 7,
  renglones: [
    {
      ...RENGLON,
      piezasFabricar: 2032,
      tallas: [
        { talla: '5-6', piezas: 305, piezasFabricar: 326 },
        { talla: '6-7', piezas: 126, piezasFabricar: 134 },
        { talla: '7-8', piezas: 129, piezasFabricar: 138 },
        { talla: '9-10', piezas: 488, piezasFabricar: 521 },
        { talla: '11-12', piezas: 490, piezasFabricar: 523 },
        { talla: '13-14', piezas: 365, piezasFabricar: 390 },
      ],
      // La OC 620884 trae 3 packs (A/B/C) → 3 renglones-pack (canónicos, suman 2032; per-talla 326-…-390).
      grupos: [
        {
          grupo: 'A',
          tipo: 'PACK',
          packsOriginales: 119,
          packsPropuestos: 127,
          desglose: [
            { talla: '5-6', original: 238, propuesta: 254 },
            { talla: '6-7', original: 119, propuesta: 127 },
            { talla: '7-8', original: 119, propuesta: 127 },
            { talla: '9-10', original: 357, propuesta: 381 },
            { talla: '11-12', original: 357, propuesta: 381 },
            { talla: '13-14', original: 238, propuesta: 254 },
          ],
          advertencia: null,
        },
        {
          grupo: 'B',
          tipo: 'PACK',
          packsOriginales: 57,
          packsPropuestos: 61,
          desglose: [
            { talla: '5-6', original: 57, propuesta: 61 },
            { talla: '6-7', original: 0, propuesta: 0 },
            { talla: '7-8', original: 0, propuesta: 0 },
            { talla: '9-10', original: 114, propuesta: 122 },
            { talla: '11-12', original: 114, propuesta: 122 },
            { talla: '13-14', original: 114, propuesta: 122 },
          ],
          advertencia: null,
        },
        {
          grupo: 'C',
          tipo: 'SKU',
          packsOriginales: 1,
          packsPropuestos: 1,
          desglose: [
            { talla: '5-6', original: 10, propuesta: 11 },
            { talla: '6-7', original: 7, propuesta: 7 },
            { talla: '7-8', original: 10, propuesta: 11 },
            { talla: '9-10', original: 17, propuesta: 18 },
            { talla: '11-12', original: 19, propuesta: 20 },
            { talla: '13-14', original: 13, propuesta: 14 },
          ],
          advertencia: null,
        },
      ],
    },
  ],
};

/** Un PDF sin liga aprendida (Modelo ID desconocido): `sin ligar`, sin sugerencia. */
const PREVIEW_SIN_LIGA: AnalizarPdf = {
  ...PREVIEW,
  totalReconocidos: 0,
  renglones: [
    {
      ...RENGLON,
      idModeloSugerido: null,
      codigoModeloSugerido: null,
      descripcionModeloSugerido: null,
    },
  ],
};

/** Lleva la pantalla del paso 1 (cliente + PDF) al paso 2 (vista previa) con el preview indicado. */
async function irAVistaPrevia(
  preview: AnalizarPdf = PREVIEW,
  permisos: ClavePermiso[] = [],
): Promise<void> {
  analizarMock.mockImplementation((_body, opciones: { onSuccess: (r: AnalizarPdf) => void }) => {
    opciones.onSuccess(preview);
  });
  renderConProveedores(<ImportadorPedidoPdf alCerrar={vi.fn()} alImportado={vi.fn()} />, {
    sesion: estadoSesionDePrueba(permisos),
  });

  // Elige el cliente en el combobox (la opción se elige con mousedown, gana antes del blur).
  fireEvent.change(screen.getByTestId('importador-pdf-cliente-input'), { target: { value: 'C' } });
  fireEvent.mouseDown(await screen.findByTestId('importador-pdf-cliente-opcion'));

  // Carga un PDF.
  fireEvent.change(screen.getByTestId('importador-pdf-archivos'), {
    target: { files: [new File(['x'], 'oc-620884.pdf', { type: 'application/pdf' })] },
  });

  fireEvent.click(screen.getByTestId('importador-pdf-continuar-origen'));
  await screen.findByTestId('importador-pdf-fila');
}

describe('ImportadorPedidoPdf', () => {
  beforeEach(() => {
    analizarMock.mockReset();
    confirmarMock.mockReset();
  });

  it('la vista previa muestra el PDF con su liga aprendida, color y talla nuevos', async () => {
    await irAVistaPrevia();

    // Un renglón con el nº de orden y el modelo del cliente.
    expect(screen.getByText('620884')).toBeInTheDocument();
    expect(screen.getByText('3138277')).toBeInTheDocument();
    // La liga aprendida (sugerida) se marca como tal (no "ligado a mano").
    expect(screen.getByText('liga aprendida')).toBeInTheDocument();
    expect(screen.queryByText('sin ligar')).not.toBeInTheDocument();
    // Color y talla que se crearán se avisan.
    expect(screen.getByText(/\(nuevo\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 talla\(s\) nueva\(s\)/)).toBeInTheDocument();
  });

  it('confirmar dispara el alta con el cliente elegido; los renglones sugeridos no mandan liga manual', async () => {
    await irAVistaPrevia();
    confirmarMock.mockImplementation(() => {});

    fireEvent.click(screen.getByTestId('importador-pdf-confirmar'));

    await waitFor(() => expect(confirmarMock).toHaveBeenCalled());
    const cuerpo = confirmarMock.mock.calls[0]?.[0] as
      | { idCliente: number; ligas: unknown[]; archivos: unknown[] }
      | undefined;
    expect(cuerpo?.idCliente).toBe(1);
    expect(cuerpo?.archivos).toHaveLength(1);
    // La fila sugerida NO se tocó → no manda liga manual; el backend usa la liga aprendida.
    expect(cuerpo?.ligas).toEqual([]);
  });

  it('con sobre-pedido muestra "pedidas → a fabricar" (el renglón conserva lo pedido)', async () => {
    await irAVistaPrevia(PREVIEW_7);

    // El renglón conserva la cantidad PEDIDA por el cliente; la OP propone fabricar 2,032 (por packs).
    expect(screen.getAllByText(/1,903 pz/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/fabricar 2,032 pz/).length).toBeGreaterThan(0);
    // El aviso del % adicional en la vista previa.
    expect(screen.getAllByText(/\+7%/).length).toBeGreaterThan(0);
  });

  it('la matriz es EDITABLE POR PACK y el confirm manda los renglones-pack editados + el pantone', async () => {
    await irAVistaPrevia(PREVIEW_7);
    confirmarMock.mockImplementation(() => {});

    // Abre la matriz por packs (A/B/C) y cambia la talla 5-6 del PACK A (primer renglón) a 300.
    fireEvent.click(screen.getByTestId('importador-pdf-toggle-tallas'));
    const celdaA56 = await screen.findByTestId('importador-pdf-celda-0-5-6');
    fireEvent.change(celdaA56, { target: { value: '300' } });
    // Captura un pantone a mano (aplica a todos los renglones del mismo color).
    fireEvent.change(screen.getByTestId('importador-pdf-pantone-0'), {
      target: { value: '11-0601 TCX' },
    });

    fireEvent.click(screen.getByTestId('importador-pdf-confirmar'));
    await waitFor(() => expect(confirmarMock).toHaveBeenCalled());

    const cuerpo = confirmarMock.mock.calls[0]?.[0] as {
      archivos: {
        matriz: { letra: string | null; tallas: { talla: string; cantidad: number }[] }[];
        pantone: string;
      }[];
    };
    const archivo = cuerpo.archivos[0];
    // 3 renglones-pack (A/B/C); NO se suman en uno.
    expect(archivo?.matriz.map((f) => f.letra)).toEqual(['A', 'B', 'C']);
    const packA = archivo?.matriz.find((f) => f.letra === 'A');
    expect(packA?.tallas).toContainEqual({ talla: '5-6', cantidad: 300 }); // editado en el pack A
    expect(packA?.tallas).toContainEqual({ talla: '6-7', cantidad: 127 }); // propuesto, sin tocar
    // El pack B conserva su corrida propuesta (no se mezcla con A).
    const packB = archivo?.matriz.find((f) => f.letra === 'B');
    expect(packB?.tallas).toContainEqual({ talla: '9-10', cantidad: 122 });
    expect(archivo?.pantone).toBe('11-0601 TCX');
  });

  it('sin permiso modelos.administrar, no ofrece crear un modelo nuevo', async () => {
    await irAVistaPrevia(PREVIEW, []);
    expect(screen.queryByTestId('importador-pdf-crear-modelo')).not.toBeInTheDocument();
  });

  it('con permiso: crear modelo advierte si el Modelo ID ya está ligado, y tras crear lo liga', async () => {
    await irAVistaPrevia(PREVIEW, ['modelos.administrar']);
    // Arranca con la liga aprendida (sugerida) al modelo DEV-1.
    expect(screen.getByText('liga aprendida')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('importador-pdf-crear-modelo'));
    // 3b: advierte (no bloquea) porque el Modelo ID ya está ligado a DEV-1.
    expect(await screen.findByText(/ya está ligado al modelo/i)).toBeInTheDocument();
    expect(screen.getByText('DEV-1')).toBeInTheDocument();

    // Confirma la advertencia → abre el alta prellenada con la descripción de la OC.
    fireEvent.click(screen.getByTestId('confirmar-accion'));
    const stub = await screen.findByTestId('stub-dialogo-modelo');
    expect(within(stub).getByTestId('stub-prefill-desc')).toHaveTextContent(
      'PLAYERA ML SINGLE JERSEY',
    );

    // Simula la creación → el PDF queda LIGADO A MANO al modelo nuevo (ya no "liga aprendida").
    fireEvent.click(screen.getByTestId('stub-crear-modelo'));
    expect(await screen.findByText('ligado a mano')).toBeInTheDocument();
    expect(screen.queryByText('liga aprendida')).not.toBeInTheDocument();
  });

  it('sin liga aprendida, crear modelo abre el alta directo (sin advertencia) y liga al crear', async () => {
    await irAVistaPrevia(PREVIEW_SIN_LIGA, ['modelos.administrar']);
    expect(screen.getByText('sin ligar')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('importador-pdf-crear-modelo'));
    // No hay liga previa → NO advierte; abre el alta directo.
    expect(screen.queryByText(/ya está ligado al modelo/i)).not.toBeInTheDocument();
    expect(await screen.findByTestId('stub-dialogo-modelo')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('stub-crear-modelo'));
    expect(await screen.findByText('ligado a mano')).toBeInTheDocument();
    expect(screen.queryByText('sin ligar')).not.toBeInTheDocument();
  });
});

/**
 * ⭐ V1-E4 punto 1 — la vista previa tiene que GRITAR que esa OC ya se importó. Sin este aviso, el
 * usuario confirma tan campante y nacen el segundo pedido, la segunda OP y su ruta crítica; se
 * descubre semanas después, cortando doble.
 */
describe('ImportadorPedidoPdf — OC ya importada (V1-E4)', () => {
  beforeEach(() => {
    analizarMock.mockReset();
    confirmarMock.mockReset();
  });

  it('marca el renglón con la OP que ya existe y pinta el aviso de duplicado', async () => {
    await irAVistaPrevia({
      ...PREVIEW,
      renglones: [
        {
          ...RENGLON,
          yaImportado: { idOrden: 41, folioOrden: 1207 },
          advertencias: [
            {
              tipo: 'duplicado' as const,
              mensaje: 'La OC 620884 del cliente YA se importó: nació la OP 1207.',
            },
          ],
        },
      ],
    });

    // El chip nombra la OP existente (el usuario tiene que poder ir a verla).
    expect(await screen.findByText(/ya importada · OP 1207/i)).toBeInTheDocument();
    // Y el aviso explica por qué no se va a importar.
    const avisos = screen.getByTestId('importador-pdf-advertencias');
    expect(avisos).toHaveTextContent(/YA se importó/i);
  });

  it('sin duplicado NO aparece el chip (el aviso no se pinta por costumbre)', async () => {
    await irAVistaPrevia();

    expect(screen.queryByText(/ya importada · OP/i)).not.toBeInTheDocument();
  });
});
