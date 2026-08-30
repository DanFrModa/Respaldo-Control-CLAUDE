import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden, WipOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * Pruebas de la CAPTURA del avance de producción con las tres reglas que dictó Daniel el
 * 28-jul-2026:
 *   1. la ENTREGA a maquila arranca con el maquilero ya programado en la OP;
 *   2. el RECIBO solo ofrece maquileros a los que SÍ se les entregó (y el pendiente que se les
 *      teclea es el de ESE maquilero, no el del proceso entero);
 *   3. la etapa de CORTE ofrece el enlace para descargar la tela del inventario.
 * La capa de datos va simulada (sin red): lo que se prueba es la pantalla, no el API. La regla 2
 * la RE-VALIDA el servidor (`recibos.int.test.ts`) — aquí solo se comprueba la comodidad.
 */

const useOrden = vi.fn<() => unknown>();
const useWipOrden = vi.fn<() => unknown>();
const useProveedores = vi.fn<() => unknown>();
const navegar = vi.fn();

vi.mock('@/api/ordenes', () => ({ useOrden: () => useOrden() }));
vi.mock('@/api/wip', () => ({ CLAVE_WIP: ['wip'], useWipOrden: () => useWipOrden() }));
// Los mocks incluyen `isError`/`refetch` porque el panel ofrece un AVISO REINTENTABLE de catálogos
// (V1-E3a): sin `refetch` el botón "Reintentar" tronaría.
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => useProveedores(),
  useRolesProveedor: () => ({
    data: [{ id: 9, codigo: 'maquila-costura', nombre: 'Costura' }],
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: {
      datos: [
        { id: 1, nombre: 'Primeras', tipo: 'PT', activo: true, esTransitoProceso: false },
        // V1-E4b (H5): el catálogo SÍ trae el almacén de tránsito; la pantalla NO debe ofrecerlo.
        { id: 4, nombre: 'Tránsito', tipo: 'PT', activo: true, esTransitoProceso: true },
      ],
    },
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/api/tipos-proceso', () => ({
  useTiposProceso: () => ({
    data: {
      datos: [
        { id: 5, codigo: 'costura', nombre: 'Costura', generaEntradaPt: true, activo: true },
        { id: 6, codigo: 'estampado', nombre: 'Estampado', generaEntradaPt: false, activo: true },
      ],
    },
    isError: false,
    refetch: vi.fn(),
  }),
}));
const crearCorte = vi.fn();
const crearEnvio = vi.fn();
const crearRecibo = vi.fn();
const cancelarEnvio = vi.fn();
const useEtapasOrden = vi.fn<() => unknown>();
/** V1-E8i: qué propone el servidor para precargar la matriz (los botones de un clic). */
const useSugerenciaCaptura = vi.fn<(...a: unknown[]) => unknown>();
vi.mock('@/api/etapas', () => ({
  CLAVE_ETAPAS: ['etapas'],
  useEtapasOrden: () => useEtapasOrden(),
  // ⚠️ H2 del reviewer: los argumentos se PASAN. Con `() => useSugerenciaCaptura()` el mock los
  // descartaba y mutar el proceso a uno inexistente pasaba las 75 pruebas en verde — ni este lado
  // ni el servidor verificaban a QUÉ PROCESO se le pregunta.
  useSugerenciaCaptura: (...a: unknown[]) => useSugerenciaCaptura(...a),
  useCrearCorte: () => ({ mutate: crearCorte, isPending: false }),
  useCrearEnvio: () => ({ mutate: crearEnvio, isPending: false }),
  useCancelarCorte: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarEnvio: () => ({ mutate: cancelarEnvio, isPending: false }),
  urlImpresoEnvio: (id: number) => `/api/produccion/envios/${id}/impreso`,
  urlFichaEstampado: (id: number) => `/api/produccion/envios/${id}/ficha-estampado`,
}));
vi.mock('@/api/recibos', () => ({
  CLAVE_RECIBOS: ['recibos'],
  useCrearRecibo: () => ({ mutate: crearRecibo, isPending: false }),
  useCancelarRecibo: () => ({ mutate: vi.fn(), isPending: false }),
  urlImpresoRecibo: (id: number) => `/api/produccion/recibos/${id}/impreso`,
}));
const crearEntrega = vi.fn();
const useEntregasOrden = vi.fn<() => unknown>();
const useSeguimientoEntrega = vi.fn<() => unknown>();
vi.mock('@/api/entregas-cliente', () => ({
  CLAVE_ENTREGAS: ['entregas'],
  useEntregasOrden: () => useEntregasOrden(),
  useSeguimientoEntrega: () => useSeguimientoEntrega(),
  useCrearEntrega: () => ({ mutate: crearEntrega, isPending: false }),
  useCancelarEntrega: () => ({ mutate: vi.fn(), isPending: false }),
  urlComprobanteEntrega: (id: number) => `/api/produccion/entregas-cliente/${id}/comprobante`,
}));
vi.mock('@/api/ordenes-centro', () => ({ CLAVE_ORDENES_CENTRO: ['centro'] }));
vi.mock('react-router-dom', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useNavigate: () => navegar,
}));

const { AvanceProduccion } = await import('./AvanceProduccion');

const PERMISOS = [
  'produccion.wip-ver',
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  // V1-E3a: la entrega a cliente es una etapa más del panel, gateada por su permiso de siempre (A4).
  'produccion.entrega',
  'produccion.cancelar',
  'ordenes.ver-precio-real-maquila',
  'inventario-telas.mover',
] as const;

/** Orden con matriz de un color × una talla y el maquilero YA programado. */
function orden(idMaquilero: number | null, maquilero: string | null): Orden {
  return {
    id: 1,
    folio: 5424,
    codigoModelo: '62182',
    idModelo: 3,
    cliente: 'C&A',
    estado: 'capturada',
    idMaquilero,
    maquilero,
    lineas: [
      {
        idColor: 7,
        color: 'Rojo',
        tallas: [{ idTalla: 11, etiquetaTalla: 'CH', cantidad: 10 }],
      },
    ],
    referencias: [],
    totalPiezas: 10,
  } as unknown as Orden;
}

