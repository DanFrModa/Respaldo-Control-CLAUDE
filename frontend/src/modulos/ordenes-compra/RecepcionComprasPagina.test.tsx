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
const usePendientesMock = vi.fn();
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
  useLineasPendientesDeOc: (id: unknown) => usePendientesMock(id) as unknown,
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
    usePendientesMock.mockReset();
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
    // Pendiente por renglón: lo calcula el servidor (A1). Default = nada recibido todavía.
    usePendientesMock.mockReturnValue({ data: [], isPending: false, isFetching: false });
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

  /**
   * LA PRUEBA DEL DOBLE CONTEO: la captura de AVÍOS precargaba lo PEDIDO COMPLETO ignorando lo ya
   * recibido, y el backend solo impide repetir un renglón dentro de la MISMA recepción → recibir
   * tres veces el 100 % pasaba en silencio. Ahora precarga lo que FALTA y enseña lo recibido.
   */
  it('precarga el PENDIENTE (no lo pedido) y muestra lo ya recibido en el renglón de avío', async () => {
    const ocConAvio = ocDePrueba({
      id: 7,
      numCompra: 1007,
      estatus: 'recibida_parcial',
      lineas: [
        {
          id: 20,
          idTela: null,
          tela: null,
          nombreComplementoTela: null,
          cantidadComplemento: null,
          precioComplemento: null,
          idAvio: 4,
          avio: 'BOT-01 — Botón',
          idAvioProveedor: null,
          descripcionLibre: null,
          cantidad: 100,
          unidad: 'pza',
          precio: 2,
          subtotal: 200,
          idOrden: null,
          folioOrden: null,
          tallas: [],
        },
      ],
    });
    useOrdenesCompraMock.mockImplementation((q: { estatus?: string }) =>
      q.estatus === 'autorizada' ? lista([ocConAvio]) : lista([]),
    );
    usePendientesMock.mockReturnValue({
      data: [
        {
          idOrdenCompraLinea: 20,
          tipo: 'avio',
          cantidad: 100,
          recibido: 40,
          pendiente: 60,
          cantidadComplemento: null,
          recibidoComplemento: 0,
          pendienteComplemento: 0,
          surtido: false,
        },
      ],
      isPending: false,
      isFetching: false,
    });

    const usuario = userEvent.setup();
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });
    await usuario.selectOptions(screen.getByTestId('rec-oc'), '7');

    // Lo pedido, lo recibido y lo que falta, a la vista.
    const resumen = screen.getByTestId('rec-pendiente-20');
    expect(resumen).toHaveTextContent('Pedido: 100');
    expect(resumen).toHaveTextContent('Recibido: 40');
    expect(resumen).toHaveTextContent('Falta: 60');

    // Y la cantidad precargada es el PENDIENTE (60), no lo pedido (100).
    await usuario.click(screen.getByTestId('rec-incluir-20'));
    expect(screen.getByTestId('rec-cant-20')).toHaveValue(60);
  });

  it('un renglón ya SURTIDO se dice y precarga 0 (no invita a recibirlo otra vez)', async () => {
    const ocConAvio = ocDePrueba({
      id: 7,
      numCompra: 1007,
      estatus: 'recibida_parcial',
      lineas: [
        {
          id: 21,
          idTela: null,
          tela: null,
          nombreComplementoTela: null,
          cantidadComplemento: null,
          precioComplemento: null,
          idAvio: 4,
          avio: 'BOT-01 — Botón',
          idAvioProveedor: null,
          descripcionLibre: null,
          cantidad: 100,
          unidad: 'pza',
          precio: 2,
          subtotal: 200,
          idOrden: null,
          folioOrden: null,
          tallas: [],
        },
      ],
    });
    useOrdenesCompraMock.mockImplementation((q: { estatus?: string }) =>
      q.estatus === 'autorizada' ? lista([ocConAvio]) : lista([]),
    );
    usePendientesMock.mockReturnValue({
      data: [
        {
          idOrdenCompraLinea: 21,
          tipo: 'avio',
          cantidad: 100,
          recibido: 100,
          pendiente: 0,
          cantidadComplemento: null,
          recibidoComplemento: 0,
          pendienteComplemento: 0,
          surtido: true,
        },
      ],
      isPending: false,
      isFetching: false,
    });

    const usuario = userEvent.setup();
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });
    await usuario.selectOptions(screen.getByTestId('rec-oc'), '7');

    expect(screen.getByTestId('rec-pendiente-21')).toHaveTextContent('Ya surtido');
    // La sobre-recepción NO se bloquea (puede ser legítima): el renglón se puede marcar, pero
    // arranca en 0 para que teclear de más sea una decisión, no un descuido.
    await usuario.click(screen.getByTestId('rec-incluir-21'));
    expect(screen.getByTestId('rec-cant-21')).toHaveValue(0);
    expect(screen.getByTestId('rec-incluir-21')).not.toBeDisabled();
  });

  /**
   * SI NO SE PUDO SABER lo recibido, NO se precarga. El `QueryClient` de producción va con
   * `retry: false` y sin `refetchOnWindowFocus` (`App.tsx`): un solo 500 dejaría la consulta en
   * error toda la sesión. Caer a "lo pedido" ahí sería reintroducir el doble conteo — una OC de 100
   * con 40 recibidos precargaría 100 y confirmar metería 140 al kardex.
   */
  it('si falla la consulta del pendiente: NO precarga, lo dice y deja reintentar', async () => {
    const ocConAvio = ocDePrueba({
      id: 7,
      numCompra: 1007,
      estatus: 'recibida_parcial',
      lineas: [
        {
          id: 22,
          idTela: null,
          tela: null,
          nombreComplementoTela: null,
          cantidadComplemento: null,
          precioComplemento: null,
          idAvio: 4,
          avio: 'BOT-01 — Botón',
          idAvioProveedor: null,
          descripcionLibre: null,
          cantidad: 100,
          unidad: 'pza',
          precio: 2,
          subtotal: 200,
          idOrden: null,
          folioOrden: null,
          tallas: [],
        },
      ],
    });
    useOrdenesCompraMock.mockImplementation((q: { estatus?: string }) =>
      q.estatus === 'autorizada' ? lista([ocConAvio]) : lista([]),
    );
    const refetchPendientes = vi.fn();
    usePendientesMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isFetching: false,
      isError: true,
      error: { message: 'Falló la consulta' },
      refetch: refetchPendientes,
    });

    const usuario = userEvent.setup();
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });
    await usuario.selectOptions(screen.getByTestId('rec-oc'), '7');

    // El aviso es FIJO en la pantalla (no un toast que se va) y explica el porqué del blanco.
    expect(screen.getByTestId('rec-error-pendientes')).toHaveTextContent(
      'No se pudo consultar lo ya recibido',
    );
    // NADA precargado: ni lo pedido (el defecto viejo) ni un número inventado.
    await usuario.click(screen.getByTestId('rec-incluir-22'));
    expect(screen.getByTestId('rec-cant-22')).toHaveValue(null);
    // Y hay salida sin recargar la página (el QueryClient no reintenta ni refresca al foco).
    await usuario.click(screen.getByTestId('rec-reintentar-pendientes'));
    expect(refetchPendientes).toHaveBeenCalled();
  });

  it('sin compras.recibir el selector queda deshabilitado', () => {
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(screen.getByTestId('rec-oc')).toBeDisabled();
  });
});
