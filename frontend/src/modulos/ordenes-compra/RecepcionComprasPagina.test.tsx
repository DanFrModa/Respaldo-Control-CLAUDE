import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ocDePrueba } from './fixtures';
import { RecepcionComprasPagina } from './RecepcionComprasPagina';

const useOrdenCompraMock = vi.fn();
const useAlmacenesMock = vi.fn();
const useTelaMock = vi.fn();
const useRecepcionesDeOcMock = vi.fn();
const usePendientesMock = vi.fn();
const useOcsRecibiblesMock = vi.fn();
const recibirMutate = vi.fn();
const reversarMutate = vi.fn();

vi.mock('@/api/ordenes-compra', () => ({
  useOrdenCompra: (id: unknown) => useOrdenCompraMock(id) as unknown,
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
  useOcsRecibibles: (f: unknown) => useOcsRecibiblesMock(f) as unknown,
  useRecibir: () => ({ mutate: recibirMutate, isPending: false }),
  useReversarRecepcion: () => ({ mutate: reversarMutate, isPending: false }),
}));
// El combobox de proveedor busca en el SERVIDOR (§Post-F9.87 reusa EL selector de la app): aquí se
// sustituye por un botón que elige uno fijo, para ejercitar el flujo sin montar la búsqueda entera.
vi.mock('@/modulos/cxp/SelectorProveedor', () => ({
  SelectorProveedor: ({
    alSeleccionar,
    deshabilitado,
  }: {
    alSeleccionar: (proveedor: { id: number; nombre: string }) => void;
    deshabilitado?: boolean;
  }) => (
    <button
      type="button"
      data-testid="rec-proveedor-stub"
      disabled={deshabilitado ?? false}
      onClick={() => alSeleccionar({ id: 33, nombre: 'Textiles del Norte' })}
    >
      Elegir proveedor
    </button>
  ),
}));

const lista = (datos: unknown[]) => ({
  data: { datos, total: datos.length, pagina: 1, porPagina: 100, totalPaginas: 1 },
  isPending: false,
  isError: false,
  isFetching: false,
});

/** Una fila del listado de OC abiertas (§Post-F9.87), con lo que trae pendiente. */
function ocAbierta(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    numCompra: 1007,
    fecha: '2026-06-01',
    fechaEntrega: '2026-06-30',
    estatus: 'autorizada',
    idProveedor: 33,
    proveedor: 'Textiles del Norte',
    renglones: 2,
    renglonesPendientes: 1,
    materialesPendientes: ['BOT-01 — Botón'],
    materialesPendientesMas: 0,
    ...over,
  };
}

/** Respuesta del listado de OC abiertas: los datos MÁS la verdad sobre lo que quedó fuera. */
function ocsRecibibles(
  datos: unknown[],
  extra: { total?: number; truncado?: boolean; limite?: number } = {},
) {
  return {
    data: {
      datos,
      total: extra.total ?? datos.length,
      truncado: extra.truncado ?? false,
      limite: extra.limite ?? 50,
    },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  };
}

/** El detalle de UNA OC llega por su propia consulta: solo responde a SU id (nunca sin id). */
function detalleDeOc(oc: { id: number }) {
  return (id: number | undefined) =>
    id === oc.id
      ? { data: oc, isPending: false, isError: false }
      : { data: undefined, isPending: false, isError: false };
}

