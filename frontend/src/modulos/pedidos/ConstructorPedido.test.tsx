import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalizarPdf, ClavePermiso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ConstructorPedido } from './ConstructorPedido';

/**
 * ⭐ §Post-F9.70 punto 1 (V1-E3i) — EL CAMPO «Archivo de la OC» LEE EL PDF.
 *
 * Antes sólo lo adjuntaba: Daniel le subió su OC de C&A esperando que la leyera y el diálogo le
 * siguió pidiendo cantidad y precio a mano — *"ahí está mal, porque la cantidad la tiene el pedido,
 * no debo dárselas yo"*. Ahora el campo lo lee y PROPONE cargarlo con el importador; si no se
 * reconoce, se dice (D3) en vez de tragarse el archivo en silencio.
 */

const analizarMock = vi.fn();

vi.mock('@/api/importacion-pdf', () => ({
  useAnalizarPdf: () => ({
    mutateAsync: (...a: unknown[]) => analizarMock(...a) as Promise<AnalizarPdf>,
    isPending: false,
  }),
}));
vi.mock('@/api/importacion-pedido', () => ({
  archivoABase64: vi.fn(() => Promise.resolve('QkFTRTY0')),
}));
vi.mock('@/api/adjuntos-pedido', () => ({
  useSubirAdjuntoPedido: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [{ id: 7, nombre: 'C&A' }] }, isFetching: false }),
}));
vi.mock('@/api/pedidos', () => ({
  useCrearPedido: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/api/pedidos-mes', () => ({
  useCandidatosDesarrollo: () => ({ data: [], isFetching: false }),
}));

/** Renglón reconocido: la OC real de Daniel (620672) reducida a lo que la propuesta enseña. */
const RENGLON: AnalizarPdf['renglones'][number] = {
  nombreArchivo: 'oc-620672.pdf',
  error: null,
  numeroOrden: '620672',
  modeloCliente: '3138277',
  descripcionArticulo: 'PLAYERA ML',
  division: '3- KIDS',
  subDivision: '',
  idColorCliente: '200',
  colorGenerico: 'BLANCO',
  codigoUnico: '26/4/001435/200',
  semanaCliente: '202646',
  pantone: '',
  costoUnitario: 97,
  piezasTotales: 1744,
  piezasFabricar: 1744,
  montoTotal: 169168,
  fechaEntrega: '2026-11-09',
  tallas: [
    { talla: '5-6', piezas: 436, piezasFabricar: 436 },
    { talla: '6-7', piezas: 436, piezasFabricar: 436 },
    { talla: '7-8', piezas: 436, piezasFabricar: 436 },
    { talla: '9-10', piezas: 436, piezasFabricar: 436 },
  ],
  grupos: [
    {
      grupo: 'A',
      tipo: 'pack',
      packsOriginales: 168,
      packsPropuestos: 180,
      desglose: [],
      advertencia: null,
    },
    {
      grupo: 'B',
      tipo: 'suelto',
      packsOriginales: 0,
      packsPropuestos: 0,
      desglose: [],
      advertencia: null,
    },
  ],
  idModeloSugerido: null,
  codigoModeloSugerido: null,
  descripcionModeloSugerido: null,
  colorNuevo: true,
  tallasNuevas: [],
  advertencias: [],
  yaImportado: null,
};

const PREVIEW: AnalizarPdf = {
  renglones: [RENGLON],
  totalPiezas: 1744,
  totalPiezasFabricar: 1744,
  porcentajeAdicional: 7,
  totalReconocidos: 0,
};

/** Permisos con los que la propuesta SÍ se ofrece (leer el PDF + crear las OPs al confirmar). */
const PERMISOS_IMPORTAR: ClavePermiso[] = ['pedidos.administrar', 'ordenes.administrar'];

const PDF = (): File => new File(['x'], 'oc-620672.pdf', { type: 'application/pdf' });

function pintar({
  permisos = PERMISOS_IMPORTAR,
  alCargar = vi.fn(),
  conCallback = true,
}: {
  permisos?: ClavePermiso[];
  alCargar?: (datos: { archivo: File; idCliente: number }) => void;
  conCallback?: boolean;
} = {}): { alCargar: (datos: { archivo: File; idCliente: number }) => void } {
  renderConProveedores(
    <ConstructorPedido
      alCerrar={vi.fn()}
      alCreado={vi.fn()}
      {...(conCallback ? { alCargarConImportador: alCargar } : {})}
    />,
    { sesion: estadoSesionDePrueba(permisos) },
  );
  return { alCargar };
}

/** Elige el cliente C&A en el combobox del encabezado. */
async function elegirCliente(): Promise<void> {
  fireEvent.change(screen.getByTestId('constructor-cliente-input'), { target: { value: 'C' } });
  fireEvent.mouseDown(await screen.findByTestId('constructor-cliente-opcion'));
}