/** WIP con 10 cortadas y lo enviado repartido entre maquileros (id `null` = migrado sin tercero). */
function wip(
  porMaquilero: {
    idMaquilero: number | null;
    maquilero: string;
    pendiente: number;
    /** Celdas explícitas; por default, una sola celda con el pendiente. */
    celdas?: { cantidad: number; incompletas?: number }[];
  }[],
): WipOrden {
  const celda = { idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH' };
  return {
    idOrden: 1,
    folio: 5424,
    estado: 'capturada',
    idModelo: 3,
    codigoModelo: '62182',
    idCliente: 4,
    cliente: 'C&A',
    pedido: 10,
    cortado: 10,
    enviado: 10,
    recibido: 0,
    incompletas: 0,
    pendientePorRecibir: 10,
    // Lo publica el SERVIDOR desde V1-E8v (antes la pantalla lo despejaba del pendiente, que era la
    // NOVENA puerta): 10 enviadas al proceso de costura.
    enviadoCostura: 10,
    recibidoCostura: 0,
    entregado: 0,
    porEntregar: 0,
    // `porCortar` trae SIEMPRE todas las celdas de la orden, ceros incluidos: el servidor lo arma
    // sobre pedido ∪ cortado sin filtrarlos (`wip.ts`). Con las 10 ya cortadas, el pendiente de
    // corte es 0 — el fixture tenía `[]`, que en el servidor solo pasa con una orden SIN celdas.
    porCortar: [{ ...celda, cantidad: 0 }],
    // `cortadoCeldas` = Σ corte por celda, tal como lo manda el servidor (V1-E8i): es la base del
    // disponible a enviar cuando el proceso todavía no tiene envíos.
    cortadoCeldas: [{ ...celda, cantidad: 10 }],
    cortadoPorEnviar: [],
    porRecibir: [
      {
        idTipoProceso: 5,
        tipoProceso: 'Costura',
        codigoProceso: 'costura',
        generaEntradaPt: true,
        // ⚠️ Las celdas del PROCESO llevan sólo `cantidad` (esquema `esquemaWipCelda`); las
        // `incompletas` viajan únicamente en el desglose POR MAQUILERO (`esquemaWipCeldaPorRecibir`),
        // que es donde la pantalla las usa. Este fixture ponía `incompletas` aquí también —una
        // respuesta que el servidor NO produce— y el `as unknown as` lo tapaba (hallazgo del
        // reviewer). Ahora el objeto se valida con `satisfies`, así que la forma no puede mentir.
        celdas: [{ ...celda, cantidad: 10 }],
        totalPendiente: 10,
        totalIncompletas: 0,
        porMaquilero: porMaquilero.map((m) => ({
          idMaquilero: m.idMaquilero,
          maquilero: m.maquilero,
          celdas: (m.celdas ?? [{ cantidad: m.pendiente }]).map((c) => ({
            ...celda,
            cantidad: c.cantidad,
            incompletas: c.incompletas ?? 0,
          })),
          totalPendiente: m.pendiente,
          totalIncompletas: (m.celdas ?? []).reduce((t, c) => t + (c.incompletas ?? 0), 0),
        })),
      },
    ],
    entregadoCeldas: [],
  } satisfies WipOrden;
}

function pintar(props: { etapaInicial?: string } = {}): void {
  renderConProveedores(
    <AvanceProduccion
      idOrden={1}
      alCerrar={vi.fn()}
      {...(props.etapaInicial === undefined
        ? {}
        : { etapaInicial: props.etapaInicial as 'corte' | 'recibo-aplicacion' })}
    />,
    { sesion: estadoSesionDePrueba([...PERMISOS]) },
  );
}

/** Abre la etapa indicada del stepper (por su clave) y su formulario de captura. */
async function abrirCaptura(
  usuario: ReturnType<typeof userEvent.setup>,
  clave: string,
): Promise<void> {
  await usuario.click(screen.getByTestId(`avance-stepper-${clave}`));
  await usuario.click(screen.getByTestId('avance-abrir-captura'));
}

beforeEach(() => {
  navegar.mockReset();
  crearCorte.mockReset();
  crearEnvio.mockReset();
  crearRecibo.mockReset();
  // La cancelación responde OK por default (el panel reacciona en `onSuccess`).
  cancelarEnvio.mockReset();
  cancelarEnvio.mockImplementation(
    (_args: unknown, opciones: { onSuccess: () => void }) => void opciones.onSuccess(),
  );
  crearEntrega.mockReset();
  useEtapasOrden.mockReturnValue({ data: { etapas: [] }, isPending: false });
  // Default: no hay nada que precargar (los tests que lo prueban lo re-mockean con su caso), y el
  // motivo CUADRA con las celdas — H5 del reviewer: el default anterior decía `motivo: 'hay'` con
  // `celdas: []`, una forma que el servidor nunca emite.
  useSugerenciaCaptura.mockReturnValue({
    data: {
      idOrden: 1,
      base: 'corte',
      idTipoProceso: null,
      celdas: [],
      total: 0,
      motivo: 'todo-cortado',
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  useEntregasOrden.mockReturnValue({ data: { entregas: [] }, isPending: false });
  useSeguimientoEntrega.mockReturnValue({ data: undefined, isPending: false });
  useOrden.mockReturnValue({
    data: orden(77, 'Maquila del Norte'),
    isPending: false,
    isError: false,
    error: null,
  });
  useWipOrden.mockReturnValue({
    data: wip([
      { idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 6 },
      { idMaquilero: 88, maquilero: 'Otra Maquila', pendiente: 4 },
    ]),
    isPending: false,
  });
  useProveedores.mockReset();
  useProveedores.mockReturnValue({
    data: { datos: [{ id: 99, nombre: 'Maquila del Sur' }] },
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe('Captura del avance · entrega a maquila', () => {
  it('arranca con el maquilero YA PROGRAMADO en la OP', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');

    // El asignado NO está en la página de proveedores del catálogo (que trae "Maquila del Sur"):
    // aun así el campo lo pinta, porque el padre pasa su etiqueta.
    await waitFor(() => {
      expect(screen.getByTestId('avance-proveedor-input')).toHaveValue('Maquila del Norte');
    });
  });

  it('al elegir OTRO maquilero el campo conserva el elegido (no lo pisa el de la OP)', async () => {
    // Se reproduce el camino REAL: con >100 maquileros el typeahead va al servidor, así que la
    // página SOLO trae a "Maquila del Sur" mientras se le busca; al elegirlo, el combobox resetea
    // la búsqueda y la página vuelve SIN él. Ahí es donde la etiqueta fija de la OP le pisaba el
    // nombre y el campo terminaba mostrando un maquilero distinto del que se iba a guardar.
    let paginaCatalogo: { id: number; nombre: string }[] = [{ id: 55, nombre: 'Maquila Centro' }];
    useProveedores.mockImplementation(() => ({
      data: { datos: paginaCatalogo },
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    }));

    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');
    await waitFor(() => {
      expect(screen.getByTestId('avance-proveedor-input')).toHaveValue('Maquila del Norte');
    });

    // Se teclea la búsqueda: la página del servidor ahora sí trae al del sur.
    paginaCatalogo = [{ id: 99, nombre: 'Maquila del Sur' }];
    await usuario.clear(screen.getByTestId('avance-proveedor-input'));
    await usuario.type(screen.getByTestId('avance-proveedor-input'), 'sur');
    const opcionSur = await screen.findByText('Maquila del Sur');

    // Al elegir, el combobox resetea la búsqueda y el typeahead vuelve a consultar: la página que
    // llega YA NO trae al elegido (es lo que pasa con >100 maquileros). Se prepara ANTES del clic
    // para que ese re-render del padre ocurra de verdad.
    paginaCatalogo = [{ id: 55, nombre: 'Maquila Centro' }];
    await usuario.click(opcionSur);
    // Y se SALE del campo, que es cuando el combobox re-sincroniza el texto con la etiqueta de la
    // selección: ahí es donde la etiqueta fija de la OP pisaba el nombre elegido.
    await usuario.tab();
    await waitFor(() => {
      expect(screen.getByTestId('avance-proveedor-input')).toHaveValue('Maquila del Sur');
    });
  });

  it('sin maquilero programado el campo arranca VACÍO (es un default, no un invento)', async () => {
    useOrden.mockReturnValue({
      data: orden(null, null),
      isPending: false,
      isError: false,
      error: null,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');

    expect(screen.getByTestId('avance-proveedor-input')).toHaveValue('');
  });
});

describe('Captura del avance · recibo de maquila', () => {
  it('solo ofrece a los maquileros con entrega viva, con lo que les falta devolver', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    // El campo arranca vacío (no hereda el maquilero de la OP: aquí se elige a quién se le recibe).
    expect(screen.getByTestId('avance-proveedor-input')).toHaveValue('');

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    // Los dos que recibieron corte, con su pendiente…
    expect(await screen.findByText('Maquila del Norte')).toBeInTheDocument();
    expect(screen.getByText('Otra Maquila')).toBeInTheDocument();
    expect(screen.getByText('6 pza(s) por recibirle')).toBeInTheDocument();
    expect(screen.getByText('4 pza(s) por recibirle')).toBeInTheDocument();
    // …y NADIE del catálogo general: a "Maquila del Sur" no se le entregó nada de esta orden.
    expect(screen.queryByText('Maquila del Sur')).not.toBeInTheDocument();
  });

  // La otra mitad de la regla: lo que se TECLEA se topa contra el pendiente de ESE maquilero, no
  // contra el del proceso entero (el reviewer probó por mutación que esto no estaba cubierto).
  it('la matriz se topa contra el pendiente del maquilero ELEGIDO, no del proceso', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    // Sin maquilero elegido no hay referencia: no se ofrece un tope que no aplica a nadie.
    expect(screen.queryByTestId('avance-matriz-hint')).not.toBeInTheDocument();

    // Otra Maquila tiene 4 de las 10 del proceso.
    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Otra Maquila'));
    await waitFor(() => {
      expect(screen.getByTestId('avance-matriz-hint')).toHaveTextContent('de 4');
    });

    // Y al cambiar de maquilero, el tope cambia con él (Norte tiene 6). Se borra el campo para que
    // el combobox suelte la selección y vuelva a ofrecer la lista completa.
    await usuario.clear(screen.getByTestId('avance-proveedor-input'));
    await usuario.type(screen.getByTestId('avance-proveedor-input'), 'norte');
    await usuario.click(await screen.findByText('Maquila del Norte'));
    await waitFor(() => {
      expect(screen.getByTestId('avance-matriz-hint')).toHaveTextContent('de 6');
    });
  });

  it('el SELECTOR no ofrece al maquilero que ya entregó todo en incompletas', async () => {
    // LA CUARTA PUERTA (hallazgo del reviewer): una pantalla ANTES de la matriz. Con 10 enviadas y
    // 8 buenas + 2 incompletas, el maquilero ya entregó las 10 y su pendiente es 0 (V1-E8v,
    // §Post-F9.147): no hay que ofrecérselo ni anunciarle piezas «por recibirle».
    useWipOrden.mockReturnValue({
      data: wip([
        {
          idMaquilero: 77,
          maquilero: 'Maquila del Norte',
          pendiente: 0,
          celdas: [{ cantidad: 0, incompletas: 2 }],
        },
        {
          idMaquilero: 88,
          maquilero: 'Otra Maquila',
          pendiente: 4,
          celdas: [{ cantidad: 4, incompletas: 0 }],
        },
      ]),
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');
    await usuario.click(screen.getByTestId('avance-proveedor-input'));

    // Al que ya entregó todo (0 pendientes) NO se le ofrece…
    expect(await screen.findByText('Otra Maquila')).toBeInTheDocument();
    expect(screen.queryByText('Maquila del Norte')).not.toBeInTheDocument();
    // …y sobre todo: NO se anuncia «2 pza(s) por recibirle», que era la mentira.
    expect(screen.queryByText('2 pza(s) por recibirle')).not.toBeInTheDocument();
    // El que sí tiene pendiente se anuncia con su número real.
    expect(screen.getByText('4 pza(s) por recibirle')).toBeInTheDocument();
  });

  it('el maquilero que ya devolvió todo no se ofrece (no hay qué recibirle)', async () => {
    useWipOrden.mockReturnValue({
      data: wip([
        { idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 10 },
        { idMaquilero: 88, maquilero: 'Otra Maquila', pendiente: 0 },
      ]),
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    expect(await screen.findByText('Maquila del Norte')).toBeInTheDocument();
    expect(screen.queryByText('Otra Maquila')).not.toBeInTheDocument();
  });
});

/**
 * V1-E3a: lo que ANTES solo tenían las tres pantallas retiradas (`/produccion/{corte,envios,
 * recibos}`) y que se migró al panel. Sin estas pruebas, retirarlas habría perdido funcionalidad en
 * silencio: el toggle de SEGUNDAS y los IMPRESOS vivían solo allá.
 */
describe('Captura del avance · SEGUNDAS del recibo (migradas de /produccion/recibos)', () => {
  it('el recibo manda el DESGLOSE de calidad; sin el toggle manda "todo primeras"', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    // Maquilero + almacén de primeras + 6 piezas.
    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Maquila del Norte'));
    await usuario.selectOptions(screen.getByTestId('avance-almacen-primeras'), '1');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '6');

    // SIN el interruptor: el cuerpo va sin desglose (el backend lo lee como todo primeras).
    await usuario.click(screen.getByTestId('avance-guardar'));
    expect(crearRecibo).toHaveBeenCalledTimes(1);
    const sinDesglose = crearRecibo.mock.calls[0]?.[0] as {
      lineas: { tallas: Record<string, unknown>[] }[];
    };
    expect(sinDesglose.lineas[0]?.tallas[0]).toEqual({ idTalla: 11, cantidad: 6 });

    // CON el interruptor y 2 de segunda: primeras = 4, segundas = 2 (el desglose que el backend
    // exige que sume el total). Antes esto era IMPOSIBLE por el camino principal.
    await usuario.click(screen.getByTestId('avance-toggle-segundas'));
    await usuario.selectOptions(screen.getByTestId('avance-almacen-segundas'), '1');
    await usuario.type(screen.getByTestId('avance-matriz-segundas-celda'), '2');
    await usuario.click(screen.getByTestId('avance-guardar'));
    expect(crearRecibo).toHaveBeenCalledTimes(2);
    const conDesglose = crearRecibo.mock.calls[1]?.[0] as {
      idAlmacenSegundas?: number;
      lineas: { tallas: Record<string, unknown>[] }[];
    };
    expect(conDesglose.lineas[0]?.tallas[0]).toEqual({
      idTalla: 11,
      cantidad: 6,
      cantidadPrimeras: 4,
      cantidadSegundas: 2,
    });
    expect(conDesglose.idAlmacenSegundas).toBe(1);
  });

  it('bloquea guardar si en una celda las segundas superan el total (primeras negativas)', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Maquila del Norte'));
    await usuario.selectOptions(screen.getByTestId('avance-almacen-primeras'), '1');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '3');
    await usuario.click(screen.getByTestId('avance-toggle-segundas'));
    await usuario.selectOptions(screen.getByTestId('avance-almacen-segundas'), '1');
    await usuario.type(screen.getByTestId('avance-matriz-segundas-celda'), '5');

    expect(screen.getByTestId('avance-aviso-segundas')).toBeInTheDocument();
    expect(screen.getByTestId('avance-guardar')).toBeDisabled();
    await usuario.click(screen.getByTestId('avance-guardar'));
    expect(crearRecibo).not.toHaveBeenCalled();
  });

  it('el toggle NO existe en el corte ni en el envío (solo el recibo tiene calidad)', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');
    expect(screen.queryByTestId('avance-toggle-segundas')).not.toBeInTheDocument();
    await abrirCaptura(usuario, 'entrega-maquila');
    expect(screen.queryByTestId('avance-toggle-segundas')).not.toBeInTheDocument();
  });
});

/**
 * V1-E8k (§Post-F9.136) — PRENDAS INCOMPLETAS. *"Aunque son prendas inservibles, necesito que me las
 * entreguen (eso no se va a ningún inventario… tampoco se pagan)."* Lo que estas pruebas cuidan es
 * que la captura las mande en su PROPIO campo: si acabaran dentro de `cantidad`, se pagarían y se
 * inventariarían — exactamente lo contrario de lo pedido.
 */
describe('Captura del avance · PRENDAS INCOMPLETAS (V1-E8k)', () => {
  it('⭐ manda las incompletas en su propio campo, FUERA de la cantidad recibida', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Maquila del Norte'));
    await usuario.selectOptions(screen.getByTestId('avance-almacen-primeras'), '1');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '4');

    await usuario.click(screen.getByTestId('avance-toggle-incompletas'));
    await usuario.type(screen.getByTestId('avance-matriz-incompletas-celda'), '2');
    await usuario.click(screen.getByTestId('avance-guardar'));

    expect(crearRecibo).toHaveBeenCalledTimes(1);
    const cuerpo = crearRecibo.mock.calls[0]?.[0] as {
      lineas: { tallas: Record<string, unknown>[] }[];
    };
    // 4 recibidas + 2 incompletas: la cantidad NO se infla a 6.
    expect(cuerpo.lineas[0]?.tallas[0]).toEqual({
      idTalla: 11,
      cantidad: 4,
      cantidadIncompletas: 2,
    });
  });

  it('deja guardar un recibo que es SOLO de incompletas, y sin exigir almacén', async () => {
    // El caso de Daniel: el maquilero llega únicamente con las que no pudo coser. Nada entra a
    // inventario, así que el almacén no se pide (el servidor tampoco lo exige).
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Maquila del Norte'));
    await usuario.click(screen.getByTestId('avance-toggle-incompletas'));
    await usuario.type(screen.getByTestId('avance-matriz-incompletas-celda'), '3');

    expect(screen.getByTestId('avance-guardar')).toBeEnabled();
    await usuario.click(screen.getByTestId('avance-guardar'));
    const cuerpo = crearRecibo.mock.calls[0]?.[0] as {
      idAlmacenPrimeras?: number;
      lineas: { tallas: Record<string, unknown>[] }[];
    };
    expect(cuerpo.idAlmacenPrimeras).toBeUndefined();
    expect(cuerpo.lineas[0]?.tallas[0]).toEqual({
      idTalla: 11,
      cantidad: 0,
      cantidadIncompletas: 3,
    });
  });

  it('el tope de la matriz cuenta las incompletas: 4 + 3 sobre 6 pendientes se bloquea', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Maquila del Norte'));
    await usuario.selectOptions(screen.getByTestId('avance-almacen-primeras'), '1');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '4');
    await usuario.click(screen.getByTestId('avance-toggle-incompletas'));
    await usuario.type(screen.getByTestId('avance-matriz-incompletas-celda'), '3');

    // 4 + 3 = 7 piezas físicas sobre 6 pendientes ⇒ el servidor lo rechazaría bajo lock; la
    // pantalla lo para antes para no mandar al usuario a comerse un 400 con la matriz tecleada.
    expect(screen.getByTestId('avance-aviso-exceso')).toBeInTheDocument();
    expect(screen.getByTestId('avance-guardar')).toBeDisabled();
    await usuario.click(screen.getByTestId('avance-guardar'));
    expect(crearRecibo).not.toHaveBeenCalled();
  });

  it('el tope NO se cierra de más: 4 + 2 sobre 6 pendientes (el límite exacto) SÍ se guarda', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Maquila del Norte'));
    await usuario.selectOptions(screen.getByTestId('avance-almacen-primeras'), '1');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '4');
    await usuario.click(screen.getByTestId('avance-toggle-incompletas'));
    await usuario.type(screen.getByTestId('avance-matriz-incompletas-celda'), '2');

    // Justo en el límite (4 + 2 = 6). Un tope "cerrado de más" lo rechazaría.
    expect(screen.queryByTestId('avance-aviso-exceso')).not.toBeInTheDocument();
    expect(screen.getByTestId('avance-guardar')).toBeEnabled();
  });

  it('el toggle NO existe en el corte ni en el envío', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');
    expect(screen.queryByTestId('avance-toggle-incompletas')).not.toBeInTheDocument();
    await abrirCaptura(usuario, 'entrega-maquila');
    expect(screen.queryByTestId('avance-toggle-incompletas')).not.toBeInTheDocument();
  });

  it('EXPLICA por qué el pendiente bajó cuando el maquilero YA entregó incompletas', async () => {
    // El pendiente YA descuenta las incompletas (V1-E8v): de 6 enviadas al 77, 2 volvieron
    // incompletas ⇒ pendiente 4. Sin esta línea, ese 4 parecería un error de cuentas contra las 6
    // que el usuario recuerda haber mandado.
    useWipOrden.mockReturnValue({
      data: wip([
        {
          idMaquilero: 77,
          maquilero: 'Maquila del Norte',
          pendiente: 4,
          celdas: [{ cantidad: 4, incompletas: 2 }],
        },
      ]),
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');
    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Maquila del Norte'));

    const aviso = screen.getByTestId('avance-aviso-incompletas-previas');
    // Con LÍMITE DE PALABRA: `toHaveTextContent` es subcadena, y '2 prenda(s)…' casa dentro de
    // '22 prenda(s)…'. `\b` es lo único que distingue 2 de 22 (verificado por mutación).
    expect(aviso).toHaveTextContent(/\b2 prenda\(s\) incompleta\(s\)/);
    expect(aviso).toHaveTextContent('salieron de su taller');
    expect(aviso).toHaveTextContent('se pierden');

    // Y el tope es 4 (el pendiente, ya sin las incompletas): 5 buenas ya excede.
    await usuario.selectOptions(screen.getByTestId('avance-almacen-primeras'), '1');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '5');
    expect(screen.getByTestId('avance-aviso-exceso')).toBeInTheDocument();
    expect(screen.getByTestId('avance-guardar')).toBeDisabled();
  });

  it('la matriz del RECIBO nombra su tope en el idioma del recibo', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');
    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Maquila del Norte'));
    expect(screen.getByTestId('avance-matriz')).toHaveTextContent('que se le puede recibir');
    expect(screen.getByTestId('avance-matriz')).not.toHaveTextContent('pendiente de la etapa');
  });

  it('en el CORTE el rótulo sigue siendo el pendiente (ahí sí lo es)', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');
    expect(screen.getByTestId('avance-matriz')).toHaveTextContent('pendiente de la etapa');
  });

  it('sin incompletas previas NO aparece esa explicación', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');
    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Maquila del Norte'));
    expect(screen.queryByTestId('avance-aviso-incompletas-previas')).not.toBeInTheDocument();
  });
});

