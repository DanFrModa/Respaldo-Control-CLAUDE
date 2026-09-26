import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * ⭐ Fila 0.200 — **EL GATE DEL COMPROBANTE PDF EN LA PANTALLA DE ENTREGA A CLIENTE.**
 *
 * POR QUÉ EXISTE. El comprobante lo sirve el backend con `produccion.wip-ver` (es una reimpresión =
 * una consulta). Esta pantalla ofrece el MISMO PDF por dos puertas —la barra del «recién guardado» y
 * el historial— y ninguna estaba gateada, así que un capturista con `produccion.entrega` y sin
 * `wip-ver` podía ver un botón que el servidor le niega con un 403 en una pestaña nueva.
 *
 * 🔑 Lo que hace especial a la barra del «recién guardado»: sale de `ultimaEntrega`, que es **estado
 * LOCAL de React** puesto con la respuesta de la propia captura (`POST`, que pide
 * `produccion.entrega`). NO la protege ninguna consulta, así que el gate tiene que ser explícito —
 * a diferencia del botón del historial, cuya lista sí viaja por una consulta con `wip-ver`.
 *
 * La capa de datos va simulada (sin red): lo que se prueba es la pantalla, no el API.
 */

const ORDEN = {
  id: 1,
  folio: 5424,
  codigoModelo: '62182',
  idModelo: 3,
  cliente: 'C&A',
  estado: 'capturada',
  idMaquilero: null,
  maquilero: null,
  lineas: [
    {
      idColor: 7,
      color: 'Rojo',
      pack: '',
      tallas: [{ idTalla: 11, etiquetaTalla: 'CH', cantidad: 10 }],
    },
  ],
  referencias: [],
  totalPiezas: 10,
} as unknown as Orden;

/** Seguimiento CON disponible en el almacén (lo que devuelve el servidor a quien lleva `wip-ver`). */
const SEGUIMIENTO = {
  idOrden: 1,
  folioOrden: 5424,
  idCliente: 4,
  cliente: 'C&A',
  idModelo: 3,
  totalPedido: 10,
  totalEntregado: 0,
  totalFaltante: 10,
  celdas: [{ idColor: 7, idTalla: 11, pedido: 10, entregado: 0, faltante: 10, disponible: 10 }],
};

const crearEntrega = vi.fn();
const useEntregasOrden = vi.fn<() => unknown>();
const useSeguimientoEntrega = vi.fn<() => unknown>();
const useOrden = vi.fn<() => unknown>();

vi.mock('@/api/ordenes', () => ({ useOrden: () => useOrden() }));
vi.mock('@/api/entregas-cliente', () => ({
  CLAVE_ENTREGAS: ['entregas'],
  useEntregasOrden: () => useEntregasOrden(),
  useSeguimientoEntrega: () => useSeguimientoEntrega(),
  useCrearEntrega: () => ({ mutate: crearEntrega, isPending: false }),
  useCancelarEntrega: () => ({ mutate: vi.fn(), isPending: false }),
  urlComprobanteEntrega: (id: number) => `/api/produccion/entregas-cliente/${id}/comprobante`,
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: {
      datos: [{ id: 1, nombre: 'Primeras', tipo: 'PT', activo: true, esTransitoProceso: false }],
    },
    isError: false,
    refetch: vi.fn(),
  }),
}));
/** El selector de orden se reduce a un botón: elegir la orden es el paso previo, no lo que se mide. */
vi.mock('./SelectorOrden', () => ({
  SelectorOrden: ({ alSeleccionar }: { alSeleccionar: (o: Orden) => void }) => (
    <button type="button" data-testid="elegir-orden" onClick={() => alSeleccionar(ORDEN)}>
      Elegir orden
    </button>
  ),
}));

const { EntregaClientePagina } = await import('./EntregaClientePagina');

/** Pinta la pantalla con exactamente estos permisos. */
function pintar(permisos: string[]): void {
  renderConProveedores(<EntregaClientePagina />, {
    sesion: estadoSesionDePrueba(permisos as Parameters<typeof estadoSesionDePrueba>[0]),
  });
}

/**
 * Lleva la pantalla hasta tener una entrega GUARDADA: elige orden, almacén, teclea una pieza y
 * guarda. `crearEntrega` responde por su `onSuccess`, que es lo que setea `ultimaEntrega`.
 */
