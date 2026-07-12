import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalizarPdf } from '@/api/tipos';
import { renderConProveedores } from '@/pruebas/utilidades';

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
      grupos: [
        {
          grupo: 'A',
          tipo: 'PACK',
          packsOriginales: 119,
          packsPropuestos: 127,
          desglose: [
            { talla: '5-6', original: 238, propuesta: 254 },
            { talla: '13-14', original: 238, propuesta: 254 },
          ],
          advertencia: null,
        },
      ],
    },
  ],
};

/** Lleva la pantalla del paso 1 (cliente + PDF) al paso 2 (vista previa) con el preview indicado. */
async function irAVistaPrevia(preview: AnalizarPdf = PREVIEW): Promise<void> {
  analizarMock.mockImplementation((_body, opciones: { onSuccess: (r: AnalizarPdf) => void }) => {
    opciones.onSuccess(preview);
  });
  renderConProveedores(<ImportadorPedidoPdf alCerrar={vi.fn()} alImportado={vi.fn()} />);

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

  it('la matriz es EDITABLE y el confirm manda los totales editados + el pantone', async () => {
    await irAVistaPrevia(PREVIEW_7);
    confirmarMock.mockImplementation(() => {});

    // Abre el desglose de la fila (matriz editable) y cambia el total a fabricar de la talla 5-6.
    fireEvent.click(screen.getByTestId('importador-pdf-toggle-tallas'));
    const celda = await screen.findByTestId('importador-pdf-celda-5-6');
    fireEvent.change(celda, { target: { value: '300' } });
    // Captura un pantone a mano.
    fireEvent.change(screen.getByTestId('importador-pdf-pantone-0'), {
      target: { value: '11-0601 TCX' },
    });

    fireEvent.click(screen.getByTestId('importador-pdf-confirmar'));
    await waitFor(() => expect(confirmarMock).toHaveBeenCalled());

    const cuerpo = confirmarMock.mock.calls[0]?.[0] as {
      archivos: { matriz: { talla: string; cantidad: number }[]; pantone: string }[];
    };
    const archivo = cuerpo.archivos[0];
    expect(archivo?.matriz).toContainEqual({ talla: '5-6', cantidad: 300 }); // el total editado
    expect(archivo?.matriz).toContainEqual({ talla: '6-7', cantidad: 134 }); // el propuesto, sin tocar
    expect(archivo?.pantone).toBe('11-0601 TCX');
  });
});
