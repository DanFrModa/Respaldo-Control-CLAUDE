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

  it('B1: la línea de tela se captura POR COLOR (color + complemento + su precio + lote del proveedor)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });

    // Elige la OC y el almacén.
    await usuario.selectOptions(screen.getByTestId('rec-oc'), '7');
    await usuario.selectOptions(screen.getByTestId('rec-almacen'), '1');

    // Marca el renglón de tela (id 10) y captura color + complemento + lote del proveedor.
    await usuario.click(screen.getByTestId('rec-incluir-10'));
    await usuario.selectOptions(screen.getByTestId('rec-color-10'), '91');
    await usuario.type(screen.getByTestId('rec-compl-10'), '25');
    // El precio del complemento se PRE-LLENA del catálogo del color (sugerencia editable).
    expect(screen.getByTestId('rec-precio-compl-10')).toHaveValue(130);
    await usuario.type(screen.getByTestId('rec-lote-prov-10'), 'L-88');

    // Registra la recepción.
    await usuario.click(screen.getByTestId('rec-guardar'));

    expect(recibirMutate).toHaveBeenCalledTimes(1);
    const [args] = recibirMutate.mock.calls[0] as [
      { idOrdenCompra: number; cuerpo: { idAlmacen: number; lineas: unknown[] } },
    ];
    expect(args.idOrdenCompra).toBe(7);
    expect(args.cuerpo.idAlmacen).toBe(1);
    expect(args.cuerpo.lineas).toHaveLength(1);
    expect(args.cuerpo.lineas[0]).toMatchObject({
      idOrdenCompraLinea: 10,
      cantidad: 100,
      telaColor: {
        idTelaColor: 91,
        cantidadComplemento: 25,
        precioUnitComplemento: 130,
        loteProveedor: 'L-88',
      },
    });
  });

  it('B1: si la tela no se pudo leer, lo DICE (no miente con "no tiene colores") y ofrece reintentar', async () => {
    const usuario = userEvent.setup();
    const refetch = vi.fn();
    useTelaMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'No tienes permiso para ver telas.' },
      refetch,
    });
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });
    await usuario.selectOptions(screen.getByTestId('rec-oc'), '7');
    await usuario.click(screen.getByTestId('rec-incluir-10'));

    expect(screen.getByTestId('rec-color-error-10')).toHaveTextContent(
      'No tienes permiso para ver telas.',
    );
    expect(screen.getByTestId('rec-color-10')).toBeDisabled();
    await usuario.click(screen.getByTestId('rec-color-reintentar-10'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('B1: sin COLOR no se manda la recepción (el backend lo exige; la UI evita el viaje)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });

    await usuario.selectOptions(screen.getByTestId('rec-oc'), '7');
    await usuario.selectOptions(screen.getByTestId('rec-almacen'), '1');
    await usuario.click(screen.getByTestId('rec-incluir-10'));
    // NO se elige color.
    await usuario.click(screen.getByTestId('rec-guardar'));

    expect(recibirMutate).not.toHaveBeenCalled();
  });

  it('sin compras.recibir el selector queda deshabilitado', () => {
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(screen.getByTestId('rec-oc')).toBeDisabled();
  });
});