describe('Captura del avance · IMPRESOS y REIMPRESIÓN (migrados de las pantallas retiradas)', () => {
  it('al guardar un envío ofrece su HOJA para el bulto (y la ficha de arte en Arte)', async () => {
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      crearEnvio.mockImplementation(
        (_cuerpo: unknown, opciones: { onSuccess: (e: unknown) => void }) => {
          opciones.onSuccess({ id: 42, folio: 7, tipoProceso: 'Costura', totalPiezas: 5 });
        },
      );
      const usuario = userEvent.setup();
      pintar();
      await abrirCaptura(usuario, 'entrega-maquila');
      await usuario.type(screen.getByTestId('avance-matriz-celda'), '5');
      await usuario.click(screen.getByTestId('avance-guardar'));

      // La barra del recién guardado ofrece el papel EN EL MOMENTO (antes el panel no imprimía nada).
      const barra = await screen.findByTestId('avance-recien-guardado');
      expect(barra).toHaveTextContent('Envío #7 guardado');
      await usuario.click(screen.getByTestId('avance-imprimir-envio'));
      expect(abrir).toHaveBeenCalledWith('/api/produccion/envios/42/impreso', '_blank', 'noopener');
      // En COSTURA no se ofrece la ficha de arte (no dice nada ahí).
      expect(screen.queryByTestId('avance-imprimir-ficha')).not.toBeInTheDocument();
    } finally {
      abrir.mockRestore();
    }
  });

  it('el historial de la etapa REIMPRIME un envío viejo (y no los cancelados)', async () => {
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      useEtapasOrden.mockReturnValue({
        isPending: false,
        data: {
          etapas: [
            {
              id: 31,
              folio: 9,
              tipo: 'envio_maquila',
              idTipoProceso: 5,
              tipoProceso: 'Costura',
              tercero: 'Maquila del Norte',
              fecha: '2026-08-13',
              totalPiezas: 10,
              observaciones: null,
              cancelado: false,
              motivoCancelacion: null,
              creadoEn: '2026-08-13T10:00:00.000Z',
              creadoPorNombre: 'Administrador',
            },
            {
              id: 32,
              folio: 8,
              tipo: 'envio_maquila',
              idTipoProceso: 5,
              tipoProceso: 'Costura',
              tercero: 'Otra Maquila',
              fecha: '2026-08-12',
              totalPiezas: 4,
              observaciones: null,
              cancelado: true,
              motivoCancelacion: 'error de captura',
              creadoEn: '2026-08-12T10:00:00.000Z',
              creadoPorNombre: 'Administrador',
            },
          ],
        },
      });
      const usuario = userEvent.setup();
      pintar();
      await usuario.click(screen.getByTestId('avance-stepper-entrega-maquila'));

      // Solo el VIVO ofrece impreso: el papel de un movimiento cancelado no vuelve a salir.
      const botones = screen.getAllByTestId('avance-imprimir-envio');
      expect(botones).toHaveLength(1);
      await usuario.click(botones[0] as HTMLElement);
      expect(abrir).toHaveBeenCalledWith('/api/produccion/envios/31/impreso', '_blank', 'noopener');
    } finally {
      abrir.mockRestore();
    }
  });
});

