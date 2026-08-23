import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ListasPreciosPagina } from './ListasPreciosPagina';

/**
 * ⭐ Unit de la pantalla de LISTAS DE PRECIOS centrada en V1-E4 (punto 4): PODER QUITAR un renglón
 * y BORRAR una lista.
 *
 * Por qué existe: `lista_precios_linea` tiene `@@unique([idDesarrollo])` a nivel BD, así que un
 * desarrollo vive en A LO MÁS UNA lista. Sin forma de quitarlo desde la pantalla, un desarrollo
 * metido por error quedaba ATRAPADO PARA SIEMPRE — `crearLista` lo rechazaba con "ya está en otra
 * lista" y no había salida por ningún lado. No truena: simplemente no hay puerta.
 */
const quitarMutate = vi.fn();
const eliminarMutate = vi.fn();
const useListaPreciosMock = vi.fn();
const useListasPreciosMock = vi.fn();

vi.mock('@/api/listas-precios', () => ({
  useListasPrecios: () => useListasPreciosMock() as unknown,
  useListaPrecios: (id: number | null) => useListaPreciosMock(id) as unknown,
  useAprobarLinea: () => ({ mutate: vi.fn(), isPending: false }),
  useAjustarPrecioLinea: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarLineaLista: () => ({ mutate: quitarMutate, isPending: false }),
  useEliminarLista: () => ({ mutate: eliminarMutate, isPending: false }),
  useDesgloseCostoLinea: () => ({ data: undefined, isPending: false, isError: false }),
  useCandidatosLista: () => ({ data: [], isPending: false, isError: false }),
  useCrearLista: () => ({ mutate: vi.fn(), isPending: false }),
  useEditarFactoresLista: () => ({ mutate: vi.fn(), isPending: false }),
  imprimirListaPdf: vi.fn(),
  descargarListaExcel: vi.fn(),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isPending: false, isFetching: false }),
  useDepartamentosCliente: () => ({ data: [], isPending: false }),
}));
vi.mock('@/api/estados-lista', () => ({
  useEstadosLista: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/negociacion', () => ({
  useEventosLinea: () => ({ data: [], isPending: false, isError: false }),
  useRegistrarRonda: () => ({ mutate: vi.fn(), isPending: false }),
  useRegistrarAcuerdo: () => ({ mutate: vi.fn(), isPending: false }),
  useSimularNegociacion: () => ({ data: undefined, isPending: false }),
  useCambiarEstadoLista: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/desarrollos', () => ({
  useDesarrollo: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/api/precostos', () => ({
  usePrecostosDesarrollo: () => ({ data: [], isPending: false }),
  usePrecosto: () => ({ data: undefined, isPending: false }),
  useGenerarPrecosto: () => ({ mutate: vi.fn(), isPending: false }),
  useCongelarPrecosto: () => ({ mutate: vi.fn(), isPending: false }),
  useRecalcularPrecosto: () => ({ mutate: vi.fn(), isPending: false }),
  useAgregarLinea: () => ({ mutate: vi.fn(), isPending: false }),
  useEditarLinea: () => ({ mutate: vi.fn(), isPending: false }),
  useEliminarLinea: () => ({ mutate: vi.fn(), isPending: false }),
  useRestaurarLinea: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Detalle de lista de ejemplo: una lista ABIERTA con un renglón. */
const LISTA = {
  id: 3,
  folio: 21,
  idCliente: 1,
  nombreCliente: 'C&A',
  idClienteDepartamento: 2,
  nombreDepartamento: 'NIÑOS',
  fecha: '2026-08-10',
  idEstadoLista: 1,
  codigoEstado: 'abierta',
  nombreEstado: 'Abierta',
  margenPct: 50,
  descuentosPct: 10,
  regaliasPct: 5,
  costoVentasPct: 5,
  notas: null,
  lineas: [
    {
      id: 91,
      idDesarrollo: 55,
      idPrecosto: 77,
      versionPrecosto: 1,
      codigoModelo: 'KM-114',
      descripcionModelo: 'Playera Cherry',
      numeroCliente: 'CA-KM-114',
      costoUnit: 40,
      precioCalculado: 100,
      precioAprobado: null,
      aprobado: false,
      aprobadoPorId: null,
      aprobadoEn: null,
    },
  ],
  creadoEn: '2026-08-10T10:00:00.000Z',
  modificadoEn: '2026-08-10T10:00:00.000Z',
};

const PERM: ClavePermiso[] = ['listas.ver', 'listas.administrar', 'consultas.ver-importes'];

/** Abre el drill-in del detalle de la lista (la pantalla arranca en el listado). */
async function abrirDetalle(permisos: ClavePermiso[] = PERM): Promise<void> {
  useListasPreciosMock.mockReturnValue({
    data: [
      {
        id: LISTA.id,
        folio: LISTA.folio,
        idCliente: 1,
        nombreCliente: 'C&A',
        idClienteDepartamento: 2,
        nombreDepartamento: 'NIÑOS',
        fecha: LISTA.fecha,
        idEstadoLista: 1,
        codigoEstado: 'abierta',
        nombreEstado: 'Abierta',
        totalRenglones: 1,
        renglonesAprobados: 0,
        creadoEn: LISTA.creadoEn,
      },
    ],
    isPending: false,
    isError: false,
    error: null,
  });
  useListaPreciosMock.mockReturnValue({
    data: LISTA,
    isPending: false,
    isError: false,
    error: null,
  });

  const usuario = userEvent.setup();
  renderConProveedores(<ListasPreciosPagina />, { sesion: estadoSesionDePrueba(permisos) });
  await usuario.click(screen.getByTestId('fila-lista-precios'));
  await screen.findByTestId('detalle-lista-precios');
}

describe('⭐ ListasPreciosPagina — quitar renglón / borrar lista (V1-E4 punto 4)', () => {
  beforeEach(() => {
    quitarMutate.mockReset();
    eliminarMutate.mockReset();
    useListaPreciosMock.mockReset();
    useListasPreciosMock.mockReset();
  });

  it('el renglón se puede QUITAR (antes quedaba atrapado por el unique de BD)', async () => {
    const usuario = userEvent.setup();
    await abrirDetalle();

    await usuario.click(screen.getByTestId('quitar-renglon-lista'));
    const dialogo = await screen.findByRole('dialog');
    // El diálogo dice lo que de verdad pasa: queda en bitácora y el desarrollo se libera (D3).
    expect(dialogo).toHaveTextContent(/íntegro en la bitácora/i);
    expect(dialogo).toHaveTextContent(/disponible para otra lista/i);

    await usuario.click(within(dialogo).getByTestId('confirmar-accion'));

    expect(quitarMutate).toHaveBeenCalledWith(91, expect.anything());
  });

  it('la lista completa se puede BORRAR', async () => {
    const usuario = userEvent.setup();
    await abrirDetalle();

    await usuario.click(screen.getByTestId('borrar-lista'));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent(/íntegra en la bitácora/i);

    await usuario.click(within(dialogo).getByTestId('confirmar-accion'));

    expect(eliminarMutate).toHaveBeenCalledWith(3, expect.anything());
  });

  it('sin listas.administrar no se ofrece ni quitar ni borrar', async () => {
    await abrirDetalle(['listas.ver', 'consultas.ver-importes'] as ClavePermiso[]);

    expect(screen.queryByTestId('quitar-renglon-lista')).not.toBeInTheDocument();
    expect(screen.queryByTestId('borrar-lista')).not.toBeInTheDocument();
  });
});
