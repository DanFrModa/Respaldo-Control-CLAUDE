import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Modelo, ModeloCodigosBarra, ModelosPagina } from '@/api/modelos';
import { ErrorDeApi } from '@/api/errores';
import { renderConProveedores } from '@/pruebas/utilidades';

import { CodigosBarraPagina } from './CodigosBarraPagina';

/**
 * Pruebas de componente del Generador de códigos de barra (F1-E5) con la capa de datos y el
 * dibujo de bwip-js SIMULADOS. Cubre: elegir un modelo y ver su EAN-13/DUN-14 (números
 * legibles), el caso EMPRESA-SIN-UPC mostrando el mensaje legible (no un crash), y que el botón
 * de PDF dispare la generación (sin abrir el renderer real).
 */

/** Forma mínima de un estado de consulta de TanStack Query usado por estas pruebas. */
interface EstadoConsultaPrueba<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
}

const useModelos = vi.fn<(q: unknown) => EstadoConsultaPrueba<ModelosPagina>>();
const useCodigosBarraModelo =
  vi.fn<(id: number | undefined) => EstadoConsultaPrueba<ModeloCodigosBarra>>();

vi.mock('@/api/modelos', () => ({
  useModelos: (q: unknown) => useModelos(q),
  useCodigosBarraModelo: (id: number | undefined) => useCodigosBarraModelo(id),
}));

// El dibujo en canvas (bwip-js) no aporta a la lógica de la pantalla y jsdom no implementa
// canvas 2D completo: se simula para probar el flujo, no el render de las barras.
vi.mock('./CodigoBarraCanvas', () => ({
  CodigoBarraCanvas: ({ valor, etiqueta }: { valor: string; etiqueta: string }) => (
    <div data-testid="canvas-mock" aria-label={etiqueta}>
      {valor}
    </div>
  ),
}));

const generarPdfBlob = vi.fn(() => Promise.resolve(new Blob(['pdf'], { type: 'application/pdf' })));
vi.mock('@react-pdf/renderer', () => ({
  pdf: () => ({ toBlob: generarPdfBlob }),
  // Componentes usados por EtiquetaPdf (no se renderizan en estas pruebas, pero el import existe).
  Document: () => null,
  Page: () => null,
  View: () => null,
  Text: () => null,
  Image: () => null,
  StyleSheet: { create: (e: unknown) => e },
}));

function modelo(id: number, codigo: string, descripcion: string | null = null): Modelo {
  return {
    id,
    codigo,
    descripcion,
    maquilaBase: null,
    idTemporada: null,
    temporada: null,
    idCurvaTalla: null,
    curvaTalla: null,
    idGenero: null,
    genero: null,
    cantidadFotos: 0,
    urlFotoPrincipal: null,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function paginaModelos(datos: Modelo[]): ModelosPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 8, totalPaginas: 1 };
}

const CODIGOS_OK: ModeloCodigosBarra = {
  idModelo: 1,
  codigoModelo: '00501',
  idEmpresa: 8,
  nombreEmpresa: 'FR Moda',
  prefijo: '7500092',
  base12: '750009200501',
  ean13: '7500092005011',
  dun14: '17500092005018',
};

function estadoConsulta<T>(
  parcial: Partial<{ data: T; isPending: boolean; isError: boolean; error: ErrorDeApi | null }>,
): EstadoConsultaPrueba<T> {
  return {
    data: parcial.data,
    isPending: parcial.isPending ?? false,
    isError: parcial.isError ?? false,
    isFetching: false,
    error: parcial.error ?? null,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Por defecto: hay un modelo en la lista; los códigos se mockean por prueba.
  useModelos.mockReturnValue(
    estadoConsulta({ data: paginaModelos([modelo(1, '00501', 'Sudadera')]) }),
  );
  useCodigosBarraModelo.mockReturnValue(estadoConsulta<ModeloCodigosBarra>({}));
});

describe('<CodigosBarraPagina>', () => {
  it('al elegir un modelo muestra el EAN-13 y el DUN-14 legibles', async () => {
    useCodigosBarraModelo.mockReturnValue(estadoConsulta({ data: CODIGOS_OK }));
    renderConProveedores(<CodigosBarraPagina />);

    await userEvent.click(screen.getByTestId('opcion-modelo'));

    expect(screen.getByTestId('texto-ean13')).toHaveTextContent('7500092005011');
    expect(screen.getByTestId('texto-dun14')).toHaveTextContent('17500092005018');
    // Los dos canvases (mockeados) recibieron los valores correctos.
    const canvases = screen.getAllByTestId('canvas-mock');
    expect(canvases.map((c) => c.textContent)).toEqual(['7500092005011', '17500092005018']);
  });

  it('muestra el mensaje legible cuando la empresa no tiene UPC (no crashea)', async () => {
    useCodigosBarraModelo.mockReturnValue(
      estadoConsulta({
        isError: true,
        error: new ErrorDeApi({
          codigo: 'VALIDACION',
          mensaje:
            'La empresa activa no tiene capturado su prefijo UPC. Captúralo en Administración → Empresas para poder generar códigos de barra.',
        }),
      }),
    );
    renderConProveedores(<CodigosBarraPagina />);

    await userEvent.click(screen.getByTestId('opcion-modelo'));

    const error = screen.getByTestId('error-codigos');
    expect(error).toHaveTextContent(/prefijo UPC/i);
    expect(screen.queryByTestId('texto-ean13')).not.toBeInTheDocument();
  });

  it('el boton de PDF genera el blob de la etiqueta', async () => {
    useCodigosBarraModelo.mockReturnValue(estadoConsulta({ data: CODIGOS_OK }));
    // jsdom no implementa estos en todas las versiones: se evita romper la descarga.
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    renderConProveedores(<CodigosBarraPagina />);

    await userEvent.click(screen.getByTestId('opcion-modelo'));
    await userEvent.click(screen.getByTestId('descargar-pdf'));

    await waitFor(() => expect(generarPdfBlob).toHaveBeenCalledTimes(1));
  });

  it('sin modelo elegido invita a elegir uno', () => {
    renderConProveedores(<CodigosBarraPagina />);
    expect(screen.getByText(/elige un modelo/i)).toBeInTheDocument();
  });
});