describe('Captura del avance · el impreso del recién guardado se retira al cancelarlo', () => {
  it('cancelar el movimiento recién guardado se lleva su botón de imprimir', async () => {
    crearEnvio.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess: (e: unknown) => void }) => {
        opciones.onSuccess({ id: 42, folio: 7, tipoProceso: 'Costura', totalPiezas: 5 });
      },
    );
    // El movimiento aparece en el historial (es lo que se va a cancelar).
    useEtapasOrden.mockReturnValue({
      isPending: false,
      data: {
        etapas: [
          {
            id: 42,
            folio: 7,
            tipo: 'envio_maquila',
            idTipoProceso: 5,
            tipoProceso: 'Costura',
            tercero: 'Maquila del Norte',
            fecha: '2026-08-13',
            totalPiezas: 5,
            observaciones: null,
            cancelado: false,
            motivoCancelacion: null,
            creadoEn: '2026-08-13T10:00:00.000Z',
            creadoPorNombre: 'Administrador',
          },
        ],
      },
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '5');
    await usuario.click(screen.getByTestId('avance-guardar'));
    expect(await screen.findByTestId('avance-recien-guardado')).toBeInTheDocument();

    // Se cancela ESE movimiento con motivo…
    await usuario.click(screen.getByTestId('avance-cancelar-movimiento'));
    await usuario.type(screen.getByTestId('avance-motivo-cancelar'), 'error de captura');
    await usuario.click(screen.getByTestId('avance-confirmar-cancelar'));

    // …y la barra se va con él: no se puede imprimir el papel de un movimiento cancelado.
    await waitFor(() => {
      expect(screen.queryByTestId('avance-recien-guardado')).not.toBeInTheDocument();
    });
  });
});

describe('Captura del avance · ENTREGA A CLIENTE (el cierre del ciclo)', () => {
  /** Una entrega viva en el historial de la orden. */
  const entregaViva = {
    id: 71,
    folio: 3,
    cliente: 'C&A',
    almacen: 'Primeras',
    fecha: '2026-08-13',
    totalPiezas: 4,
    observaciones: null,
    cancelado: false,
    motivoCancelacion: null,
  };

  it('el COMPROBANTE solo se ofrece con `produccion.entrega` (el endpoint lo exige)', async () => {
    useEntregasOrden.mockReturnValue({ isPending: false, data: { entregas: [entregaViva] } });
    const usuario = userEvent.setup();

    // Con el permiso: la impresora está.
    pintar();
    await usuario.click(screen.getByTestId('avance-stepper-entrega-cliente'));
    expect(screen.getByTestId('avance-imprimir-entrega')).toBeInTheDocument();
  });

  it('quien SOLO consulta (wip-ver) NO ve la impresora del comprobante (evita un 403)', async () => {
    useEntregasOrden.mockReturnValue({ isPending: false, data: { entregas: [entregaViva] } });
    const usuario = userEvent.setup();
    renderConProveedores(<AvanceProduccion idOrden={1} alCerrar={vi.fn()} />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver']),
    });
    await usuario.click(screen.getByTestId('avance-stepper-entrega-cliente'));
    // La entrega SÍ se ve en el historial…
    expect(screen.getByTestId('avance-entrega')).toBeInTheDocument();
    // …pero sin `produccion.entrega` no se ofrece su PDF (el backend lo negaría con 403).
    expect(screen.queryByTestId('avance-imprimir-entrega')).not.toBeInTheDocument();
  });

  it('es la 6ª etapa del stepper y toma su avance del WIP del servidor', () => {
    pintar();
    expect(screen.getByTestId('avance-stepper-entrega-cliente')).toBeInTheDocument();
    // El resumen la explica también (ordenada / entregada / lista por entregar).
    expect(screen.getByTestId('avance-resumen')).toHaveTextContent('Resumen · entrega al cliente');
  });

  it('exige el almacén de salida y manda la entrega al dominio de entregas-cliente', async () => {
    useSeguimientoEntrega.mockReturnValue({
      isPending: false,
      data: {
        idOrden: 1,
        folioOrden: 5424,
        idCliente: 4,
        cliente: 'C&A',
        idModelo: 3,
        modelo: '62182',
        celdas: [
          {
            idColor: 7,
            color: 'Rojo',
            idTalla: 11,
            etiquetaTalla: 'CH',
            pedido: 10,
            entregado: 0,
            faltante: 10,
            disponible: 10,
          },
        ],
        totalPedido: 10,
        totalEntregado: 0,
        totalFaltante: 10,
      },
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-cliente');

    // Sin almacén la matriz está deshabilitada y no se puede guardar (el tope es la existencia).
    expect(screen.getByTestId('avance-entrega-matriz-celda')).toBeDisabled();
    expect(screen.getByTestId('avance-guardar')).toBeDisabled();

    await usuario.selectOptions(screen.getByTestId('avance-entrega-almacen'), '1');
    await usuario.type(screen.getByTestId('avance-entrega-matriz-celda'), '4');
    await usuario.click(screen.getByTestId('avance-guardar'));

    expect(crearEntrega).toHaveBeenCalledTimes(1);
    expect(crearEntrega.mock.calls[0]?.[0]).toMatchObject({
      idOrden: 1,
      idAlmacen: 1,
      lineas: [{ idColor: 7, tallas: [{ idTalla: 11, cantidad: 4 }] }],
    });
  });

  it('avisa (y no deja guardar) si se entrega por encima de la existencia del almacén', async () => {
    useSeguimientoEntrega.mockReturnValue({
      isPending: false,
      data: {
        idOrden: 1,
        folioOrden: 5424,
        idCliente: 4,
        cliente: 'C&A',
        idModelo: 3,
        modelo: '62182',
        celdas: [
          {
            idColor: 7,
            color: 'Rojo',
            idTalla: 11,
            etiquetaTalla: 'CH',
            pedido: 10,
            entregado: 0,
            faltante: 10,
            disponible: 3,
          },
        ],
        totalPedido: 10,
        totalEntregado: 0,
        totalFaltante: 10,
      },
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-cliente');
    await usuario.selectOptions(screen.getByTestId('avance-entrega-almacen'), '1');
    await usuario.type(screen.getByTestId('avance-entrega-matriz-celda'), '9');

    expect(screen.getByTestId('avance-entrega-aviso-exceso')).toBeInTheDocument();
    expect(screen.getByTestId('avance-guardar')).toBeDisabled();
    expect(crearEntrega).not.toHaveBeenCalled();
  });

  it('sin `produccion.entrega` la etapa se ve pero no ofrece capturar (A4)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<AvanceProduccion idOrden={1} alCerrar={vi.fn()} />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver', 'produccion.corte']),
    });
    await usuario.click(screen.getByTestId('avance-stepper-entrega-cliente'));
    expect(screen.queryByTestId('avance-abrir-captura')).not.toBeInTheDocument();
  });
});