/** Elige un archivo en el campo "Archivo de la OC". */
function elegirArchivo(archivo: File): void {
  fireEvent.change(screen.getByTestId('constructor-archivo-oc'), { target: { files: [archivo] } });
}

beforeEach(() => {
  analizarMock.mockReset();
  analizarMock.mockResolvedValue(PREVIEW);
});

describe('ConstructorPedido — el archivo de la OC se LEE (§Post-F9.70)', () => {
  it('reconoce la OC y propone cargarla, con lo que encontró (tallas, piezas, packs)', async () => {
    pintar();
    await elegirCliente();
    elegirArchivo(PDF());

    const aviso = await screen.findByTestId('constructor-oc-reconocida');
    expect(aviso).toHaveTextContent(/620672/);
    expect(aviso).toHaveTextContent(/4 talla\(s\)/);
    expect(aviso).toHaveTextContent(/1,744 piezas/);
    expect(aviso).toHaveTextContent(/2 pack\(s\)/);
  });

  it('“Sí, cargar la OC” manda el archivo y el cliente al importador', async () => {
    const alCargar = vi.fn();
    pintar({ alCargar });
    await elegirCliente();
    const archivo = PDF();
    elegirArchivo(archivo);

    fireEvent.click(await screen.findByTestId('constructor-oc-cargar'));
    expect(alCargar).toHaveBeenCalledWith({ archivo, idCliente: 7 });
  });

  it('“No, sólo adjuntarla” deja el archivo como adjunto y no abre nada', async () => {
    const alCargar = vi.fn();
    pintar({ alCargar });
    await elegirCliente();
    elegirArchivo(PDF());

    fireEvent.click(await screen.findByTestId('constructor-oc-descartar'));
    expect(alCargar).not.toHaveBeenCalled();
    expect(screen.queryByTestId('constructor-oc-reconocida')).toBeNull();
    expect(screen.getByTestId('constructor-oc-nota')).toHaveTextContent(/adjunto/i);
  });

  it('si el PDF NO se reconoce lo dice con su motivo (D3), y no ofrece cargarlo', async () => {
    analizarMock.mockResolvedValue({
      ...PREVIEW,
      renglones: [{ ...RENGLON, error: 'El PDF no tiene el formato de C&A.' }],
    });
    pintar();
    await elegirCliente();
    elegirArchivo(PDF());

    const nota = await screen.findByTestId('constructor-oc-nota');
    expect(nota).toHaveTextContent(/adjunto/i);
    expect(nota).toHaveTextContent(/no tiene el formato de C&A/i);
    expect(screen.queryByTestId('constructor-oc-cargar')).toBeNull();
  });

  it('si no se pudo ni revisar, lo dice y NO afirma que el archivo esté mal', async () => {
    analizarMock.mockRejectedValue(new Error('Failed to fetch'));
    pintar();
    await elegirCliente();
    elegirArchivo(PDF());

    const nota = await screen.findByTestId('constructor-oc-nota');
    expect(nota).toHaveTextContent(/No se pudo revisar el archivo/i);
    expect(nota).toHaveTextContent(/Failed to fetch/);
  });

  it('sin cliente todavía no lee (el reconocimiento es POR cliente) y lo dice; al elegirlo, lee', async () => {
    pintar();
    elegirArchivo(PDF());

    expect(await screen.findByTestId('constructor-oc-nota')).toHaveTextContent(/Elige el cliente/i);
    expect(analizarMock).not.toHaveBeenCalled();

    await elegirCliente();
    await screen.findByTestId('constructor-oc-reconocida');
    expect(analizarMock).toHaveBeenCalledTimes(1);
  });

  it('un archivo que no es PDF se adjunta tal cual, sin molestar al servidor', async () => {
    pintar();
    await elegirCliente();
    elegirArchivo(new File(['x'], 'nota.docx'));

    expect(await screen.findByTestId('constructor-oc-nota')).toHaveTextContent(
      /sólo se leen las órdenes de compra en PDF/i,
    );
    expect(analizarMock).not.toHaveBeenCalled();
  });

  it('§Post-F9.68: sin permiso para importar, ni se lee ni se pinta la propuesta', async () => {
    pintar({ permisos: ['pedidos.administrar'] });
    await elegirCliente();
    elegirArchivo(PDF());

    await waitFor(() => {
      expect(screen.getByTestId('constructor-archivo-oc')).toBeInTheDocument();
    });
    expect(analizarMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('constructor-lectura-oc')).toBeNull();
  });

  it('sin la pantalla que sabe cargarla (sin callback), el campo se comporta como siempre', async () => {
    pintar({ conCallback: false });
    await elegirCliente();
    elegirArchivo(PDF());

    await waitFor(() => {
      expect(screen.getByTestId('constructor-archivo-oc')).toBeInTheDocument();
    });
    expect(analizarMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('constructor-lectura-oc')).toBeNull();
  });
});