describe('RecepcionComprasPagina (F4-E3)', () => {
  beforeEach(() => {
    useOrdenCompraMock.mockReset();
    useAlmacenesMock.mockReset();
    useTelaMock.mockReset();
    useRecepcionesDeOcMock.mockReset();
    usePendientesMock.mockReset();
    useOcsRecibiblesMock.mockReset();
    recibirMutate.mockReset();
    reversarMutate.mockReset();

    // Dos OC abiertas del proveedor: con más de una NO hay auto-selección, así que cada prueba
    // elige la suya haciendo clic (que es lo que hace quien recibe).
    useOcsRecibiblesMock.mockReturnValue(
      ocsRecibibles([ocAbierta(), ocAbierta({ id: 8, numCompra: 1008 })]),
    );
    // El detalle de la OC se pide POR ID: sin OC elegida no hay detalle (ni renglones).
    const ocAutorizada = ocDePrueba({ id: 7, numCompra: 1007, estatus: 'autorizada' });
    useOrdenCompraMock.mockImplementation(detalleDeOc(ocAutorizada));
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

  it('lista las OC abiertas del proveedor y exige elegir una para capturar', () => {
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });
    expect(screen.getByText('Sin orden seleccionada.')).toBeInTheDocument();
    // Las dos OC abiertas están a la vista, cada una con lo que trae pendiente.
    expect(screen.getByTestId('rec-oc-7')).toHaveTextContent('OC 1007');
    expect(screen.getByTestId('rec-oc-8')).toHaveTextContent('OC 1008');
    expect(screen.getByTestId('rec-oc-7')).toHaveTextContent('1 de 2 renglones por recibir');
    expect(screen.getByTestId('rec-oc-7')).toHaveTextContent('BOT-01 — Botón');
  });

  it('§Post-F9.14: la tela NO se recibe aquí — el renglón se ve pero no se puede marcar', async () => {
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.recibir']),
    });
    const usuario = userEvent.setup();
    await usuario.click(screen.getByTestId('rec-oc-7'));

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
    useOrdenCompraMock.mockImplementation(detalleDeOc(ocConAvio));
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
    await usuario.click(screen.getByTestId('rec-oc-7'));

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
    useOrdenCompraMock.mockImplementation(detalleDeOc(ocConAvio));
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
    await usuario.click(screen.getByTestId('rec-oc-7'));

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
    useOrdenCompraMock.mockImplementation(detalleDeOc(ocConAvio));
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
    await usuario.click(screen.getByTestId('rec-oc-7'));

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

  it('sin compras.recibir el buscador y las OC quedan deshabilitados (§Post-F9.68)', () => {
    renderConProveedores(<RecepcionComprasPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(screen.getByTestId('rec-proveedor-stub')).toBeDisabled();
    expect(screen.getByTestId('rec-num-oc')).toBeDisabled();
    expect(screen.getByTestId('rec-oc-7')).toBeDisabled();
  });

  /**
   * §Post-F9.87 — LA PANTALLA PREGUNTABA AL REVÉS QUE LA VIDA. Quien llega al almacén es el
   * proveedor; el número de OC es lo que hay que AVERIGUAR. Y de paso muere el defecto vivo: el
   * `<select>` alimentado por dos consultas de 100 volvía INALCANZABLES las OC de más abajo.
   */
  describe('§Post-F9.87 — se empieza por el proveedor', () => {
    it('sin proveedor ni número no se lista nada: se dice por dónde empezar', () => {
      useOcsRecibiblesMock.mockReturnValue({
        data: undefined,
        isPending: false,
        isFetching: false,
        isError: false,
        refetch: vi.fn(),
      });
      renderConProveedores(<RecepcionComprasPagina />, {
        sesion: estadoSesionDePrueba(['compras.recibir']),
      });
      expect(screen.getByTestId('rec-sin-filtro')).toHaveTextContent(
        'Empieza por el proveedor que llegó a entregar.',
      );
      expect(screen.queryByTestId('rec-ocs')).not.toBeInTheDocument();
    });

    it('elegir proveedor consulta AL SERVIDOR por ese proveedor (no filtra en el cliente)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<RecepcionComprasPagina />, {
        sesion: estadoSesionDePrueba(['compras.recibir']),
      });
      await usuario.click(screen.getByTestId('rec-proveedor-stub'));

      // El id del proveedor viaja al hook: si se filtrara en el cliente, la consulta iría sin él
      // (y las OC fuera de la página seguirían siendo inalcanzables, que es el defecto).
      expect(useOcsRecibiblesMock).toHaveBeenCalledWith({ idProveedor: 33 });
    });

    it('si el proveedor trae UNA SOLA OC, queda elegida sola', () => {
      useOcsRecibiblesMock.mockReturnValue(ocsRecibibles([ocAbierta()]));
      renderConProveedores(<RecepcionComprasPagina />, {
        sesion: estadoSesionDePrueba(['compras.recibir']),
      });
      // Sin tocar nada: la OC 1007 ya está elegida (su ficha de detalle está en pantalla).
      expect(screen.getByTestId('rec-oc-seleccionada')).toHaveTextContent('OC 1007');
      expect(screen.queryByText('Sin orden seleccionada.')).not.toBeInTheDocument();
    });

    it('NADA de topes silenciosos: si la lista se recortó, la pantalla lo dice', () => {
      useOcsRecibiblesMock.mockReturnValue(
        ocsRecibibles([ocAbierta(), ocAbierta({ id: 8, numCompra: 1008 })], {
          total: 300,
          truncado: true,
          limite: 2,
        }),
      );
      renderConProveedores(<RecepcionComprasPagina />, {
        sesion: estadoSesionDePrueba(['compras.recibir']),
      });
      // El aviso nombra el TOTAL real (300), no solo lo que cupo, y ofrece la salida.
      const aviso = screen.getByTestId('rec-ocs-truncado');
      expect(aviso).toHaveTextContent('Se muestran 2 de 300 OC abiertas');
      expect(aviso).toHaveTextContent('Escribe el número de la OC para llegar a las demás.');
    });

    it('si NO se recortó, no se inventa un aviso de recorte', () => {
      renderConProveedores(<RecepcionComprasPagina />, {
        sesion: estadoSesionDePrueba(['compras.recibir']),
      });
      expect(screen.queryByTestId('rec-ocs-truncado')).not.toBeInTheDocument();
    });

    it('ATAJO: teclear el número de la remisión consulta por `numCompra`', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<RecepcionComprasPagina />, {
        sesion: estadoSesionDePrueba(['compras.recibir']),
      });
      await usuario.type(screen.getByTestId('rec-num-oc'), '1008');

      // El debounce es de 300 ms; se espera a que la consulta salga con el número.
      await waitFor(() => {
        expect(useOcsRecibiblesMock).toHaveBeenCalledWith({ numCompra: 1008 });
      });
    });

    it('si la consulta de OC falla, se dice y se puede reintentar (no se queda en blanco)', async () => {
      const refetch = vi.fn();
      useOcsRecibiblesMock.mockReturnValue({
        data: undefined,
        isPending: false,
        isFetching: false,
        isError: true,
        error: { message: 'Falló la consulta' },
        refetch,
      });
      const usuario = userEvent.setup();
      renderConProveedores(<RecepcionComprasPagina />, {
        sesion: estadoSesionDePrueba(['compras.recibir']),
      });
      await usuario.click(screen.getByTestId('rec-proveedor-stub'));

      expect(screen.getByTestId('rec-error-ocs')).toHaveTextContent('Falló la consulta');
      await usuario.click(screen.getByTestId('rec-reintentar-ocs'));
      expect(refetch).toHaveBeenCalled();
    });
  });
});
