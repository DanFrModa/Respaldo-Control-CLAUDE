import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CostoOrden, CostoRealOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CosteoOrdenPagina } from './CosteoOrdenPagina';

/**
 * Pruebas de la pantalla de COSTEO DE ORDEN con el tercer origen del costo: el REAL DE COMPRAS
 * (petición de Daniel, 26-jul-2026). Cubren que se vean los tres números lado a lado, que el valor
 * PROPUESTO al capturar sea el real cuando la orden tiene compras (y el teórico cuando no), y que el
 * desglose se pida solo al abrirlo.
 */

/** Estado mutable de los hooks mockeados (objeto estable para el factory de `vi.mock`). */
const mock: { costo: unknown; real: unknown; hits: unknown; realHabilitado: boolean } = {
  costo: null,
  real: null,
  hits: { data: { datos: [] } },
  realHabilitado: false,
};

vi.mock('@/api/costos', () => ({
  useCostoOrden: () => mock.costo,
  useCostoRealOrden: (_id: number | null, habilitado: boolean) => {
    mock.realHabilitado = habilitado;
    return mock.real;
  },
  useGuardarCostoOrden: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/ordenes-consulta', () => ({
  useBuscarOrdenes: () => mock.hits,
}));

/** Costo de orden de juguete: teórico 4,000 de tela y real de compras 5,000. */
function costoOrden(over: Partial<CostoOrden['real']> = {}): CostoOrden {
  return {
    idOrden: 1,
    folio: 77,
    idModelo: 1,
    codigoModelo: 'MOD-1',
    descripcionModelo: 'Playera',
    idCliente: 1,
    cliente: 'Tienda X',
    noCostear: false,
    cantidades: { pedido: 100, cortado: 100, recibido: 0, vendido: 0 },
    teorico: {
      telaPorPrenda: 40,
      aviosPorPrenda: 17,
      procesosPorPrenda: 8,
      tela: 4000,
      avios: 1700,
      procesos: 800,
      total: 6500,
    },
    real: {
      tela: 5000,
      avios: 2500,
      total: 7500,
      importeDirecto: 7500,
      importeValuado: 0,
      importeLibre: 0,
      hayCompras: true,
      origenRequerido: 'snapshot-mrp',
      avisos: [],
      ...over,
    },
    guardado: null,
    unitario: { base: 'cortado', cantidadBase: 100, costoUnitario: 65 },
  };
}

const sinPedir = { data: undefined, isPending: true, isError: false, error: null };

function montar(costo: CostoOrden): void {
  mock.costo = { data: costo, isPending: false, isError: false, error: null };
  mock.real = sinPedir;
  renderConProveedores(<CosteoOrdenPagina />, {
    sesion: estadoSesionDePrueba(['costos.ver', 'costos.capturar', 'consultas.ver-importes']),
    rutaInicial: '/costos/costeo?idOrden=1',
  });
}

describe('CosteoOrdenPagina — los tres números (real / teórico / capturado)', () => {
  it('muestra el REAL de compras junto al teórico', () => {
    montar(costoOrden());
    expect(screen.getByTestId('costeo-real-tela')).toHaveTextContent('$5,000.00');
    expect(screen.getByTestId('costeo-real-avios')).toHaveTextContent('$2,500.00');
    expect(screen.getByText('Real de compras')).toBeInTheDocument();
    expect(screen.getByText('Teórico')).toBeInTheDocument();
    expect(screen.getByText('Capturado')).toBeInTheDocument();
  });

  it('propone el REAL en los campos capturables cuando la orden tiene compras', () => {
    montar(costoOrden());
    expect(screen.getByTestId('costeo-tela')).toHaveValue(5000);
    expect(screen.getByTestId('costeo-avios')).toHaveValue(2500);
    // Los procesos NO se compran con OC: siguen cayendo al teórico.
    expect(screen.getByTestId('costeo-procesos')).toHaveValue(800);
    expect(screen.getByText('Esta orden tiene compras registradas')).toBeInTheDocument();
  });

  it('sin compras ligadas, propone el TEÓRICO (no cambia lo de antes)', () => {
    montar(costoOrden({ hayCompras: false, tela: 4000, avios: 1700, total: 5700 }));
    expect(screen.getByTestId('costeo-tela')).toHaveValue(4000);
    expect(screen.getByText('Sin compras ligadas a esta orden')).toBeInTheDocument();
  });

  it('"Usar el teórico" y "Usar el real de compras" copian a los campos capturables', async () => {
    const usuario = userEvent.setup();
    montar(costoOrden());
    await usuario.click(screen.getByTestId('costeo-usar-teorico'));
    expect(screen.getByTestId('costeo-tela')).toHaveValue(4000);
    await usuario.click(screen.getByTestId('costeo-usar-real'));
    expect(screen.getByTestId('costeo-tela')).toHaveValue(5000);
  });

  it('lista los avisos del real cuando el backend los manda', () => {
    montar(costoOrden({ avisos: ['«Felpa» nunca se ha comprado…'] }));
    expect(screen.getByTestId('costeo-avisos-real')).toHaveTextContent('Felpa');
  });
});

describe('CosteoOrdenPagina — desglose del real', () => {
  it('el desglose NO se pide hasta que el usuario lo abre', async () => {
    const usuario = userEvent.setup();
    montar(costoOrden());
    expect(mock.realHabilitado).toBe(false);

    const desglose: CostoRealOrden = {
      idOrden: 1,
      folio: 77,
      tela: 5000,
      avios: 2500,
      total: 7500,
      importeDirecto: 5000,
      importeValuado: 2500,
      importeLibre: 0,
      hayCompras: true,
      origenRequerido: 'snapshot-mrp',
      avisos: [],
      materiales: [
        {
          tipo: 'tela',
          idTela: 3,
          idAvio: null,
          material: 'Felpa',
          unidad: 'm',
          esGenerico: false,
          requerido: 200,
          comprado: 200,
          compras: [
            {
              idOrdenCompra: 9,
              numCompra: 4001,
              estatus: 'autorizada',
              fecha: '2026-06-10',
              idProveedor: 2,
              proveedor: 'Textiles del Bajío',
              cantidad: 200,
              unidad: 'm',
              precio: 25,
              importe: 5000,
            },
          ],
          importeDirecto: 5000,
          cantidadValuada: 0,
          precioValuado: null,
          importeValuado: 0,
          origenPrecio: 'compra-directa',
          ultimaCompra: null,
          importe: 5000,
        },
      ],
    };
    mock.real = { data: desglose, isPending: false, isError: false, error: null };

    await usuario.click(screen.getByTestId('costeo-ver-desglose'));
    await waitFor(() => {
      expect(mock.realHabilitado).toBe(true);
    });
    const cajon = await screen.findByTestId('costeo-desglose');
    expect(cajon).toHaveTextContent('Felpa');
    expect(cajon).toHaveTextContent('Textiles del Bajío');
    expect(cajon).toHaveTextContent('OC 4001');
    expect(cajon).toHaveTextContent('Comprado para esta orden');
  });
});
