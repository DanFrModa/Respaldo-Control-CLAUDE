import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ocDePrueba } from './fixtures';
import { RecepcionComprasPagina } from './RecepcionComprasPagina';

const useOrdenesCompraMock = vi.fn();
const useAlmacenesMock = vi.fn();
const useTelaMock = vi.fn();
const useRecepcionesDeOcMock = vi.fn();
const recibirMutate = vi.fn();
const reversarMutate = vi.fn();

vi.mock('@/api/ordenes-compra', () => ({
  useOrdenesCompra: (q: unknown) => useOrdenesCompraMock(q) as unknown,
  CLAVE_OC: ['ordenes-compra'],
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => useAlmacenesMock() as unknown,
}));
vi.mock('@/api/telas', () => ({
  useTela: (id: unknown) => useTelaMock(id) as unknown,
}));
vi.mock('@/api/recepciones', () => ({
  useRecepcionesDeOc: (id: unknown) => useRecepcionesDeOcMock(id) as unknown,
  useRecibir: () => ({ mutate: recibirMutate, isPending: false }),
  useReversarRecepcion: () => ({ mutate: reversarMutate, isPending: false }),
}));

const lista = (datos: unknown[]) => ({
  data: { datos, total: datos.length, pagina: 1, porPagina: 100, totalPaginas: 1 },
  isPending: false,
  isError: false,
  isFetching: false,
});

describe('RecepcionComprasPagina (F4-E3)', () => {
  beforeEach(() => {
    useOrdenesCompraMock.mockReset();
    useAlmacenesMock.mockReset();
    useTelaMock.mockReset();
    useRecepcionesDeOcMock.mockReset();
    recibirMutate.mockReset();
    reversarMutate.mockReset();

    // Primer hook (autorizada) trae la OC; segundo (recibida_parcial) vacío.
    const ocAutorizada = ocDePrueba({ id: 7, numCompra: 1007, estatus: 'autorizada' });
    useOrdenesCompraMock.mockImplementation((q: { estatus?: string }) =>
      q.estatus === 'autorizada' ? lista([ocAutorizada]) : lista([]),
    );
    useAlmacenesMock.mockReturnValue(lista([{ id: 1, nombre: 'Bodega' }]));
    // B1: la captura de tela es POR COLOR — la tela comprada se lee por su ID EXACTO (no por
    // búsqueda paginada) y trae sus colores hijos, su complemento ("Cardigan") y los precios del
    // catálogo que se sugieren en la captura.
    useTelaMock.mockReturnValue({
      data: {
        id: 3,
        nombre: 'Felpa francesa',
        nombreCuerpo: 'Felpa',
        nombreComplemento: 'Cardigan',
        colores: [
          { id: 91, nombre: 'Rojo', pantone: '18-1664', precio: 95, precioComplemento: 130 },
          { id: 92, nombre: 'Marino', pantone: null, precio: null, precioComplemento: null },
        ],
      },
      isPending: false,
      isError: false,
    });
    useRecepcionesDeOcMock.mockReturnValue({
      data: { recepciones: [] },
      isPending: false,
      isError: false,
    });
  });

  it('lista solo OC recibibles y exige seleccionar una para capturar', () => {
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });
    expect(screen.getByText('Sin orden seleccionada.')).toBeInTheDocument();
    // La opción de la OC autorizada está disponible.
    expect(screen.getByRole('option', { name: /OC 1007/ })).toBeInTheDocument();
  });

  it('§Post-F9.14: la tela NO se recibe aquí — el renglón se ve pero no se puede marcar', async () => {
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });
    const usuario = userEvent.setup();
    await usuario.selectOptions(screen.getByTestId('rec-oc'), '7');

    // El renglón de tela sigue VISIBLE (para ver qué falta de la orden)…
    expect(screen.getByTestId('rec-incluir-10')).toBeInTheDocument();
    // …pero no se puede marcar, y la pantalla dice a dónde ir a recibirlo.
    expect(screen.getByTestId('rec-incluir-10')).toBeDisabled();
    expect(screen.getByTestId('rec-tela-por-factura-10')).toHaveTextContent('factura o remisión');
  });

  it('sin compras.recibir el selector queda deshabilitado', () => {
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(screen.getByTestId('rec-oc')).toBeDisabled();
  });
});