/**
 * Las DOS reglas del exceso, que el panel no miraba en absoluto (las pantallas retiradas sí): el
 * sobre-corte se PERMITE (decisión (f)) y el sobre-envío/sobre-recibo son ESTRICTOS (decisión (g)).
 */
describe('Captura del avance · sobre-corte permitido vs sobre-envío estricto', () => {
  it('el SOBRE-CORTE avisa en ámbar que se permite, y deja guardar', async () => {
    // Pedido 10 con 4 por cortar: teclear 9 excede en 5.
    useWipOrden.mockReturnValue({
      isPending: false,
      data: {
        ...wip([{ idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 6 }]),
        porCortar: [{ idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 4 }],
      },
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');
    await usuario.type(screen.getByTestId('avance-proveedor-input'), 'sur');
    await usuario.click(await screen.findByText('Maquila del Sur'));
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '9');

    const aviso = screen.getByTestId('avance-aviso-sobrecorte');
    expect(aviso).toHaveTextContent('5 pieza(s) por encima');
    expect(aviso).toHaveTextContent('Se permite');
    // Y NO es el aviso destructivo del sobre-envío.
    expect(screen.queryByTestId('avance-aviso-exceso')).not.toBeInTheDocument();
    // Lo importante: el botón sigue habilitado (el servidor acepta el sobre-corte).
    expect(screen.getByTestId('avance-guardar')).toBeEnabled();
  });

  it('el SOBRE-ENVÍO se bloquea antes de mandarlo (el servidor lo rechaza)', async () => {
    // La orden tiene 10 cortadas y nada enviado a costura: 12 excede en 2.
    useWipOrden.mockReturnValue({
      isPending: false,
      data: {
        ...wip([]),
        enviado: 0,
        cortadoPorEnviar: [
          {
            idTipoProceso: 5,
            tipoProceso: 'Costura',
            codigoProceso: 'costura',
            generaEntradaPt: true,
            celdas: [{ idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 10 }],
            totalPendiente: 10,
          },
        ],
      },
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '12');

    expect(screen.getByTestId('avance-aviso-exceso')).toHaveTextContent('2 pieza(s) por encima');
    expect(screen.queryByTestId('avance-aviso-sobrecorte')).not.toBeInTheDocument();
    expect(screen.getByTestId('avance-guardar')).toBeDisabled();
    await usuario.click(screen.getByTestId('avance-guardar'));
    expect(crearEnvio).not.toHaveBeenCalled();
  });

  it('con la orden SIN CORTAR no deja enviar nada (el tope es 0, no "sin referencia")', async () => {
    // Caso que se colaba: primer envío de una orden con CERO cortado. La referencia se derivaba
    // (pedido − porCortar = 0 en cada celda) y luego se DESCARTABA por estar toda en cero, así que
    // la matriz quedaba neutra, sin topes, con el botón habilitado — y el 400 del servidor llegaba
    // con la matriz ya tecleada. Cero cortado es un tope REAL: no se envía lo que no se ha cortado.
    useWipOrden.mockReturnValue({
      isPending: false,
      data: {
        ...wip([]),
        cortado: 0,
        enviado: 0,
        // `porCortar` trae TODAS las celdas de la orden (el servidor no filtra los ceros ahí).
        porCortar: [{ idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 10 }],
        // Nada cortado: el servidor manda la celda en CERO (no la omite). Cero es un tope real.
        cortadoCeldas: [
          { idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 0 },
        ],
        cortadoPorEnviar: [],
      },
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '4');

    expect(screen.getByTestId('avance-aviso-exceso')).toHaveTextContent('4 pieza(s) por encima');
    expect(screen.getByTestId('avance-guardar')).toBeDisabled();
    await usuario.click(screen.getByTestId('avance-guardar'));
    expect(crearEnvio).not.toHaveBeenCalled();
  });

  it('el primer envío de una orden YA CORTADA sí se puede capturar (no se bloquea de más)', async () => {
    // La otra mitad: sin `cortadoPorEnviar` (nunca se ha enviado a este proceso) pero con la orden
    // cortada, el tope es lo cortado y la captura fluye. Si el arreglo del caso anterior bloqueara
    // de más, esta prueba revienta.
    useWipOrden.mockReturnValue({
      isPending: false,
      data: {
        ...wip([]),
        cortado: 10,
        enviado: 0,
        porCortar: [{ idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 0 }],
        cortadoCeldas: [
          { idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 10 },
        ],
        cortadoPorEnviar: [],
      },
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '10');

    expect(screen.queryByTestId('avance-aviso-exceso')).not.toBeInTheDocument();
    expect(screen.getByTestId('avance-guardar')).toBeEnabled();
  });
});

describe('Captura del avance · el precio pactado y la fecha compromiso (migrados)', () => {
  it('el PRECIO se captura SIN `ordenes.ver-precio-real-maquila` (ese permiso gobierna la LECTURA)', async () => {
    crearEnvio.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess: (e: unknown) => void }) => {
        opciones.onSuccess({ id: 42, folio: 7, tipoProceso: 'Costura', totalPiezas: 5 });
      },
    );
    const usuario = userEvent.setup();
    // Sesión SIN el permiso de ver el precio real, pero CON el de enviar: es el caso del seed, donde
    // `ordenes.ver-precio-real-maquila` se corta de Logística hacia abajo y `produccion.envio` no.
    // Si el campo se escondiera, estos roles capturarían la maquila diaria sin precio y el cargo
    // EsMa nacería sin precio (`esma/cargos.ts` cae al `precioPactado` del recibo).
    renderConProveedores(<AvanceProduccion idOrden={1} alCerrar={vi.fn()} />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver', 'produccion.envio']),
    });
    await abrirCaptura(usuario, 'entrega-maquila');

    await usuario.type(screen.getByTestId('avance-precio'), '12.5');
    await usuario.type(screen.getByTestId('avance-fecha-compromiso'), '2026-09-01');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '5');
    await usuario.click(screen.getByTestId('avance-guardar'));

    expect(crearEnvio.mock.calls[0]?.[0]).toMatchObject({
      precioPactado: 12.5,
      fechaCompromiso: '2026-09-01',
    });
  });

  it('el recibo manda el precio y NO ofrece fecha compromiso (es del envío)', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');
    expect(screen.getByTestId('avance-precio')).toBeInTheDocument();
    expect(screen.queryByTestId('avance-fecha-compromiso')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Maquila del Norte'));
    await usuario.selectOptions(screen.getByTestId('avance-almacen-primeras'), '1');
    await usuario.type(screen.getByTestId('avance-precio'), '3');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '2');
    await usuario.click(screen.getByTestId('avance-guardar'));
    expect(crearRecibo.mock.calls[0]?.[0]).toMatchObject({ precioPactado: 3 });
  });
});

describe('Captura del avance · aviso reintentable de catálogos', () => {
  it('si falla un catálogo lo DICE y ofrece reintentar (no finge "Sin coincidencias")', async () => {
    const refetch = vi.fn();
    useProveedores.mockReturnValue({ data: undefined, isFetching: false, isError: true, refetch });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');

    expect(screen.getByTestId('avance-error-catalogo')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('avance-reintentar'));
    expect(refetch).toHaveBeenCalled();
  });

  it('sin errores no se pinta ningún aviso', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');
    expect(screen.queryByTestId('avance-error-catalogo')).not.toBeInTheDocument();
  });
});

describe('Captura del avance · etapa inicial (deep-link de la Ruta Crítica)', () => {
  it('abre en la etapa pedida, no siempre en Corte', () => {
    pintar({ etapaInicial: 'recibo-aplicacion' });
    // La etapa activa es la pedida (su encabezado es el que se pinta).
    expect(screen.getByRole('heading', { name: 'Recibo de Arte' })).toBeInTheDocument();
  });

  it('sin etapa pedida abre en Corte (default de siempre)', () => {
    pintar();
    expect(screen.getByRole('heading', { name: 'Corte' })).toBeInTheDocument();
  });
});

