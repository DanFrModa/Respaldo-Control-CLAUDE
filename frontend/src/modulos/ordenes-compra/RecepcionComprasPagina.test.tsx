import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ocDePrueba } from './fixtures';
import { RecepcionComprasPagina } from './RecepcionComprasPagina';

const useOrdenesCompraMock = vi.fn();
const useAlmacenesMock = vi.fn();
const useColoresMock = vi.fn();
const useTelasMock = vi.fn();
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
vi.mock('@/api/colores', () => ({
  useColores: () => useColoresMock() as unknown,
}));
vi.mock('@/api/telas', () => ({
  useTelas: () => useTelasMock() as unknown,
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
    useColoresMock.mockReset();
    useTelasMock.mockReset();
    useRecepcionesDeOcMock.mockReset();
    recibirMutate.mockReset();
    reversarMutate.mockReset();

    // Primer hook (autorizada) trae la OC; segundo (recibida_parcial) vacío.
    const ocAutorizada = ocDePrueba({ id: 7, numCompra: 1007, estatus: 'autorizada' });
    useOrdenesCompraMock.mockImplementation((q: { estatus?: string }) =>
      q.estatus === 'autorizada' ? lista([ocAutorizada]) : lista([]),
    );
    useAlmacenesMock.mockReturnValue(lista([{ id: 1, nombre: 'Bodega' }]));
    useColoresMock.mockReturnValue(lista([{ id: 9, nombre: 'Rojo' }]));
    // Catálogo de telas para los componentes del lote (M1): incluye la tela comprada (id 3) + una
    // acompañante (id 4) para poder armar un lote felpa+cardigan desde la UI.
    useTelasMock.mockReturnValue(
      lista([
        { id: 3, nombre: 'Felpa francesa' },
        { id: 4, nombre: 'Cardigan' },
      ]),
    );
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

  it('al recibir una línea de tela arma el lote (color + componente) y llama a recibir', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });

    // Elige la OC y el almacén.
    await usuario.selectOptions(screen.getByTestId('rec-oc'), '7');
    await usuario.selectOptions(screen.getByTestId('rec-almacen'), '1');

    // Marca el renglón de tela (id 10) y elige el color del lote.
    await usuario.click(screen.getByTestId('rec-incluir-10'));
    await usuario.selectOptions(screen.getByTestId('rec-color-10'), '9');

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
      lote: { idColor: 9, componentes: [{ idTela: 3, cantidad: 100 }] },
    });
  });

  it('M1: "+ componente" agrega una tela ACOMPAÑANTE distinta del catálogo (lote felpa+cardigan)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });

    await usuario.selectOptions(screen.getByTestId('rec-oc'), '7');
    await usuario.selectOptions(screen.getByTestId('rec-almacen'), '1');
    await usuario.click(screen.getByTestId('rec-incluir-10'));
    await usuario.selectOptions(screen.getByTestId('rec-color-10'), '9');

    // Agrega un segundo componente y elige el CARDIGAN (id 4), distinto de la tela comprada (id 3).
    await usuario.click(screen.getByTestId('rec-add-comp-10'));
    const [, selectorComp2] = screen.getAllByLabelText('Tela del componente');
    const [, cantidadComp2] = screen.getAllByLabelText('Cantidad del componente');
    expect(selectorComp2).toBeDefined();
    await usuario.selectOptions(selectorComp2 as HTMLElement, '4');
    await usuario.clear(cantidadComp2 as HTMLElement);
    await usuario.type(cantidadComp2 as HTMLElement, '60');

    await usuario.click(screen.getByTestId('rec-guardar'));

    expect(recibirMutate).toHaveBeenCalledTimes(1);
    const [args] = recibirMutate.mock.calls[0] as [
      { cuerpo: { lineas: { lote: { componentes: { idTela: number; cantidad: number }[] } }[] } },
    ];
    const [primeraLinea] = args.cuerpo.lineas;
    expect(primeraLinea?.lote.componentes).toEqual([
      { idTela: 3, cantidad: 100 }, // tela comprada (default)
      { idTela: 4, cantidad: 60 }, // acompañante elegido del catálogo (M1)
    ]);
  });

  it('sin compras.recibir el selector queda deshabilitado', () => {
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(screen.getByTestId('rec-oc')).toBeDisabled();
  });
});
