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

/** La orden que «elige» el selector simulado (las pruebas de la 0.219 usan una de tres celdas). */
let ordenDelSelector: Orden = ORDEN;

const crearEntrega = vi.fn();
const useEntregasOrden = vi.fn<() => unknown>();
const useSeguimientoEntrega = vi.fn<(...args: unknown[]) => unknown>();
const respuestaOrden = vi.fn<(id?: number) => unknown>();
/** Lo que devuelve react-query para un id que no es el de la orden (o `undefined`: consulta apagada). */
const SIN_ORDEN = { data: undefined, isError: false, isPending: false };

// 0.227: el mock DEPENDE DEL ID, como el hook real. Si devolviera la orden con `useOrden(undefined)`,
// la pantalla la «tendría» sin que nadie la eligiera y una prueba de enlace directo pasaría aunque
// el enlace no hiciera nada.
vi.mock('@/api/ordenes', () => ({
  useOrden: (id?: number) => (id === ORDEN.id ? respuestaOrden(id) : SIN_ORDEN),
}));
vi.mock('@/api/entregas-cliente', () => ({
  CLAVE_ENTREGAS: ['entregas'],
  useEntregasOrden: () => useEntregasOrden(),
  // Se le pasan los argumentos (orden, query, habilitado) para poder medir CUÁNDO se pide (0.219).
  useSeguimientoEntrega: (...args: unknown[]) => useSeguimientoEntrega(...args),
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
  SelectorOrden: ({
    alSeleccionar,
    etiquetaSeleccion,
  }: {
    alSeleccionar: (o: Orden) => void;
    etiquetaSeleccion?: string;
  }) => (
    <>
      <button
        type="button"
        data-testid="elegir-orden"
        onClick={() => alSeleccionar(ordenDelSelector)}
      >
        Elegir orden
      </button>
      {/* 0.227: cómo rotula el buscador la orden elegida que no viene en su lista. */}
      <span data-testid="selector-etiqueta">{etiquetaSeleccion ?? ''}</span>
    </>
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
  ordenDelSelector = ORDEN;
  respuestaOrden.mockReturnValue({ data: ORDEN, isError: false, isPending: false });
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
    // sesión NO lleve `wip-ver` (la pantalla ya ni la pide). Da igual para lo que se mide: desde la
    // fila 0.219 la barra es alcanzable de verdad SIN el seguimiento —lo mide el tercer bloque de
    // este archivo—, así que este gate es el único freno.
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
  it('🔴 0.219: sin el seguimiento (que pide `wip-ver`) «Guardar entrega» SÍ se habilita y guarda', async () => {
    // Hasta la v0.196 esta prueba fijaba lo CONTRARIO: sin `wip-ver` el mapa de existencia llegaba
    // vacío, todo contaba como exceso y el botón nunca se habilitaba. Era un ACCIDENTE que la fila
    // 0.219 corrige a propósito: una existencia que NO se sabe no bloquea (bloquear sería inventar un
    // cero) y decide el servidor. ⇒ la barra del recién guardado es alcanzable de verdad sin
    // `wip-ver`, y el gate del comprobante (primer bloque) pasa a ser el único freno.
    const refetch = vi.fn();
    useSeguimientoEntrega.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: false,
      refetch,
    });
    const usuario = userEvent.setup();
    pintar(['produccion.entrega']);
    await capturarUnaEntrega(usuario);
    // Tampoco se re-pide al guardar: `refetch` ignora `enabled: false` y sería un 403 seguro.
    expect(refetch).not.toHaveBeenCalled();

    // La consulta ni se pide (sería un 403 seguro): el tercer argumento es `habilitado`.
    expect(useSeguimientoEntrega).toHaveBeenCalled();
    for (const llamada of useSeguimientoEntrega.mock.calls) {
      expect(llamada[2]).toBe(false);
    }
    expect(screen.queryByTestId('entrega-aviso-exceso')).not.toBeInTheDocument();
    expect(screen.getByText(/Última entrega guardada: #3/)).toBeInTheDocument();
    expect(screen.queryByTestId('entrega-pdf')).not.toBeInTheDocument();
  });
});

/**
 * ⭐⭐ FILA 0.219 — LA ENTREGA ENSEÑA LA EXISTENCIA POR TALLA (punto 10b del repaso de Daniel):
 * *«Debería de decir la existencia que hay por talla para saber lo que se va a capturar no exceda la
 * cantidad por talla.»*
 *
 * La orden de estas pruebas tiene TRES celdas con existencias DISTINTAS a propósito —Rojo CH 5,
 * Rojo M 0, Azul CH 8—: si la pantalla mirara otra talla u otro color, el número pintado cambiaría
 * y la prueba lo vería.
 */
describe('⭐ 0.219 — la existencia por talla se pinta bajo cada celda', () => {
  const PERMISOS = ['produccion.entrega', 'produccion.wip-ver'];

  const ORDEN_TRES = {
    ...ORDEN,
    lineas: [
      {
        idColor: 7,
        color: 'Rojo',
        pack: '',
        tallas: [
          { idTalla: 11, etiquetaTalla: 'CH', cantidad: 10 },
          { idTalla: 12, etiquetaTalla: 'M', cantidad: 10 },
        ],
      },
      {
        idColor: 8,
        color: 'Azul',
        pack: '',
        tallas: [{ idTalla: 11, etiquetaTalla: 'CH', cantidad: 10 }],
      },
    ],
    totalPiezas: 30,
  } as unknown as Orden;

  const celda = (idColor: number, idTalla: number, disponible: number) => ({
    idColor,
    idTalla,
    pedido: 10,
    entregado: 0,
    faltante: 10,
    disponible,
  });
  const SEGUIMIENTO_TRES = {
    ...SEGUIMIENTO,
    totalPedido: 30,
    totalFaltante: 30,
    celdas: [celda(7, 11, 5), celda(7, 12, 0), celda(8, 11, 8)],
  };

  /** El input de una celda por su etiqueta accesible, y lo que la pantalla pinta debajo. */
  const input = (etiqueta: string): HTMLElement => screen.getByLabelText(etiqueta);
  function leyendaDe(etiqueta: string): HTMLElement | null {
    const td = input(etiqueta).closest('td');
    return td?.querySelector('[data-testid="entrega-existencia"]') ?? null;
  }

  async function prepararCaptura(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
    await usuario.click(screen.getByTestId('elegir-orden'));
    await usuario.selectOptions(screen.getByTestId('entrega-almacen'), '1');
  }

  beforeEach(() => {
    ordenDelSelector = ORDEN_TRES;
    respuestaOrden.mockReturnValue({ data: ORDEN_TRES, isError: false, isPending: false });
    useSeguimientoEntrega.mockReturnValue({
      data: SEGUIMIENTO_TRES,
      isError: false,
      isPending: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    });
  });

  it('pinta «Hay N» por color×talla y dice el cero con su nombre («Sin existencia»)', async () => {
    const usuario = userEvent.setup();
    pintar(PERMISOS);
    await prepararCaptura(usuario);

    expect(leyendaDe('Rojo, talla CH')).toHaveTextContent(/^Hay 5$/);
    expect(leyendaDe('Rojo, talla M')).toHaveTextContent(/^Sin existencia$/);
    expect(leyendaDe('Azul, talla CH')).toHaveTextContent(/^Hay 8$/);
    // El cero se pinta en rojo aunque no se haya tecleado nada: ahí no hay qué entregar.
    expect(leyendaDe('Rojo, talla M')).toHaveAttribute('data-tono', 'crit');
    expect(leyendaDe('Rojo, talla CH')).toHaveAttribute('data-tono', 'normal');
  });

  it('lo que EXCEDE la existencia de ESA talla se pinta «Excede · hay N» y no deja guardar', async () => {
    const usuario = userEvent.setup();
    pintar(PERMISOS);
    await prepararCaptura(usuario);

    // 6 cabe en Azul CH (hay 8) pero NO en Rojo CH (hay 5): distingue color y talla.
    await usuario.type(input('Azul, talla CH'), '6');
    expect(leyendaDe('Azul, talla CH')).toHaveTextContent(/^Hay 8$/);
    expect(screen.getByTestId('entrega-guardar')).toBeEnabled();

    await usuario.type(input('Rojo, talla CH'), '6');
    expect(leyendaDe('Rojo, talla CH')).toHaveTextContent(/^Excede · hay 5$/);
    expect(leyendaDe('Rojo, talla CH')).toHaveAttribute('data-tono', 'crit');
    expect(screen.getByTestId('entrega-aviso-exceso')).toHaveTextContent(/1 pieza\(s\)/);
    expect(screen.getByTestId('entrega-guardar')).toBeDisabled();

    // Al bajarlo a lo que hay, vuelve a «Hay 5» y se puede guardar.
    await usuario.clear(input('Rojo, talla CH'));
    await usuario.type(input('Rojo, talla CH'), '5');
    expect(leyendaDe('Rojo, talla CH')).toHaveTextContent(/^Hay 5$/);
    expect(screen.getByTestId('entrega-guardar')).toBeEnabled();
  });

  it('teclear en la talla SIN existencia la sigue diciendo «Sin existencia» y no deja guardar', async () => {
    const usuario = userEvent.setup();
    pintar(PERMISOS);
    await prepararCaptura(usuario);

    await usuario.type(input('Rojo, talla M'), '1');
    expect(leyendaDe('Rojo, talla M')).toHaveTextContent(/^Sin existencia$/);
    expect(screen.getByTestId('entrega-guardar')).toBeDisabled();
  });

  it('sin almacén elegido no pinta nada (no hay a qué preguntarle)', async () => {
    const usuario = userEvent.setup();
    pintar(PERMISOS);
    await usuario.click(screen.getByTestId('elegir-orden'));

    expect(screen.queryAllByTestId('entrega-existencia')).toHaveLength(0);
  });

  describe('«no se sabe» NO se pinta como cero y deja pasar (decide el servidor)', () => {
    /** Teclea MUCHO más de lo que hay y comprueba que la pantalla no frena ni inventa un número. */
    async function teclearDeMas(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
      await prepararCaptura(usuario);
      await usuario.type(input('Rojo, talla M'), '99');
      expect(screen.queryAllByTestId('entrega-existencia')).toHaveLength(0);
      expect(screen.queryByTestId('entrega-aviso-exceso')).not.toBeInTheDocument();
      expect(screen.getByTestId('entrega-guardar')).toBeEnabled();
    }

    it('la consulta FALLÓ: lo dice y deja capturar', async () => {
      useSeguimientoEntrega.mockReturnValue({
        data: undefined,
        isError: true,
        isPending: false,
        refetch: vi.fn(),
      });
      const usuario = userEvent.setup();
      pintar(PERMISOS);
      await teclearDeMas(usuario);
      expect(screen.getByTestId('entrega-existencia-desconocida')).toBeInTheDocument();
    });

    it('sin `produccion.wip-ver`: ni la pide, lo dice y deja capturar', async () => {
      useSeguimientoEntrega.mockReturnValue({
        data: undefined,
        isError: false,
        isPending: false,
        refetch: vi.fn(),
      });
      const usuario = userEvent.setup();
      pintar(['produccion.entrega']);
      await teclearDeMas(usuario);
      expect(screen.getByTestId('entrega-existencia-desconocida')).toBeInTheDocument();
    });

    it('CARGANDO: no pinta ni bloquea (y tampoco dice que falló)', async () => {
      useSeguimientoEntrega.mockReturnValue({
        data: undefined,
        isError: false,
        isPending: true,
        refetch: vi.fn(),
      });
      const usuario = userEvent.setup();
      pintar(PERMISOS);
      await teclearDeMas(usuario);
      expect(screen.queryByTestId('entrega-existencia-desconocida')).not.toBeInTheDocument();
    });

    it('dato del almacén ANTERIOR (`keepPreviousData`): no se pinta como si fuera de éste', async () => {
      // La consulta trae el disponible del almacén de antes mientras vuelve el nuevo: pintarlo sería
      // decir lo que hay en OTRO almacén, y bloquear con él, frenar por un número ajeno.
      useSeguimientoEntrega.mockReturnValue({
        data: SEGUIMIENTO_TRES,
        isError: false,
        isPending: false,
        isPlaceholderData: true,
        refetch: vi.fn(),
      });
      const usuario = userEvent.setup();
      pintar(PERMISOS);
      await teclearDeMas(usuario);
    });
  });
});

describe('⭐ 0.226b — la orden CERRADA apaga la entrega (§Post-F9.244)', () => {
  const PERMISOS = ['produccion.entrega', 'produccion.wip-ver', 'produccion.cancelar'];

  it('cerrada: avisa y apaga almacén, matriz y «Guardar»; el historial ya no ofrece cancelar', async () => {
    respuestaOrden.mockReturnValue({
      data: { ...ORDEN, cerradaEn: '2026-10-01T10:00:00.000Z', estado: 'cerrada' },
      isError: false,
      isPending: false,
    });
    useEntregasOrden.mockReturnValue({
      data: {
        entregas: [
          {
            id: 70,
            folio: 2,
            cliente: 'C&A',
            totalPiezas: 4,
            fecha: '2026-09-30',
            cancelado: false,
            motivoCancelacion: null,
          },
        ],
      },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    const usuario = userEvent.setup();
    pintar(PERMISOS);
    await usuario.click(screen.getByTestId('elegir-orden'));

    expect(screen.getByTestId('aviso-orden-cerrada')).toHaveTextContent(
      /La orden 5424 está cerrada/,
    );
    expect(screen.getByTestId('entrega-almacen')).toBeDisabled();
    expect(screen.getByTestId('entrega-guardar')).toBeDisabled();
    // La consulta sigue libre: el historial se ve, pero no se cancela.
    expect(screen.getByTestId('historial-entrega')).toBeInTheDocument();
    expect(screen.queryByTestId('historial-entrega-cancelar')).not.toBeInTheDocument();
  });

  it('abierta: sin aviso, y se captura y guarda', async () => {
    const usuario = userEvent.setup();
    pintar(PERMISOS);
    await usuario.click(screen.getByTestId('elegir-orden'));

    expect(screen.queryByTestId('aviso-orden-cerrada')).not.toBeInTheDocument();
    await usuario.selectOptions(screen.getByTestId('entrega-almacen'), '1');
    await usuario.type(screen.getByTestId('entrega-matriz-celda'), '1');
    expect(screen.getByTestId('entrega-guardar')).toBeEnabled();
  });

  it('la ÚLTIMA entrega guardada deja de ofrecer «Cancelar» si la orden se cierra después', async () => {
    const usuario = userEvent.setup();
    pintar(PERMISOS);
    await capturarUnaEntrega(usuario);
    expect(screen.getByTestId('entrega-cancelar')).toBeInTheDocument();

    // La orden se CIERRA (llega en el siguiente render, p. ej. tras un refetch): el botón se va.
    respuestaOrden.mockReturnValue({
      data: { ...ORDEN, cerradaEn: '2026-10-01T10:00:00.000Z', estado: 'cerrada' },
      isError: false,
      isPending: false,
    });
    await usuario.type(screen.getByTestId('entrega-observaciones'), 'x');
    expect(screen.getByTestId('aviso-orden-cerrada')).toBeInTheDocument();
    expect(screen.queryByTestId('entrega-cancelar')).not.toBeInTheDocument();
    // El comprobante de la última entrega sigue (consultar es libre).
    expect(screen.getByTestId('entrega-pdf')).toBeInTheDocument();
  });

  it('⭐ 0.227: con ENLACE DIRECTO la orden queda ELEGIDA (matriz) y el buscador la rotula', async () => {
    // El tablero WIP abre la entrega de una orden por su id; el buscador oculta las cerradas y
    // sólo trae 8, así que la pantalla tiene que elegirla ella y pasarle el rótulo.
    renderConProveedores(<EntregaClientePagina />, {
      sesion: estadoSesionDePrueba(['produccion.entrega', 'produccion.wip-ver']),
      rutaInicial: { pathname: '/produccion/entregas', state: { idOrden: ORDEN.id } },
    });
    // Elegida de verdad: se pinta su matriz de captura (sin tocar `elegir-orden`).
    expect(await screen.findByTestId('entrega-matriz-celda')).toBeInTheDocument();
    expect(screen.getByTestId('selector-etiqueta')).toHaveTextContent('Orden #5424');
    expect(screen.queryByTestId('aviso-orden-cerrada')).not.toBeInTheDocument();
  });

  it('⭐ 0.227: ENLACE DIRECTO a una orden CERRADA también la elige, y avisa (consultar es libre)', async () => {
    respuestaOrden.mockReturnValue({
      data: { ...ORDEN, cerradaEn: '2026-10-01T10:00:00.000Z', estado: 'cerrada' },
      isError: false,
      isPending: false,
    });
    renderConProveedores(<EntregaClientePagina />, {
      sesion: estadoSesionDePrueba(['produccion.entrega', 'produccion.wip-ver']),
      rutaInicial: { pathname: '/produccion/entregas', state: { idOrden: ORDEN.id } },
    });
    expect(await screen.findByTestId('aviso-orden-cerrada')).toHaveTextContent(
      /La orden 5424 está cerrada/,
    );
    expect(screen.getByTestId('selector-etiqueta')).toHaveTextContent('Orden #5424');
    expect(screen.getByTestId('entrega-guardar')).toBeDisabled();
  });
});