describe('Captura del avance · casos del histórico migrado', () => {
  it('un maquilero con total 0 pero CELDAS pendientes SÍ se ofrece', async () => {
    // +5 en una talla y −5 en otra (recibo capturado en la talla equivocada en el Access): el
    // total da 0, pero el servidor sí aceptaría recibirle esas 5.
    useWipOrden.mockReturnValue({
      data: wip([
        {
          idMaquilero: 88,
          maquilero: 'Otra Maquila',
          pendiente: 0,
          celdas: [{ cantidad: 5 }, { cantidad: -5 }],
        },
      ]),
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    expect(await screen.findByText('Otra Maquila')).toBeInTheDocument();
  });

  it('una entrega migrada SIN maquilero se DICE, no se esconde', async () => {
    useWipOrden.mockReturnValue({
      data: wip([{ idMaquilero: null, maquilero: 'Sin asignar', pendiente: 10 }]),
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    // No hay a quién recibirle…
    expect(screen.getByTestId('avance-proveedor-input')).toHaveAttribute(
      'placeholder',
      'Nadie tiene piezas por devolver',
    );
    // …pero el aviso explica POR QUÉ y qué hay que corregir (antes se negaba que existiera).
    expect(screen.getByTestId('avance-sin-maquilero')).toHaveTextContent(
      /10 pza\(s\).*SIN maquilero/s,
    );
  });
});

describe('Captura del avance · descargar tela', () => {
  it('la etapa de CORTE lleva a la salida de tela con la orden puesta', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.click(screen.getByTestId('avance-descargar-tela'));
    expect(navegar).toHaveBeenCalledWith('/inventarios/telas/salida-orden', {
      state: { idOrden: 1 },
    });
  });

  it('con captura ABIERTA pregunta antes de salir (y no navega si se cancela)', async () => {
    const usuario = userEvent.setup();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      pintar();
      await abrirCaptura(usuario, 'corte');

      await usuario.click(screen.getByTestId('avance-descargar-tela'));
      expect(confirmar).toHaveBeenCalled();
      expect(navegar).not.toHaveBeenCalled();

      // Con el "sí", ahora navega.
      confirmar.mockReturnValue(true);
      await usuario.click(screen.getByTestId('avance-descargar-tela'));
      expect(navegar).toHaveBeenCalledWith('/inventarios/telas/salida-orden', {
        state: { idOrden: 1 },
      });
    } finally {
      confirmar.mockRestore();
    }
  });

  it('con el CORTADOR elegido, la descarga se lleva su id (§Post-F9.13)', async () => {
    const usuario = userEvent.setup();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      pintar();
      await abrirCaptura(usuario, 'corte');

      // Se elige el cortador en la captura (el corte arranca SIN proveedor: no hay default).
      await usuario.type(screen.getByTestId('avance-proveedor-input'), 'sur');
      await usuario.click(await screen.findByText('Maquila del Sur'));

      await usuario.click(screen.getByTestId('avance-descargar-tela'));
      expect(navegar).toHaveBeenCalledWith('/inventarios/telas/salida-orden', {
        state: { idOrden: 1, idCortador: 99 },
      });
    } finally {
      confirmar.mockRestore();
    }
  });

  it('"Mandar tela al cortador" aparece SOLO con cortador elegido y lleva su id', async () => {
    const usuario = userEvent.setup();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      pintar();
      // Sin captura abierta (y por tanto sin cortador) el atajo no existe.
      expect(screen.queryByTestId('avance-traspasar-tela')).not.toBeInTheDocument();

      await abrirCaptura(usuario, 'corte');
      await usuario.type(screen.getByTestId('avance-proveedor-input'), 'sur');
      await usuario.click(await screen.findByText('Maquila del Sur'));

      await usuario.click(screen.getByTestId('avance-traspasar-tela'));
      expect(navegar).toHaveBeenCalledWith('/inventarios/telas/traspaso', {
        state: { idCortador: 99 },
      });
    } finally {
      confirmar.mockRestore();
    }
  });

  it('el enlace NO aparece en las otras etapas', async () => {
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(screen.getByTestId('avance-stepper-entrega-maquila'));
    expect(screen.queryByTestId('avance-descargar-tela')).not.toBeInTheDocument();
  });

  it('el enlace NO aparece sin permiso para mover inventario de telas', () => {
    renderConProveedores(<AvanceProduccion idOrden={1} alCerrar={vi.fn()} />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver', 'produccion.corte']),
    });
    expect(screen.queryByTestId('avance-descargar-tela')).not.toBeInTheDocument();
    // …y la captura de corte sigue estando (no se escondió de más).
    expect(screen.getByTestId('avance-abrir-captura')).toBeInTheDocument();
  });
});

/**
 * V1-E4b · EL TRÁNSITO DE PRENDAS A PROCESO (§Post-F9.61). Cuando el proceso de arte va DESPUÉS de
 * la costura, lo que se manda ya es producto terminado: el envío tiene que SACARLO del almacén (si
 * no, el almacén sigue diciendo que está en el piso y los faltantes y las segundas del recibo no
 * tienen dónde caer). Aquí se prueba la mitad de pantalla de esa regla: que el default siga a la
 * orden, que se pida el almacén de origen y que las dos cosas viajen en el cuerpo del envío.
 */
