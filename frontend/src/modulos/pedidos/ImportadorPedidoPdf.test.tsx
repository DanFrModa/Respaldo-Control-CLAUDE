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
/**
 * ⚠️ El % adicional del cliente (§Post-F9.2: C&A = 7) llega POR RED desde la plantilla vigente.
 * Antes este mock devolvía SIEMPRE `undefined`, así que en ninguna prueba el % podía ser distinto de
 * 0 — y el defecto de mandar un 0 que le gana a la plantilla del cliente era **inalcanzable para la
 * suite**. Ahora se configura por prueba: un escenario que no puede fallar no prueba nada.
 */
const plantillaMock = vi.fn();
const toastErrorMock = vi.fn();

/**
 * Configura la plantilla vigente POR CLIENTE (`{ idCliente: porcentaje }`). Que dependa del
 * argumento no es un adorno: con un mock que contesta lo mismo para todos, "el % del cliente
 * anterior se pega al siguiente" es INEXPRESABLE — y un escenario que no puede ocurrir no prueba
 * nada. Con `idCliente` null la consulta real ni corre (`enabled: false`), así que aquí tampoco hay
 * datos.
 */
function conPlantillaPorCliente(porcentajes: Record<number, number>): void {
  plantillaMock.mockImplementation((idCliente: number | null) => {
    const pct = idCliente === null ? undefined : porcentajes[idCliente];
    return {
      data: pct === undefined ? undefined : { plantilla: { porcentajeAdicional: pct } },
      isFetching: false,
    };
  });
}

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
  usePlantillaVigente: (idCliente: number | null) => plantillaMock(idCliente) as unknown,
}));
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => {
      toastErrorMock(...a);
    },
    success: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({
    data: {
      datos: [
        { id: 1, nombre: 'C&A' },
        { id: 2, nombre: 'Zapatería Norte' },
      ],
    },
    isFetching: false,
  }),
}));
let queryModelos: Record<string, unknown> | undefined;
vi.mock('@/api/modelos', () => ({
  useModelos: (query: Record<string, unknown>) => {
    queryModelos = query;
    return {
      data: { datos: [{ id: 42, codigo: 'DEV-1', descripcion: 'Playera' }] },
      isFetching: false,
    };
  },
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
  colorFusionadoEn: null,
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
    toastErrorMock.mockReset();
    plantillaMock.mockReset();
    plantillaMock.mockReturnValue({ data: undefined, isFetching: false });
  });

  /**
   * V1-E3n: la liga MANUAL de la vista previa busca modelos por texto. La primera OC de un modelo
   * que sigue en DESARROLLO es exactamente el caso que hay que poder ligar, y el default del API
   * (`produccion`) lo escondería.
   */
  it('el buscador de la liga manual pide los DOS catálogos (origen: todos)', async () => {
    await irAVistaPrevia();
    expect(queryModelos?.origen).toBe('todos');
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
    // El CABLE sigue llevando los 3 renglones-pack (A/B/C) tal como el usuario los editó: la suma en
    // el renglón por tendido lo arma el BACKEND al persistir (§Post-F9.10), no el navegador.
    expect(archivo?.matriz.map((f) => f.letra)).toEqual(['A', 'B', 'C']);
    const packA = archivo?.matriz.find((f) => f.letra === 'A');
    expect(packA?.tallas).toContainEqual({ talla: '5-6', cantidad: 300 }); // editado en el pack A
    expect(packA?.tallas).toContainEqual({ talla: '6-7', cantidad: 127 }); // propuesto, sin tocar
    // El pack B conserva su corrida propuesta (no se mezcla con A).
    const packB = archivo?.matriz.find((f) => f.letra === 'B');
    expect(packB?.tallas).toContainEqual({ talla: '9-10', cantidad: 122 });
    expect(archivo?.pantone).toBe('11-0601 TCX');
  });

  it('la previa etiqueta PACKS (no colores) y el total dice el color que va a quedar en la OP', async () => {
    await irAVistaPrevia(PREVIEW_7);
    fireEvent.click(screen.getByTestId('importador-pdf-toggle-tallas'));
    await screen.findByTestId('importador-pdf-matriz');

    // ⭐ §Post-F9.129: los renglones son PACKS, no colores. "Blanco A"/"Blanco B" ya NO existen —
    // eran colores de catálogo que partían las compras de una misma orden.
    expect(screen.getByText('Pack A')).toBeInTheDocument();
    expect(screen.getByText('Pack B')).toBeInTheDocument();
    expect(screen.queryByText(/Blanco A/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Blanco B/)).not.toBeInTheDocument();

    // El renglón de totales es la SUMA del color, para cotejar contra el papel — ya no "el renglón
    // de la OP": desde §Post-F9.10 la OP lleva un renglón POR PACK, todos del mismo color.
    expect(screen.getByText(/Total a fabricar · Blanco/)).toBeInTheDocument();
    expect(screen.getByTestId('importador-pdf-nota-packs')).toHaveTextContent(
      /un renglón por pack/i,
    );
    expect(screen.getByTestId('importador-pdf-nota-packs')).toHaveTextContent(/mismo color/i);
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
    toastErrorMock.mockReset();
    plantillaMock.mockReset();
    plantillaMock.mockReturnValue({ data: undefined, isFetching: false });
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

/**
 * 🔴🔴 El color del papel lo absorbió una FUSIÓN: la OP va a nacer en OTRO color, con OTRO nombre —
 * y la cadena de precio casa POR NOMBRE, así que el precosto puede salir de otro renglón. Antes la
 * previa no lo marcaba ni lo advertía y el desvío sólo constaba en la bitácora, DESPUÉS de
 * confirmar: lo que se veía era un precio que no cuadraba con el papel del cliente, sin explicación.
 */
describe('ImportadorPedidoPdf — color desviado por una fusión', () => {
  beforeEach(() => {
    analizarMock.mockReset();
    confirmarMock.mockReset();
    toastErrorMock.mockReset();
    plantillaMock.mockReset();
    plantillaMock.mockReturnValue({ data: undefined, isFetching: false });
  });

  it('marca junto al color a dónde va a ir de verdad, y pinta el aviso', async () => {
    await irAVistaPrevia({
      ...PREVIEW,
      renglones: [
        {
          ...RENGLON,
          colorNuevo: false,
          colorFusionadoEn: 'Blanco Optico',
          advertencias: [
            {
              tipo: 'color-fusionado' as const,
              mensaje:
                'El color "BLANCO" del papel lo absorbió una fusión: la OP va a nacer en "Blanco Optico".',
            },
          ],
        },
      ],
    });

    // La marca va PEGADA al color, que es la línea que deja de ser cierta.
    expect(await screen.findByTestId('importador-pdf-color-fusionado-0')).toHaveTextContent(
      'Blanco Optico',
    );
    const avisos = screen.getByTestId('importador-pdf-advertencias');
    expect(avisos).toHaveTextContent(/absorbió una fusión/i);
  });

  it('⚠️ sin desvío NO aparece la marca (el color del papel es el que queda)', async () => {
    // `RENGLON` trae `colorFusionadoEn: null` — el caso normal. Si la marca se pintara por
    // costumbre (o atada a `colorNuevo`, que aquí sí es true), esta prueba se cae.
    await irAVistaPrevia();

    expect(screen.queryByTestId('importador-pdf-color-fusionado-0')).not.toBeInTheDocument();
    expect(screen.queryByText(/Blanco Optico/)).not.toBeInTheDocument();
  });
});

/**
 * ⭐ §Post-F9.70 punto 3 (V1-E3i) — EL BOTÓN MUDO. «Generar pedido interno + OPs» sólo enciende con
 * al menos un renglón ligado, y en la PRIMERA OC de un modelo esa liga no existe todavía porque se
 * aprende. Deshabilitado y sin explicación, la pantalla ofrecía una puerta sin decir por qué no
 * abre.
 */
describe('ImportadorPedidoPdf — el botón deshabilitado dice QUÉ falta (§Post-F9.70)', () => {
  beforeEach(() => {
    analizarMock.mockReset();
    confirmarMock.mockReset();
    toastErrorMock.mockReset();
    plantillaMock.mockReset();
    plantillaMock.mockReturnValue({ data: undefined, isFetching: false });
  });

  it('sin ninguna liga: el botón está apagado y la pantalla dice qué falta y cuántos', async () => {
    await irAVistaPrevia(PREVIEW_SIN_LIGA);

    expect(screen.getByTestId('importador-pdf-confirmar')).toBeDisabled();
    const motivo = screen.getByTestId('importador-pdf-motivo-bloqueo');
    expect(motivo).toHaveTextContent(/Falta ligar 1 de 1 renglón/i);
    expect(motivo).toHaveTextContent(/Liga a nuestro modelo/i);
  });

  it('con la liga aprendida el botón abre y NO se pinta ningún motivo (gemela positiva)', async () => {
    await irAVistaPrevia();

    expect(screen.getByTestId('importador-pdf-confirmar')).toBeEnabled();
    expect(screen.queryByTestId('importador-pdf-motivo-bloqueo')).toBeNull();
  });

  it('cuando el PDF ni se pudo leer, el motivo es ése y no "falta ligar"', async () => {
    await irAVistaPrevia({
      ...PREVIEW,
      totalReconocidos: 0,
      renglones: [{ ...RENGLON, error: 'El PDF no tiene el formato de C&A.' }],
    });

    const motivo = screen.getByTestId('importador-pdf-motivo-bloqueo');
    expect(motivo).toHaveTextContent(/no se pudo leer/i);
    expect(motivo).not.toHaveTextContent(/Falta ligar/i);
  });
});

/**
 * ⭐ §Post-F9.70 punto 1 (V1-E3i) — ENTRADA DESDE EL PEDIDO. Cuando el constructor reconoce la OC y
 * el usuario dice "sí, cárgala", este importador se abre YA cargado: mismo cliente, mismo archivo, y
 * sin cobrarle otro clic por una decisión que ya tomó.
 */
describe('ImportadorPedidoPdf — abierto desde el constructor con el PDF ya elegido', () => {
  beforeEach(() => {
    analizarMock.mockReset();
    confirmarMock.mockReset();
    toastErrorMock.mockReset();
    plantillaMock.mockReset();
    plantillaMock.mockReturnValue({ data: undefined, isFetching: false });
  });

  it('analiza solo al montarse (sin pulsar Continuar) y con el cliente que trae', async () => {
    analizarMock.mockImplementation((_body, opciones: { onSuccess: (r: AnalizarPdf) => void }) => {
      opciones.onSuccess(PREVIEW);
    });
    renderConProveedores(
      <ImportadorPedidoPdf
        alCerrar={vi.fn()}
        alImportado={vi.fn()}
        idClienteInicial={1}
        archivosIniciales={[new File(['x'], 'oc-620884.pdf', { type: 'application/pdf' })]}
      />,
      { sesion: estadoSesionDePrueba([]) },
    );

    await screen.findByTestId('importador-pdf-fila');
    expect(analizarMock).toHaveBeenCalledTimes(1);
    expect(analizarMock.mock.calls[0]?.[0]).toMatchObject({ idCliente: 1 });
  });

  it('sin precarga NO analiza solo (el asistente normal espera al usuario)', async () => {
    analizarMock.mockImplementation((_body, opciones: { onSuccess: (r: AnalizarPdf) => void }) => {
      opciones.onSuccess(PREVIEW);
    });
    renderConProveedores(<ImportadorPedidoPdf alCerrar={vi.fn()} alImportado={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });

    await waitFor(() => {
      expect(screen.getByTestId('importador-pdf-continuar-origen')).toBeInTheDocument();
    });
    expect(analizarMock).not.toHaveBeenCalled();
    // Y no sólo "no analiza": tampoco le grita al usuario. Sin el guardia, el arranque automático
    // corre igual y el asistente normal abre con un "Elige el cliente del pedido." en la cara.
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  /**
   * 🔴 EL DEFECTO QUE ESTA ETAPA VINO A CERRAR, POR LA PUERTA NUEVA (§Post-F9.70 puntos 1 y 2).
   * El arranque automático analizaba con el `pct` del primer render (0), y en el backend
   * `datos.porcentajeAdicional ?? config.porcentajeAdicional` hace que ese 0 explícito le GANE a la
   * plantilla del cliente: la OC de 1,744 pzas se proponía con 1,744 en vez de 1,866.
   */
  it('🔴 NO impone un 0%: deja que mande el % del cliente (C&A = 7)', async () => {
    conPlantillaPorCliente({ 1: 7 });
    analizarMock.mockImplementation((_body, opciones: { onSuccess: (r: AnalizarPdf) => void }) => {
      opciones.onSuccess(PREVIEW);
    });
    renderConProveedores(
      <ImportadorPedidoPdf
        alCerrar={vi.fn()}
        alImportado={vi.fn()}
        idClienteInicial={1}
        archivosIniciales={[new File(['x'], 'oc-620672.pdf', { type: 'application/pdf' })]}
      />,
      { sesion: estadoSesionDePrueba([]) },
    );

    await screen.findByTestId('importador-pdf-fila');
    const cuerpo = analizarMock.mock.calls[0]?.[0] as { porcentajeAdicional?: number };
    // Ni 0 ni ningún número: el campo NO viaja, y el backend aplica el de la plantilla.
    expect(cuerpo.porcentajeAdicional).toBeUndefined();
    expect(cuerpo).not.toHaveProperty('porcentajeAdicional');
  });

  it('el % que YA está en pantalla sí viaja (gemela positiva del camino manual)', async () => {
    conPlantillaPorCliente({ 1: 7 });
    await irAVistaPrevia();

    const cuerpo = analizarMock.mock.calls[0]?.[0] as { porcentajeAdicional?: number };
    expect(cuerpo.porcentajeAdicional).toBe(7);
  });

  /**
   * El backend RECUERDA el % que recibe al confirmar (`guardarPlantilla`, versión nueva): mandar un
   * 0 de arranque no sólo produce una OP corta — BORRA el 7% sembrado del cliente para siempre.
   * Escenario: el % del cliente todavía no llegó (la consulta va por red) y el usuario confirma.
   */
  it('🔴 al confirmar SIN el % del cliente cargado, no manda un 0 (borraría el 7% del cliente)', async () => {
    plantillaMock.mockReturnValue({ data: undefined, isFetching: true });
    analizarMock.mockImplementation((_body, opciones: { onSuccess: (r: AnalizarPdf) => void }) => {
      opciones.onSuccess(PREVIEW);
    });
    renderConProveedores(
      <ImportadorPedidoPdf
        alCerrar={vi.fn()}
        alImportado={vi.fn()}
        idClienteInicial={1}
        archivosIniciales={[new File(['x'], 'oc-620672.pdf', { type: 'application/pdf' })]}
      />,
      { sesion: estadoSesionDePrueba([]) },
    );
    await screen.findByTestId('importador-pdf-fila');
    fireEvent.click(screen.getByTestId('importador-pdf-confirmar'));

    await waitFor(() => expect(confirmarMock).toHaveBeenCalled());
    const cuerpo = confirmarMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(cuerpo).not.toHaveProperty('porcentajeAdicional');
  });

  /**
   * El mismo "0 no es vacío", pero del lado del usuario: BORRAR el campo del paso 1 significa
   * *"usa el del cliente"*, no *"cero por ciento"*. Si el vacío se convirtiera en 0, quien limpia el
   * campo estaría anulando en silencio el 7% de C&A.
   */
  it('vaciar el % del paso 1 devuelve la decisión al cliente; escribir 0 sí es un cero explícito', async () => {
    conPlantillaPorCliente({ 1: 7 });
    analizarMock.mockImplementation((_body, opciones: { onSuccess: (r: AnalizarPdf) => void }) => {
      opciones.onSuccess(PREVIEW);
    });
    renderConProveedores(<ImportadorPedidoPdf alCerrar={vi.fn()} alImportado={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });
    fireEvent.change(screen.getByTestId('importador-pdf-cliente-input'), {
      target: { value: 'C' },
    });
    fireEvent.mouseDown(await screen.findByTestId('importador-pdf-cliente-opcion'));
    fireEvent.change(screen.getByTestId('importador-pdf-archivos'), {
      target: { files: [new File(['x'], 'oc-620884.pdf', { type: 'application/pdf' })] },
    });
    // El campo llega con el 7 del cliente…
    expect(screen.getByTestId('importador-pdf-pct')).toHaveValue(7);
    // …y vaciarlo NO es escribir un cero.
    fireEvent.change(screen.getByTestId('importador-pdf-pct'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('importador-pdf-continuar-origen'));
    await screen.findByTestId('importador-pdf-fila');
    expect(analizarMock.mock.calls[0]?.[0] as Record<string, unknown>).not.toHaveProperty(
      'porcentajeAdicional',
    );
  });

  /**
   * 🔴 EL % DEL CLIENTE ANTERIOR NO SE PEGA AL SIGUIENTE. El efecto que pre-carga el % sólo escribe
   * cuando el cliente TIENE plantilla (para no pisar lo que la persona tecleó al refrescarse la
   * consulta), así que por sí solo no puede devolver `pct` a "sin opinión": cambiar de C&A (7%) a un
   * cliente sin plantilla dejaba el 7 pegado — y al confirmar, el backend le CREABA a ese cliente
   * una plantilla vigente al 7% con los campos variables de C&A. Silencioso y permanente.
   */
  it('🔴 cambiar de cliente devuelve la decisión del % al cliente nuevo (no arrastra el 7 de C&A)', async () => {
    conPlantillaPorCliente({ 1: 7 }); // el 2 (Zapatería Norte) no tiene plantilla
    analizarMock.mockImplementation((_body, opciones: { onSuccess: (r: AnalizarPdf) => void }) => {
      opciones.onSuccess(PREVIEW);
    });
    renderConProveedores(<ImportadorPedidoPdf alCerrar={vi.fn()} alImportado={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });

    // 1) C&A: su 7% se pre-carga en el campo.
    fireEvent.change(screen.getByTestId('importador-pdf-cliente-input'), {
      target: { value: 'C' },
    });
    fireEvent.mouseDown(await screen.findByTestId('importador-pdf-cliente-opcion'));
    await waitFor(() => expect(screen.getByTestId('importador-pdf-pct')).toHaveValue(7));

    // 2) Era otro cliente: se cambia.
    fireEvent.change(screen.getByTestId('importador-pdf-cliente-input'), {
      target: { value: 'Zap' },
    });
    fireEvent.mouseDown(await screen.findByTestId('importador-pdf-cliente-opcion'));
    await waitFor(() => expect(screen.getByTestId('importador-pdf-pct')).toHaveValue(null));

    fireEvent.change(screen.getByTestId('importador-pdf-archivos'), {
      target: { files: [new File(['x'], 'oc.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByTestId('importador-pdf-continuar-origen'));
    await screen.findByTestId('importador-pdf-fila');

    const cuerpo = analizarMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(cuerpo.idCliente).toBe(2);
    expect(cuerpo).not.toHaveProperty('porcentajeAdicional');
  });

  it('volver a elegir al MISMO cliente no borra lo que la persona tecleó (gemela)', async () => {
    conPlantillaPorCliente({ 1: 7 });
    analizarMock.mockImplementation((_body, opciones: { onSuccess: (r: AnalizarPdf) => void }) => {
      opciones.onSuccess(PREVIEW);
    });
    renderConProveedores(<ImportadorPedidoPdf alCerrar={vi.fn()} alImportado={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });
    fireEvent.change(screen.getByTestId('importador-pdf-cliente-input'), {
      target: { value: 'C' },
    });
    fireEvent.mouseDown(await screen.findByTestId('importador-pdf-cliente-opcion'));
    await waitFor(() => expect(screen.getByTestId('importador-pdf-pct')).toHaveValue(7));

    fireEvent.change(screen.getByTestId('importador-pdf-pct'), { target: { value: '3' } });
    // Re-elige al mismo cliente (abrir el combo y confirmar la opción no es cambiar de cliente).
    fireEvent.change(screen.getByTestId('importador-pdf-cliente-input'), {
      target: { value: 'C' },
    });
    fireEvent.mouseDown(await screen.findByTestId('importador-pdf-cliente-opcion'));
    expect(screen.getByTestId('importador-pdf-pct')).toHaveValue(3);

    fireEvent.change(screen.getByTestId('importador-pdf-archivos'), {
      target: { files: [new File(['x'], 'oc.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByTestId('importador-pdf-continuar-origen'));
    await screen.findByTestId('importador-pdf-fila');
    const cuerpo = analizarMock.mock.calls[0]?.[0] as { porcentajeAdicional?: number };
    expect(cuerpo.porcentajeAdicional).toBe(3);
  });

  /**
   * La otra mitad de la regla: el guardia `if (pctGuardado !== null)` está para que un refresco de la
   * consulta NO pise lo que la persona tecleó. Sin prueba, es un `if` que alguien "simplifica" — y
   * entonces un refetch que llega sin datos borra el % en plena captura.
   */
  it('un refresco de la consulta que llega SIN datos no borra lo que la persona tecleó', async () => {
    conPlantillaPorCliente({ 1: 7 });
    renderConProveedores(<ImportadorPedidoPdf alCerrar={vi.fn()} alImportado={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });
    fireEvent.change(screen.getByTestId('importador-pdf-cliente-input'), {
      target: { value: 'C' },
    });
    fireEvent.mouseDown(await screen.findByTestId('importador-pdf-cliente-opcion'));
    await waitFor(() => expect(screen.getByTestId('importador-pdf-pct')).toHaveValue(7));
    fireEvent.change(screen.getByTestId('importador-pdf-pct'), { target: { value: '3' } });

    // La consulta deja de tener datos (refetch en curso / error) y algo re-renderiza la pantalla.
    conPlantillaPorCliente({});
    fireEvent.change(screen.getByTestId('importador-pdf-referencia'), {
      target: { value: 'REM-1' },
    });

    expect(screen.getByTestId('importador-pdf-pct')).toHaveValue(3);
  });

  it('sin opinión, el campo se VE vacío con su placeholder (0 no es vacío, tampoco en pantalla)', async () => {
    conPlantillaPorCliente({}); // ningún cliente tiene plantilla
    renderConProveedores(<ImportadorPedidoPdf alCerrar={vi.fn()} alImportado={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });
    fireEvent.change(screen.getByTestId('importador-pdf-cliente-input'), {
      target: { value: 'C' },
    });
    fireEvent.mouseDown(await screen.findByTestId('importador-pdf-cliente-opcion'));

    const campo = screen.getByTestId('importador-pdf-pct');
    // Pintar un 0 sería MENTIR sobre lo que se va a aplicar (el que manda es el % del cliente).
    expect(campo).toHaveValue(null);
    expect(campo).toHaveAttribute('placeholder', 'el del cliente');
  });

  it('un 0 ESCRITO por una persona sí es una decisión y viaja como tal (gemela)', async () => {
    conPlantillaPorCliente({ 1: 7 });
    analizarMock.mockImplementation((_body, opciones: { onSuccess: (r: AnalizarPdf) => void }) => {
      opciones.onSuccess(PREVIEW);
    });
    renderConProveedores(<ImportadorPedidoPdf alCerrar={vi.fn()} alImportado={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });
    fireEvent.change(screen.getByTestId('importador-pdf-cliente-input'), {
      target: { value: 'C' },
    });
    fireEvent.mouseDown(await screen.findByTestId('importador-pdf-cliente-opcion'));
    fireEvent.change(screen.getByTestId('importador-pdf-archivos'), {
      target: { files: [new File(['x'], 'oc-620884.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.change(screen.getByTestId('importador-pdf-pct'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('importador-pdf-continuar-origen'));

    await screen.findByTestId('importador-pdf-fila');
    const cuerpo = analizarMock.mock.calls[0]?.[0] as { porcentajeAdicional?: number };
    expect(cuerpo.porcentajeAdicional).toBe(0);
  });

  it('con el % del cliente ya cargado, confirmar SÍ lo manda (gemela positiva)', async () => {
    conPlantillaPorCliente({ 1: 7 });
    analizarMock.mockImplementation((_body, opciones: { onSuccess: (r: AnalizarPdf) => void }) => {
      opciones.onSuccess(PREVIEW);
    });
    renderConProveedores(
      <ImportadorPedidoPdf
        alCerrar={vi.fn()}
        alImportado={vi.fn()}
        idClienteInicial={1}
        archivosIniciales={[new File(['x'], 'oc-620672.pdf', { type: 'application/pdf' })]}
      />,
      { sesion: estadoSesionDePrueba([]) },
    );
    await screen.findByTestId('importador-pdf-fila');
    fireEvent.click(screen.getByTestId('importador-pdf-confirmar'));

    await waitFor(() => expect(confirmarMock).toHaveBeenCalled());
    const cuerpo = confirmarMock.mock.calls[0]?.[0] as { porcentajeAdicional?: number };
    expect(cuerpo.porcentajeAdicional).toBe(7);
  });
});