async function capturarUnaEntrega(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  await usuario.click(screen.getByTestId('elegir-orden'));
  await usuario.selectOptions(screen.getByTestId('entrega-almacen'), '1');
  await usuario.type(screen.getByTestId('entrega-matriz-celda'), '1');
  await usuario.click(screen.getByTestId('entrega-guardar'));
  await waitFor(() => {
    expect(crearEntrega).toHaveBeenCalledTimes(1);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useOrden.mockReturnValue({ data: ORDEN, isError: false, isPending: false });
  useSeguimientoEntrega.mockReturnValue({
    data: SEGUIMIENTO,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  });
  useEntregasOrden.mockReturnValue({
    data: { entregas: [] },
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  });
  // La captura contesta con la entrega creada: es el eco de la propia escritura (`proyectarEntrega`),
  // que el servidor SÍ le devuelve a quien sólo tiene `produccion.entrega`.
  crearEntrega.mockImplementation(
    (_cuerpo: unknown, opciones: { onSuccess: (e: unknown) => void }) => {
      opciones.onSuccess({ id: 71, folio: 3, cliente: 'C&A', totalPiezas: 1 });
    },
  );
});

describe('Comprobante PDF de la barra del «recién guardado» (fila 0.200)', () => {
  it('⭐ quien captura SIN `produccion.wip-ver` NO ve «Comprobante PDF» de lo que acaba de guardar', async () => {
    // EL caso que el gate existe para cubrir: la barra sale de estado LOCAL, no de una consulta, así
    // que nada más la protege.
    //
    // ⚠️ HONESTIDAD SOBRE EL MONTAJE: al `useSeguimientoEntrega` se le da su respuesta aunque esta
    // sesión NO lleve `wip-ver` (en el servidor sería un 403). Es DELIBERADO y es lo único que
    // permite llegar a la barra, porque sin ese dato el botón de guardar se deshabilita — lo mide el
    // tercer bloque de este archivo. O sea: lo que se fija aquí es la REGLA del gate, no que el
    // agujero sea alcanzable por la UI de hoy.
    const usuario = userEvent.setup();
    pintar(['produccion.entrega']);
    await capturarUnaEntrega(usuario);

    // La barra del recién guardado SÍ está (la captura funcionó: es su permiso)…
    expect(screen.getByText(/Última entrega guardada: #3/)).toBeInTheDocument();
    // …pero sin `wip-ver` no ofrece el PDF.
    expect(screen.queryByTestId('entrega-pdf')).not.toBeInTheDocument();
  });

  it('y con `produccion.wip-ver` SÍ lo ve (la gemela positiva)', async () => {
    const usuario = userEvent.setup();
    pintar(['produccion.entrega', 'produccion.wip-ver']);
    await capturarUnaEntrega(usuario);

    expect(screen.getByText(/Última entrega guardada: #3/)).toBeInTheDocument();
    expect(screen.getByTestId('entrega-pdf')).toBeInTheDocument();
  });
});

describe('Comprobante PDF del historial de la orden (fila 0.200)', () => {
  /** Una entrega viva en el historial (lo que devuelve la consulta con `wip-ver`). */
  const entregaViva = {
    id: 71,
    folio: 3,
    fecha: '2026-08-13',
    almacen: 'Primeras',
    totalPiezas: 4,
    observaciones: null,
    cancelado: false,
    motivoCancelacion: null,
    lineas: [],
  };

  it('con `produccion.wip-ver` el historial ofrece el comprobante de cada entrega', async () => {
    useEntregasOrden.mockReturnValue({
      data: { entregas: [entregaViva] },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    const usuario = userEvent.setup();
    pintar(['produccion.entrega', 'produccion.wip-ver']);
    await usuario.click(screen.getByTestId('elegir-orden'));

    expect(screen.getByLabelText('Comprobante de la entrega 3')).toBeInTheDocument();
  });

  it('sin `produccion.wip-ver` no lo ofrece (gate defensivo: la lista ya llegaría vacía)', async () => {
    // ⚠️ Estado SINTÉTICO a propósito: se le da la lista a una sesión sin `wip-ver`, que en el
    // servidor recibiría un 403 y la vería vacía. Lo que se fija es la REGLA del gate, para que el
    // botón no reaparezca si algún día la lista llega por otra vía.
    useEntregasOrden.mockReturnValue({
      data: { entregas: [entregaViva] },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    const usuario = userEvent.setup();
    pintar(['produccion.entrega']);
    await usuario.click(screen.getByTestId('elegir-orden'));

    expect(screen.queryByLabelText('Comprobante de la entrega 3')).not.toBeInTheDocument();
  });
});

describe('⚠️ Medición: qué tan alcanzable es la barra sin `produccion.wip-ver`', () => {
  it('sin el seguimiento (que pide `wip-ver`) «Guardar entrega» queda DESHABILITADO', async () => {
    // Éste es el estado REAL de un capturista sin `wip-ver`: el seguimiento le devuelve 403, así que
    // el mapa de `disponible` llega vacío, todo lo que teclee cuenta como exceso y el botón no se
    // habilita. ⇒ por la UI de HOY la barra del recién guardado no se alcanza, y el gate de arriba es
    // una red, no un parche a un agujero abierto.
    //
    // 🔑 La prueba se queda porque fija esa dependencia: si alguien «arregla» el exceso para que no
    // bloquee cuando no hay disponible, la barra pasa a ser alcanzable de verdad — y el gate, lo
    // único que evitaría el 403.
    useSeguimientoEntrega.mockReturnValue({
      data: undefined,
      isError: true,
      isPending: false,
      refetch: vi.fn(),
    });
    const usuario = userEvent.setup();
    pintar(['produccion.entrega']);
    await usuario.click(screen.getByTestId('elegir-orden'));
    await usuario.selectOptions(screen.getByTestId('entrega-almacen'), '1');
    await usuario.type(screen.getByTestId('entrega-matriz-celda'), '1');

    expect(screen.getByTestId('entrega-guardar')).toBeDisabled();
    expect(screen.getByTestId('entrega-aviso-exceso')).toBeInTheDocument();
    expect(crearEntrega).not.toHaveBeenCalled();
  });
});