describe('Captura del avance · prendas ya terminadas a proceso (V1-E4b)', () => {
  /** WIP de una orden que YA tiene producto terminado de costura y aún nada enviado a estampado. */
  function wipConPtRecibido(): WipOrden {
    const base = wip([{ idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 0 }]);
    return {
      ...base,
      recibidoCostura: 10,
      recibido: 10,
      porRecibir: [],
      cortadoPorEnviar: [],
    };
  }

  beforeEach(() => {
    useWipOrden.mockReturnValue({ data: wipConPtRecibido(), isPending: false });
  });

  it('con PT ya recibido, el envío a arte marca "prendas ya terminadas" por default y pide el almacén', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-aplicacion');
    await usuario.selectOptions(screen.getByTestId('avance-tipo'), '6');

    expect(screen.getByTestId('avance-prenda-terminada')).toBeChecked();
    expect(screen.getByTestId('avance-almacen-origen')).toBeInTheDocument();

    await usuario.type(screen.getByTestId('avance-proveedor-input'), 'sur');
    await usuario.click(await screen.findByText('Maquila del Sur'));
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '10');
    // Sin almacén de origen NO se puede guardar: el servidor lo rechazaría (400).
    expect(screen.getByTestId('avance-guardar')).toBeDisabled();

    await usuario.selectOptions(screen.getByTestId('avance-almacen-origen'), '1');
    await usuario.click(screen.getByTestId('avance-guardar'));

    expect(crearEnvio).toHaveBeenCalledTimes(1);
    const cuerpo = crearEnvio.mock.calls[0]?.[0] as {
      prendaTerminada: boolean;
      idAlmacenOrigen?: number;
    };
    expect(cuerpo.prendaTerminada).toBe(true);
    expect(cuerpo.idAlmacenOrigen).toBe(1);
  });

  it('al desmarcarlo, se esconde el almacén y el envío va como bultos cortados', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-aplicacion');
    await usuario.selectOptions(screen.getByTestId('avance-tipo'), '6');
    await usuario.click(screen.getByTestId('avance-prenda-terminada'));

    expect(screen.queryByTestId('avance-almacen-origen')).not.toBeInTheDocument();

    await usuario.type(screen.getByTestId('avance-proveedor-input'), 'sur');
    await usuario.click(await screen.findByText('Maquila del Sur'));
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '10');
    await usuario.click(screen.getByTestId('avance-guardar'));

    const cuerpo = crearEnvio.mock.calls[0]?.[0] as {
      prendaTerminada: boolean;
      idAlmacenOrigen?: number;
    };
    expect(cuerpo.prendaTerminada).toBe(false);
    expect(cuerpo.idAlmacenOrigen).toBeUndefined();
  });

  it('sin PT recibido, el default es "bultos cortados" (el flujo de siempre)', async () => {
    useWipOrden.mockReturnValue({
      data: wip([{ idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 0 }]),
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-aplicacion');
    await usuario.selectOptions(screen.getByTestId('avance-tipo'), '6');

    expect(screen.getByTestId('avance-prenda-terminada')).not.toBeChecked();
    expect(screen.queryByTestId('avance-almacen-origen')).not.toBeInTheDocument();
  });

  it('si el proceso YA tiene entrega viva, la bandera queda fijada por ella (no se puede mezclar)', async () => {
    const base = wip([{ idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 4 }]);
    useWipOrden.mockReturnValue({
      data: {
        ...base,
        recibidoCostura: 10,
        porRecibir: [
          {
            idTipoProceso: 6,
            tipoProceso: 'Estampado',
            codigoProceso: 'estampado',
            generaEntradaPt: false,
            devuelveAPt: false,
            celdas: [],
            totalPendiente: 4,
            totalIncompletas: 0,
            porMaquilero: [],
          },
        ],
      } as unknown as WipOrden,
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-aplicacion');
    await usuario.selectOptions(screen.getByTestId('avance-tipo'), '6');

    // La entrega viva es de bultos cortados ⇒ la bandera queda apagada y BLOQUEADA, aunque la
    // orden ya tenga producto terminado (el servidor rechaza mezclar las dos formas).
    const casilla = screen.getByTestId('avance-prenda-terminada');
    expect(casilla).not.toBeChecked();
    expect(casilla).toBeDisabled();
  });

  it('el RECIBO de un proceso que devuelve del tránsito pide almacén destino', async () => {
    const base = wip([{ idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 4 }]);
    useWipOrden.mockReturnValue({
      data: {
        ...base,
        porRecibir: [
          {
            idTipoProceso: 6,
            tipoProceso: 'Estampado',
            codigoProceso: 'estampado',
            generaEntradaPt: false,
            devuelveAPt: true,
            celdas: [
              {
                idColor: 7,
                color: 'Rojo',
                idTalla: 11,
                etiquetaTalla: 'CH',
                cantidad: 4,
                incompletas: 0,
              },
            ],
            totalPendiente: 4,
            totalIncompletas: 0,
            porMaquilero: [
              {
                idMaquilero: 77,
                maquilero: 'Maquila del Norte',
                celdas: [
                  {
                    idColor: 7,
                    color: 'Rojo',
                    idTalla: 11,
                    etiquetaTalla: 'CH',
                    cantidad: 4,
                    incompletas: 0,
                  },
                ],
                totalPendiente: 4,
                totalIncompletas: 0,
              },
            ],
          },
        ],
      } as unknown as WipOrden,
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-aplicacion');
    await usuario.selectOptions(screen.getByTestId('avance-tipo'), '6');

    // El proceso NO crea PT, pero las prendas están en tránsito: hay que decir a dónde regresan.
    expect(screen.getByTestId('avance-almacen-primeras')).toBeInTheDocument();
  });
});

/**
 * V1-E4b · hallazgos H5 y H1 del reviewer, del lado de la pantalla.
 *  • H5 — el almacén de TRÁNSITO no puede aparecer en NINGÚN selector: el servidor lo rechaza como
 *    origen y como destino, así que ofrecerlo solo servía para cosechar un 400 con la matriz ya
 *    tecleada.
 *  • H1 — el BUCKET de existencia («de esta orden» vs «sin orden asignada») tiene que poder
 *    elegirse: el histórico migrado y el inventario de arranque viven en el segundo.
 */
describe('Captura del avance · tránsito y bucket de existencia (V1-E4b, H5/H1)', () => {
  function wipConPt(): WipOrden {
    const base = wip([{ idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 0 }]);
    return {
      ...base,
      recibidoCostura: 10,
      recibido: 10,
      porRecibir: [],
      cortadoPorEnviar: [],
    };
  }

  it('H5 — el almacén de TRÁNSITO no se ofrece ni como origen del envío ni como destino del recibo', async () => {
    useWipOrden.mockReturnValue({ data: wipConPt(), isPending: false });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-aplicacion');
    await usuario.selectOptions(screen.getByTestId('avance-tipo'), '6');

    const origen = screen.getByTestId('avance-almacen-origen');
    expect(origen).toHaveTextContent('Primeras');
    expect(origen).not.toHaveTextContent('Tránsito');

    // Y en el recibo de costura (destino), lo mismo.
    useWipOrden.mockReturnValue({
      data: wip([{ idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 6 }]),
      isPending: false,
    });
    pintar();
    const capturas = screen.getAllByTestId('avance-stepper-recibo-maquila');
    await usuario.click(capturas[capturas.length - 1] as HTMLElement);
    const botones = screen.getAllByTestId('avance-abrir-captura');
    await usuario.click(botones[botones.length - 1] as HTMLElement);
    const destinos = screen.getAllByTestId('avance-almacen-primeras');
    const destino = destinos[destinos.length - 1] as HTMLElement;
    expect(destino).toHaveTextContent('Primeras');
    expect(destino).not.toHaveTextContent('Tránsito');
  });

  it('H1 — se puede mandar el stock SIN orden asignada, y viaja en el cuerpo del envío', async () => {
    useWipOrden.mockReturnValue({ data: wipConPt(), isPending: false });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-aplicacion');
    await usuario.selectOptions(screen.getByTestId('avance-tipo'), '6');

    // Default: el stock de la orden.
    expect(screen.getByTestId('avance-bucket-stock')).toHaveValue('orden');

    await usuario.selectOptions(screen.getByTestId('avance-bucket-stock'), 'sin-orden');
    await usuario.selectOptions(screen.getByTestId('avance-almacen-origen'), '1');
    await usuario.type(screen.getByTestId('avance-proveedor-input'), 'sur');
    await usuario.click(await screen.findByText('Maquila del Sur'));
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '10');
    await usuario.click(screen.getByTestId('avance-guardar'));

    const cuerpo = crearEnvio.mock.calls[0]?.[0] as {
      prendaTerminada: boolean;
      stockSinOrden: boolean;
      idAlmacenOrigen?: number;
    };
    expect(cuerpo.prendaTerminada).toBe(true);
    expect(cuerpo.stockSinOrden).toBe(true);
    expect(cuerpo.idAlmacenOrigen).toBe(1);
  });

  it('H1 — con entregas vivas, el bucket queda FIJADO por ellas (no se puede mezclar)', async () => {
    const base = wip([{ idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 4 }]);
    useWipOrden.mockReturnValue({
      data: {
        ...base,
        recibidoCostura: 10,
        porRecibir: [
          {
            idTipoProceso: 6,
            tipoProceso: 'Estampado',
            codigoProceso: 'estampado',
            generaEntradaPt: false,
            devuelveAPt: true,
            stockSinOrden: true,
            celdas: [],
            totalPendiente: 4,
            porMaquilero: [],
          },
        ],
      } as unknown as WipOrden,
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-aplicacion');
    await usuario.selectOptions(screen.getByTestId('avance-tipo'), '6');

    const bucket = screen.getByTestId('avance-bucket-stock');
    expect(bucket).toHaveValue('sin-orden');
    expect(bucket).toBeDisabled();
  });
});

/**
 * V1-E8i (§Post-F9.131) — los DOS botones de un clic que pidió Daniel: «Llenar con lo que falta por
 * cortar» (corte) y «Llenar con lo que se cortó» (envío a maquila). Lo que estas pruebas defienden:
 *   • PRECARGAN, NO GUARDAN (el usuario revisa y ajusta antes de dar Guardar);
 *   • PISAN lo ya capturado (no suman: un segundo clic no puede duplicar cantidades);
 *   • el número lo pone el SERVIDOR — el del envío es lo cortado MENOS lo ya enviado a ese proceso,
 *     así que un segundo envío parcial no propone un sobre-envío que el servidor rechazaría;
 *   • cuando no hay nada que precargar, el botón se ve APAGADO y con la razón al lado (nunca mudo).
 */
describe('Captura del avance · los botones de precarga de un clic (V1-E8i)', () => {
  /** Respuesta del servidor para la celda única del fixture (Rojo × CH). */
  function sugerencia(cantidad: number, motivo = 'hay', base = 'corte'): unknown {
    const celdas =
      cantidad > 0
        ? [{ idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad }]
        : [];
    return {
      data: {
        idOrden: 1,
        base,
        idTipoProceso: base === 'corte' ? null : 5,
        celdas,
        total: cantidad,
        motivo,
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
  }

  it('CORTE: llena la talla con lo que falta por cortar, lo dice en el botón y NO guarda', async () => {
    useSugerenciaCaptura.mockReturnValue(sugerencia(10));
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');

    const boton = screen.getByTestId('avance-precargar');
    expect(boton).toHaveTextContent('Llenar con lo que falta por cortar (10 pza)');
    await usuario.click(boton);

    expect(screen.getByTestId('avance-matriz-celda')).toHaveValue(10);
    // ⚠️ Precarga, NO guarda: el atajo llena los campos y ahí se detiene.
    expect(crearCorte).not.toHaveBeenCalled();
  });

  it('PISA lo que ya estaba capturado (no suma: un segundo clic no duplica)', async () => {
    useSugerenciaCaptura.mockReturnValue(sugerencia(10));
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '3');

    await usuario.click(screen.getByTestId('avance-precargar'));
    expect(screen.getByTestId('avance-matriz-celda')).toHaveValue(10);
    // Y otro clic deja lo mismo (sumar habría dado 20 en silencio y sin vuelta atrás).
    await usuario.click(screen.getByTestId('avance-precargar'));
    expect(screen.getByTestId('avance-matriz-celda')).toHaveValue(10);
  });

  it('ENVÍO tras un envío PARCIAL: propone el RESTO, no el bruto cortado (no sería enviable)', async () => {
    // El caso trampa: 10 cortadas, 6 ya enviadas → el botón debe poner 4. Poner 10 daría un
    // sobre-envío que el servidor rechaza bajo lock (decisión (g)), y el usuario se comería el 400.
    useSugerenciaCaptura.mockReturnValue(sugerencia(4, 'hay', 'envio'));
    useWipOrden.mockReturnValue({
      isPending: false,
      data: {
        ...wip([]),
        cortadoPorEnviar: [
          {
            idTipoProceso: 5,
            tipoProceso: 'Costura',
            codigoProceso: 'costura',
            generaEntradaPt: true,
            celdas: [{ idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 4 }],
            totalPendiente: 4,
          },
        ],
      },
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');

    const boton = screen.getByTestId('avance-precargar');
    expect(boton).toHaveTextContent('Llenar con lo que se cortó (4 pza)');
    await usuario.click(boton);

    expect(screen.getByTestId('avance-matriz-celda')).toHaveValue(4);
    // Y con el resto exacto no salta el aviso de sobre-envío ni se bloquea el guardado.
    expect(screen.queryByTestId('avance-aviso-exceso')).not.toBeInTheDocument();
    expect(crearEnvio).not.toHaveBeenCalled();
  });

  it('sin nada que precargar el botón queda APAGADO y con la razón al lado (nunca mudo)', async () => {
    useSugerenciaCaptura.mockReturnValue(sugerencia(0, 'todo-enviado', 'envio'));
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');

    expect(screen.getByTestId('avance-precargar')).toBeDisabled();
    expect(screen.getByTestId('avance-precarga-nota')).toHaveTextContent(
      'Todo lo cortado ya se le envió a este proceso',
    );
    // El lugar para llenar SIGUE ahí: el aviso explica, no reemplaza a la matriz.
    expect(screen.getByTestId('avance-matriz')).toBeInTheDocument();
  });

  it('con la orden ya cortada, el botón del CORTE explica que no queda nada que copiar', async () => {
    useSugerenciaCaptura.mockReturnValue(sugerencia(0, 'todo-cortado'));
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');

    expect(screen.getByTestId('avance-precargar')).toBeDisabled();
    expect(screen.getByTestId('avance-precarga-nota')).toHaveTextContent(
      'Ya está cortado todo lo que pide la orden',
    );
  });

  it('si la consulta falla lo dice y ofrece Reintentar (se puede seguir capturando a mano)', async () => {
    const refetch = vi.fn();
    useSugerenciaCaptura.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');

    expect(screen.getByTestId('avance-precargar')).toBeDisabled();
    expect(screen.getByTestId('avance-precarga-nota')).toHaveTextContent(
      'Captura las cantidades a mano',
    );
    await usuario.click(screen.getByTestId('avance-precarga-reintentar'));
    expect(refetch).toHaveBeenCalled();
    // La matriz sigue tecleable pese al fallo del atajo.
    await usuario.type(screen.getByTestId('avance-matriz-celda'), '7');
    expect(screen.getByTestId('avance-matriz-celda')).toHaveValue(7);
  });

  it('el RECIBO no ofrece precarga (su pendiente es por maquilero, no por proceso)', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    expect(screen.queryByTestId('avance-precarga')).not.toBeInTheDocument();
  });
});

/**
 * Ronda de corrección de V1-E8i — los tres huecos que encontró el reviewer y que las pruebas de la
 * primera ronda dejaban pasar en verde:
 *   • **H2** — el mock descartaba los argumentos, así que nadie comprobaba **a qué proceso** se le
 *     pregunta (mutar el id a uno inexistente pasaba 75/75);
 *   • **H3** — con prendas YA TERMINADAS el servidor exige además que el almacén las tenga, y la
 *     sugerencia sólo conoce el tope de lo cortado: el atajo se apaga con su razón;
 *   • **H4** — «las celdas no propuestas quedan VACÍAS» estaba documentado tres veces y probado por
 *     nadie: con un fixture de UNA celda, mezclar en vez de pisar pasaba limpio.
 */
describe('Captura del avance · la ronda de corrección de los botones (V1-E8i)', () => {
  /** Orden de DOS tallas (CH y M) del mismo color: hace falta para poder probar H4. */
  function ordenDosTallas(): Orden {
    return {
      ...orden(77, 'Maquila del Norte'),
      lineas: [
        {
          idColor: 7,
          color: 'Rojo',
          tallas: [
            { idTalla: 11, etiquetaTalla: 'CH', cantidad: 10 },
            { idTalla: 12, etiquetaTalla: 'M', cantidad: 20 },
          ],
        },
      ],
      totalPiezas: 30,
    } as unknown as Orden;
  }

  it('⭐ H2 · en el CORTE se le pregunta al servidor SIN proceso (la base es la orden)', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');

    // El hook se llama en cada render; lo que importa es con qué se le pregunta AL FINAL.
    const ultima = useSugerenciaCaptura.mock.calls.at(-1);
    expect(ultima?.[0]).toBe(1); // la orden
    expect(ultima?.[1]).toBeUndefined(); // sin proceso → base CORTE
  });

  it('⭐⭐ H2 · en la ENTREGA A MAQUILA se le pregunta por EL PROCESO de costura (id 5)', async () => {
    // Es la mitad frontend de D8: costura y arte consumen las mismas piezas y no se restan entre sí,
    // así que preguntar por el proceso equivocado devolvería el disponible de otro flujo.
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');

    const ultima = useSugerenciaCaptura.mock.calls.at(-1);
    expect(ultima?.[0]).toBe(1);
    expect(ultima?.[1]).toBe(5); // el TipoProceso de costura del catálogo mockeado
  });

  it('⭐⭐ H2 · en la ENTREGA A ARTE se le pregunta por el proceso ELEGIDO (id 6), no por costura', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-aplicacion');
    await usuario.selectOptions(screen.getByTestId('avance-tipo'), '6');

    const ultima = useSugerenciaCaptura.mock.calls.at(-1);
    expect(ultima?.[1]).toBe(6);
  });

  it('⭐⭐ H9 · sin proceso elegido en Arte, el botón NO se queda con el número del CORTE', async () => {
    // 🔴 EL CASO QUE ESTA PRUEBA DEFIENDE (bloqueante H9). La clave de caché es
    // `[…, idOrden, idTipoProceso ?? null]`, así que **el corte y «envío sin proceso elegido»
    // comparten entrada**: deshabilitar la query NO impide que TanStack sirva el `data` ya cacheado
    // del corte. Daniel captura un corte, abre «Entrega a arte» —donde el proceso arranca VACÍO, o
    // sea que es lo primero que ve— y el botón salía ENCENDIDO diciendo «Llenar con lo que se cortó
    // (1,726 pza)» con la cifra de *lo que falta por cortar*, mientras la nota de al lado decía
    // «Elige primero el proceso». Botón y nota contradiciéndose, y al picarlo la matriz se llenaba
    // con la respuesta de OTRA pregunta.
    //
    // ⚠️ Por eso el mock devuelve aquí el payload DEL CORTE: es exactamente lo que la caché real
    // entrega en ese estado. Con el default genérico (`motivo: 'todo-cortado'`) la prueba pasaba
    // **por la razón equivocada** — un payload que la caché nunca podría servir ahí.
    useSugerenciaCaptura.mockReturnValue({
      data: {
        idOrden: 1,
        base: 'corte',
        idTipoProceso: null,
        celdas: [{ idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 1726 }],
        total: 1726,
        motivo: 'hay',
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-aplicacion');

    // La query va DESHABILITADA (tercer argumento) mientras no haya proceso…
    expect(useSugerenciaCaptura.mock.calls.at(-1)?.[2]).toBe(false);
    // …y el botón respeta ESE gate, no el `motivo` de un payload prestado.
    expect(screen.getByTestId('avance-precargar')).toBeDisabled();
    expect(screen.getByTestId('avance-precargar')).not.toHaveTextContent('1,726');
    expect(screen.getByTestId('avance-precarga-nota')).toHaveTextContent(
      'Elige primero el proceso',
    );
  });

  it('⭐⭐ H3 · con PRENDAS YA TERMINADAS el atajo se apaga y dice por qué (el tope real es la existencia)', async () => {
    // Caso real y frecuente: 1,000 cortadas, 400 recibidas de costura. `prendaTerminada` arranca en
    // `true` y el servidor exige ADEMÁS que el almacén las tenga físicamente
    // (`traspasarPrendasATransito` → `exigirExistenciaPt`). La sugerencia sólo conoce
    // `enviado ≤ cortado`, así que anunciar «(1,000 pza)» sería mandar al usuario a un rechazo.
    useWipOrden.mockReturnValue({
      isPending: false,
      data: {
        ...wip([]),
        recibidoCostura: 400,
        recibido: 400,
        porRecibir: [],
        cortadoPorEnviar: [],
      },
    });
    useSugerenciaCaptura.mockReturnValue({
      data: {
        idOrden: 1,
        base: 'envio',
        idTipoProceso: 6,
        celdas: [{ idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 1000 }],
        total: 1000,
        motivo: 'hay',
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-aplicacion');
    await usuario.selectOptions(screen.getByTestId('avance-tipo'), '6');

    expect(screen.getByTestId('avance-prenda-terminada')).toBeChecked();
    expect(screen.getByTestId('avance-precargar')).toBeDisabled();
    expect(screen.getByTestId('avance-precarga-nota')).toHaveTextContent(
      'salen del almacén de producto terminado',
    );
    // Y NO se anuncia un total que el servidor rechazaría.
    expect(screen.getByTestId('avance-precargar')).not.toHaveTextContent('1,000 pza');
  });

  it('H3 · al desmarcar "prendas ya terminadas" el atajo vuelve a encenderse', async () => {
    // La gemela positiva: si el apagado se pasara de listo, el atajo quedaría muerto en toda la
    // etapa de arte, que es donde más se usa.
    useSugerenciaCaptura.mockReturnValue({
      data: {
        idOrden: 1,
        base: 'envio',
        idTipoProceso: 6,
        celdas: [{ idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 10 }],
        total: 10,
        motivo: 'hay',
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    useWipOrden.mockReturnValue({
      isPending: false,
      data: { ...wip([]), recibidoCostura: 10, recibido: 10, porRecibir: [], cortadoPorEnviar: [] },
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-aplicacion');
    await usuario.selectOptions(screen.getByTestId('avance-tipo'), '6');
    expect(screen.getByTestId('avance-precargar')).toBeDisabled();

    await usuario.click(screen.getByTestId('avance-prenda-terminada'));
    expect(screen.getByTestId('avance-precargar')).toBeEnabled();
    expect(screen.getByTestId('avance-precargar')).toHaveTextContent('(10 pza)');
  });

  it('⭐ H4 · la celda que el servidor NO propone queda VACÍA, no con lo que había tecleado', async () => {
    // Con una sola celda, «mezclar» y «pisar» son indistinguibles. Aquí el servidor propone CH=10 y
    // NO propone M: si se mezclara, la M tecleada a mano se quedaría y la matriz sumaría 13 mientras
    // el rótulo prometió «10 pza» — una cifra afirmada y falsa.
    useOrden.mockReturnValue({
      data: ordenDosTallas(),
      isPending: false,
      isError: false,
      error: null,
    });
    useSugerenciaCaptura.mockReturnValue({
      data: {
        idOrden: 1,
        base: 'corte',
        idTipoProceso: null,
        celdas: [{ idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 10 }],
        total: 10,
        motivo: 'hay',
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'corte');

    const celdas = screen.getAllByTestId('avance-matriz-celda');
    expect(celdas).toHaveLength(2);
    await usuario.type(celdas[1] as HTMLElement, '3'); // la M, que el servidor NO propone

    await usuario.click(screen.getByTestId('avance-precargar'));

    const tras = screen.getAllByTestId('avance-matriz-celda');
    expect(tras[0]).toHaveValue(10); // CH ← la propuesta
    expect(tras[1]).toHaveValue(null); // M ← el campo quedó VACÍO, no en 3 ni en 13
    // Y el total capturado coincide con lo que el botón prometió.
    expect(screen.getByTestId('avance-captura')).toHaveTextContent('Total capturado: 10');
  });
});
