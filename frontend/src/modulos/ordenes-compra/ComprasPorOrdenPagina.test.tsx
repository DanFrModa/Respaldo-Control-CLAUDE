import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ComprasPorOrdenPagina } from './ComprasPorOrdenPagina';
import { ocDePrueba } from './fixtures';

const useOrdenesCompraMock = vi.fn();
const useConsultaOrdenesMock = vi.fn();

vi.mock('@/api/ordenes-compra', () => ({
  useOrdenesCompra: (q: unknown) => useOrdenesCompraMock(q) as unknown,
  imprimirOc: vi.fn(),
}));
vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: () => useConsultaOrdenesMock() as unknown,
}));

/** Línea de OC ligada a la orden 50. */
function lineaLigada(id: number) {
  return {
    id,
    idTela: 3,
    tela: 'Felpa',
    nombreComplementoTela: null,
    cantidadComplemento: null,
    precioComplemento: null,
    idAvio: null,
    avio: null,
    idAvioProveedor: null,
    descripcionLibre: null,
    idTelaColor: null,
    telaColor: null,
    idColorPrenda: null,
    colorPrenda: null,
    colorAvio: null,
    medidas: [],
    pantoneTelaColor: null,
    cantidadSugerida: null,
    avisoDesvio: null,
    cantidad: 100,
    unidad: 'm',
    precio: 25,
    subtotal: 2500,
    idOrden: 50,
    folioOrden: 7,
    tallas: [],
  };
}

describe('ComprasPorOrdenPagina (F4-E2)', () => {
  beforeEach(() => {
    useOrdenesCompraMock.mockReset();
    useConsultaOrdenesMock.mockReset();
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    // Por defecto, sin OC (antes de elegir orden).
    useOrdenesCompraMock.mockReturnValue({
      data: { datos: [], total: 0, pagina: 1, porPagina: 10, totalPaginas: 0 },
      isPending: false,
      isError: false,
      isFetching: false,
    });
  });

  it('al elegir una orden, consulta el filtro server-side idOrden y lista las OC ligadas', async () => {
    useOrdenesCompraMock.mockReturnValue({
      data: {
        datos: [ocDePrueba({ id: 1, numCompra: 1001, lineas: [lineaLigada(10)] })],
        total: 1,
        pagina: 1,
        porPagina: 10,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
      isFetching: false,
    });

    const usuario = userEvent.setup();
    renderConProveedores(<ComprasPorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });

    await usuario.click(screen.getByTestId('cpo-orden-opcion'));

    // El cruce lo hace el SERVIDOR: la consulta lleva idOrden = la orden elegida.
    expect(useOrdenesCompraMock).toHaveBeenCalledWith(expect.objectContaining({ idOrden: 50 }));

    const ocs = screen.getAllByTestId('cpo-oc');
    expect(ocs).toHaveLength(1);
    expect(screen.getByText('OC 1001')).toBeInTheDocument();
  });

  it('⭐ V1-E4e (§Post-F9.101): sólo ofrece Imprimir en la OC autorizada; si no, dice por qué', async () => {
    useOrdenesCompraMock.mockReturnValue({
      data: {
        datos: [
          ocDePrueba({ id: 1, numCompra: 1001, estatus: 'borrador', lineas: [lineaLigada(10)] }),
          ocDePrueba({ id: 2, numCompra: 1002, estatus: 'autorizada', lineas: [lineaLigada(11)] }),
        ],
        total: 2,
        pagina: 1,
        porPagina: 10,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
      isFetching: false,
    });

    const usuario = userEvent.setup();
    renderConProveedores(<ComprasPorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('cpo-orden-opcion'));

    // Sólo la autorizada trae botón; el borrador trae la explicación en su lugar.
    expect(screen.getAllByTestId('cpo-imprimir-oc')).toHaveLength(1);
    expect(screen.getByLabelText('Imprimir orden de compra 1002')).toBeInTheDocument();
    const avisos = screen.getAllByTestId('cpo-sin-imprimir');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toHaveTextContent('Se imprime cuando la orden esté autorizada');
  });

  it('muestra vacío cuando la orden no tiene OC ligadas', async () => {
    // Tras elegir orden, el servidor devuelve 0 OC.
    useOrdenesCompraMock.mockReturnValue({
      data: { datos: [], total: 0, pagina: 1, porPagina: 10, totalPaginas: 0 },
      isPending: false,
      isError: false,
      isFetching: false,
    });

    const usuario = userEvent.setup();
    renderConProveedores(<ComprasPorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('cpo-orden-opcion'));
    expect(screen.getByTestId('cpo-vacio')).toBeInTheDocument();
  });
});
