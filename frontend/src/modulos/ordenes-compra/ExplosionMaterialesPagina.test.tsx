import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorDeApi } from '@/api/errores';
import {
  crearQueryClientDePrueba,
  estadoSesionDePrueba,
  renderConProveedores,
} from '@/pruebas/utilidades';

import { ExplosionMaterialesPagina, ocPlaneadasEnPantalla } from './ExplosionMaterialesPagina';

// ⭐ V1-E3x — la confirmación del acto en bloque es un TOAST de la página (sobrevive a que el panel
// se desmonte al llenarse los huecos). Se espía con el patrón hoisted del módulo.
const { toastExito } = vi.hoisted(() => ({ toastExito: vi.fn() }));
vi.mock('sonner', () => ({
  toast: {
    success: (mensaje: string): void => {
      toastExito(mensaje);
    },
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

const useExplosionMock = vi.fn();
const useGenerarOcMock = vi.fn();
const useConsultaOrdenesMock = vi.fn();
const mutateMock = vi.fn();
const imprimirExplosionMock = vi.fn();
// ⭐ V1-E3q (§Post-F9.85/.86): la REVISIÓN PREVIA y la precarga por pedido interno.
const usePrevioCompraMock = vi.fn();
const previoMutateMock = vi.fn();
const useOrdenesDelPedidoMock = vi.fn();
// ⭐ V1-E3m (§Post-F9.82): asignar/quitar el proveedor de un material EN ESTA ORDEN.
const useAsignarProveedorMock = vi.fn();
const asignarMutateMock = vi.fn();
// ⭐⭐ V1-E3x (§Post-F9.88): asignar el MISMO proveedor a varios renglones en UN acto.
const useAsignarProveedorEnBloqueMock = vi.fn();
const bloqueMutateMock = vi.fn();

const useColoresDeTelaMock = vi.fn((_id: unknown) => ({ data: undefined, isPending: false }));
// ⭐⭐ V1-E4c — el bloque de color vive AHORA EN EL RENGLÓN, y un renglón puede abarcar VARIAS OP:
// por eso lee los colores de todas a la vez. Se espía la lista de ids que recibe, que es la prueba
// de que cada renglón pregunta por SUS órdenes (y no por la primera de la pantalla).
const useColoresDeVariasOrdenesMock = vi.fn(
  (_ids: readonly number[], _habilitado: boolean) => [] as unknown[],
);
const asignarColorMutateMock = vi.fn();
// El tipo se declara ANCHO a propósito: hay una prueba que sustituye este doble por el
// `useMutation` AUTÉNTICO (para poder mirar una escritura en vuelo, que un doble estático no tiene).
const useAsignarColorTelaMock = vi.fn((): { mutate: unknown; isPending: boolean } => ({
  mutate: asignarColorMutateMock,
  isPending: false,
}));
// ⭐⭐ V1-E6b (§Post-F9.106): dar de alta el color de la tela SIN salir de la compra. El doble
// contesta llamando a `onSuccess` con el color creado, que es lo que dispara el "queda ELEGIDO".
const agregarColorMutateMock = vi.fn();
const useAgregarColorDeTelaMock = vi.fn((): { mutate: unknown; isPending: boolean } => ({
  mutate: agregarColorMutateMock,
  isPending: false,
}));
vi.mock('@/api/mrp', () => ({
  useExplosion: (ids: unknown) => useExplosionMock(ids) as unknown,
  useOrdenesDelPedido: (id: unknown) => useOrdenesDelPedidoMock(id) as unknown,
  usePrevioCompra: () => usePrevioCompraMock() as unknown,
  useGenerarOc: () => useGenerarOcMock() as unknown,
  useAsignarProveedor: () => useAsignarProveedorMock() as unknown,
  // ⭐⭐ V1-E3x (§Post-F9.88): el mismo proveedor a VARIOS renglones de un golpe.
  useAsignarProveedorEnBloque: () => useAsignarProveedorEnBloqueMock() as unknown,
  imprimirExplosion: (id: number) => imprimirExplosionMock(id) as unknown,
  // ⭐⭐ V1-E3u (§Post-F9.89): el diálogo «de qué color se compra la tela» cuelga de esta pantalla.
  // Se monta siempre (cerrado), así que sus hooks tienen que existir en el mock aunque no se usen.
  // ⭐ V1-E3u/D7: se ESPÍA el id que recibe. El diálogo pide los colores de UNA orden, así que este
  // argumento es la prueba de a qué orden se aterrizó — y no se puede falsear leyendo la pantalla
  // (el texto del botón también dice el folio, y una aserción por texto pasaría sin abrir nada).
  useColoresDeTela: (id: unknown) => useColoresDeTelaMock(id) as unknown,
  useColoresDeVariasOrdenes: (ids: readonly number[], habilitado: boolean) =>
    useColoresDeVariasOrdenesMock(ids, habilitado) as unknown,
  useAsignarColorTela: () => useAsignarColorTelaMock() as unknown,
  useFijarPrecioColor: () => ({ mutate: vi.fn(), isPending: false }) as unknown,
  // ⭐⭐ V1-E6b (§Post-F9.106): el alta de un COLOR de la tela desde el renglón de la compra.
  useAgregarColorDeTela: () => useAgregarColorDeTelaMock() as unknown,
}));
vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: () => useConsultaOrdenesMock() as unknown,
}));
// El catálogo de direcciones de entrega decide si la OC se puede generar (§Post-F9.18): sin
// dirección el dominio la RECHAZA, así que la pantalla tiene que decirlo antes de intentarlo.
const useDireccionesMock = vi.fn();
// ⭐⭐ V1-E4d (§Post-F9.96): el alta de dirección se hace DESDE esta pantalla, con el diálogo del
// catálogo. Sus dos mutaciones tienen que existir en el doble o el diálogo no monta.
const crearDireccionMock = vi.fn();
vi.mock('@/api/direcciones-entrega', () => ({
  useDireccionesEntregaActivas: () => useDireccionesMock() as unknown,
  useCrearDireccionEntrega: () => ({ mutate: crearDireccionMock, isPending: false }) as unknown,
  useActualizarDireccionEntrega: () => ({ mutate: vi.fn(), isPending: false }) as unknown,
}));
// El combobox de proveedor busca en el SERVIDOR; aquí se sustituye por un botón que elige uno fijo,
// para poder ejercitar el flujo de «asignar proveedor» sin montar la búsqueda entera.
vi.mock('@/modulos/cxp/SelectorProveedor', () => ({
  SelectorProveedor: ({
    alSeleccionar,
  }: {
    alSeleccionar: (proveedor: { id: number; nombre: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="exp-selector-proveedor-stub"
      onClick={() => alSeleccionar({ id: 33, nombre: 'Telas del Norte' })}
    >
      Elegir proveedor
    </button>
  ),
}));

/**
 * 🔴 **V1-E7f (§Post-F9.120) — CAPTURAR LA «Entrega (inicial)», que ahora es EL PASO OBLIGATORIO.**
 *
 * Hasta hoy casi ninguna prueba de esta pantalla tocaba la fecha: las OP del fixture la traían y la
 * OC la HEREDABA, así que el clic de «Revisar y generar OC» salía sin más. Retirado el respaldo —la
 * fecha de la OP es cuándo se le entrega al CLIENTE, no cuándo debe llegar la tela—, **ninguna
 * compra avanza sin que una persona teclee la fecha**, y eso es exactamente lo que este paso
 * reproduce: lo que el comprador hace de verdad antes de darle a generar.
 *
 * ⚠️ Por eso NO se usa en el bloque de *"la fecha de entrega, a fuerzas"*: allí lo que se mide es
 * justamente qué pasa cuando NADIE la capturó.
 */
function capturarEntregaInicial(fecha = '2026-10-15'): void {
  fireEvent.change(screen.getByTestId('exp-fecha-entrega'), { target: { value: fecha } });
}

/** Explosión de prueba: un botón comprable (con proveedor) + felpa sin proveedor + genérico cubierto. */
function explosionDePrueba() {
  return {
    // ⭐ V1-E3q (§Post-F9.86): la explosión es de un CONJUNTO de OP.
    ordenes: [
      {
        idOrden: 50,
        folio: 7,
        idModelo: 9,
        modelo: 'A-100',
        totalPiezas: 30,
        idPedido: 300,
        folioPedido: 1515,
        fechaEntrega: '2026-09-30',
      },
    ],
    idOrden: 50,
    folioOrden: 7,
    idModelo: 9,
    modelo: 'A-100',
    totalPiezas: 30,
    huboCambios: false,
    regenerado: false,
    avisos: [],
    // V1-E3d: la explosión trae la desalineación de la receta congelada vs. el BOM vivo.
    desalineacion: { hayCambios: false, conOrdenCompra: false, critico: false, cambios: [] },
    // V1-E3h: y lo que quedó fuera por no estar liberado (vacío = no falta firmar nada).
    pendientesLiberar: [],
    // ⭐⭐ V1-E3u (§Post-F9.89): telas a las que falta decirles de qué color se compran.
    pendientesColor: [],
    grupos: [
      {
        idProveedor: 11,
        proveedor: 'Avíos Baratos',
        renglones: [
          {
            id: 1,
            tipo: 'avio',
            idTela: null,
            idTelaColor: null,
            telaColor: null,
            idAvio: 3,
            material: 'BOT-01 — Botón',
            cantidadRequerida: 180,
            unidad: 'pza',
            esGenerico: false,
            estadoGenerico: 'no-aplica',
            existenciaStock: 0,
            cantidadAComprar: 180,
            idProveedorSugerido: 11,
            proveedorSugerido: 'Avíos Baratos',
            precioSugerido: 2,
            origenProveedor: 'habitual',
            proveedorSugeridoInactivo: false,
            diff: 'sin-cambio',
            cambiosReceta: [],
            avisos: [],
            cantidadEnOc: 0,
            cantidadPendiente: 180,
            idsRequerimiento: [1],
            porOrden: [
              {
                idRequerimiento: 1,
                idOrden: 50,
                folioOrden: 7,
                cantidadRequerida: 180,
                cantidadAComprar: 180,
                cantidadEnOc: 0,
                cantidadPendiente: 180,
                precioSugerido: 2,
              },
            ],
          },
        ],
      },
      {
        idProveedor: null,
        proveedor: 'Sin proveedor sugerido',
        renglones: [
          {
            id: 2,
            tipo: 'tela',
            idTela: 4,
            idTelaColor: null,
            telaColor: null,
            idAvio: null,
            material: 'Felpa',
            cantidadRequerida: 45,
            unidad: 'm',
            esGenerico: false,
            estadoGenerico: 'no-aplica',
            existenciaStock: 0,
            cantidadAComprar: 45,
            idProveedorSugerido: null,
            proveedorSugerido: null,
            precioSugerido: null,
            origenProveedor: 'sin-proveedor',
            proveedorSugeridoInactivo: false,
            diff: 'sin-cambio',
            cambiosReceta: [],
            avisos: [],
            cantidadEnOc: 0,
            cantidadPendiente: 45,
            idsRequerimiento: [2],
            porOrden: [
              {
                idRequerimiento: 2,
                idOrden: 50,
                folioOrden: 7,
                cantidadRequerida: 45,
                cantidadAComprar: 45,
                cantidadEnOc: 0,
                cantidadPendiente: 45,
                precioSugerido: null,
              },
            ],
          },
          {
            id: 3,
            tipo: 'avio',
            idTela: null,
            idTelaColor: null,
            telaColor: null,
            idAvio: 5,
            material: 'HIL-01 — Hilo',
            cantidadRequerida: 60,
            unidad: 'm',
            esGenerico: true,
            estadoGenerico: 'cubierto-por-stock',
            existenciaStock: 100,
            cantidadAComprar: 0,
            idProveedorSugerido: null,
            proveedorSugerido: null,
            precioSugerido: null,
            origenProveedor: 'sin-proveedor',
            proveedorSugeridoInactivo: false,
            diff: 'sin-cambio',
            cambiosReceta: [],
            avisos: [],
            cantidadEnOc: 0,
            cantidadPendiente: 0,
            idsRequerimiento: [3],
            porOrden: [
              {
                idRequerimiento: 3,
                idOrden: 50,
                folioOrden: 7,
                cantidadRequerida: 60,
                cantidadAComprar: 0,
                cantidadEnOc: 0,
                cantidadPendiente: 0,
                precioSugerido: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * ⭐⭐ **V1-E4d (§Post-F9.96) — LAS HERRAMIENTAS QUE PROTEGEN EL DISEÑO, NO SÓLO LA LÓGICA.**
 *
 * Lo que Daniel va a mirar al abrir la pantalla es si lo reciben con carteles amarillos apilados
 * (*"los avisos en amarillo salen muchos y confunde lo que realmente se busca"*). Eso no lo fija
 * ninguna aserción de texto: una mutación puede devolver un aviso a la entrada dejando todas las
 * pruebas de contenido en verde. Por eso estas dos preguntan por lo que de verdad cambió — el
 * TONO y el LUGAR.
 */
/** ¿Este elemento (o alguno de sus padres) está pintado con el amarillo de aviso? */
function claseAmarilla(elemento: HTMLElement): boolean {
  for (let n: HTMLElement | null = elemento; n !== null; n = n.parentElement) {
    const clases = n.className;
    if (typeof clases === 'string' && /(?:bg-warn-soft|text-warn|border-warn)/.test(clases)) {
      return true;
    }
  }
  return false;
}

/** ¿Está DESPUÉS de la lista de materiales (y no apilado antes del primer renglón)? */
function vaDespuesDeLaLista(elemento: HTMLElement): boolean {
  const grupos = screen.queryAllByTestId('exp-grupo');
  const ultimo = grupos.at(-1) ?? screen.queryByTestId('exp-vacio');
  if (ultimo === null || ultimo === undefined) return false;
  // DOCUMENT_POSITION_FOLLOWING = el argumento va después del nodo desde el que se pregunta.
  return (ultimo.compareDocumentPosition(elemento) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * 🔴 **EL GUARDIÁN DE LA ENTRADA**: todo lo amarillo que se pinte ANTES del primer renglón.
 *
 * Excepción declarada: el panel de «ponles el mismo proveedor de un golpe» (`exp-bloque`), que va
 * arriba a propósito y **no es un aviso sino un lugar donde se captura** — que es justo lo que
 * §Post-F9.96 pide que esté primero.
 */
function amarillosAntesDelPrimerRenglon(): HTMLElement[] {
  const primero = screen.queryAllByTestId('exp-grupo')[0] ?? screen.queryByTestId('exp-vacio');
  if (primero === null || primero === undefined) return [];
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[class*="bg-warn-soft"],[class*="text-warn"],[class*="border-warn"]',
    ),
  ).filter(
    (n) =>
      n.closest('[data-testid="exp-bloque"]') === null &&
      (primero.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
  );
}

describe('ExplosionMaterialesPagina (F4-E4, R3)', () => {
  beforeEach(() => {
    useExplosionMock.mockReset();
    useGenerarOcMock.mockReset();
    useConsultaOrdenesMock.mockReset();
    useDireccionesMock.mockReset();
    mutateMock.mockReset();
    imprimirExplosionMock.mockReset();
    useAsignarProveedorMock.mockReset();
    asignarMutateMock.mockReset();
    usePrevioCompraMock.mockReset();
    previoMutateMock.mockReset();
    useOrdenesDelPedidoMock.mockReset();
    // Por defecto la OP no tiene hermanas que precargar (la precarga tiene su propio bloque).
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useAsignarProveedorMock.mockReturnValue({
      mutate: asignarMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useAsignarProveedorEnBloqueMock.mockReset();
    bloqueMutateMock.mockReset();
    useAsignarProveedorEnBloqueMock.mockReturnValue({
      mutate: bloqueMutateMock,
      reset: vi.fn(),
      data: undefined,
      isPending: false,
      isError: false,
      isSuccess: false,
    });

    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    // Caso normal: hay catálogo y una dirección FAVORITA (la que el servidor usaría por default).
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
  });

  it('al elegir una orden, muestra los materiales agrupados por proveedor y el neteo de genéricos', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });

    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    // Pide la explosión de la orden elegida (id 50).
    expect(useExplosionMock).toHaveBeenCalledWith([50]);
    // Dos grupos (un proveedor + "sin proveedor").
    expect(screen.getAllByTestId('exp-grupo')).toHaveLength(2);
    expect(screen.getByText('BOT-01 — Botón')).toBeInTheDocument();
    // El genérico cubierto por stock se marca.
    expect(screen.getByText('Cubierto por stock')).toBeInTheDocument();
  });

  /**
   * ⭐⭐ V1-E3q (§Post-F9.85) — el botón YA NO GENERA de un clic: pide la REVISIÓN PREVIA. Daniel:
   * *"al darle «generar OC desde la explosión», te mande a una pantalla previa… una revisión previa
   * es indispensable"*. Si alguien devolviera este botón a `generar.mutate`, esta prueba se pone
   * roja: `mutateMock` NO debe haberse llamado.
   */
  it('«Revisar y generar OC» pide el PLAN al servidor y NO crea nada todavía', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    // Revisa TODO lo pendiente (sin marcar nada → idsRequerimiento vacío).
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    expect(previoMutateMock).toHaveBeenCalledOnce();
    // 🔴 Y NADA se generó: el clic que Daniel daba ahora abre la revisión, no la compra.
    expect(mutateMock).not.toHaveBeenCalled();
    const [cuerpo, opciones] = previoMutateMock.mock.calls[0] as [
      Record<string, unknown>,
      { onSuccess?: unknown },
    ];
    // La dirección FAVORITA viaja explícita: el servidor no tiene que adivinarla. Y las OP van en
    // el cuerpo (§Post-F9.86), no en la URL.
    expect(cuerpo).toEqual({
      idsOrden: [50],
      idsRequerimiento: [],
      idDireccionEntrega: 7,
      // 🔴 V1-E7f: la fecha viaja porque una PERSONA la capturó; ya no la pone el servidor solo.
      fechaEntrega: '2026-10-15',
    });
    expect(typeof opciones.onSuccess).toBe('function');
  });

  it('el checkbox de un material sin proveedor (felpa) está deshabilitado (no comprable)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const checks = screen.getAllByTestId('exp-renglon-check');
    // El primero (botón, comprable) habilitado; la felpa (sin proveedor) deshabilitada.
    expect(checks[0]).not.toBeDisabled();
    expect(checks[1]).toBeDisabled();
  });

  /**
   * ⭐⭐ V1-E4d (§Post-F9.96): «el BOM cambió» es **la leyenda de las etiquetas** que cada renglón
   * afectado ya trae, no un problema. Dejó de ser una caja amarilla en la entrada y es una cláusula
   * de la línea de resumen. Si alguien devuelve el cartel, la segunda aserción se pone roja.
   */
  it('dice que el BOM cambió en la línea de resumen, SIN cartel amarillo', async () => {
    useExplosionMock.mockReturnValue({
      data: { ...explosionDePrueba(), huboCambios: true, regenerado: true },
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    expect(screen.getByTestId('exp-resumen')).toHaveTextContent('El BOM cambió');
    expect(screen.queryByTestId('exp-aviso-cambios')).toBeNull();
  });

  it('muestra los avisos del enganche (F8-E6) cuando la explosión los reporta', async () => {
    useExplosionMock.mockReturnValue({
      data: {
        ...explosionDePrueba(),
        avisos: ['Tela "Felpa" amarrada multi-color con precios distintos: se usó el precio base.'],
      },
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    expect(screen.getByTestId('exp-avisos')).toBeInTheDocument();
    expect(screen.getByTestId('exp-aviso')).toHaveTextContent('amarrada multi-color');
    // ⭐⭐ V1-E4d: se quedan, pero DEBAJO de la lista y sin color de alarma (son apuntes sobre
    // cómo quedó valuada la explosión, no un "algo está mal").
    expect(claseAmarilla(screen.getByTestId('exp-avisos'))).toBe(false);
    expect(vaDespuesDeLaLista(screen.getByTestId('exp-avisos'))).toBe(true);
  });

  /**
   * §Post-F9.16 — el catálogo de direcciones nace VACÍO y sin dirección el dominio rechaza la
   * generación. Antes el botón se veía habilitado y el error llegaba del servidor, sin decir a
   * dónde ir: ahora se explica y se enlaza el catálogo.
   */
  it('SIN direcciones de entrega explica qué falta, ofrece el alta AQUÍ y enlaza el catálogo', async () => {
    useDireccionesMock.mockReturnValue({ data: { datos: [] }, isPending: false });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const aviso = screen.getByTestId('exp-falta-direccion');
    expect(aviso).toHaveTextContent('No hay ninguna dirección de entrega activa');
    // ⭐⭐ V1-E4d: el lugar para llenarlo está EN esta pantalla; el catálogo queda como salida.
    expect(screen.getByTestId('exp-alta-direccion')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /catálogo de direcciones/i })).toHaveAttribute(
      'href',
      '/catalogos/direcciones-entrega',
    );
  });

  /**
   * ⚠️ **DOS direcciones, y ninguna favorita** — con UNA sola ya no se pregunta nada (Daniel,
   * 23-ago-2026: *"siempre dejarla fija"*); la decisión sólo existe cuando de verdad hay dónde
   * elegir.
   */
  it('CON VARIAS direcciones y ninguna favorita, dice que hay que elegir una', async () => {
    useDireccionesMock.mockReturnValue({
      data: {
        datos: [
          { id: 7, nombre: 'Naucalpan', favorita: false },
          { id: 8, nombre: 'Bodega Centro', favorita: false },
        ],
      },
      isPending: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    expect(screen.getByTestId('exp-falta-direccion')).toHaveTextContent('favorita');

    // Al elegirla en el selector, el aviso desaparece y ya se puede generar.
    await usuario.selectOptions(screen.getByTestId('exp-direccion-entrega'), '7');
    expect(screen.queryByTestId('exp-falta-direccion')).not.toBeInTheDocument();
    expect(screen.getByTestId('exp-generar-oc')).not.toBeDisabled();
  });

  /**
   * Si el catálogo NO se pudo consultar, decir "está vacío" sería mentir con el catálogo lleno (el
   * usuario abre el enlace, ve sus 5 direcciones y vuelve bloqueado sin causa). Se avisa del ERROR
   * y NO se bloquea: por una lectura fallida no se le cierra la puerta — decide el servidor al
   * guardar.
   */
  it('si FALLA la consulta del catálogo: lo dice tal cual y NO bloquea', async () => {
    const refetchDirecciones = vi.fn();
    useDireccionesMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: refetchDirecciones,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const aviso = screen.getByTestId('exp-falta-direccion');
    expect(aviso).toHaveTextContent('No se pudo consultar el catálogo');
    // NO dice "está vacío" (sería falso) ni bloquea por un error de lectura.
    expect(aviso).not.toHaveTextContent('No hay ninguna dirección de entrega activa');
    expect(screen.getByTestId('exp-generar-oc')).not.toBeDisabled();
    // ⭐⭐ V1-E4d: y el clic SÍ sale al servidor — por una lectura fallida no se cierra la puerta.
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    expect(previoMutateMock).toHaveBeenCalledOnce();
    await usuario.click(screen.getByTestId('exp-reintentar-direcciones'));
    expect(refetchDirecciones).toHaveBeenCalled();
  });

  /**
   * ORDEN DE LAS RAMAS: un refetch que falla NO borra los datos previos de la cache. Si el usuario
   * ya eligió su dirección, decirle "no sabemos cuál usar" sería falso — se pregunta primero si ya
   * hay dirección y solo después si hubo error.
   */
  it('con la dirección YA ELEGIDA, un refetch fallido no inventa que falta', async () => {
    // Datos previos en cache + isError (lo que deja React Query tras un refetch fallido). Van DOS
    // sin favorita: con una sola, la cascada la elegiría y no habría nada que avisar.
    useDireccionesMock.mockReturnValue({
      data: {
        datos: [
          { id: 7, nombre: 'Naucalpan', favorita: false },
          { id: 8, nombre: 'Bodega Centro', favorita: false },
        ],
      },
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    // Sin elegir nada (y sin favorita) sí avisa del error.
    expect(screen.getByTestId('exp-falta-direccion')).toBeInTheDocument();

    await usuario.selectOptions(screen.getByTestId('exp-direccion-entrega'), '7');
    expect(screen.queryByTestId('exp-falta-direccion')).not.toBeInTheDocument();
    expect(screen.getByTestId('exp-generar-oc')).not.toBeDisabled();
  });

  it('con una dirección FAVORITA no estorba con avisos', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    expect(screen.queryByTestId('exp-falta-direccion')).not.toBeInTheDocument();
  });
  // ── ⭐ PRIMER AVISO de §Post-F9.43(d): la desalineación EN EL LUGAR DE LA DECISIÓN (V1-E3d) ──
  //
  // La ficha es explícita: *"sin OC todavía → rojo en el lugar de la decisión: al explotar el MRP /
  // generar la OC, los renglones que cambiaron salen marcados diciendo QUÉ cambió"*. Aquí es donde
  // se está a punto de gastar; que el aviso solo viviera en el detalle de la orden dejaba a esta
  // pantalla —la que decide— muda.

  it('sin desalineación no estorba con el aviso', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    expect(screen.queryByTestId('exp-desalineacion')).not.toBeInTheDocument();
  });

  it('el modelo cambió: lo dice AQUÍ, con QUÉ cambió, y marca el renglón afectado', async () => {
    const base = explosionDePrueba();
    useExplosionMock.mockReturnValue({
      data: {
        ...base,
        desalineacion: {
          hayCambios: true,
          conOrdenCompra: false,
          critico: false,
          cambios: [
            {
              tipo: 'avio',
              idRenglon: 9,
              material: 'BOT-01 — Botón',
              que: 'consumo',
              detalle: 'La cantidad de "BOT-01 — Botón" pasó de 6 a 8 en el modelo.',
            },
          ],
        },
        grupos: base.grupos.map((g) => ({
          ...g,
          renglones: g.renglones.map((r) =>
            r.id === 1 ? { ...r, cambiosReceta: ['consumo'] } : r,
          ),
        })),
      },
      isPending: false,
      isError: false,
    });

    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const aviso = screen.getByTestId('exp-desalineacion');
    expect(aviso).toHaveTextContent('pasó de 6 a 8 en el modelo');
    // …y el renglón concreto queda marcado, que es a lo que apunta el aviso.
    expect(screen.getByTestId('exp-renglon-desalineado')).toHaveTextContent('El modelo cambió');
  });

  it('⭐ un movimiento del PRECIO DE COMPRA se informa SIN rojo y con su causa real', async () => {
    // El escenario del reviewer: el comprador ajusta su propia OC y la autoriza. Eso mueve el precio
    // de la receta del modelo (desde V1-E3e ES la última compra real), pero NADIE tocó el modelo.
    const base = explosionDePrueba();
    useExplosionMock.mockReturnValue({
      data: {
        ...base,
        desalineacion: {
          hayCambios: true,
          conOrdenCompra: true,
          critico: false, // ← lo decide el servidor: sin esto sería rojo permanente
          cambios: [
            {
              tipo: 'avio',
              idRenglon: 9,
              material: 'BOT-01 — Botón',
              que: 'precio-mercado',
              detalle:
                'La última COMPRA REAL de "BOT-01 — Botón" es de $2.20 y esta orden congeló $2.00. El modelo no cambió: cambió el precio de compra.',
            },
          ],
        },
        grupos: base.grupos.map((g) => ({
          ...g,
          renglones: g.renglones.map((r) =>
            r.id === 1 ? { ...r, cambiosReceta: ['precio-mercado'] } : r,
          ),
        })),
      },
      isPending: false,
      isError: false,
    });

    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const aviso = screen.getByTestId('exp-desalineacion');
    expect(aviso).toHaveTextContent('El modelo no cambió');
    expect(aviso).not.toHaveTextContent('ya tiene compras'); // NO es el cartel rojo
    expect(screen.getByTestId('exp-renglon-desalineado')).toHaveTextContent(
      'Cambió el precio de compra',
    );
  });
});

/**
 * ⭐ V1-E3h (§Post-F9.72) — LO QUE EL COMPRADOR TIENE QUE VER. Requisito TEXTUAL de Daniel: que se
 * vea *"transparentemente qué le falta de liberar"*. No un "no se puede": **qué** y **cuánto**, y el
 * camino a donde se resuelve (antes la explosión frenaba en seco sin decir siquiera a qué pantalla
 * ir — el hueco de navegación que la decisión nombra aparte).
 */
describe('ExplosionMaterialesPagina · lo que falta liberar (V1-E3h)', () => {
  /** Explosión con un material fuera por no estar firmado. */
  function conPendiente() {
    return {
      ...explosionDePrueba(),
      pendientesLiberar: [
        {
          tipo: 'avio' as const,
          idRenglon: 9,
          idOrden: 50,
          folioOrden: 7,
          idTela: null,
          idTelaColor: null,
          telaColor: null,
          idAvio: 21,
          material: 'CIE-53 — Cierre 53 cm',
          consumoPorPrenda: 1,
          unidad: 'pza',
        },
      ],
    };
  }

  async function abrir(permisos: string[]): Promise<void> {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(permisos as never),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
  }

  it('lista lo pendiente con NOMBRE y CANTIDAD (no un "no se puede")', async () => {
    useExplosionMock.mockReturnValue({ data: conPendiente(), isPending: false, isError: false });
    await abrir(['compras.ver']);

    const aviso = screen.getByTestId('exp-pendientes-liberar');
    expect(aviso).toHaveTextContent('CIE-53 — Cierre 53 cm');
    expect(aviso).toHaveTextContent('1 pza por prenda');
    // Y la explosión SIGUE mostrando lo que sí se puede comprar.
    expect(screen.getAllByTestId('exp-grupo').length).toBeGreaterThan(0);
  });

  it('sin nada pendiente, el aviso NI SE PINTA', async () => {
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    await abrir(['compras.ver']);

    expect(screen.queryByTestId('exp-pendientes-liberar')).toBeNull();
  });

  it('⭐ el aviso LLEVA a donde se libera, si esta sesión puede abrirlo', async () => {
    useExplosionMock.mockReturnValue({ data: conPendiente(), isPending: false, isError: false });
    await abrir(['compras.ver', 'ordenes.ver', 'desarrollo.ver']);

    expect(screen.getByTestId('exp-ir-a-liberar')).toBeInTheDocument();
  });

  it('con TODO pendiente, el vacío NO miente diciendo "BOM vacío"', async () => {
    useExplosionMock.mockReturnValue({
      data: { ...conPendiente(), grupos: [] },
      isPending: false,
      isError: false,
    });
    await abrir(['compras.ver']);

    expect(screen.getByTestId('exp-vacio')).toHaveTextContent(
      /pendiente de que Desarrollo lo libere/,
    );
    expect(screen.getByTestId('exp-vacio')).not.toHaveTextContent(/BOM vacío/);
  });

  it('un comprador que NO puede ver la receta no recibe un enlace muerto (§Post-F9.68)', async () => {
    useExplosionMock.mockReturnValue({ data: conPendiente(), isPending: false, isError: false });
    await abrir(['compras.ver']);

    expect(screen.queryByTestId('exp-ir-a-liberar')).toBeNull();
    // Pero SÍ se le dice quién lo resuelve (nunca un callejón sin salida).
    expect(screen.getByTestId('exp-pendientes-liberar')).toHaveTextContent(/Pídeselo a Desarrollo/);
  });
});

/**
 * ⭐ §Post-F9.71 (V1-E3i) — CADA OC CON SU FECHA. Daniel, sobre una orden real: *"me pide fecha de
 * entrega, pero cada OC interna va a tener una fecha de entrega diferente"*. La tela se necesita
 * semanas antes que los avíos: una sola fecha para todas convierte el dato en decorativo.
 */
describe('ExplosionMaterialesPagina · fecha de entrega POR PROVEEDOR (§Post-F9.71)', () => {
  /** Explosión con DOS proveedores comprables (una sola OC no puede demostrar nada de fechas). */
  function conDosProveedores() {
    const base = explosionDePrueba();
    return {
      ...base,
      grupos: [
        ...base.grupos,
        {
          idProveedor: 22,
          proveedor: 'Telas del Norte',
          renglones: [
            {
              id: 4,
              tipo: 'tela',
              idTela: 4,
              idTelaColor: null,
              telaColor: null,
              idAvio: null,
              material: 'Felpa amarrada',
              cantidadRequerida: 45,
              unidad: 'm',
              esGenerico: false,
              estadoGenerico: 'no-aplica',
              existenciaStock: 0,
              cantidadAComprar: 45,
              idProveedorSugerido: 22,
              proveedorSugerido: 'Telas del Norte',
              precioSugerido: 10,
              origenProveedor: 'amarre-desarrollo',
              proveedorSugeridoInactivo: false,
              diff: 'sin-cambio',
              cambiosReceta: [],
              avisos: [],
              cantidadEnOc: 0,
              cantidadPendiente: 45,
              idsRequerimiento: [4],
              porOrden: [
                {
                  idRequerimiento: 4,
                  idOrden: 50,
                  folioOrden: 7,
                  cantidadRequerida: 45,
                  cantidadAComprar: 45,
                  cantidadEnOc: 0,
                  cantidadPendiente: 45,
                  precioSugerido: 10,
                },
              ],
            },
          ],
        },
      ],
    };
  }

  beforeEach(() => {
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    mutateMock.mockReset();
    previoMutateMock.mockReset();
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useExplosionMock.mockReturnValue({
      data: conDosProveedores(),
      isPending: false,
      isError: false,
    });
  });

  async function abrirExplosion(): Promise<void> {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
  }

  it('cada grupo CON proveedor lleva su propia fecha; el grupo sin proveedor no (no genera OC)', async () => {
    await abrirExplosion();

    const fechas = screen.getAllByTestId('exp-fecha-grupo');
    expect(fechas).toHaveLength(2);
    expect(fechas.map((f) => f.getAttribute('data-proveedor'))).toEqual(['11', '22']);
  });

  it('la fecha de arriba es el VALOR INICIAL: las que nadie tocó la siguen', async () => {
    await abrirExplosion();

    fireEvent.change(screen.getByTestId('exp-fecha-entrega'), { target: { value: '2026-11-30' } });
    for (const campo of screen.getAllByTestId('exp-fecha-grupo')) {
      expect(campo).toHaveValue('2026-11-30');
    }
  });

  it('la fecha tocada de un proveedor NO arrastra a los demás, y viaja al servidor', async () => {
    const usuario = userEvent.setup();
    await abrirExplosion();

    fireEvent.change(screen.getByTestId('exp-fecha-entrega'), { target: { value: '2026-11-30' } });
    const campos = screen.getAllByTestId('exp-fecha-grupo');
    fireEvent.change(campos[1] as HTMLElement, { target: { value: '2026-10-05' } });

    // El campo tocado SE QUEDA con lo que se escribió…
    expect(campos[1] as HTMLElement).toHaveValue('2026-10-05');
    // …y el otro proveedor sigue con la de arriba (no se movió con el vecino).
    expect(campos[0] as HTMLElement).toHaveValue('2026-11-30');

    // (La «Entrega (inicial)» ya está capturada arriba: sin ella no se avanzaría, V1-E7f.)
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    const [cuerpo] = previoMutateMock.mock.calls[0] as [
      {
        fechaEntrega?: string;
        fechasPorProveedor?: { idProveedor: number; fechaEntrega: string }[];
      },
    ];
    expect(cuerpo.fechaEntrega).toBe('2026-11-30');
    // Sólo viaja la EXCEPCIÓN: la del proveedor que nadie tocó la resuelve el servidor con la de
    // arriba (mandar las dos sería mandar como decisión lo que es un default).
    expect(cuerpo.fechasPorProveedor).toEqual([{ idProveedor: 22, fechaEntrega: '2026-10-05' }]);
  });

  it('sin tocar ninguna fecha de grupo, el cuerpo NO lleva fechas por proveedor (gemela)', async () => {
    const usuario = userEvent.setup();
    await abrirExplosion();

    fireEvent.change(screen.getByTestId('exp-fecha-entrega'), { target: { value: '2026-11-30' } });
    await usuario.click(screen.getByTestId('exp-generar-oc'));

    const [cuerpo] = previoMutateMock.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo).not.toHaveProperty('fechasPorProveedor');
    expect(cuerpo.fechaEntrega).toBe('2026-11-30');
  });

  it('vaciar la fecha de un grupo lo devuelve a seguir a la de arriba (y no viaja vacía)', async () => {
    const usuario = userEvent.setup();
    await abrirExplosion();

    fireEvent.change(screen.getByTestId('exp-fecha-entrega'), { target: { value: '2026-11-30' } });
    const campos = screen.getAllByTestId('exp-fecha-grupo');
    fireEvent.change(campos[1] as HTMLElement, { target: { value: '2026-10-05' } });
    fireEvent.change(campos[1] as HTMLElement, { target: { value: '' } });

    // Vuelve a mostrar la de arriba (no se queda en blanco significando otra cosa).
    expect(screen.getAllByTestId('exp-fecha-grupo')[1] as HTMLElement).toHaveValue('2026-11-30');

    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    const [cuerpo] = previoMutateMock.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo).not.toHaveProperty('fechasPorProveedor');
  });

  it('al cambiar de orden, las fechas por proveedor NO se arrastran', async () => {
    const usuario = userEvent.setup();
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [
          { id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' },
          { id: 51, folio: 8, codigoModelo: 'A-101', cliente: 'Cliente Y' },
        ],
        total: 2,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    fireEvent.change(screen.getAllByTestId('exp-fecha-grupo')[0] as HTMLElement, {
      target: { value: '2026-10-05' },
    });

    // V1-E3q: quitar la última OP deja la pantalla en blanco; volver a empezar NO arrastra fechas.
    await usuario.click(screen.getAllByTestId('exp-quitar-op')[0] as HTMLElement);
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[1] as HTMLElement);
    expect(screen.getAllByTestId('exp-fecha-grupo')[0] as HTMLElement).toHaveValue('');
  });
});

/**
 * ⭐ V1-E3m (§Post-F9.82) — EL PROVEEDOR DEL MATERIAL, desde la pantalla del comprador.
 *
 * Daniel se quedó atorado aquí: la explosión completa a la vista, el botón «Generar OC» apagado y
 * ni una pista de por qué. Estas pruebas cubren las dos mitades del arreglo en la UI: **decir qué
 * falta, con nombres** y **poder asignarle proveedor al material ahí mismo, solo para esa OP**.
 */
describe('ExplosionMaterialesPagina — V1-E3m: el proveedor del material (§Post-F9.82)', () => {
  beforeEach(() => {
    // Este bloque es TOP-LEVEL a propósito: arma su propio escenario en vez de heredar el de otro
    // describe (heredar el de al lado fue justo lo que hizo que un `mock.calls[0]` leyera la llamada
    // de la prueba anterior y diera un verde/rojo que no hablaba de esta prueba).
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    mutateMock.mockReset();
    previoMutateMock.mockReset();
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    asignarMutateMock.mockReset();
    useAsignarProveedorMock.mockReturnValue({
      mutate: asignarMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    // ⭐⭐ V1-E3x: el hook del acto en bloque se llama SIEMPRE (aunque el panel no se pinte), así
    // que este describe top-level también tiene que devolverle algo o la pantalla no monta.
    bloqueMutateMock.mockReset();
    useAsignarProveedorEnBloqueMock.mockReturnValue({
      mutate: bloqueMutateMock,
      reset: vi.fn(),
      data: undefined,
      isPending: false,
      isError: false,
      isSuccess: false,
    });
  });

  /** Explosión donde NADA se puede comprar: el único material pendiente no tiene proveedor. */
  function explosionSinNadaComprable(): ReturnType<typeof explosionDePrueba> {
    const base = explosionDePrueba();
    return { ...base, grupos: base.grupos.filter((g) => g.idProveedor === null) };
  }

  /**
   * ⭐⭐ **V1-E4d (§Post-F9.96) — EL MOTIVO DEJA DE SER UN CARTEL DE ENTRADA.**
   *
   * V1-E3m puso este mensaje porque Daniel se quedó mirando un botón muerto (*"no me deja hacer
   * nada"*), y estuvo bien: el problema no era el texto, era **dónde**. Un cartel amarillo antes
   * del primer renglón recibe al comprador diciéndole que ya llegó mal. Ahora el botón **no se
   * apaga**, el clic va al servidor y la revisión previa lo explica material por material y con
   * sus palabras (`exp-previa-omitidos`) — que es más de lo que decía el cartel, y cuando se
   * pregunta. El motivo sobrevive como TÍTULO del botón, para quien pase el ratón.
   */
  it('sin nada comprable el botón ya NO se apaga: el clic va al servidor a que explique', async () => {
    const usuario = userEvent.setup();
    useExplosionMock.mockReturnValue({
      data: explosionSinNadaComprable(),
      isPending: false,
      isError: false,
    });
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const boton = screen.getByTestId('exp-generar-oc');
    expect(boton).toBeEnabled();
    // El motivo sigue dicho —al pasar el ratón—, con el NOMBRE del material culpable…
    expect(boton).toHaveAttribute('title', expect.stringContaining('Felpa'));
    // …y el genérico cubierto por stock, que no es lo que estorba, no sale nombrado.
    expect(boton.getAttribute('title')).not.toContain('HIL-01');
    // 🔴 Y ya NO hay cartel amarillo en la entrada.
    expect(screen.queryByTestId('exp-motivo-sin-oc')).toBeNull();
    await usuario.click(boton);
    expect(previoMutateMock).toHaveBeenCalledOnce();
  });

  /**
   * ⚠️ **CORRECCIÓN DE LA 2ª VUELTA: NO ERAN UN DUPLICADO, ERAN LOS DOS LADOS DEL MISMO CASO.**
   * La primera vuelta afirmó que `exp-parcial-sin-proveedor` repetía a `exp-motivo-sin-oc`, y era
   * falso: son **mutuamente excluyentes** —`motivoSinOc` sólo existe con `comprables === 0`, y el
   * parcial exigía `comprables > 0`—. Uno decía *"no se puede generar nada"*; el otro, *"sí se
   * genera, PERO N materiales se quedan fuera"*, que es el caso peligroso.
   *
   * Se retiraron los DOS de la entrada igual, porque ninguno es un error del comprador: la acción
   * vive en el renglón desde §Post-F9.82 y la razón completa la da la previa. Pero **el hecho de
   * la compra parcial no se perdió**: vive en la línea gris de resumen (su prueba, más abajo).
   */
  it('lo que no tiene proveedor NO se regaña en la entrada: se resuelve en su renglón', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    expect(screen.getByTestId('exp-generar-oc')).toBeEnabled();
    expect(screen.queryByTestId('exp-motivo-sin-oc')).toBeNull();
    expect(screen.queryByTestId('exp-parcial-sin-proveedor')).toBeNull();
    // La acción sí está, y está donde se ve el problema: el renglón de la Felpa (tela 4).
    const asignar = screen.getAllByTestId('exp-asignar-proveedor');
    expect(asignar).toHaveLength(1);
    expect(asignar[0]).toHaveAttribute('data-material', '4');
  });

  it('ofrece «asignar proveedor» SOLO en el material que no tiene a quién comprarle', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const botones = screen.getAllByTestId('exp-asignar-proveedor');
    // UNO solo: la Felpa (id 4). El botón (id 3) ya trae proveedor del catálogo —ahí no se cambia
    // desde aquí, se cambia en la OC— y el hilo genérico no va a compra (cantidadAComprar 0).
    expect(botones).toHaveLength(1);
    expect(botones[0]).toHaveAttribute('data-material', '4');
  });

  it('sin `compras.administrar` la acción NO se pinta (§Post-F9.68: esconder Y bloquear)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    expect(screen.queryByTestId('exp-asignar-proveedor')).not.toBeInTheDocument();
  });

  it('asignar manda tipo + material + proveedor + precio, y NO toca ningún catálogo', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    await usuario.click(screen.getByTestId('exp-asignar-proveedor'));

    // Sin proveedor elegido no se puede guardar (evita mandar una asignación a medias).
    expect(screen.getByTestId('exp-guardar-proveedor')).toBeDisabled();

    await usuario.click(screen.getByTestId('exp-selector-proveedor-stub'));
    fireEvent.change(screen.getByTestId('exp-precio-asignar'), { target: { value: '13.5' } });
    await usuario.click(screen.getByTestId('exp-guardar-proveedor'));

    expect(asignarMutateMock).toHaveBeenCalledTimes(1);
    const [args] = asignarMutateMock.mock.calls[0] as [
      { idOrden: number; cuerpo: Record<string, unknown> },
    ];
    // El material es la FELPA (tela 4) y el proveedor el elegido (33): si la pantalla mandara el
    // renglón del snapshot (id 2) o el proveedor del otro grupo (11), aquí saldría rojo.
    expect(args.idOrden).toBe(50);
    expect(args.cuerpo).toEqual({
      tipo: 'tela',
      idMaterial: 4,
      idProveedor: 33,
      precio: 13.5,
    });
  });

  it('sin precio capturado la asignación viaja SIN precio (que lo resuelva el servidor, no un 0)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    await usuario.click(screen.getByTestId('exp-asignar-proveedor'));
    await usuario.click(screen.getByTestId('exp-selector-proveedor-stub'));
    await usuario.click(screen.getByTestId('exp-guardar-proveedor'));

    const [args] = asignarMutateMock.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    expect(args.cuerpo).not.toHaveProperty('precio');
  });

  it('⭐ si el proveedor propuesto está DE BAJA, la pantalla SÍ ofrece reasignarlo', async () => {
    const usuario = userEvent.setup();
    const base = explosionDePrueba();
    // El botón (id 3) trae proveedor del catálogo… pero ese proveedor está dado de baja. Antes el
    // renglón se quedaba sin salida: `crearOC` no valida `activo`, así que la OC nacía a un
    // proveedor muerto, y el catálogo tampoco deja guardar con un proveedor desactivado.
    const conInactivo = {
      ...base,
      grupos: base.grupos.map((g) => ({
        ...g,
        renglones: g.renglones.map((r) =>
          r.idAvio === 3 ? { ...r, proveedorSugeridoInactivo: true } : r,
        ),
      })),
    };
    useExplosionMock.mockReturnValue({ data: conInactivo, isPending: false, isError: false });
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    expect(screen.getByTestId('exp-proveedor-inactivo')).toBeInTheDocument();
    // DOS ofertas de asignar: la felpa (sin proveedor, id 4) y el botón (proveedor de baja, id 3).
    const materiales = screen
      .getAllByTestId('exp-asignar-proveedor')
      .map((b) => b.getAttribute('data-material'));
    expect(materiales.sort()).toEqual(['3', '4']);
  });

  it('lo que asignó COMPRAS se ve marcado y se puede QUITAR (vuelve a lo del catálogo)', async () => {
    const usuario = userEvent.setup();
    const base = explosionDePrueba();
    const conAsignacion = {
      ...base,
      grupos: base.grupos.map((g) =>
        g.idProveedor === null
          ? {
              ...g,
              idProveedor: 33,
              proveedor: 'Telas del Norte',
              renglones: g.renglones.map((r) =>
                r.idTela === 4
                  ? {
                      ...r,
                      idProveedorSugerido: 33,
                      proveedorSugerido: 'Telas del Norte',
                      precioSugerido: 13.5,
                      origenProveedor: 'asignado-compras',
                    }
                  : r,
              ),
            }
          : g,
      ),
    };
    useExplosionMock.mockReturnValue({ data: conAsignacion, isPending: false, isError: false });
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    // Se distingue de un proveedor que vino del catálogo (el botón, `origenProveedor: habitual`).
    expect(screen.getAllByTestId('exp-origen-compras')).toHaveLength(1);

    await usuario.click(screen.getByTestId('exp-asignar-proveedor'));
    await usuario.click(screen.getByTestId('exp-quitar-proveedor'));
    const [args] = asignarMutateMock.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    expect(args.cuerpo).toMatchObject({ tipo: 'tela', idMaterial: 4, idProveedor: null });
  });
});

/**
 * ⭐⭐ V1-E3q (§Post-F9.85) — **LA REVISIÓN PREVIA Y EL NETEO CONTRA LO YA COMPRADO.**
 *
 * Daniel, probando en vivo el 20-ago: *"Dice que se generaron las OC, pero no se ven reflejadas…
 * me vuelvo a meter en la pantalla y sigue apareciendo ahí los elementos y me deja volver a
 * hacerla"*, y su petición: *"me gustaría que al darle «generar OC desde la explosión», te mande a
 * una pantalla previa… una revisión previa es indispensable"*.
 */
describe('ExplosionMaterialesPagina — V1-E3q: revisión previa y no recomprar (§Post-F9.85)', () => {
  /** Plan que devolvería el servidor: una OC para dos OP + un renglón omitido por ya estar en OC. */
  function planDePrueba() {
    return {
      ordenes: [
        {
          idOrden: 50,
          folio: 7,
          idModelo: 9,
          modelo: 'A-100',
          totalPiezas: 30,
          idPedido: 300,
          folioPedido: 1515,
          fechaEntrega: '2026-09-30',
        },
        {
          idOrden: 51,
          folio: 8,
          idModelo: 9,
          modelo: 'A-101',
          totalPiezas: 20,
          idPedido: 300,
          folioPedido: 1515,
          fechaEntrega: '2026-10-15',
        },
      ],
      proveedores: [
        {
          idProveedor: 11,
          proveedor: 'Avíos Baratos',
          fechaEntrega: '2026-09-01',
          renglones: [
            {
              tipo: 'avio' as const,
              idMaterial: 3,
              material: 'BOT-01 — Botón',
              unidad: 'pza',
              cantidadTotal: 300,
              cantidadPropuesta: 300,
              cantidadEnOcSinColor: 0,
              ajustado: false,
              // ⭐⭐ V1-E3z (§Post-F9.94): el precio del renglón viaja para poder EDITARLO aquí.
              // `as number | null` para que el fixture admita el caso "sus líneas traen precios
              // distintos", que el servidor manda como null.
              precioUnitario: 2 as number | null,
              precioPropuesto: 2 as number | null,
              precioAjustado: false,
              importe: 600,
              porOrden: [
                {
                  idRequerimiento: 1,
                  idOrden: 50,
                  folioOrden: 7,
                  cantidad: 180,
                  cantidadPropuesta: 180,
                  precio: 2,
                  importe: 360,
                  seEscribe: true,
                },
                {
                  idRequerimiento: 9,
                  idOrden: 51,
                  folioOrden: 8,
                  cantidad: 120,
                  cantidadPropuesta: 120,
                  precio: 2,
                  importe: 240,
                  seEscribe: true,
                },
              ],
            },
          ],
          total: 600,
          ordenes: [7, 8],
        },
      ],
      omitidos: [
        {
          idRequerimiento: 2,
          idOrden: 50,
          folioOrden: 7,
          tipo: 'tela' as const,
          material: 'Felpa',
          unidad: 'm',
          cantidadAComprar: 45,
          cantidadEnOc: 45,
          cantidadEnOcSinColor: 0,
          motivo: 'ya-en-oc' as const,
          detalle: '"Felpa" ya está en una orden de compra viva para la orden 7 (45 m).',
        },
      ],
      bloqueos: [] as string[],
      // ⭐⭐ V1-E4c: los avisos que NO bloquean (hoy: telas que se van a pedir sin decir el color).
      avisos: [] as string[],
      totalGeneral: 600,
    };
  }

  beforeEach(() => {
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [
          { id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' },
          { id: 51, folio: 8, codigoModelo: 'A-101', cliente: 'Cliente X' },
        ],
        total: 2,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    useOrdenesDelPedidoMock.mockReset();
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    mutateMock.mockReset();
    previoMutateMock.mockReset();
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useAsignarProveedorMock.mockReturnValue({
      mutate: asignarMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
  });

  /** Abre la pantalla, elige la OP y llega hasta la REVISIÓN PREVIA con el plan dado. */
  async function llegarALaPrevia(plan = planDePrueba()): Promise<void> {
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        opciones.onSuccess?.(plan);
      },
    );
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
  }

  it('⭐ la revisión previa enseña la OC completa, con DE QUÉ OP es cada cantidad', async () => {
    await llegarALaPrevia();

    expect(screen.getByTestId('exp-revision-previa')).toBeInTheDocument();
    const oc = screen.getByTestId('exp-previa-oc');
    expect(oc).toHaveTextContent('Avíos Baratos');
    expect(oc).toHaveTextContent('2026-09-01');
    // §Post-F9.86: el reparto POR OP es innegociable — se ve junto, se guarda repartido.
    const repartos = screen.getAllByTestId('exp-previa-reparto');
    expect(repartos).toHaveLength(2);
    expect(repartos[0]).toHaveTextContent('Orden 7: 180');
    expect(repartos[1]).toHaveTextContent('Orden 8: 120');
    // Y qué OP surte esta OC, dicho arriba.
    expect(screen.getByTestId('exp-previa-ops')).toHaveTextContent('7, 8');
  });

  /**
   * ⭐⭐ **V1-E3u (§Post-F9.89) — EL AVISO DE LA ELECCIÓN LLEGA A LA PREVIA.**
   *
   * La previa es la ÚLTIMA pantalla antes de comprometer el dinero, y la cantidad que se va a
   * comprar salió de RESTAR lo ya comprado. Cuando parte de esa resta viene de una OC que no dice
   * de qué color era, la resta **la decidió el sistema**, no la orden. Mismo criterio con el que el
   * COLOR se enseña aquí y no sólo en la explosión.
   */
  it('🔴 la previa avisa cuando la cantidad salió de restar una atribución ELEGIDA', async () => {
    const plan = planDePrueba();
    const proveedor = plan.proveedores[0] as { renglones: Record<string, unknown>[] };
    proveedor.renglones = [{ ...proveedor.renglones[0], cantidadEnOcSinColor: 80 }];
    await llegarALaPrevia(plan);

    // 🔴 EL VALOR QUE LA PONE ROJA: `cantidadEnOcSinColor: 0` — o sea el sistema restando por una
    // elección suya y presentándolo como un hecho, que es lo que §Post-F9.85 vino a cerrar.
    const aviso = screen.getByTestId('exp-previa-en-oc-sin-color');
    expect(aviso).toHaveTextContent('80');
    expect(aviso).toHaveTextContent('no dice de qué color');
  });

  it('sin atribución elegida, la previa NO inventa una alarma', async () => {
    await llegarALaPrevia();
    expect(screen.queryByTestId('exp-previa-en-oc-sin-color')).toBeNull();
  });

  /**
   * 🔴 **EL CASO MÁS FILOSO, y por eso va aparte:** un renglón omitido por `ya-en-oc` **desaparece
   * de la compra**. Si ese "ya está comprado" salió de una atribución que el sistema ELIGIÓ, la
   * frase *"no hace falta volver a comprarlo"* afirma un hecho que no puede sostener — y el
   * material se queda sin comprar. La frase la arma el SERVIDOR; aquí se comprueba que llega y que
   * la fila se lee como aviso.
   */
  it('🔴 un omitido por «ya en OC» ambiguo se marca como aviso, no como hecho', async () => {
    const plan = planDePrueba();
    const omitido = plan.omitidos[0] as Record<string, unknown>;
    omitido.cantidadEnOcSinColor = 45;
    omitido.detalle =
      '"Felpa" ya está en una orden de compra viva para la orden 7 (45 m). ⚠ Ojo: 45 m de esa ' +
      'cantidad vienen de una orden de compra que NO dice de qué color era.';
    await llegarALaPrevia(plan);

    const fila = screen.getByTestId('exp-previa-omitido');
    // Rojo si la fila ambigua se pinta igual que una normal: se lee como "no hace falta comprarlo"
    // y nadie mira dos veces un renglón que el sistema descartó.
    expect(fila).toHaveAttribute('data-ambiguo', 'si');
    expect(fila).toHaveTextContent('NO dice de qué color');
  });

  it('⭐ enseña lo que se va a OMITIR y POR QUÉ (antes se descartaba en silencio)', async () => {
    await llegarALaPrevia();

    const omitido = screen.getByTestId('exp-previa-omitido');
    expect(omitido).toHaveAttribute('data-motivo', 'ya-en-oc');
    expect(omitido).toHaveTextContent('ya está en una orden de compra viva');
  });

  it('⭐ confirmar SÍ genera, con el MISMO cuerpo que se revisó', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    await usuario.click(screen.getByTestId('exp-confirmar-generar'));
    expect(mutateMock).toHaveBeenCalledOnce();
    const [cuerpo] = mutateMock.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo).toEqual({
      idsOrden: [50],
      idsRequerimiento: [],
      idDireccionEntrega: 7,
      // 🔴 V1-E7f: la fecha viaja porque una PERSONA la capturó; ya no la pone el servidor solo.
      fechaEntrega: '2026-10-15',
    });
  });

  it('volver desde la previa NO genera nada y devuelve la explosión', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    await usuario.click(screen.getByTestId('exp-volver-explosion'));
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('exp-revision-previa')).toBeNull();
    expect(screen.getByTestId('exp-grupos')).toBeInTheDocument();
  });

  // ── ⭐⭐ V1-E3z (§Post-F9.94) — LA PREVIA ES EDITABLE: CANTIDAD Y PRECIO ────────────────────────
  //
  // Daniel, 23-ago-2026: *"ya hay una pantalla previa, pero **no me deja poner el precio correcto ni
  // la cantidad**… **No me deja modificar nada**"*. Lo que estas pruebas fijan es el CÓMO: al
  // corregir un número, la previa **le vuelve a pedir el plan al servidor** — nunca calcula ella.

  it('⭐⭐ la previa trae campos EDITABLES de cantidad y precio (antes era todo texto)', async () => {
    await llegarALaPrevia();

    expect(screen.getByTestId('exp-previa-cantidad')).toHaveValue(300);
    expect(screen.getByTestId('exp-previa-precio')).toHaveValue(2);
  });

  it('⭐⭐ cambiar la CANTIDAD vuelve a pedirle el plan al servidor (la pantalla no calcula, A1)', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();
    previoMutateMock.mockClear();

    const campo = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(campo);
    await usuario.type(campo, '500');
    await usuario.tab();

    // Una petición por campo TERMINADO, no una por tecla.
    expect(previoMutateMock).toHaveBeenCalledOnce();
    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ ajustes?: unknown[] }];
    expect(cuerpo.ajustes).toEqual([
      { tipo: 'avio', idMaterial: 3, idTelaColor: null, idProveedor: 11, cantidadTotal: 500 },
    ]);
    // Y NO se generó nada: corregir un número no es comprar.
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('⭐⭐ cambiar el PRECIO manda `precioUnitario` (el canal que no existía)', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();
    previoMutateMock.mockClear();

    const campo = screen.getByTestId('exp-previa-precio');
    await usuario.clear(campo);
    await usuario.type(campo, '3.75');
    await usuario.tab();

    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ ajustes?: unknown[] }];
    expect(cuerpo.ajustes).toEqual([
      { tipo: 'avio', idMaterial: 3, idTelaColor: null, idProveedor: 11, precioUnitario: 3.75 },
    ]);
  });

  it('🔴 el precio en CERO SÍ viaja: es un ajuste ("sin precio"), no un campo vacío', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();
    previoMutateMock.mockClear();

    const campo = screen.getByTestId('exp-previa-precio');
    await usuario.clear(campo);
    await usuario.type(campo, '0');
    await usuario.tab();

    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ ajustes?: unknown[] }];
    expect(cuerpo.ajustes).toEqual([
      { tipo: 'avio', idMaterial: 3, idTelaColor: null, idProveedor: 11, precioUnitario: 0 },
    ]);
  });

  it('🔴 VACIAR el campo BORRA el ajuste (el renglón vuelve a lo que propone el sistema)', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    const campo = screen.getByTestId('exp-previa-precio');
    await usuario.clear(campo);
    await usuario.type(campo, '9');
    await usuario.tab();
    previoMutateMock.mockClear();
    await usuario.clear(screen.getByTestId('exp-previa-precio'));
    await usuario.tab();

    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ ajustes?: unknown[] }];
    expect(cuerpo.ajustes).toBeUndefined();
  });

  it('pasar por el campo SIN cambiar nada no cuesta una petición', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();
    previoMutateMock.mockClear();

    await usuario.click(screen.getByTestId('exp-previa-cantidad'));
    await usuario.tab();

    expect(previoMutateMock).not.toHaveBeenCalled();
  });

  it('⭐ los DOS ajustes del mismo renglón viajan juntos, no se pisan', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    const cantidad = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(cantidad);
    await usuario.type(cantidad, '500');
    await usuario.tab();
    previoMutateMock.mockClear();
    const precio = screen.getByTestId('exp-previa-precio');
    await usuario.clear(precio);
    await usuario.type(precio, '4');
    await usuario.tab();

    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ ajustes?: unknown[] }];
    expect(cuerpo.ajustes).toEqual([
      {
        tipo: 'avio',
        idMaterial: 3,
        idTelaColor: null,
        idProveedor: 11,
        cantidadTotal: 500,
        precioUnitario: 4,
      },
    ]);
  });

  /**
   * 🔴 **EL SERVIDOR MANDA, TAMBIÉN DESPUÉS DE TECLEAR.** Ésta es la mitad que de verdad importa: el
   * campo arranca con el número del plan (fácil), pero cuando el servidor RESPONDE con otro —porque
   * lo redondeó, o porque el reparto le cambió el total— la pantalla tiene que adoptar el suyo. Si
   * se quedara con lo tecleado, la previa volvería a prometer un número que la OC no va a guardar,
   * que es exactamente lo que §Post-F9.85 vino a impedir.
   */
  it('🔴 cuando el servidor devuelve OTRO número, el campo adopta el del servidor', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();
    expect(screen.getByTestId('exp-previa-cantidad')).toHaveValue(300);

    // La siguiente respuesta del servidor trae 499.99, no el 500 que se tecleó.
    const recortado = planDePrueba();
    const renglon = recortado.proveedores[0]?.renglones[0];
    if (renglon !== undefined) renglon.cantidadTotal = 499.99;
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        opciones.onSuccess?.(recortado);
      },
    );

    const campo = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(campo);
    await usuario.type(campo, '500');
    await usuario.tab();

    expect(screen.getByTestId('exp-previa-cantidad')).toHaveValue(499.99);
  });

  // ── 🔴 3ª VUELTA DE V1-E3z — EL CAMPO SE RECONCILIA CONTRA EL **PLAN**, NO CONTRA EL NÚMERO ────
  //
  // La prueba de arriba sólo cubría el caso FÁCIL: el servidor devuelve un número DISTINTO. El
  // reviewer encontró el caso de verdad, y es el más frecuente: el servidor devuelve **el mismo
  // número que ya estaba pintado**. Entonces el `valor` no cambia, un efecto que dependiera sólo de
  // él no corre, y **el texto tecleado sobrevive** — la previa enseñando un número que la OC no va
  // a guardar, en la última pantalla antes de comprometer dinero.

  it('🔴 el campo adopta el número del servidor AUNQUE coincida con el que ya enseñaba (redondeo)', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();
    expect(screen.getByTestId('exp-previa-precio')).toHaveValue(2);

    // El servidor REDONDEA el 2.004 tecleado y devuelve… 2: el mismo número que el campo ya tenía
    // antes de teclear. El plan sí cambia (avisa que el precio quedó ajustado), pero el NÚMERO no.
    const redondeado = planDePrueba();
    const renglon = redondeado.proveedores[0]?.renglones[0];
    if (renglon !== undefined) {
      renglon.precioUnitario = 2;
      renglon.precioPropuesto = 2;
      renglon.precioAjustado = true;
    }
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        opciones.onSuccess?.(redondeado);
      },
    );

    const campo = screen.getByTestId('exp-previa-precio');
    await usuario.clear(campo);
    await usuario.type(campo, '2.004');
    await usuario.tab();

    // 🔴 Antes: el campo se quedaba en `2.004` mientras el chip decía «propuesto $2.00», el reparto
    // decía «× $2.00» y el importe $2.00. Todo lo demás decía la verdad; mentía el único número que
    // el comprador está mirando cuando decide.
    expect(screen.getByTestId('exp-previa-precio')).toHaveValue(2);
    expect(screen.getByTestId('exp-previa-precio-ajustado')).toBeInTheDocument();
  });

  /**
   * 🔴 **EL MISMO DEFECTO, POR EL LADO QUE NO SE CURA SOLO.** El servidor rechaza un `0`, el
   * comprador se arrepiente y BORRA el campo para deshacer su cambio: el servidor devuelve otra vez
   * el plan de siempre (`300`), el `valor` no cambia… y el campo se quedaba **en blanco para
   * siempre**, con el renglón enseñando `300 pza · $600.00` al lado. Y como el texto vacío ya nunca
   * volvía a igualar al valor, la guardia del `onBlur` dejaba de servir: **cada paso por el campo
   * costaba otra petición**, y cada petición apagaba «Confirmar y generar» un instante. Hasta
   * recargar la página.
   */
  it('🔴 tras un rechazo, VACIAR el campo lo devuelve al número del servidor (y no se queda pidiendo planes)', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    // (1) El servidor RECHAZA la cantidad en cero (el contrato la exige positiva): el plan NO cambia.
    previoMutateMock.mockImplementation(() => {
      /* la mutación queda en error; el hook lo reporta abajo */
    });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: true,
      error: new ErrorDeApi({
        codigo: 'VALIDACION',
        mensaje: 'Los datos enviados no son válidos.',
        detalles: [
          {
            campo: '/ajustes/0/cantidadTotal',
            mensaje: 'La cantidad a comprar debe ser mayor que cero',
          },
        ],
      }),
      isSuccess: false,
    });
    const campo = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(campo);
    await usuario.type(campo, '0');
    await usuario.tab();
    expect(screen.getByTestId('exp-error-recalculo')).toHaveTextContent('mayor que cero');

    // (2) Se arrepiente y BORRA el campo. El ajuste desaparece y el servidor devuelve el MISMO
    // plan de antes: `cantidadTotal: 300`, idéntico al que el campo enseñaba al principio.
    const mismoPlan = planDePrueba();
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        opciones.onSuccess?.(mismoPlan);
      },
    );
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
    });
    await usuario.clear(screen.getByTestId('exp-previa-cantidad'));
    await usuario.tab();

    // (a) El campo vuelve a decir lo que dice el plan — no se queda en blanco.
    expect(screen.getByTestId('exp-previa-cantidad')).toHaveValue(300);
    expect(screen.queryByTestId('exp-error-recalculo')).toBeNull();

    // (b) Y como el texto y el plan volvieron a coincidir, pasar por el campo deja de costar una
    // petición: la guardia del `onBlur` vuelve a servir.
    previoMutateMock.mockClear();
    await usuario.click(screen.getByTestId('exp-previa-cantidad'));
    await usuario.tab();
    expect(previoMutateMock).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **LA OTRA CARA DE LA MISMA MONEDA.** Reconciliar con CADA respuesta del servidor —y no sólo
   * cuando el número cambia— tiene un riesgo: tabular de «Comprar» a «Precio» es el camino normal,
   * o sea que la respuesta del primer campo llega cuando el comprador **ya está tecleando** en el
   * segundo. Si esa respuesta le pisara el texto a medio escribir, habríamos cambiado una mentira
   * por otra.
   */
  it('🔴 la respuesta de OTRO campo no borra lo que el comprador está tecleando', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    // La respuesta se guarda para soltarla A MANO, cuando el cursor ya está en el otro campo.
    const pendientes: ((p: unknown) => void)[] = [];
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        if (opciones.onSuccess !== undefined) pendientes.push(opciones.onSuccess);
      },
    );

    const cantidad = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(cantidad);
    await usuario.type(cantidad, '500');
    // Se pasa a «Precio» (esto confirma la cantidad y dispara la petición) y se empieza a teclear.
    const precio = screen.getByTestId('exp-previa-precio');
    await usuario.clear(precio);
    await usuario.type(precio, '4');
    expect(pendientes).toHaveLength(1);

    // …y AHÍ llega la respuesta de la cantidad.
    act(() => {
      pendientes[0]?.(planDePrueba());
    });

    // El campo donde está el cursor conserva lo que se lleva escrito.
    expect(screen.getByTestId('exp-previa-precio')).toHaveValue(4);
  });

  // ── 🔴 4ª VUELTA DE V1-E3z — «NO ME LO PISES» ES **MIENTRAS TECLEO**, NO **MIENTRAS MIRO** ──────
  //
  // La guardia de la vuelta anterior se saltaba la reconciliación por tener el CURSOR dentro, y con
  // eso reabría el defecto por una puerta más estrecha pero igual de transitada: salir con Tab
  // (sale la petición) y **volver a entrar al campo a revisar lo que uno puso** mientras el botón
  // dice «Recalculando…». La respuesta llegaba tapada y la pantalla se quedaba con el número
  // tecleado. La marca correcta es «hay teclazos SIN confirmar», no «tengo el foco».

  it('🔴 volver al campo antes de que conteste el servidor NO deja un número que contradiga al renglón', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    // La respuesta se suelta A MANO, para que llegue con el comprador ya de vuelta en el campo.
    const pendientes: ((p: unknown) => void)[] = [];
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        if (opciones.onSuccess !== undefined) pendientes.push(opciones.onSuccess);
      },
    );

    // (1) Teclea 2.004 y sale: sale la petición.
    const campo = screen.getByTestId('exp-previa-precio');
    await usuario.clear(campo);
    await usuario.type(campo, '2.004');
    await usuario.tab();
    expect(pendientes).toHaveLength(1);

    // (2) Vuelve a entrar al campo A MIRAR lo que puso —sin teclear nada— mientras se recalcula.
    await usuario.click(screen.getByTestId('exp-previa-precio'));

    // (3) …y AHÍ llega el redondeo del servidor: el MISMO $2 de antes, ahora marcado como ajustado.
    const redondeado = planDePrueba();
    const renglon = redondeado.proveedores[0]?.renglones[0];
    if (renglon !== undefined) {
      renglon.precioUnitario = 2;
      renglon.precioPropuesto = 2;
      renglon.precioAjustado = true;
    }
    act(() => {
      pendientes[0]?.(redondeado);
    });

    // 🔴 Antes: `2.004` en el campo con el chip «Precio ajustado (propuesto $2.00)» al lado —la
    // pantalla contradiciéndose a sí misma durante TODO el recálculo.
    expect(screen.getByTestId('exp-previa-precio')).toHaveValue(2);
    expect(screen.getByTestId('exp-previa-precio-ajustado')).toBeInTheDocument();

    // Y salir del campo ya no cuesta otra petición: lo que se ve ES lo del plan.
    previoMutateMock.mockClear();
    await usuario.tab();
    expect(previoMutateMock).not.toHaveBeenCalled();
  });

  /**
   * 🔴 **LA MISMA RAÍZ, POR EL LADO CARO:** estar parado en un campo sin teclear no puede convertir
   * su número VIEJO en un ajuste que el comprador nunca capturó. Si el plan cambia el precio por
   * fuera (otro usuario movió el catálogo, se consumió un requerimiento) y el campo lo tapa, al
   * salir el `onBlur` ve un texto distinto del plan y manda un `precioUnitario` inventado: enciende
   * el chip «Precio ajustado» y **clava ese precio en TODAS las líneas del renglón**, pisando los
   * precios por OP de V1-E3m.
   */
  it('🔴 pasar por un campo SIN teclear no inventa un ajuste con su valor viejo', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    const pendientes: ((p: unknown) => void)[] = [];
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        if (opciones.onSuccess !== undefined) pendientes.push(opciones.onSuccess);
      },
    );

    // Se corrige la CANTIDAD (esa sí la tecleó) y se pasa a «Precio» sin escribir nada ahí.
    const cantidad = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(cantidad);
    await usuario.type(cantidad, '500');
    await usuario.click(screen.getByTestId('exp-previa-precio'));
    expect(pendientes).toHaveLength(1);

    // El plan que vuelve trae el precio cambiado POR FUERA: 2 → 5.
    const conPrecioNuevo = planDePrueba();
    const renglon = conPrecioNuevo.proveedores[0]?.renglones[0];
    if (renglon !== undefined) {
      renglon.cantidadTotal = 500;
      renglon.precioUnitario = 5;
      renglon.precioPropuesto = 5;
    }
    act(() => {
      pendientes[0]?.(conPrecioNuevo);
    });

    // (a) El campo que nadie tecleó adopta el precio del plan…
    expect(screen.getByTestId('exp-previa-precio')).toHaveValue(5);
    // (b) …y salir de él NO manda ningún ajuste: el comprador no capturó ningún precio.
    previoMutateMock.mockClear();
    await usuario.tab();
    expect(previoMutateMock).not.toHaveBeenCalled();
  });

  // ── 🔴 5ª VUELTA DE V1-E3z — LA PETICIÓN NO PUEDE SOBREVIVIR A LA PANTALLA QUE LA LANZÓ ─────────

  /**
   * 🔴 **UNA RESPUESTA TARDÍA NO PUEDE REABRIR LA PREVIA.** Salir de la previa no invalidaba nada:
   * el clic en «Volver y corregir» empieza por un `mousedown` que saca el foco del campo, así que
   * **sale una petición** justo mientras la pantalla se cierra. Al llegar, la previa **reaparecía
   * sola** con el plan viejo — y si mientras tanto el comprador cambió el conjunto de OP (lo que
   * además BORRA los ajustes), esa pantalla resucitada enseña unas órdenes y «Confirmar y generar»
   * manda OTRAS, porque el cuerpo se arma con el estado de AHORA. La última pantalla antes de
   * comprometer dinero, abierta sin que nadie la pida y describiendo una compra que no es la que se
   * va a hacer.
   */
  it('🔴 salir de la previa INVALIDA lo que venga en vuelo: una respuesta tardía NO la reabre', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    // La respuesta se retiene para soltarla cuando la previa ya esté cerrada.
    const pendientes: ((p: unknown) => void)[] = [];
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        if (opciones.onSuccess !== undefined) pendientes.push(opciones.onSuccess);
      },
    );

    // Se corrige la cantidad y, sin esperar el recálculo, el comprador se arrepiente y se sale.
    const campo = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(campo);
    await usuario.type(campo, '77');
    await usuario.click(screen.getByTestId('exp-volver-explosion'));

    // El `mousedown` del botón sacó el foco del campo: la petición SÍ salió (no es un hueco de la
    // guardia, es una petición legítima que se quedó sin pantalla).
    expect(pendientes).toHaveLength(1);
    expect(screen.queryByTestId('exp-revision-previa')).toBeNull();

    // Y ahora llega, tarde.
    act(() => {
      pendientes[0]?.(planDePrueba());
    });

    // 🔴 Antes: `la previa REABRE sola con el plan viejo: true`.
    expect(screen.queryByTestId('exp-revision-previa')).toBeNull();
  });

  // ── 🔴 …Y LOS OTROS TRES CAMINOS POR LOS QUE LA PREVIA PUEDE ABRIRSE SOLA ───────────────────────
  //
  // `cerrarPrevia()` se usa en cinco sitios, pero sólo «Volver y corregir» estaba vigilado: revertir
  // cualquiera de los otros a un `setPlan(null)` pelón dejaba la suite entera en verde. No es que
  // los caminos no existan — se llega a ellos con gestos normales, y aquí están.

  /**
   * 🔴 **CON LAS OC YA EMITIDAS, UN RECÁLCULO ABANDONADO NO PUEDE REABRIR LA PREVIA.** Los campos
   * NO se apagan mientras se generan las órdenes de compra, así que el comprador todavía puede
   * corregir un número entre que pulsa «Confirmar y generar» y que el servidor contesta. Si esa
   * petición huérfana llegara después, volvería a abrir la revisión previa **de una compra que ya
   * se hizo** — y lo que propondría es comprar otra vez lo mismo.
   */
  it('🔴 tras GENERAR las OC, un recálculo abandonado no reabre la previa', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    // Los dos `onSuccess` se retienen para soltarlos en el orden que ocurre de verdad.
    const previoPendiente: ((p: unknown) => void)[] = [];
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        if (opciones.onSuccess !== undefined) previoPendiente.push(opciones.onSuccess);
      },
    );
    const generarPendiente: (() => void)[] = [];
    mutateMock.mockImplementation((_cuerpo: unknown, opciones: { onSuccess?: () => void }) => {
      if (opciones.onSuccess !== undefined) generarPendiente.push(opciones.onSuccess);
    });

    // (1) Confirma… y mientras se generan las OC todavía corrige un número.
    await usuario.click(screen.getByTestId('exp-confirmar-generar'));
    const campo = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(campo);
    await usuario.type(campo, '77');
    await usuario.tab();
    expect(generarPendiente).toHaveLength(1);
    expect(previoPendiente).toHaveLength(1);

    // (2) Las OC se emiten: la previa se cierra y se borran ajustes y selección.
    act(() => {
      generarPendiente[0]?.();
    });
    expect(screen.queryByTestId('exp-revision-previa')).toBeNull();

    // (3) …y AHORA llega el recálculo que nadie esperaba ya.
    act(() => {
      previoPendiente[0]?.(planDePrueba());
    });

    // 🔴 Antes: la previa reaparecía proponiendo la compra que se acababa de hacer.
    expect(screen.queryByTestId('exp-revision-previa')).toBeNull();
  });

  /**
   * 🔴 **CAMBIAR EL CONJUNTO DE OP CON «REVISAR» EN VUELO NO PUEDE ABRIR LA PREVIA DEL CONJUNTO
   * VIEJO.** El botón «Revisar y generar OC» sí se apaga mientras el servidor prepara el plan, pero
   * la lista de órdenes NO: se puede agregar o quitar una OP en esa ventana. Si la respuesta llega
   * después, la previa **abre sola** describiendo una compra de otras órdenes distintas de las que
   * están elegidas ahora.
   */
  it('🔴 AGREGAR una OP con «Revisar» en vuelo no abre la previa del conjunto viejo', async () => {
    const usuario = userEvent.setup();
    const pendientes: ((p: unknown) => void)[] = [];
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        if (opciones.onSuccess !== undefined) pendientes.push(opciones.onSuccess);
      },
    );
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });

    const opciones = screen.getAllByTestId('exp-orden-opcion');
    await usuario.click(opciones[0] as HTMLElement);
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    expect(pendientes).toHaveLength(1);

    // Con el plan en camino, se agrega otra OP al conjunto.
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[1] as HTMLElement);

    act(() => {
      pendientes[0]?.(planDePrueba());
    });

    expect(screen.queryByTestId('exp-revision-previa')).toBeNull();
  });

  it('🔴 QUITAR una OP con «Revisar» en vuelo tampoco abre la previa del conjunto viejo', async () => {
    const usuario = userEvent.setup();
    const pendientes: ((p: unknown) => void)[] = [];
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        if (opciones.onSuccess !== undefined) pendientes.push(opciones.onSuccess);
      },
    );
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });

    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[1] as HTMLElement);
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    expect(pendientes).toHaveLength(1);

    // Con el plan en camino, se quita una de las OP elegidas.
    await usuario.click(screen.getAllByTestId('exp-quitar-op')[0] as HTMLElement);

    act(() => {
      pendientes[0]?.(planDePrueba());
    });

    expect(screen.queryByTestId('exp-revision-previa')).toBeNull();
  });

  /**
   * ⚠️ **POR QUÉ NO HACE FALTA UNA GUARDIA EN «CONFIRMAR Y GENERAR».** El clic empieza por un
   * `mousedown`, que saca el foco del campo ANTES del `click`: el `onBlur` corre primero, confirma
   * el número y deja la petición en vuelo, y con `isPending` el botón queda apagado — el `click`
   * ni siquiera llega. Esta prueba mide esa cadena (con el hook reportando el `isPending` de
   * verdad, no el estático de los demás casos) para que la afirmación del comentario de
   * `confirmarGeneracion` esté respaldada y no sea otra promesa sin verificar.
   */
  it('🔴 el clic en «Confirmar y generar» con un número sin mandar confirma el campo y NO genera', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    // ⚠️ **Este falso NO es equivalente al hook: es una aproximación a mano, fiel PARA ESTE CASO.**
    // `enVuelo` es un pestillo de una sola vía (nunca vuelve a `false`) y **no repinta por sí
    // mismo**: funciona porque el mismo manejador que dispara la petición cambia estado de React y
    // provoca el re-render que vuelve a leer el hook. Para `revisar()`, que llama a `previo.mutate`
    // SIN tocar estado, no dispararía nada. Quien lo reuse tiene que saberlo.
    let enVuelo = false;
    previoMutateMock.mockImplementation(() => {
      enVuelo = true;
    });
    usePrevioCompraMock.mockImplementation(() => ({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: enVuelo,
      isError: false,
      isSuccess: false,
    }));

    const campo = screen.getByTestId('exp-previa-precio');
    await usuario.clear(campo);
    await usuario.type(campo, '2.004');
    previoMutateMock.mockClear();
    await usuario.click(screen.getByTestId('exp-confirmar-generar'));

    // (a) El campo confirmó primero (una sola petición, la del recálculo)…
    expect(previoMutateMock).toHaveBeenCalledOnce();
    // (b) …y NO se generó ninguna OC con el número que todavía no había pasado por el servidor.
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('exp-confirmar-generar')).toBeDisabled();
  });

  /**
   * 🔴 **UN FALLO TARDÍO DE UNA PETICIÓN ABANDONADA NO DEJA UN ERROR EN PANTALLA.** Antes de esta
   * etapa el único `previo.mutate` era el que ABRE la previa, así que el error de la explosión
   * siempre correspondía a algo que la persona acababa de pedir. El ajuste de campo agregó un
   * segundo emisor: si el comprador corrige un número y se sale sin esperar, esa petición se queda
   * huérfana — y al caerse pintaba un error sobre algo que ya nadie está haciendo.
   *
   * ⚠️ **Este caso monta el `useMutation` DE VERDAD**, no el hook falso de los demás. No es un
   * capricho: lo que hay que medir es qué hace la mutación real cuando se la resetea con una
   * petición en vuelo, y con un mock la aserción mediría el mock — el error que esta misma etapa ya
   * cometió una vez (la 1ª versión de SONDA 3 horneaba en el mock la premisa que decía probar).
   * Como `@/api/mrp` es lo único mockeado, el hook falso puede devolver el hook auténtico.
   */
  it('🔴 el fallo TARDÍO de una petición abandonada no deja un error en la explosión', async () => {
    const usuario = userEvent.setup();

    // La 1ª petición (la que ABRE la previa) contesta; la 2ª (el ajuste) se queda colgada para
    // tumbarla a mano cuando el comprador ya se haya ido.
    let peticion = 0;
    let tumbarLaSegunda: (e: Error) => void = () => {};
    const mutationFn = (): Promise<unknown> => {
      peticion += 1;
      if (peticion === 1) return Promise.resolve(planDePrueba());
      return new Promise((_resolver, rechazar) => {
        tumbarLaSegunda = rechazar;
      });
    };
    usePrevioCompraMock.mockImplementation(() => useMutation({ mutationFn }));

    // Se guarda el cliente para poder esperar a que la mutación SE ASIENTE de verdad (abajo).
    const cliente = crearQueryClientDePrueba();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
      queryClient: cliente,
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    await screen.findByTestId('exp-revision-previa');

    // (1) Corrige un número: sale la 2ª petición y se queda en vuelo.
    const campo = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(campo);
    await usuario.type(campo, '77');
    await usuario.tab();
    expect(peticion).toBe(2);

    // (2) Se arrepiente y se sale de la previa SIN esperar la respuesta.
    await usuario.click(screen.getByTestId('exp-volver-explosion'));
    expect(screen.queryByTestId('exp-revision-previa')).toBeNull();

    // (3) …y la petición que dejó atrás se cae.
    //
    // ⚠️ **La espera se ancla al ESTADO de la mutación, no a un tick.** Las dos primeras versiones
    // de esta prueba esperaban `await Promise.resolve()` y un `setTimeout(0)`: la primera pasaba
    // **también sin el arreglo** (falso verde) y la segunda salía verde o roja según el día —el
    // despacho del error encadena microtareas, el `notifyManager` y el repintado de React, y una
    // espera fija cae justo en el borde. `isMutating()` llega a 0 cuando la mutación DE VERDAD se
    // asentó, en los dos mundos; ahí ya se puede mirar la pantalla.
    tumbarLaSegunda(new Error('El servidor se cayó cuando ya nadie miraba.'));
    await waitFor(() => {
      expect(cliente.isMutating()).toBe(0);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 🔴 Sin el `previo.reset()` de `cerrarPrevia`, aquí aparecía el mensaje de un recálculo que el
    // comprador abandonó hace rato, junto a la explosión que sí está mirando.
    expect(screen.queryByTestId('exp-error-previo')).toBeNull();
  });

  /**
   * …**y la otra mitad: el error que SÍ tiene que verse no se lo lleva el reset.** Cuando «Revisar
   * y generar OC» falla, la previa no llega a abrirse, así que no se cierra nada y `cerrarPrevia`
   * —el único que resetea— no corre: el aviso tiene que quedarse en la explosión, que es lo que la
   * persona está mirando.
   *
   * ⚠️ **Lo que esta prueba fija, dicho con precisión** (la versión anterior de este comentario
   * afirmaba de más, y era la tercera afirmación no verificada de la etapa): monta el
   * `useMutation` **de verdad** y deja que el servidor rechace, así que se pone roja si alguien
   * borra el aviso de la explosión, o si resetea la mutación **DESPUÉS** del fallo (un `onError`
   * que "limpia", un `cerrarPrevia()` metido en ese camino). Lo que **NO** fija es *cualquier*
   * colocación de `previo.reset()`: uno al ARRANQUE de `revisar()` la deja verde —y está bien que
   * la deje, porque ahí el reset ocurre ANTES del fallo y no borra nada.
   */
  it('…pero el error de «Revisar y generar OC» SÍ se sigue viendo: ése nadie lo abandonó', async () => {
    const usuario = userEvent.setup();
    // El hook AUTÉNTICO otra vez: con el mock estático (`isError: true` literal, `reset` inerte)
    // ninguna colocación del `reset` en el programa podría cambiar el resultado — la prueba mediría
    // el mock, no la página.
    const mutationFn = (): Promise<unknown> =>
      Promise.reject(new Error('El servidor no pudo preparar la compra.'));
    usePrevioCompraMock.mockImplementation(() => useMutation({ mutationFn }));

    const cliente = crearQueryClientDePrueba();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
      queryClient: cliente,
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    await waitFor(() => {
      expect(cliente.isMutating()).toBe(0);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // No abrió previa (falló), así que el aviso tiene que estar en la explosión, que es lo que se ve.
    expect(screen.queryByTestId('exp-revision-previa')).toBeNull();
    expect(screen.getByTestId('exp-error-previo')).toHaveTextContent('no pudo preparar la compra');
  });

  it('⭐ mientras el servidor recalcula NO se puede confirmar (el plan en pantalla ya no es el bueno)', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();
    // A partir de aquí el hook reporta que la petición está en vuelo; el cambio de campo provoca el
    // re-render que lo lee. (Ponerlo antes de llegar apagaría el botón «Revisar», no éste.)
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: true,
      isError: false,
      isSuccess: false,
    });
    const campo = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(campo);
    await usuario.type(campo, '500');
    await usuario.tab();

    expect(screen.getByTestId('exp-confirmar-generar')).toBeDisabled();
    expect(screen.getByTestId('exp-confirmar-generar')).toHaveTextContent('Recalculando');
  });

  it('🔴 una OP que se queda sin línea (no alcanza el mínimo) se dice, no se promete', async () => {
    const plan = planDePrueba();
    const linea = plan.proveedores[0]?.renglones[0]?.porOrden[1];
    if (linea !== undefined) {
      linea.cantidad = 0;
      linea.importe = 0;
      linea.seEscribe = false;
    }
    await llegarALaPrevia(plan);

    const repartos = screen.getAllByTestId('exp-previa-reparto');
    expect(repartos[0]).toHaveAttribute('data-se-escribe', 'si');
    expect(repartos[1]).toHaveAttribute('data-se-escribe', 'no');
    expect(repartos[1]).toHaveTextContent('esta orden no lleva línea');
  });

  it('⭐ el aviso de «precio ajustado» dice contra qué se cambió', async () => {
    const plan = planDePrueba();
    const renglon = plan.proveedores[0]?.renglones[0];
    if (renglon !== undefined) {
      renglon.precioAjustado = true;
      renglon.precioUnitario = 3.75;
      renglon.precioPropuesto = 2;
    }
    await llegarALaPrevia(plan);

    expect(screen.getByTestId('exp-previa-precio-ajustado')).toHaveTextContent('Precio ajustado');
    expect(screen.getByTestId('exp-previa-precio-ajustado')).toHaveTextContent('2');
  });

  it('un renglón cuyas líneas traen precios DISTINTOS no inventa uno: el campo sale vacío', async () => {
    const plan = planDePrueba();
    const renglon = plan.proveedores[0]?.renglones[0];
    if (renglon !== undefined) {
      renglon.precioUnitario = null;
      renglon.precioPropuesto = null;
    }
    await llegarALaPrevia(plan);

    const campo = screen.getByTestId('exp-previa-precio');
    expect(campo).toHaveValue(null);
    expect(campo).toHaveAttribute('placeholder', 'varios');
  });

  // ── 🔴 2ª VUELTA DE V1-E3z — EL VALOR MALO NO SE TRAGA EN SILENCIO ──────────────────────────────
  //
  // El reviewer lo probó con tres sondas y las tres pasaban: el cliente DESCARTABA el valor
  // inválido sin mandarlo, el campo se quedaba con el número malo, no había dónde enseñar el error
  // (el aviso vivía en la rama de la explosión, DESMONTADA) y «Confirmar» seguía encendido → la OC
  // nacía con el número VIEJO. Es el mismo patrón del toast que se desmontaba en V1-E3x.

  it('🔴 SONDA 1 — un precio NEGATIVO viaja al servidor (el cliente no lo juzga ni lo calla)', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();
    previoMutateMock.mockClear();

    const campo = screen.getByTestId('exp-previa-precio');
    await usuario.clear(campo);
    await usuario.type(campo, '-5');
    await usuario.tab();

    // 🔴 Antes: NO se llamaba, y la OC se generaba a $2 sin que nadie dijera nada. El mensaje del
    // contrato ("El precio no puede ser negativo") no se ejecutaba NUNCA.
    expect(previoMutateMock).toHaveBeenCalledOnce();
    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ ajustes?: unknown[] }];
    expect(cuerpo.ajustes).toEqual([
      { tipo: 'avio', idMaterial: 3, idTelaColor: null, idProveedor: 11, precioUnitario: -5 },
    ]);
  });

  it('🔴 SONDA 2 — una cantidad en CERO también viaja (el servidor decide, no la pantalla)', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();
    previoMutateMock.mockClear();

    const campo = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(campo);
    await usuario.type(campo, '0');
    await usuario.tab();

    expect(previoMutateMock).toHaveBeenCalledOnce();
    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ ajustes?: unknown[] }];
    expect(cuerpo.ajustes).toEqual([
      { tipo: 'avio', idMaterial: 3, idTelaColor: null, idProveedor: 11, cantidadTotal: 0 },
    ]);
  });

  /**
   * 🔴 **SONDA 3, la peor: el recálculo FALLA y nadie se entera.** El campo se quedaba con `500`,
   * el renglón seguía enseñando el total viejo ($600), **no salía ningún mensaje** y «Confirmar»
   * seguía habilitado — al pulsarlo se emitía una OC con un número que nadie revisó.
   */
  it('🔴 SONDA 3 — si el recálculo falla, se dice DENTRO de la previa y NO se puede confirmar', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    // 🔴 3ª VUELTA — EL ERROR SE CONSTRUYE CON EL CUERPO **REAL** DEL BACKEND, no con un mensaje ya
    // digerido. La versión anterior de esta prueba mockeaba
    // `error: { message: 'El precio no puede ser negativo' }` y con eso **horneaba la premisa
    // falsa**: probaba mi suposición sobre el backend, no el backend. En realidad la frase viaja en
    // `detalles[].mensaje` y `mensajeDeError` la tiraba, así que lo que Daniel veía era
    // *"Los datos enviados no son válidos."* a secas. Pasando el cuerpo real por `ErrorDeApi` —el
    // mismo camino que recorre en producción— la prueba mide el sistema y no el mock.
    previoMutateMock.mockImplementation(() => {
      /* la mutación queda en error; el hook lo reporta abajo */
    });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: true,
      error: new ErrorDeApi({
        codigo: 'VALIDACION',
        mensaje: 'Los datos enviados no son válidos.',
        detalles: [
          { campo: '/ajustes/0/precioUnitario', mensaje: 'El precio no puede ser negativo' },
        ],
      }),
      isSuccess: false,
    });

    const campo = screen.getByTestId('exp-previa-precio');
    await usuario.clear(campo);
    await usuario.type(campo, '-5');
    await usuario.tab();

    // (a) El error se pinta DENTRO de la previa (la rama de la explosión está desmontada)…
    const aviso = screen.getByTestId('exp-error-recalculo');
    // …🔴 y con la frase ESPECÍFICA del contrato, no sólo el genérico de validación. Sin esto el
    // usuario lee "Los datos enviados no son válidos" con veinte renglones en pantalla: ni qué
    // campo, ni por qué — justo lo que esta etapa declaró inaceptable en `ajuste-comprador.ts`.
    expect(aviso).toHaveTextContent('El precio no puede ser negativo');
    expect(aviso).toHaveTextContent('son los de ANTES de tu cambio');
    // (b) Y no se puede confirmar un plan que ya no corresponde a lo tecleado.
    expect(screen.getByTestId('exp-confirmar-generar')).toBeDisabled();
    // (c) El número malo SIGUE en el campo, para poder corregirlo con el motivo a la vista.
    expect(screen.getByTestId('exp-previa-precio')).toHaveValue(-5);
    // Y nada se generó.
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('sin error de recálculo no se pinta el aviso (no es un cartel permanente)', async () => {
    await llegarALaPrevia();
    expect(screen.queryByTestId('exp-error-recalculo')).toBeNull();
    expect(screen.getByTestId('exp-confirmar-generar')).toBeEnabled();
  });

  /**
   * 🔴 Dos ediciones seguidas dejan dos peticiones en vuelo. Si las respuestas llegan al revés, la
   * pantalla acabaría pintando el plan de la PRIMERA mientras los campos ya llevan las dos
   * correcciones: un total que no corresponde a lo que se ve.
   */
  it('🔴 una respuesta que llega TARDE no pisa a la última', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    const planViejo = planDePrueba();
    const rv = planViejo.proveedores[0]?.renglones[0];
    if (rv !== undefined) rv.cantidadTotal = 111;
    const planNuevo = planDePrueba();
    const rn = planNuevo.proveedores[0]?.renglones[0];
    if (rn !== undefined) rn.cantidadTotal = 222;

    // Se guardan los `onSuccess` para resolverlos AL REVÉS del orden en que se pidieron.
    const pendientes: ((p: unknown) => void)[] = [];
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        if (opciones.onSuccess !== undefined) pendientes.push(opciones.onSuccess);
      },
    );

    const campo = screen.getByTestId('exp-previa-cantidad');
    await usuario.clear(campo);
    await usuario.type(campo, '111');
    await usuario.tab();
    await usuario.clear(screen.getByTestId('exp-previa-cantidad'));
    await usuario.type(screen.getByTestId('exp-previa-cantidad'), '222');
    await usuario.tab();
    expect(pendientes).toHaveLength(2);

    // Llega primero la SEGUNDA (la buena)…
    act(() => {
      pendientes[1]?.(planNuevo);
    });
    // …y después la PRIMERA, que ya no debe pintar nada.
    act(() => {
      pendientes[0]?.(planViejo);
    });

    expect(screen.getByTestId('exp-previa-cantidad')).toHaveValue(222);
  });

  it('con BLOQUEOS del servidor, la previa los dice y NO deja confirmar', async () => {
    const plan = { ...planDePrueba(), bloqueos: ['Falta la dirección de entrega favorita.'] };
    await llegarALaPrevia(plan);

    expect(screen.getByTestId('exp-bloqueo')).toHaveTextContent('dirección de entrega favorita');
    expect(screen.getByTestId('exp-confirmar-generar')).toBeDisabled();
  });

  /**
   * 🔴 EL DEFECTO DE FONDO: lo que ya está en una OC viva NO se vuelve a proponer. Si alguien
   * quitara el neteo del servidor (o la pantalla volviera a mirar `cantidadAComprar`), el renglón
   * volvería a salir comprable y esta prueba se pondría roja.
   */
  it('⭐ un material YA COMPRADO no es comprable y se dice con letras', async () => {
    const base = explosionDePrueba();
    // Sólo el grupo CON proveedor: así lo único que puede bloquear es el neteo contra la OC (con la
    // felpa sin proveedor delante, el motivo sería "sin proveedor" y no se probaría nada de esto).
    const yaComprado = {
      ...base,
      grupos: base.grupos
        .filter((g) => g.idProveedor !== null)
        .map((g) => ({
          ...g,
          renglones: g.renglones.map((r) =>
            r.id === 1
              ? {
                  ...r,
                  cantidadEnOc: 180,
                  cantidadPendiente: 0,
                  porOrden: r.porOrden.map((l) => ({
                    ...l,
                    cantidadEnOc: 180,
                    cantidadPendiente: 0,
                  })),
                }
              : r,
          ),
        })),
    };
    useExplosionMock.mockReturnValue({ data: yaComprado, isPending: false, isError: false });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // ⭐⭐ V1-E4d: el conteo se cuenta como INFORMACIÓN (línea de resumen), no en verde de caja…
    expect(screen.getByTestId('exp-resumen')).toHaveTextContent('1 ya cubierto(s) por OC vivas');
    expect(screen.queryByTestId('exp-ya-en-oc')).toBeNull();
    // …el NOMBRE lo dice su propia fila, que es donde se busca…
    expect(screen.getByTestId('exp-en-oc-badge')).toHaveTextContent('Ya comprado');
    // …su casilla queda deshabilitada (no es comprable)…
    expect(screen.getAllByTestId('exp-renglon-check')[0]).toBeDisabled();
    // …y la razón REAL (no "sin proveedor", que sería mentir) sigue dicha en el botón, que ya no
    // se apaga: el porqué completo lo da la revisión previa, material por material.
    expect(screen.getByTestId('exp-generar-oc')).toBeEnabled();
    expect(screen.getByTestId('exp-generar-oc')).toHaveAttribute(
      'title',
      expect.stringContaining('Todo lo que falta ya está en órdenes de compra'),
    );
  });

  it('el SOBRANTE de compra (rollo completo) viaja como AJUSTE; el servidor lo reparte', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // Sólo el renglón comprable ofrece ajustar el total (el botón, avío 3, proveedor 11).
    const campos = screen.getAllByTestId('exp-ajuste-cantidad');
    expect(campos).toHaveLength(1);
    fireEvent.change(campos[0] as HTMLElement, { target: { value: '250' } });

    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ ajustes?: unknown[] }];
    expect(cuerpo.ajustes).toEqual([
      { tipo: 'avio', idMaterial: 3, idTelaColor: null, idProveedor: 11, cantidadTotal: 250 },
    ]);
  });

  it('un ajuste VACÍO no viaja (en blanco = compra lo pendiente, no "compra cero")', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    const campo = screen.getAllByTestId('exp-ajuste-cantidad')[0] as HTMLElement;
    fireEvent.change(campo, { target: { value: '250' } });
    fireEvent.change(campo, { target: { value: '' } });

    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    const [cuerpo] = previoMutateMock.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo).not.toHaveProperty('ajustes');
  });
});

/**
 * ⭐ V1-E3q (§Post-F9.86) — **UNA COMPRA PARA VARIAS OP.** Daniel: *"¿cómo hacemos cuando una OC
 * cubre varias OP? Es muy muy común… Podríamos hacerlo por número de pedido interno (ejemplo 1515).
 * Pero aparte a veces se compran más órdenes… por ejemplo cuando se compran cajas"*.
 */
describe('ExplosionMaterialesPagina — V1-E3q: varias OP en una compra (§Post-F9.86)', () => {
  beforeEach(() => {
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [
          { id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' },
          { id: 51, folio: 8, codigoModelo: 'A-101', cliente: 'Cliente X' },
          { id: 99, folio: 12, codigoModelo: 'B-200', cliente: 'Otro Cliente' },
        ],
        total: 3,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    mutateMock.mockReset();
    previoMutateMock.mockReset();
    useOrdenesDelPedidoMock.mockReset();
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useAsignarProveedorMock.mockReturnValue({
      mutate: asignarMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
  });

  it('⭐ al elegir una OP se PRECARGAN las OP de su pedido interno (los avíos del 1515)', async () => {
    useOrdenesDelPedidoMock.mockReturnValue({
      data: {
        idPedido: 300,
        folioPedido: 1515,
        ordenes: [
          { idOrden: 50, folio: 7, modelo: 'A-100', cliente: 'Cliente X', cancelada: false },
          { idOrden: 51, folio: 8, modelo: 'A-101', cliente: 'Cliente X', cancelada: false },
          // La cancelada NO se precarga: comprar material para ella es tirar el dinero.
          { idOrden: 52, folio: 9, modelo: 'A-102', cliente: 'Cliente X', cancelada: true },
        ],
      },
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // Se explosiona el CONJUNTO precargado, sin la cancelada. Si la 52 se colara, esto sale rojo.
    expect(useExplosionMock).toHaveBeenCalledWith([50, 51]);
  });

  /**
   * 🔴 La precarga **NO puede volver a meter una OP que el usuario quitó.** Es fácil que pase: la
   * consulta del pedido se refresca sola (al recuperar el foco, por ejemplo) y un efecto que sólo
   * mirara la forma del conjunto la re-precargaría. Una precarga que pisa lo que la persona decidió
   * es un sabotaje, no una ayuda. Por eso corre UNA sola vez por OP base.
   */
  it('⭐ quitar una OP precargada NO la devuelve cuando la consulta del pedido se refresca', async () => {
    const respuesta = {
      idPedido: 300,
      folioPedido: 1515,
      ordenes: [
        { idOrden: 50, folio: 7, modelo: 'A-100', cliente: 'Cliente X', cancelada: false },
        { idOrden: 51, folio: 8, modelo: 'A-101', cliente: 'Cliente X', cancelada: false },
      ],
    };
    // Cada render devuelve un objeto NUEVO: es justo lo que hace un refetch sin igualdad estructural.
    useOrdenesDelPedidoMock.mockImplementation(() => ({
      data: { ...respuesta, ordenes: [...respuesta.ordenes] },
      isPending: false,
      isError: false,
    }));
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    expect(useExplosionMock).toHaveBeenCalledWith([50, 51]);

    // Se quita la 8 (idOrden 51) y se dispara un re-render más (el buscador).
    const quitar = screen.getAllByTestId('exp-quitar-op');
    await usuario.click(quitar[1] as HTMLElement);
    await usuario.type(screen.getByTestId('exp-buscar-orden'), 'a');

    // 🔴 Si la precarga volviera a correr, la última llamada sería [50, 51] otra vez.
    const ultima = useExplosionMock.mock.calls.at(-1)?.[0] as number[];
    expect(ultima).toEqual([50]);
  });

  it('⭐ se pueden AGREGAR OP sueltas (las cajas, que cruzan pedidos) y quitarlas', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    // La 99 es de OTRO cliente y OTRO pedido: se agrega a mano.
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[2] as HTMLElement);
    expect(useExplosionMock).toHaveBeenCalledWith([50, 99]);

    // Y se puede quitar: el chip de cada OP lleva su botón.
    const chips = screen.getAllByTestId('exp-op-chip');
    expect(chips.length).toBeGreaterThan(0);
  });

  it('las OP del conjunto viajan en el cuerpo de la compra (no en la URL)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[1] as HTMLElement);
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));

    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ idsOrden: number[] }];
    expect(cuerpo.idsOrden).toEqual([50, 51]);
  });

  it('quitar la ÚLTIMA OP deja la pantalla sin explosión (no en un estado a medias)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    expect(screen.getByTestId('exp-grupos')).toBeInTheDocument();

    await usuario.click(screen.getAllByTestId('exp-quitar-op')[0] as HTMLElement);
    expect(screen.queryByTestId('exp-grupos')).toBeNull();
    expect(screen.queryByTestId('exp-ops-elegidas')).toBeNull();
  });
});

/**
 * ⭐⭐ V1-E3u (§Post-F9.89) — **LA TELA SE COMPRA POR COLOR.**
 *
 * Lo que se protege aquí es que la pantalla **diga la verdad sobre el color** y que el ajuste del
 * comprador **viaje amarrado a SU color**: sin eso, el total que se teclea para el marino se
 * aplicaría también al grana y el desvío que ve quien autoriza sería el de una compra que nadie hizo.
 */
describe('ExplosionMaterialesPagina — V1-E3u: la tela se compra POR COLOR (§Post-F9.89)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
    });
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      isPending: false,
      reset: vi.fn(),
    });
    useGenerarOcMock.mockReturnValue({ mutate: vi.fn(), isPending: false, reset: vi.fn() });
    useAsignarProveedorMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    imprimirExplosionMock.mockReset();
  });

  /** Explosión con la felpa PARTIDA en dos colores (lo que la etapa vino a hacer posible). */
  function explosionPorColor() {
    const base = explosionDePrueba();
    const felpa = base.grupos[1]?.renglones[0] as Record<string, unknown>;
    const grana = {
      ...felpa,
      id: 20,
      idTelaColor: 77,
      telaColor: 'Grana 7700',
      idProveedorSugerido: 11,
      idsRequerimiento: [20],
    };
    const marino = {
      ...felpa,
      id: 21,
      idTelaColor: 78,
      telaColor: 'Marino Alsa 3040',
      idProveedorSugerido: 11,
      idsRequerimiento: [21],
    };
    return {
      ...base,
      grupos: [{ idProveedor: 11, proveedor: 'Alsatex', renglones: [grana, marino] }],
      pendientesColor: [
        {
          idTela: 4,
          tela: 'Cardigan',
          colores: ['Azul'],
          cantidadRequerida: 15,
          unidad: 'kg',
          idOrden: 91,
          folioOrden: 5558,
        },
        // ⭐ V1-E3u/D7 — un SEGUNDO pendiente, de OTRA orden: es el caso multi-OP que Daniel llamó
        // *"muy muy común"* y donde la acción global abría siempre la primera.
        {
          idTela: 4,
          tela: 'Cardigan',
          colores: ['Verde'],
          cantidadRequerida: 20,
          unidad: 'kg',
          idOrden: 92,
          folioOrden: 5560,
        },
      ],
    };
  }

  it('cada renglón de tela ENSEÑA su color', async () => {
    useExplosionMock.mockReturnValue({ data: explosionPorColor(), isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    const chips = screen.getAllByTestId('exp-color-tela').map((c) => c.textContent);
    expect(chips).toEqual(['Grana 7700', 'Marino Alsa 3040']);
  });

  /**
   * ⭐⭐ **V1-E4c (23-ago-2026) — EL AVISO AMARILLO DE LA ENTRADA SE FUE.**
   *
   * Daniel: *"los avisos en amarillo salen muchos y confunde lo que realmente se busca… primero
   * que dé la opción de meterlo, y si no se hace, entonces que mande los mensajes en amarillo"*. La
   * pantalla ya no recibe con el regaño: lo que falta lo marca el CHIP del renglón, y el amarillo
   * sale en la revisión previa (más abajo).
   *
   * 🔴 El valor que la pone roja: que alguien devuelva el bloque `exp-pendientes-color` a la
   * entrada de la explosión — con datos que lo dispararían (`pendientesColor` con dos elementos).
   */
  it('⭐⭐ V1-E4c — la explosión YA NO recibe con el aviso amarillo del color', async () => {
    useExplosionMock.mockReturnValue({ data: explosionPorColor(), isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    expect(screen.queryByTestId('exp-pendientes-color')).toBeNull();
    expect(screen.queryByTestId('exp-decir-colores')).toBeNull();
    // …y lo que falta se sigue viendo, en el renglón: el chip «Sin color» y su acción.
    expect(screen.getAllByTestId('exp-decir-color').length).toBeGreaterThan(0);
  });

  it('§Post-F9.68 — sin `compras.administrar` NO se ofrece decir el color (esconder Y bloquear)', async () => {
    useExplosionMock.mockReturnValue({ data: explosionPorColor(), isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // El COLOR sí se ve (es información), pero la acción de cambiarlo no.
    expect(screen.getAllByTestId('exp-color-tela').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('exp-decir-color')).toBeNull();
  });

  /**
   * 🟠 **D5 — cuando el "ya en OC" NO es un hecho plano.** Lo ya comprado que viene de una OC vieja
   * (sin color) hay que atribuírselo a ALGÚN color; cuando no alcanza para todos, **el orden de las
   * filas decide**. Es una elección del sistema, no un dato — y se marca.
   */
  it('🟠 avisa cuando lo "ya en OC" viene de una orden que no dice el color', async () => {
    const base = explosionPorColor();
    const grupo = base.grupos[0] as { renglones: Record<string, unknown>[] };
    const [grana, marino] = grupo.renglones;
    const conAmbiguo = {
      ...base,
      grupos: [
        {
          ...grupo,
          renglones: [{ ...grana, cantidadEnOc: 100, cantidadEnOcSinColor: 100 }, marino],
        },
      ],
    };
    useExplosionMock.mockReturnValue({ data: conAmbiguo, isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // 🔴 El valor que la pone ROJA: `cantidadEnOcSinColor: 0` — el sistema eligiendo en silencio,
    // que es como estaba antes de la revisión.
    const aviso = screen.getByTestId('exp-en-oc-sin-color');
    expect(aviso).toHaveTextContent('no dice de');
    expect(aviso).toHaveTextContent('100');
    // Y sólo lo marca el renglón que lo tiene: el otro color no inventa una alarma.
    expect(screen.getAllByTestId('exp-en-oc-sin-color')).toHaveLength(1);
  });

  /**
   * ⭐⭐ **§Post-F9.105 — EL AVISO QUE EXPLICA EL NÚMERO INFLADO, JUNTO AL NÚMERO.**
   *
   * Daniel: *"la compra de los cierres me está dando una cantidad muchísimo mayor de la que
   * necesito"*. El servidor ya redacta el aviso (con la magnitud); lo que esta prueba fija es
   * DÓNDE se pinta: en el renglón, en tono de aviso — **no** en la caja gris del pie («Notas de la
   * explosión»), donde se leería como un apunte de precios más y se perdería.
   */
  it('⭐ §Post-F9.105: el aviso del renglón se pinta junto al requerido, en tono de aviso', async () => {
    const base = explosionPorColor();
    const grupo = base.grupos[0] as { renglones: Record<string, unknown>[] };
    const [grana, marino] = grupo.renglones;
    const conAviso = {
      ...base,
      grupos: [
        {
          ...grupo,
          renglones: [
            {
              ...grana,
              avisos: ['Este avío se compra POR MEDIDA… 1,590 pza en vez de 30 pza.'],
            },
            marino,
          ],
        },
      ],
    };
    useExplosionMock.mockReturnValue({ data: conAviso, isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    const aviso = screen.getByTestId('exp-renglon-aviso');
    expect(aviso).toHaveTextContent('POR MEDIDA');
    expect(aviso).toHaveTextContent('1,590 pza en vez de 30 pza');
    // 🔴 El tono importa: en gris (`text-muted-foreground`, como las notas del pie) el aviso se
    // muestra y se esconde a la vez — que es exactamente el defecto que esta etapa vino a cerrar.
    expect(aviso.className).toContain('text-warn');
    // Y sólo lo lleva el renglón que lo tiene: el otro no inventa una alarma.
    expect(screen.getAllByTestId('exp-renglon-aviso')).toHaveLength(1);
  });

  it('🔴 el ajuste del comprador viaja amarrado a SU COLOR, no a la tela', async () => {
    useExplosionMock.mockReturnValue({ data: explosionPorColor(), isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // Se teclea el rollo completo SÓLO en el segundo color (el marino).
    const campos = screen.getAllByTestId('exp-ajuste-cantidad');
    expect(campos).toHaveLength(2);
    fireEvent.change(campos[1] as HTMLElement, { target: { value: '250' } });
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));

    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ ajustes?: unknown[] }];
    // 🔴 EL VALOR QUE LO PONDRÍA ROJO: `idTelaColor: 77` (el grana) o `null` — cualquiera de los dos
    // haría que el rollo completo se le cargara al color equivocado.
    expect(cuerpo.ajustes).toEqual([
      { tipo: 'tela', idMaterial: 4, idTelaColor: 78, idProveedor: 11, cantidadTotal: 250 },
    ]);
  });
});

/**
 * ⭐⭐ **V1-E3x (§Post-F9.88) — EL MISMO PROVEEDOR A VARIOS RENGLONES, DE UN GOLPE.**
 *
 * Daniel: *"cuando no tengan proveedor los avíos, ya en la pantalla de explosión, podemos hacer una
 * forma de poder poner el proveedor de manera más rápida a varios elementos que lleven el mismo
 * proveedor"*. Estas pruebas cubren lo que la pantalla tiene que hacer bien: **aparecer sólo cuando
 * sirve**, **respetar el permiso**, **mandar los pares (orden, material) EXACTOS** y **acotar el
 * alcance a las órdenes que el usuario eligió** (nunca inventar un "todas").
 */
describe('ExplosionMaterialesPagina — V1-E3x: proveedor a varios de un golpe (§Post-F9.88)', () => {
  beforeEach(() => {
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    mutateMock.mockReset();
    previoMutateMock.mockReset();
    asignarMutateMock.mockReset();
    bloqueMutateMock.mockReset();
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useAsignarProveedorMock.mockReturnValue({
      mutate: asignarMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useAsignarProveedorEnBloqueMock.mockReturnValue({
      mutate: bloqueMutateMock,
      reset: vi.fn(),
      data: undefined,
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useExplosionMock.mockReturnValue({
      data: explosionConDosHuecos(),
      isPending: false,
      isError: false,
    });
  });

  /**
   * Explosión con DOS materiales sin proveedor y pendientes de comprar (el caso de Daniel). Sobre
   * la base se le da pendiente al genérico: así los dos huecos son reales, no uno solo.
   */
  function explosionConDosHuecos(): ReturnType<typeof explosionDePrueba> {
    const base = explosionDePrueba();
    const sin = base.grupos[1];
    const hilo = sin?.renglones[1];
    if (hilo) {
      hilo.cantidadPendiente = 60;
      hilo.cantidadAComprar = 60;
      hilo.estadoGenerico = 'faltante';
      hilo.existenciaStock = 0;
      const linea = hilo.porOrden[0];
      if (linea) {
        linea.cantidadPendiente = 60;
        linea.cantidadAComprar = 60;
      }
    }
    return base;
  }

  /** La misma explosión DESPUÉS del acto: ya nadie está sin proveedor (el panel debe desaparecer). */
  function explosionSinHuecos(): ReturnType<typeof explosionDePrueba> {
    const base = explosionConDosHuecos();
    for (const renglon of base.grupos[1]?.renglones ?? []) {
      renglon.idProveedorSugerido = 33;
      renglon.proveedorSugerido = 'Telas del Norte';
      renglon.origenProveedor = 'asignado-compras';
    }
    return base;
  }

  it('con DOS materiales sin proveedor aparece el panel de asignación en bloque', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    expect(screen.getByTestId('exp-bloque')).toBeInTheDocument();
    expect(screen.getAllByTestId('exp-bloque-check')).toHaveLength(2);
  });

  it('con UN solo hueco NO aparece: la forma del renglón ya alcanza', async () => {
    const usuario = userEvent.setup();
    // La explosión base tiene un solo material sin proveedor pendiente (la felpa).
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    expect(screen.queryByTestId('exp-bloque')).not.toBeInTheDocument();
  });

  it('§Post-F9.68 — sin `compras.administrar` el panel NO se pinta', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    expect(screen.queryByTestId('exp-bloque')).not.toBeInTheDocument();
  });

  it('⭐ «Seleccionar todos» + un proveedor manda los pares (orden, material) EXACTOS', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    await usuario.click(screen.getByTestId('exp-bloque-todos'));
    await usuario.click(screen.getByTestId('exp-selector-proveedor-stub'));
    await usuario.click(screen.getByTestId('exp-bloque-asignar'));

    expect(bloqueMutateMock).toHaveBeenCalledTimes(1);
    expect(bloqueMutateMock.mock.calls[0]?.[0]).toEqual({
      idProveedor: 33,
      asignaciones: [
        { idOrden: 50, tipo: 'tela', idMaterial: 4 },
        { idOrden: 50, tipo: 'avio', idMaterial: 5 },
      ],
    });
  });

  it('sin nada marcado el botón queda apagado (no se manda un acto vacío)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    await usuario.click(screen.getByTestId('exp-selector-proveedor-stub'));
    expect(screen.getByTestId('exp-bloque-asignar')).toBeDisabled();
    expect(bloqueMutateMock).not.toHaveBeenCalled();
  });

  it('⭐ el ALCANCE lo elige el usuario: «sólo la orden 8» no toca la 7', async () => {
    const usuario = userEvent.setup();
    // Dos OP en pantalla y un material que vive en las dos (el caso de la compra multi-OP).
    const datos = explosionConDosHuecos();
    datos.ordenes = [
      { ...(datos.ordenes[0] as (typeof datos.ordenes)[number]) },
      {
        ...(datos.ordenes[0] as (typeof datos.ordenes)[number]),
        idOrden: 51,
        folio: 8,
      },
    ];
    const felpa = datos.grupos[1]?.renglones[0];
    if (felpa) {
      // El `as` cierra la unión que TS infiere del literal de la explosión (los renglones con
      // precio y los que no): sin él, un arreglo mezclado no encaja en ninguna de las dos ramas.
      const primera = felpa.porOrden[0] as (typeof felpa.porOrden)[number];
      felpa.porOrden = [
        primera,
        { ...primera, idRequerimiento: 20, idOrden: 51, folioOrden: 8 },
      ] as typeof felpa.porOrden;
      felpa.idsRequerimiento = [2, 20];
    }
    useExplosionMock.mockReturnValue({ data: datos, isPending: false, isError: false });
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    await usuario.click(screen.getByTestId('exp-bloque-todos'));
    fireEvent.change(screen.getByTestId('exp-bloque-alcance'), { target: { value: '51' } });
    await usuario.click(screen.getByTestId('exp-selector-proveedor-stub'));
    await usuario.click(screen.getByTestId('exp-bloque-asignar'));

    // Sólo la felpa vive en la orden 51; el hilo (que sólo está en la 50) se queda fuera.
    expect(bloqueMutateMock.mock.calls[0]?.[0]).toEqual({
      idProveedor: 33,
      asignaciones: [{ idOrden: 51, tipo: 'tela', idMaterial: 4 }],
    });
  });

  it('⭐ la confirmación SOBREVIVE a que el panel se desmonte (el caso real: se llenan TODOS)', async () => {
    const usuario = userEvent.setup();
    /**
     * 🔴 **EL DEFECTO QUE ESTA PRUEBA CAZA.** El panel se desmonta en cuanto quedan menos de dos
     * huecos, así que en el camino común —«Seleccionar todos» y llenarlos TODOS— una confirmación
     * que viviera DENTRO del panel no se vería nunca. Justo cuando más importa. Aquí se reproduce
     * eso mismo: la explosión responde con dos huecos hasta que el acto corre y con NINGUNO después
     * (que es lo que pasa de verdad al recargar), y se exige que el mensaje siga a la vista.
     */
    let quedanHuecos = true;
    useExplosionMock.mockImplementation(() => ({
      data: quedanHuecos ? explosionConDosHuecos() : explosionSinHuecos(),
      isPending: false,
      isError: false,
    }));
    bloqueMutateMock.mockImplementation(
      (
        _cuerpo: unknown,
        opciones?: { onSuccess?: (dato: Record<string, unknown>) => void },
      ): void => {
        quedanHuecos = false;
        opciones?.onSuccess?.({
          idLote: 'abc',
          idProveedor: 33,
          proveedor: 'Telas del Norte',
          renglones: 6,
          ordenes: 2,
          asignados: [],
        });
      },
    );
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    await usuario.click(screen.getByTestId('exp-bloque-todos'));
    await usuario.click(screen.getByTestId('exp-selector-proveedor-stub'));
    await usuario.click(screen.getByTestId('exp-bloque-asignar'));

    // Un tecleo cualquiera vuelve a pintar la página: ahí es donde la explosión ya no trae huecos
    // y el panel desaparece (igual que tras el refetch de React Query).
    await usuario.type(screen.getByTestId('exp-buscar-orden'), 'a');

    expect(screen.queryByTestId('exp-bloque')).not.toBeInTheDocument(); // el panel YA no está…
    expect(toastExito).toHaveBeenCalledWith(
      'Se le asignó «Telas del Norte» a 6 renglón(es) de receta en 2 orden(es), en un solo acto.',
    ); // …y la confirmación sí se dio.
  });

  it('el mismo material repetido en dos renglones (dos colores) se manda UNA vez', async () => {
    const usuario = userEvent.setup();
    // §Post-F9.89: la misma tela sale en varios renglones (uno por color) y todos apuntan al MISMO
    // renglón de receta. El previo tiene que contar 1, no 2 (el servidor escribiría 1).
    const datos = explosionConDosHuecos();
    const sin = datos.grupos[1];
    const felpa = sin?.renglones[0];
    if (sin && felpa) {
      // El `as` cierra la unión que TS infiere del literal (los renglones traen `telaColor: null`).
      sin.renglones = [
        felpa,
        { ...felpa, id: 99, telaColor: 'Marino' },
        ...sin.renglones.slice(1),
      ] as typeof sin.renglones;
    }
    useExplosionMock.mockReturnValue({ data: datos, isPending: false, isError: false });
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    await usuario.click(screen.getByTestId('exp-bloque-todos'));
    await usuario.click(screen.getByTestId('exp-selector-proveedor-stub'));
    // El previo cuenta lo MISMO que se va a mandar (2 pares, no 3).
    expect(screen.getByTestId('exp-bloque-previo')).toHaveTextContent(
      /Se escribirán 2 renglón\(es\) de receta/,
    );
    await usuario.click(screen.getByTestId('exp-bloque-asignar'));

    expect(bloqueMutateMock.mock.calls[0]?.[0]).toEqual({
      idProveedor: 33,
      asignaciones: [
        { idOrden: 50, tipo: 'tela', idMaterial: 4 },
        { idOrden: 50, tipo: 'avio', idMaterial: 5 },
      ],
    });
  });
});

/**
 * ⭐⭐⭐ **V1-E4c — DECIR EL COLOR EN EL RENGLÓN DE LA TELA** (Daniel, 23-ago-2026).
 *
 * Probando la 0.017: *"no puedo comprar las telas por color"*. La función existía desde la 0.013,
 * pero **estaba escondida en el único lugar donde nadie la busca**: dentro del aviso amarillo. Al
 * enseñárselo: *"ya vi dónde está, pero no me gusta que sea ahí. **¿Por qué no poner la opción
 * directo en el renglón de la tela?** … los avisos en amarillo salen muchos y confunde lo que
 * realmente se busca"*. Y la regla que manda sobre todo el diseño:
 *
 * > *"El proceso normal es llenar ahí la información. Los mensajes amarillos parecieran que estamos
 * > haciendo algo mal. **Primero que dé la opción de meterlo, y si no se hace, entonces que mande
 * > los mensajes en amarillo.**"*
 */
describe('ExplosionMaterialesPagina — V1-E4c: el color, EN EL RENGLÓN', () => {
  /** Los tonos que la tela tiene dados de alta en el catálogo. */
  const OPCIONES = [
    {
      idTelaColor: 77,
      nombre: 'Grana 7700',
      pantone: '19-1664 TCX',
      precio: 80,
      precioComplemento: null,
    },
    {
      idTelaColor: 78,
      nombre: 'Marino Alsa 3040',
      pantone: null,
      precio: 95,
      precioComplemento: null,
    },
  ];

  /** Un color de la MATRIZ de la OP, tal como lo entrega el servidor. */
  function colorDeLaOrden(over: Record<string, unknown> = {}) {
    return {
      idColor: 900,
      color: 'Azul',
      pantone: null,
      piezas: 10,
      cantidadRequerida: 15,
      idTelaColor: null,
      telaColor: null,
      propuestaIdTelaColor: null,
      propuestaTelaColor: null,
      origenPropuesta: 'sin-propuesta',
      // ⭐ V1-E4c: la REGLA la manda el servidor; la pantalla la pinta (A1).
      puedeCambiar: true,
      motivoNoCambiar: null,
      ...over,
    };
  }

  /** La consulta ya resuelta de `colores-tela` de UNA orden. */
  function consultaColores(
    idOrden: number,
    folio: number,
    colores: unknown[],
    extra: Record<string, unknown> = {},
  ) {
    return {
      data: {
        idOrden,
        folio,
        sinMatrizColores: false,
        telas: [
          {
            idOrdenTela: 1,
            idTela: 4,
            tela: 'Felpa',
            unidad: 'm',
            consumoPorPrenda: 1.5,
            excluido: false,
            liberado: true,
            colores,
            opciones: OPCIONES,
          },
        ],
        ...extra,
      },
      isPending: false,
      isError: false,
    };
  }

  /** La explosión de siempre, con el renglón de TELA (id 2, tela 4) tocado a modo. */
  function explosionConTela(over: Record<string, unknown> = {}) {
    const base = explosionDePrueba();
    const grupo = base.grupos[1] as { renglones: Record<string, unknown>[] };
    const felpa = { ...(grupo.renglones[0] as Record<string, unknown>), ...over };
    return { ...base, grupos: [{ ...grupo, renglones: [felpa] }] };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
    });
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      isPending: false,
      reset: vi.fn(),
    });
    useGenerarOcMock.mockReturnValue({ mutate: vi.fn(), isPending: false, reset: vi.fn() });
    useAsignarProveedorMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useAsignarProveedorEnBloqueMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useColoresDeVariasOrdenesMock.mockReturnValue([]);
    useAsignarColorTelaMock.mockReturnValue({
      mutate: asignarColorMutateMock,
      isPending: false,
    });
    useAgregarColorDeTelaMock.mockReturnValue({
      mutate: agregarColorMutateMock,
      isPending: false,
    });
    useColoresDeTelaMock.mockReturnValue({ data: undefined, isPending: false });
  });

  /**
   * Abre la pantalla con esa explosión y despliega el bloque de color del renglón de tela.
   *
   * ⭐ V1-E6b: `permisos` es un parámetro para poder abrir la pantalla SIN `compras.administrar` y
   * comprobar que entonces no hay ni bloque de color ni puerta de alta (§Post-F9.68, la mitad de
   * ESCONDER). El default es el perfil del comprador — y ojo: **NO trae `telas.administrar`**, que
   * es justo lo que prueban las de esta etapa.
   */
  async function abrirElBloqueDeColor(
    explosion: unknown,
    // El tipo se toma del propio helper de sesión: las claves de permiso son una UNIÓN, y un
    // `string[]` dejaría pasar un permiso que no existe (una prueba que "pasa" sin ejercer nada).
    permisos: Parameters<typeof estadoSesionDePrueba>[0] = ['compras.ver', 'compras.administrar'],
  ): Promise<void> {
    useExplosionMock.mockReturnValue({ data: explosion, isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(permisos),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    await usuario.click(screen.getByTestId('exp-decir-color'));
  }

  /**
   * ⭐ **EL CASO NORMAL: una OP, un color — se pide un dato y ya.** Y el dato viaja amarrado a SU
   * orden y a SU color de prenda, que es lo único que `OrdenTelaColor` sabe guardar.
   */
  it('⭐ con UNA OP y UN color: un solo campo, y guarda contra esa orden y ese color', async () => {
    useColoresDeVariasOrdenesMock.mockReturnValue([consultaColores(50, 7, [colorDeLaOrden()])]);
    await abrirElBloqueDeColor(explosionConTela());

    // Pregunta por LAS ÓRDENES DE ESTE RENGLÓN, y sólo con el bloque abierto.
    expect(useColoresDeVariasOrdenesMock).toHaveBeenCalledWith([50], true);
    expect(screen.getByTestId('exp-forma-color')).toBeInTheDocument();
    const selects = screen.getAllByTestId('exp-color-select');
    expect(selects).toHaveLength(1);

    fireEvent.change(selects[0] as HTMLElement, { target: { value: '77' } });
    // 🔴 Lo que la pone roja: mandar otra orden, otro color de prenda, o el color como texto.
    expect(asignarColorMutateMock).toHaveBeenCalledTimes(1);
    const [args] = asignarColorMutateMock.mock.calls[0] as [Record<string, unknown>];
    expect(args).toEqual({
      idOrden: 50,
      cuerpo: { idTela: 4, idColor: 900, idTelaColor: 77 },
    });
  });

  /**
   * 🔴 **VARIAS OP Y VARIOS COLORES: SE LISTAN TODOS, y cada uno guarda el SUYO.**
   *
   * Nunca se aplica "el mismo a todos" por cuenta propia: escribir una suposición como si fuera un
   * hecho es exactamente lo que §Post-F9.86 prohíbe. El valor que pondría roja esta prueba es
   * justamente ése — un solo campo para los tres, o tres campos que guarden contra la primera OP.
   */
  it('🔴 con VARIAS OP y colores: lista todos los casos y cada uno guarda contra SU orden', async () => {
    const explosion = explosionConTela({
      porOrden: [
        {
          idRequerimiento: 2,
          idOrden: 50,
          folioOrden: 7,
          cantidadRequerida: 45,
          cantidadAComprar: 45,
          cantidadEnOc: 0,
          cantidadPendiente: 45,
          precioSugerido: null,
        },
        {
          idRequerimiento: 9,
          idOrden: 92,
          folioOrden: 5560,
          cantidadRequerida: 20,
          cantidadAComprar: 20,
          cantidadEnOc: 0,
          cantidadPendiente: 20,
          precioSugerido: null,
        },
      ],
    });
    useColoresDeVariasOrdenesMock.mockReturnValue([
      consultaColores(50, 7, [
        colorDeLaOrden({ idColor: 900, color: 'Azul' }),
        colorDeLaOrden({ idColor: 901, color: 'Verde' }),
      ]),
      consultaColores(92, 5560, [colorDeLaOrden({ idColor: 902, color: 'Negro' })]),
    ]);
    await abrirElBloqueDeColor(explosion);

    expect(useColoresDeVariasOrdenesMock).toHaveBeenCalledWith([50, 92], true);
    // TRES casos: dos colores de la orden 7 y uno de la 5560, cada uno con su propio campo.
    const casos = screen.getAllByTestId('exp-color-caso');
    expect(casos).toHaveLength(3);
    expect(casos[0]?.textContent).toContain('Azul');
    expect(casos[1]?.textContent).toContain('Verde');
    expect(casos[2]?.textContent).toContain('Negro');
    // Y cada OP se nombra: con varias en pantalla, no saber cuál se está tocando es el defecto.
    const bloque = screen.getByTestId('exp-forma-color');
    expect(bloque).toHaveTextContent('Orden 7');
    expect(bloque).toHaveTextContent('Orden 5560');

    // El TERCERO guarda contra la orden 92 y el color 902.
    // 🔴 El valor que la pondría roja: `idOrden: 50` (la primera), que es como estaba antes.
    fireEvent.change(screen.getAllByTestId('exp-color-select')[2] as HTMLElement, {
      target: { value: '78' },
    });
    const [args] = asignarColorMutateMock.mock.calls[0] as [Record<string, unknown>];
    expect(args).toEqual({
      idOrden: 92,
      cuerpo: { idTela: 4, idColor: 902, idTelaColor: 78 },
    });
  });

  /**
   * ⭐ **CORREGIR UN COLOR YA DICHO** — el agujero que dejaba el diseño anterior: en cuanto se
   * decía el color desaparecía el aviso, y con él el ÚNICO botón. Ahora la acción vive en el
   * renglón y sigue ahí después.
   */
  it('⭐ un color YA DICHO se puede corregir desde su renglón', async () => {
    useColoresDeVariasOrdenesMock.mockReturnValue([
      consultaColores(50, 7, [
        colorDeLaOrden({ idColor: 900, color: 'Azul', idTelaColor: 77, telaColor: 'Grana 7700' }),
        // Un color de OTRO renglón (ya amarrado al Marino): NO debe salir en este bloque.
        colorDeLaOrden({
          idColor: 901,
          color: 'Verde',
          idTelaColor: 78,
          telaColor: 'Marino Alsa 3040',
        }),
      ]),
    ]);
    await abrirElBloqueDeColor(
      explosionConTela({ idTelaColor: 77, telaColor: 'Grana 7700', idProveedorSugerido: 11 }),
    );

    // El botón lo dice con letras (y nombra el color que hoy tiene).
    expect(screen.getByTestId('exp-decir-color')).toHaveTextContent('Cambiar el color');
    expect(screen.getByTestId('exp-decir-color')).toHaveTextContent('Grana 7700');
    // 🔴 Sólo los casos DE ESTE renglón: si listara todos, los dos renglones de la misma tela
    // enseñarían la misma lista y no se sabría cuál se está tocando.
    // 🔴 UNO, no dos: el «Verde» ya está amarrado al Marino, así que pertenece al OTRO renglón.
    // El valor que la pondría roja: 2 — los dos renglones de la misma tela enseñando la misma
    // lista, sin saber cuál se está tocando.
    expect(screen.getAllByTestId('exp-color-caso')).toHaveLength(1);
    const select = screen.getByTestId('exp-color-select');
    expect((select as HTMLSelectElement).value).toBe('77');

    fireEvent.change(select, { target: { value: '78' } });
    const [args] = asignarColorMutateMock.mock.calls[0] as [Record<string, unknown>];
    expect(args).toEqual({
      idOrden: 50,
      cuerpo: { idTela: 4, idColor: 900, idTelaColor: 78 },
    });
  });

  /**
   * 🔴 **LA ORDEN SIN MATRIZ COLOR×TALLA: el dato NO es difícil, es IMPOSIBLE.**
   *
   * El amarre cuelga del color de la PRENDA (`OrdenTelaColor` = orden×tela×color): sin matriz no
   * hay `idColor` del que colgarlo. Ofrecer aquí un campo sería exactamente el defecto que esta
   * etapa vino a corregir — un control que no puede guardar nada. Y antes el sistema se lo tragaba
   * callado: sin colores en la matriz la tela ni siquiera entraba en `pendientesColor`.
   */
  it('🔴 la orden SIN matriz de colores lo DICE, y no ofrece un campo muerto', async () => {
    useColoresDeVariasOrdenesMock.mockReturnValue([
      consultaColores(50, 7, [], { sinMatrizColores: true }),
    ]);
    await abrirElBloqueDeColor(explosionConTela());

    const aviso = screen.getByTestId('exp-color-sin-matriz');
    expect(aviso).toHaveTextContent('matriz');
    // Dice de QUÉ orden es y DÓNDE se captura.
    expect(aviso).toHaveTextContent('7');
    expect(aviso).toHaveTextContent('Producción');
    // 🔴 El valor que la pone roja: un `<select>` que no puede guardar nada.
    expect(screen.queryByTestId('exp-color-select')).toBeNull();
  });

  /**
   * ⭐⭐ **CON LA OC AUTORIZADA NO SE CAMBIA** (la regla de §Post-F9.79 aplicada al color). La
   * pantalla no la calcula: la pinta con las palabras del servidor.
   */
  it('⭐⭐ con la OC AUTORIZADA el campo se bloquea y se dice que hay que DES-AUTORIZAR', async () => {
    const motivo =
      'El color "Grana 7700" ya está COMPRADO para esta orden en la orden de compra #812 ' +
      '(autorizada): no se puede cambiar. Si de verdad va otro color, hay que DES-AUTORIZAR esa ' +
      'orden de compra en Compras › Órdenes de compra y volver aquí.';
    useColoresDeVariasOrdenesMock.mockReturnValue([
      consultaColores(50, 7, [
        colorDeLaOrden({
          idColor: 900,
          color: 'Azul',
          idTelaColor: 77,
          telaColor: 'Grana 7700',
          puedeCambiar: false,
          motivoNoCambiar: motivo,
        }),
      ]),
    ]);
    await abrirElBloqueDeColor(
      explosionConTela({ idTelaColor: 77, telaColor: 'Grana 7700', idProveedorSugerido: 11 }),
    );

    // 🔴 Los valores que la ponen roja: `puedeCambiar: true` (campo abierto) o un mensaje redactado
    // en el cliente (que se desincronizaría del rechazo del servidor).
    expect(screen.getByTestId('exp-color-select')).toBeDisabled();
    const bloqueado = screen.getByTestId('exp-color-bloqueado');
    expect(bloqueado).toHaveTextContent('DES-AUTORIZAR');
    expect(bloqueado).toHaveTextContent('#812');
  });

  it('con la OC en BORRADOR el campo sigue abierto (ahí no hay compromiso con nadie)', async () => {
    useColoresDeVariasOrdenesMock.mockReturnValue([
      consultaColores(50, 7, [
        colorDeLaOrden({ idColor: 900, idTelaColor: 77, telaColor: 'Grana 7700' }),
      ]),
    ]);
    await abrirElBloqueDeColor(
      explosionConTela({ idTelaColor: 77, telaColor: 'Grana 7700', idProveedorSugerido: 11 }),
    );
    expect(screen.getByTestId('exp-color-select')).not.toBeDisabled();
    expect(screen.queryByTestId('exp-color-bloqueado')).toBeNull();
  });

  /**
   * ⚠️ **ESTA PRUEBA ERA DE V1-E4c Y V1-E6b LA DIO VUELTA — a propósito, y aquí queda dicho.**
   *
   * Afirmaba que la tela sin colores *"no ofrece un campo muerto: dice dónde darlos de alta"* — o
   * sea, el texto que mandaba a «Catálogos › Telas», **fuera de la compra**. Desde §Post-F9.106 el
   * campo ya NO está muerto: el desplegable trae «＋ Nuevo color…» y se dan de alta aquí mismo. El
   * texto viejo se borró porque su rama era **inalcanzable**: se pintaba sólo a quien no podía dar
   * de alta, y quien no puede dar de alta tampoco ve este bloque (los dos los abre
   * `compras.administrar`).
   */
  it('la tela SIN colores en el catálogo YA NO manda a otra pantalla: se dan de alta aquí', async () => {
    useColoresDeVariasOrdenesMock.mockReturnValue([
      {
        data: {
          idOrden: 50,
          folio: 7,
          sinMatrizColores: false,
          telas: [
            {
              idOrdenTela: 1,
              idTela: 4,
              tela: 'Felpa',
              unidad: 'm',
              consumoPorPrenda: 1.5,
              excluido: false,
              liberado: true,
              colores: [colorDeLaOrden()],
              opciones: [],
            },
          ],
        },
        isPending: false,
        isError: false,
      },
    ]);
    await abrirElBloqueDeColor(explosionConTela());
    // Ya no existe el texto que sacaba de la compra…
    expect(screen.queryByTestId('exp-color-sin-opciones')).toBeNull();
    // …y en su lugar hay un campo VIVO con la puerta dentro.
    expect(screen.getByTestId('exp-color-select')).toBeInTheDocument();
    expect(screen.getByTestId('exp-alta-color')).toBeInTheDocument();
  });

  /**
   * El precio del color (decisión (b) de §Post-F9.89) sigue vivo: se corrige en la vista completa
   * de la orden, y ahora se llega a ella DESDE EL RENGLÓN — no desde un aviso amarillo.
   */
  it('desde el bloque se puede abrir la vista completa de SU orden (donde vive el precio)', async () => {
    const explosion = explosionConTela({
      porOrden: [
        {
          idRequerimiento: 9,
          idOrden: 92,
          folioOrden: 5560,
          cantidadRequerida: 20,
          cantidadAComprar: 20,
          cantidadEnOc: 0,
          cantidadPendiente: 20,
          precioSugerido: null,
        },
      ],
    });
    useColoresDeVariasOrdenesMock.mockReturnValue([consultaColores(92, 5560, [colorDeLaOrden()])]);
    await abrirElBloqueDeColor(explosion);

    useColoresDeTelaMock.mockClear();
    fireEvent.click(screen.getByTestId('exp-ver-colores-orden'));
    // 🔴 El valor que la pondría roja: 50 (la primera OP de la pantalla), el defecto de D7.
    expect(useColoresDeTelaMock).toHaveBeenCalledWith(92);
  });
  /**
   * 🔴🔴 **EL FLUJO PRINCIPAL: DESPUÉS DE GUARDAR, EL BLOQUE NO PUEDE MENTIR.**
   *
   * El defecto que esta prueba fija (hallazgo del reviewer, 2ª vuelta): `useAsignarColorTela`
   * escribe la caché de COLORES al instante (`setQueryData`) pero la EXPLOSIÓN sólo la **invalida**
   * (viaje al servidor). En ese intervalo, un filtro que mirara el `idTelaColor` vivo del renglón
   * dejaba de casar con el caso recién guardado y el bloque contestaba **«la orden 7 ya no tiene
   * colores en este renglón»**: la única respuesta a un guardado correcto era una frase falsa, y en
   * el camino que Daniel pidió.
   *
   * ⚠️ **Monta los hooks DE VERDAD** (`useQueries` + `useMutation` sobre el mismo `QueryClient`),
   * no el doble estático: lo que hay que medir es qué pasa **entre** la escritura de la caché y el
   * repintado de la explosión, y un mock con datos fijos no tiene ese "entre" — mediría el mock.
   * Como `@/api/mrp` es lo único mockeado, los dobles pueden devolver los hooks auténticos.
   */
  it('🔴🔴 al guardar, el bloque enseña el color nuevo (y NUNCA «ya no tiene colores»)', async () => {
    const clave = (idOrden: number) => ['colores-de-prueba', idOrden];
    // La respuesta del servidor: antes y después de decir el color del «Azul».
    const respuesta = (idTelaColor: number | null) =>
      consultaColores(50, 7, [colorDeLaOrden({ idColor: 900, color: 'Azul', idTelaColor })]).data;

    // La escritura se queda EN VUELO hasta que la prueba la suelta: así se puede mirar el momento
    // exacto en el que el select tiene que estar bloqueado (que es lo que evita el doble disparo).
    let soltar: (v: unknown) => void = () => {};
    useAsignarColorTelaMock.mockImplementation(() => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: (_args: unknown) =>
          new Promise((resolver) => {
            soltar = resolver;
          }),
        onSuccess: (datos: unknown, variables: unknown) => {
          // EXACTAMENTE lo que hace el hook real: la caché de colores se escribe…
          qc.setQueryData(clave((variables as { idOrden: number }).idOrden), datos);
          // …y la EXPLOSIÓN sólo se invalida (aquí sigue devolviendo el renglón «sin color»).
        },
      });
    });
    useColoresDeVariasOrdenesMock.mockImplementation((ids: readonly number[]) =>
      useQueries({
        queries: ids.map((idOrden) => ({
          queryKey: clave(idOrden),
          queryFn: () => Promise.resolve(respuesta(null)),
        })),
      }),
    );

    const cliente = crearQueryClientDePrueba();
    useExplosionMock.mockReturnValue({
      data: explosionConTela(),
      isPending: false,
      error: null,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
      queryClient: cliente,
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    await usuario.click(screen.getByTestId('exp-decir-color'));
    const select = await screen.findByTestId('exp-color-select');

    fireEvent.change(select, { target: { value: '77' } });

    // (1) MIENTRAS SE GUARDA el campo está bloqueado: sin eso se puede volver a disparar la misma
    // escritura antes de que la primera conteste (el choque que V1-E3z ya pagó una vez).
    await waitFor(() => {
      expect(screen.getByTestId('exp-color-select')).toBeDisabled();
    });

    // (2) Y al contestar: el caso sigue ahí con SU color nuevo. 🔴 El valor que la pone roja es
    // literalmente la frase que el bloque daba antes.
    soltar(respuesta(77));
    await waitFor(() => {
      expect(cliente.isMutating()).toBe(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId('exp-color-select')).toHaveValue('77');
    });
    expect(screen.queryByTestId('exp-color-sin-casos')).toBeNull();
    expect(screen.getByTestId('exp-forma-color')).not.toHaveTextContent('ya no tiene colores');
  });

  /**
   * 🔴 **EL BLOQUE NO SE CIERRA CUANDO LA EXPLOSIÓN SE RECALCULA.** Decir un color **invalida la
   * explosión**, y el snapshot nuevo trae OTROS `id` para los mismos renglones. Si el bloque
   * abierto se identificara por ese `id`, se cerraría solo justo al terminar la primera captura —
   * o sea, cuando el comprador iba a decir el segundo color. Se identifica por lo que un renglón
   * *es* (tela + color + proveedor), que es lo que no cambia.
   */
  it('🔴 el bloque sigue abierto aunque la explosión se recalcule con ids nuevos', async () => {
    let idSnapshot = 2;
    useColoresDeVariasOrdenesMock.mockReturnValue([consultaColores(50, 7, [colorDeLaOrden()])]);
    useExplosionMock.mockImplementation(() => ({
      data: explosionConTela({ id: idSnapshot, idProveedorSugerido: 11 }),
      isPending: false,
      error: null,
    }));
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    await usuario.click(screen.getByTestId('exp-decir-color'));
    expect(screen.getByTestId('exp-forma-color')).toBeInTheDocument();

    // El servidor recalculó: mismo renglón, otro id de snapshot. Cualquier repintado de la página
    // (aquí, marcar el renglón) ya lo trae con el id nuevo.
    idSnapshot = 999;
    await usuario.click(screen.getByTestId('exp-renglon-check'));

    // 🔴 El valor que la pone roja: identificar el bloque por `r.id` — ahí desaparece.
    expect(screen.getByTestId('exp-forma-color')).toBeInTheDocument();
    expect(screen.getByTestId('exp-color-select')).toBeInTheDocument();
  });

  it('mientras se cargan los colores lo dice, sin ofrecer un campo a medias', async () => {
    useColoresDeVariasOrdenesMock.mockReturnValue([
      { data: undefined, isPending: true, isError: false },
    ]);
    await abrirElBloqueDeColor(explosionConTela());
    expect(screen.getByTestId('exp-forma-color')).toHaveTextContent('Cargando los colores');
    expect(screen.queryByTestId('exp-color-select')).toBeNull();
  });

  it('si la consulta falla, se dice con la frase del servidor (no se calla ni se finge vacío)', async () => {
    useColoresDeVariasOrdenesMock.mockReturnValue([
      {
        data: undefined,
        isPending: false,
        isError: true,
        error: { message: 'El servidor no pudo leer los colores.' },
      },
    ]);
    await abrirElBloqueDeColor(explosionConTela());
    expect(screen.getByTestId('exp-color-error')).toHaveTextContent('no pudo leer los colores');
    expect(screen.queryByTestId('exp-color-select')).toBeNull();
  });

  it('si la tela ya no está en la receta de esa orden, lo dice (explosión más vieja que la receta)', async () => {
    useColoresDeVariasOrdenesMock.mockReturnValue([
      {
        data: { idOrden: 50, folio: 7, sinMatrizColores: false, telas: [] },
        isPending: false,
        isError: false,
      },
    ]);
    await abrirElBloqueDeColor(explosionConTela());
    expect(screen.getByTestId('exp-color-sin-renglon')).toHaveTextContent(
      'ya no está en la receta',
    );
    expect(screen.queryByTestId('exp-color-select')).toBeNull();
  });

  it('una orden cuyos colores son todos de OTRO renglón lo dice, y manda a re-explotar', async () => {
    // El renglón es el «sin color», pero la orden ya tiene sus dos colores amarrados: la explosión
    // que se está mirando es más vieja que la receta.
    useColoresDeVariasOrdenesMock.mockReturnValue([
      consultaColores(50, 7, [
        colorDeLaOrden({ idColor: 900, idTelaColor: 77, telaColor: 'Grana 7700' }),
        colorDeLaOrden({ idColor: 901, idTelaColor: 78, telaColor: 'Marino Alsa 3040' }),
      ]),
    ]);
    await abrirElBloqueDeColor(explosionConTela());
    expect(screen.getByTestId('exp-color-sin-casos')).toHaveTextContent('vuelve a explotar');
    expect(screen.queryByTestId('exp-color-select')).toBeNull();
  });

  /**
   * 🔴 **CAMBIAR EL CONJUNTO CIERRA EL BLOQUE** (3ª vuelta). Aquí el botón despacha
   * **`agregarOrden`** —con una OP ya elegida, `idsOrden` no está vacío—, que declara muerto el
   * contexto anterior: tira ajustes, precios y la previa, y el bloque de color tiene que irse con
   * ellos: si no, **reaparece solo** sobre las OP nuevas. Hasta esta etapa se cerraba por
   * accidente (los paneles se identificaban por el `id` de snapshot, que muere en cada explosión);
   * al darle una clave estable, el accidente dejó de taparlo.
   */
  it('🔴 al cambiar de orden, el bloque de color NO sobrevive al contexto anterior', async () => {
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [
          { id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' },
          { id: 92, folio: 5560, codigoModelo: 'B-200', cliente: 'Cliente Y' },
        ],
        total: 2,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
    });
    useColoresDeVariasOrdenesMock.mockReturnValue([consultaColores(50, 7, [colorDeLaOrden()])]);
    useExplosionMock.mockReturnValue({
      data: explosionConTela(),
      isPending: false,
      error: null,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    const opciones = screen.getAllByTestId('exp-orden-opcion');
    await usuario.click(opciones[0] as HTMLElement);
    await usuario.click(screen.getByTestId('exp-decir-color'));
    expect(screen.getByTestId('exp-forma-color')).toBeInTheDocument();

    // Otra compra, otro contexto.
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[1] as HTMLElement);

    // 🔴 El valor que la pone roja: que el cambio de conjunto no olvide los paneles del renglón —
    // el bloque reaparece solo, ya montado sobre la compra nueva.
    expect(screen.queryByTestId('exp-forma-color')).toBeNull();
  });

  /**
   * …y por la otra puerta: QUITAR una OP del conjunto también lo declara muerto.
   *
   * ⚠️ Se quita **una de dos**, a propósito: quitando la única, la explosión entera se desmonta y
   * el bloque desaparecería igual sin ningún reset — la prueba pasaría sin probar nada (la primera
   * versión de este caso hacía justamente eso, y el mutante sobrevivió).
   */
  it('🔴 al quitar una OP del conjunto, el bloque de color tampoco sobrevive', async () => {
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [
          { id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' },
          { id: 92, folio: 5560, codigoModelo: 'B-200', cliente: 'Cliente Y' },
        ],
        total: 2,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
    });
    useColoresDeVariasOrdenesMock.mockReturnValue([consultaColores(50, 7, [colorDeLaOrden()])]);
    useExplosionMock.mockReturnValue({
      data: explosionConTela(),
      isPending: false,
      error: null,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[1] as HTMLElement);
    await usuario.click(screen.getByTestId('exp-decir-color'));
    expect(screen.getByTestId('exp-forma-color')).toBeInTheDocument();

    // Se quita la SEGUNDA: queda una OP, así que la explosión sigue en pantalla y el bloque sólo
    // puede desaparecer si alguien lo cerró.
    await usuario.click(screen.getAllByTestId('exp-quitar-op')[1] as HTMLElement);
    expect(screen.getAllByTestId('exp-renglon').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('exp-forma-color')).toBeNull();
  });

  /**
   * 🔴 **LA CUARTA PUERTA: LA PRECARGA POR PEDIDO INTERNO, LLEGANDO TARDE.**
   *
   * Es el único sitio que cambia el conjunto de OP **sin un clic**: la consulta de hermanas
   * (`del-mismo-pedido`) puede aterrizar segundos después —React Query reintenta— con el comprador
   * ya trabajando, y el conjunto pasa de 1 a N OP con un panel abierto encima.
   *
   * ⚠️ **No es un escenario inventado, es el mecanismo tal cual:** la prueba no "fuerza" nada —
   * simplemente la consulta contesta en un repintado POSTERIOR (que es lo que significa llegar
   * tarde), y el efecto de precarga corre entonces.
   */
  it('🔴 la precarga por pedido llegando TARDE tampoco deja el panel abierto', async () => {
    // Al principio, las hermanas todavía no contestan.
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    useColoresDeVariasOrdenesMock.mockReturnValue([consultaColores(50, 7, [colorDeLaOrden()])]);
    useExplosionMock.mockReturnValue({
      data: explosionConTela({ idProveedorSugerido: 11 }),
      isPending: false,
      error: null,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    await usuario.click(screen.getByTestId('exp-decir-color'));
    expect(screen.getByTestId('exp-forma-color')).toBeInTheDocument();

    // …y AHORA contestan: el conjunto pasa de [50] a [50, 92] sin que nadie haya pulsado nada.
    useOrdenesDelPedidoMock.mockReturnValue({
      data: {
        idPedido: 300,
        folioPedido: 1515,
        ordenes: [
          { idOrden: 50, folio: 7, modelo: 'A-100', cliente: 'Cliente X', cancelada: false },
          { idOrden: 92, folio: 5560, modelo: 'B-200', cliente: 'Cliente Y', cancelada: false },
        ],
      },
      isPending: false,
      isError: false,
    });
    // Cualquier repintado de la página trae ya la respuesta (aquí, marcar el renglón).
    await usuario.click(screen.getByTestId('exp-renglon-check'));

    // El conjunto de verdad cambió (si no, la prueba no probaría nada)…
    expect(useExplosionMock).toHaveBeenLastCalledWith([50, 92]);
    // …🔴 y el panel se fue con él. El valor que la pone roja: la precarga sin
    // `olvidarPanelesDeRenglon()`, que era el cuarto sitio y el único sin ella.
    expect(screen.queryByTestId('exp-forma-color')).toBeNull();
  });

  /**
   * …y lo mismo para el OTRO panel del renglón, el de «asignar proveedor». Vivía del mismo
   * accidente (se identifica por el `id` de snapshot, que muere en cada explosión); ahora los dos
   * se cierran a mano, y los dos tienen quien lo compruebe.
   */
  it('🔴 el panel de «asignar proveedor» tampoco sobrevive al cambio de conjunto', async () => {
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [
          { id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' },
          { id: 92, folio: 5560, codigoModelo: 'B-200', cliente: 'Cliente Y' },
        ],
        total: 2,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
    });
    useExplosionMock.mockReturnValue({
      data: explosionConTela(),
      isPending: false,
      error: null,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    await usuario.click(screen.getByTestId('exp-asignar-proveedor'));
    expect(screen.getByTestId('exp-forma-asignar')).toBeInTheDocument();

    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[1] as HTMLElement);
    expect(screen.queryByTestId('exp-forma-asignar')).toBeNull();
  });

  /**
   * 🔴 **LOS CASOS SE CONGELAN POR ORDEN, NO “CUANDO LLEGAN TODAS”.** Con dos OP en el renglón, si
   * una falla, la otra tiene que seguir siendo capturable: esperar a que lleguen todas dejaría el
   * bloque entero muerto por una petición ajena — el mismo defecto de la 2ª vuelta («ya no tiene
   * colores en este renglón»), entrando por otra puerta.
   */
  it('🔴 si UNA de las órdenes falla, las demás se siguen capturando', async () => {
    const explosion = explosionConTela({
      porOrden: [
        {
          idRequerimiento: 2,
          idOrden: 50,
          folioOrden: 7,
          cantidadRequerida: 45,
          cantidadAComprar: 45,
          cantidadEnOc: 0,
          cantidadPendiente: 45,
          precioSugerido: null,
        },
        {
          idRequerimiento: 9,
          idOrden: 92,
          folioOrden: 5560,
          cantidadRequerida: 20,
          cantidadAComprar: 20,
          cantidadEnOc: 0,
          cantidadPendiente: 20,
          precioSugerido: null,
        },
      ],
    });
    useColoresDeVariasOrdenesMock.mockReturnValue([
      consultaColores(50, 7, [colorDeLaOrden({ idColor: 900, color: 'Azul' })]),
      // La segunda OP se cae.
      {
        data: undefined,
        isPending: false,
        isError: true,
        error: { message: 'El servidor no pudo leer los colores.' },
      },
    ]);
    await abrirElBloqueDeColor(explosion);

    // 🔴 El valor que la pone roja: congelar sólo cuando han llegado TODAS — la orden 7 se queda
    // sin campo por culpa de un fallo de la 5560.
    expect(screen.getAllByTestId('exp-color-select')).toHaveLength(1);
    expect(screen.getByTestId('exp-color-error')).toHaveTextContent('no pudo leer los colores');
  });

  /**
   * Los AVÍOS no llevan color en ningún lado del modelo de datos (V1-E3u): ofrecerles la acción
   * sería el mismo control muerto que la etapa vino a quitar, por otra puerta.
   */
  it('los AVÍOS no ofrecen decir el color (no lo llevan en el modelo de datos)', async () => {
    useColoresDeVariasOrdenesMock.mockReturnValue([]);
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      error: null,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // La explosión de prueba trae DOS avíos y UNA tela: una sola acción, la de la tela.
    expect(screen.getAllByTestId('exp-renglon')).toHaveLength(3);
    expect(screen.getAllByTestId('exp-decir-color')).toHaveLength(1);
    expect(screen.getByTestId('exp-decir-color').getAttribute('data-material')).toBe('4');
  });

  /**
   * ⭐⭐ **V1-E6b (§Post-F9.106) — DAR DE ALTA EL COLOR DE LA TELA DESDE LA COMPRA.**
   *
   * Daniel, probando las OP 5562/5563/5564: *"ya jaló los pantones desde la OC del cliente. Ahora
   * quiero comprar con esos pantones pero no me deja. Porque me jala sólo algunos colores, que
   * supongo que son los que están dados de alta. **Pero me gustaría que acá pueda yo poner los
   * colores que voy a comprar**"*.
   *
   * Es el hermano del alta de dirección (§Post-F9.104): «＋ Nuevo color…» como ÚLTIMA opción del
   * desplegable, separada, **y pintada también con el catálogo vacío** —que es cuando más se
   * necesita: esconder la única salida detrás de una lista sin elementos fue el defecto que V1-E4d
   * vino a quitar—.
   */
  describe('V1-E6b (§Post-F9.106): dar de alta el color de la tela sin salir de la compra', () => {
    /**
     * ⚖️⚖️ **EL PERFIL DE AURORA, Y ES EL PUNTO DE TODA LA VUELTA DEL 25-AGO-2026.**
     *
     * `compras.ver` + `compras.administrar` y **NADA de `telas.administrar`** — el rol Gerencial con
     * el que Daniel dio de alta a Aurora para probar compras. Es el DEFAULT del helper, así que
     * cada prueba de este bloque que ve la puerta la está viendo **con el perfil de quien compra,
     * no con el del dueño**. Si alguien devuelve el permiso a `telas.administrar`, todas se caen.
     */
    const PERMISOS_COMPRADOR: Parameters<typeof estadoSesionDePrueba>[0] = [
      'compras.ver',
      'compras.administrar',
    ];

    /** La consulta de colores con la tela SIN colores dados de alta (el caso del arranque). */
    function consultaSinOpciones(colores: unknown[]) {
      return {
        data: {
          idOrden: 50,
          folio: 7,
          sinMatrizColores: false,
          telas: [
            {
              idOrdenTela: 1,
              idTela: 4,
              tela: 'Felpa',
              unidad: 'm',
              nombreComplemento: null,
              consumoPorPrenda: 1.5,
              excluido: false,
              liberado: true,
              colores,
              opciones: [],
            },
          ],
        },
        isPending: false,
        isError: false,
      };
    }

    /** El desplegable del primer caso, con sus `<option>` en orden. */
    function opcionesDelSelect(): string[] {
      const select = screen.getAllByTestId('exp-color-select')[0] as HTMLSelectElement;
      return [...select.options].map((o) => o.textContent ?? '');
    }

    // 🔴🔴 EL CASO QUE ORIGINÓ LA ETAPA: sin colores, la pantalla mandaba FUERA de la compra.
    it('🔴 con el catálogo VACÍO la puerta SÍ se pinta (y ya no manda a otra pantalla)', async () => {
      useColoresDeVariasOrdenesMock.mockReturnValue([consultaSinOpciones([colorDeLaOrden()])]);
      await abrirElBloqueDeColor(explosionConTela(), PERMISOS_COMPRADOR);

      // Ya NO es el texto que manda a «Catálogos › Telas»: es un desplegable con la salida dentro.
      expect(screen.queryByTestId('exp-color-sin-opciones')).toBeNull();
      expect(screen.getByTestId('exp-color-select')).toBeInTheDocument();
      expect(screen.getByTestId('exp-alta-color')).toBeInTheDocument();
      // Y la instrucción va en gris (§Post-F9.96: el amarillo es para quien ya intentó avanzar).
      expect(screen.getByTestId('exp-color-sin-opciones-alta')).toHaveTextContent('Nuevo color');
      // Sin colores en el catálogo no hay separador que separar de nada.
      expect(screen.queryByTestId('exp-separador-color')).toBeNull();
    });

    it('con colores dados de alta, «＋ Nuevo color…» va AL FINAL y separada de los reales', async () => {
      useColoresDeVariasOrdenesMock.mockReturnValue([consultaColores(50, 7, [colorDeLaOrden()])]);
      await abrirElBloqueDeColor(explosionConTela(), PERMISOS_COMPRADOR);

      const textos = opcionesDelSelect();
      expect(textos[0]).toContain('sin decir');
      expect(textos[1]).toContain('Grana 7700');
      expect(textos[2]).toContain('Marino Alsa 3040');
      expect(textos[3]).toContain('─'); // el separador
      // 🔴 La última, siempre: si se colara entre los colores reales se elegiría por error.
      expect(textos[textos.length - 1]).toContain('Nuevo color');
      expect(screen.getByTestId('exp-separador-color')).toBeInTheDocument();
    });

    // §Post-F9.68 — esconder Y bloquear. Esta mitad es la de ESCONDER; la de BLOQUEAR (el servidor
    // rechaza igual) vive en el unit del dominio (`telas.test.ts`).
    /**
     * §Post-F9.68 — **ESCONDER Y BLOQUEAR, y dónde vive cada mitad ahora.**
     *
     * 🔴 Ya no se puede probar "sin permiso la opción no se pinta pero el bloque sí": desde el giro
     * del 25-ago-2026 **el bloque y la puerta los abre el MISMO permiso** (`compras.administrar`),
     * así que quien no puede dar de alta tampoco puede decir el color — no llega ni a ver el
     * desplegable. Ésa es la mitad de ESCONDER, y es lo que esta prueba mide: en el gate REAL, no
     * en un `if` interno que ningún caso podría poner en `false`.
     *
     * La mitad de BLOQUEAR (el servidor rechaza igual) vive en el unit del dominio: *"lo abre
     * COMPRAS: el comprador sin `telas.administrar` SÍ puede; el catálogo solo, NO"*.
     */
    it('sin `compras.administrar` no hay bloque de color, y por tanto tampoco puerta de alta', async () => {
      useColoresDeVariasOrdenesMock.mockReturnValue([consultaSinOpciones([colorDeLaOrden()])]);
      useExplosionMock.mockReturnValue({
        data: explosionConTela(),
        isPending: false,
        error: null,
      });
      const usuario = userEvent.setup();
      renderConProveedores(<ExplosionMaterialesPagina />, {
        sesion: estadoSesionDePrueba(['compras.ver']),
      });
      await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

      expect(screen.queryByTestId('exp-decir-color')).toBeNull();
      expect(screen.queryByTestId('exp-color-select')).toBeNull();
      expect(screen.queryByTestId('exp-alta-color')).toBeNull();
    });

    /**
     * ⚖️ **Y LA OTRA MITAD DEL GIRO: el comprador que NO administra telas SÍ ve la puerta.**
     * Con `telas.administrar` esta prueba se pone roja — que es exactamente lo que tiene que pasar
     * si alguien "corrige" el permiso de vuelta por simetría con el resto del catálogo.
     */
    it('⚖️ el comprador SIN `telas.administrar` (perfil Gerencial) SÍ ve «＋ Nuevo color…»', async () => {
      useColoresDeVariasOrdenesMock.mockReturnValue([consultaColores(50, 7, [colorDeLaOrden()])]);
      await abrirElBloqueDeColor(explosionConTela(), PERMISOS_COMPRADOR);

      expect(PERMISOS_COMPRADOR).not.toContain('telas.administrar');
      expect(screen.getByTestId('exp-alta-color')).toBeInTheDocument();
      expect(screen.getByTestId('exp-separador-color')).toBeInTheDocument();
    });

    // ⭐ EL PUNTO ENTERO DE LA PETICIÓN: el pantone ya está en pantalla, no se teclea dos veces.
    it('⭐ el alta viene PRECARGADA con el color de prenda de la OP y su pantone', async () => {
      useColoresDeVariasOrdenesMock.mockReturnValue([
        consultaSinOpciones([colorDeLaOrden({ color: 'Marino', pantone: '19-4027 TCX' })]),
      ]);
      await abrirElBloqueDeColor(explosionConTela(), PERMISOS_COMPRADOR);

      fireEvent.change(screen.getByTestId('exp-color-select'), {
        target: { value: 'nuevo-color' },
      });

      expect(await screen.findByTestId('dialogo-nuevo-color-tela')).toBeInTheDocument();
      expect(screen.getByTestId('nuevo-color-nombre')).toHaveValue('Marino');
      expect(screen.getByTestId('nuevo-color-pantone')).toHaveValue('19-4027 TCX');
      // 🔴 Y elegir «＋ Nuevo color…» NO guarda nada: no se amarra un `NaN` como color de tela.
      expect(asignarColorMutateMock).not.toHaveBeenCalled();
    });

    it('el precio NO es obligatorio: se puede dar de alta el color con el precio en blanco', async () => {
      useColoresDeVariasOrdenesMock.mockReturnValue([
        consultaSinOpciones([colorDeLaOrden({ color: 'Marino', pantone: '19-4027' })]),
      ]);
      await abrirElBloqueDeColor(explosionConTela(), PERMISOS_COMPRADOR);
      fireEvent.change(screen.getByTestId('exp-color-select'), {
        target: { value: 'nuevo-color' },
      });
      await screen.findByTestId('dialogo-nuevo-color-tela');
      expect(screen.getByTestId('nuevo-color-precio')).toHaveValue(null);

      fireEvent.submit(
        screen.getByTestId('guardar-nuevo-color-tela').closest('form') as HTMLElement,
      );

      await waitFor(() => {
        expect(agregarColorMutateMock).toHaveBeenCalledTimes(1);
      });
      const [args] = agregarColorMutateMock.mock.calls[0] as [Record<string, unknown>];
      expect(args).toEqual({
        idTela: 4,
        cuerpo: { nombre: 'Marino', pantone: '19-4027' },
      });
    });

    // La tela sin complemento no ofrece un campo que el servidor rechazaría (A1).
    it('el precio del complemento sólo se pregunta si la tela lleva complemento', async () => {
      useColoresDeVariasOrdenesMock.mockReturnValue([consultaSinOpciones([colorDeLaOrden()])]);
      await abrirElBloqueDeColor(explosionConTela(), PERMISOS_COMPRADOR);
      fireEvent.change(screen.getByTestId('exp-color-select'), {
        target: { value: 'nuevo-color' },
      });
      await screen.findByTestId('dialogo-nuevo-color-tela');
      expect(screen.queryByTestId('nuevo-color-precio-complemento')).toBeNull();
    });

    it('con complemento declarado, su precio SÍ se pregunta y viaja con su nombre', async () => {
      const conComplemento = consultaSinOpciones([colorDeLaOrden({ color: 'Marino' })]);
      (conComplemento.data.telas[0] as unknown as Record<string, unknown>).nombreComplemento =
        'Cardigan';
      useColoresDeVariasOrdenesMock.mockReturnValue([conComplemento]);
      await abrirElBloqueDeColor(explosionConTela(), PERMISOS_COMPRADOR);
      fireEvent.change(screen.getByTestId('exp-color-select'), {
        target: { value: 'nuevo-color' },
      });
      await screen.findByTestId('dialogo-nuevo-color-tela');

      const campo = screen.getByTestId('nuevo-color-precio-complemento');
      expect(campo).toBeInTheDocument();
      fireEvent.change(campo, { target: { value: '40' } });
      fireEvent.submit(
        screen.getByTestId('guardar-nuevo-color-tela').closest('form') as HTMLElement,
      );

      await waitFor(() => {
        expect(agregarColorMutateMock).toHaveBeenCalledTimes(1);
      });
      const [args] = agregarColorMutateMock.mock.calls[0] as [Record<string, unknown>];
      expect((args.cuerpo as Record<string, unknown>).precioComplemento).toBe(40);
    });

    /**
     * ⭐⭐ **AL CREARLO, QUEDA ELEGIDO.** Sin esto el comprador da de alta el color y tiene que
     * volver a buscarlo — preguntar dos veces lo mismo, que es lo que V1-E4d ya corrigió en la
     * dirección recién creada.
     */
    it('⭐ el color recién creado QUEDA ELEGIDO para ese caso (esa OP, ese color de prenda)', async () => {
      // El doble contesta como el servidor: llama a `onSuccess` con el color creado.
      agregarColorMutateMock.mockImplementation(
        (_args: unknown, opciones: { onSuccess?: (c: unknown) => void }) => {
          opciones.onSuccess?.({
            id: 512,
            nombre: 'Marino',
            pantone: '19-4027',
            precio: null,
            precioComplemento: null,
            idColor: null,
          });
        },
      );
      useColoresDeVariasOrdenesMock.mockReturnValue([
        consultaSinOpciones([colorDeLaOrden({ color: 'Marino', pantone: '19-4027' })]),
      ]);
      await abrirElBloqueDeColor(explosionConTela(), PERMISOS_COMPRADOR);
      fireEvent.change(screen.getByTestId('exp-color-select'), {
        target: { value: 'nuevo-color' },
      });
      await screen.findByTestId('dialogo-nuevo-color-tela');
      fireEvent.submit(
        screen.getByTestId('guardar-nuevo-color-tela').closest('form') as HTMLElement,
      );

      await waitFor(() => {
        expect(asignarColorMutateMock).toHaveBeenCalledTimes(1);
      });
      // 🔴 Lo que la pone roja: amarrar otra orden, otro color de prenda, o no amarrar nada.
      const [args] = asignarColorMutateMock.mock.calls[0] as [Record<string, unknown>];
      expect(args).toEqual({
        idOrden: 50,
        cuerpo: { idTela: 4, idColor: 900, idTelaColor: 512 },
      });
    });

    /**
     * 🔴 **NO SE RE-ROMPE EL CONGELADO DE V1-E4c.** Los casos se congelan al abrir precisamente
     * porque, al guardar, el caso recién escrito dejaba de casar con el filtro vivo y el bloque
     * decía *"la orden 7 ya no tiene colores en este renglón"* — una frase falsa, y el único acuse
     * de recibo de un guardado correcto. El alta escribe igual que el amarre: tiene que sobrevivir.
     */
    it('🔴 tras dar de alta y elegir, el caso SIGUE a la vista con su color (no dice que ya no hay)', async () => {
      agregarColorMutateMock.mockImplementation(
        (_args: unknown, opciones: { onSuccess?: (c: unknown) => void }) => {
          opciones.onSuccess?.({
            id: 512,
            nombre: 'Marino',
            pantone: '19-4027',
            precio: null,
            precioComplemento: null,
            idColor: null,
          });
        },
      );
      // El amarre contesta como el servidor: la vista COMPLETA releída, ya con el color nuevo
      // dentro de `opciones` y elegido en el caso.
      const yaConColor = {
        data: {
          idOrden: 50,
          folio: 7,
          sinMatrizColores: false,
          telas: [
            {
              idOrdenTela: 1,
              idTela: 4,
              tela: 'Felpa',
              unidad: 'm',
              nombreComplemento: null,
              consumoPorPrenda: 1.5,
              excluido: false,
              liberado: true,
              colores: [
                colorDeLaOrden({
                  color: 'Marino',
                  pantone: '19-4027',
                  idTelaColor: 512,
                  telaColor: 'Marino',
                }),
              ],
              opciones: [
                {
                  idTelaColor: 512,
                  nombre: 'Marino',
                  pantone: '19-4027',
                  precio: null,
                  precioComplemento: null,
                },
              ],
            },
          ],
        },
        isPending: false,
        isError: false,
      };
      asignarColorMutateMock.mockImplementation(() => {
        useColoresDeVariasOrdenesMock.mockReturnValue([yaConColor]);
      });
      useColoresDeVariasOrdenesMock.mockReturnValue([
        consultaSinOpciones([colorDeLaOrden({ color: 'Marino', pantone: '19-4027' })]),
      ]);
      await abrirElBloqueDeColor(explosionConTela(), PERMISOS_COMPRADOR);
      fireEvent.change(screen.getByTestId('exp-color-select'), {
        target: { value: 'nuevo-color' },
      });
      await screen.findByTestId('dialogo-nuevo-color-tela');

      fireEvent.submit(
        screen.getByTestId('guardar-nuevo-color-tela').closest('form') as HTMLElement,
      );
      await waitFor(() => {
        expect(asignarColorMutateMock).toHaveBeenCalledTimes(1);
      });

      const bloque = screen.getByTestId('exp-forma-color');
      expect(bloque).not.toHaveTextContent('no hay ningún color de prenda');
      expect(screen.queryByTestId('exp-color-sin-casos')).toBeNull();
      // Y el acuse de recibo de verdad: el caso sigue ahí, con el color nuevo elegido.
      expect(screen.getByTestId('exp-color-select')).toHaveValue('512');
    });
  });
});

/**
 * ⭐⭐ **V1-E4c (B) — EL AVISO AMARILLO, EN EL PASO DE AVANZAR.** Daniel: *"primero que dé la opción
 * de meterlo, **y si no se hace, entonces que mande los mensajes en amarillo**"*. El amarillo es la
 * consecuencia de no haber llenado, y sale en la revisión previa: la última pantalla antes de
 * comprometer el dinero. **No bloquea** (una tela sin color se ha comprado así siempre).
 */
describe('ExplosionMaterialesPagina — V1-E4c: el aviso del color, en la REVISIÓN PREVIA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
    });
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      isPending: false,
      reset: vi.fn(),
    });
    useGenerarOcMock.mockReturnValue({ mutate: vi.fn(), isPending: false, reset: vi.fn() });
    useAsignarProveedorMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useAsignarProveedorEnBloqueMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useColoresDeVariasOrdenesMock.mockReturnValue([]);
    useAsignarColorTelaMock.mockReturnValue({
      mutate: asignarColorMutateMock,
      isPending: false,
    });
    useColoresDeTelaMock.mockReturnValue({ data: undefined, isPending: false });
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
  });

  function planConAvisos(avisos: string[]) {
    return {
      ordenes: [
        {
          idOrden: 50,
          folio: 7,
          idModelo: 9,
          modelo: 'A-100',
          totalPiezas: 30,
          idPedido: 300,
          folioPedido: 1515,
          fechaEntrega: '2026-09-30',
        },
      ],
      proveedores: [
        {
          idProveedor: 11,
          proveedor: 'Alsatex',
          fechaEntrega: '2026-09-01',
          renglones: [
            {
              tipo: 'tela' as const,
              idMaterial: 4,
              idTelaColor: null,
              telaColor: null,
              cantidadEnOcSinColor: 0,
              material: 'Felpa',
              unidad: 'm',
              cantidadTotal: 45,
              cantidadPropuesta: 45,
              ajustado: false,
              precioUnitario: 50,
              precioPropuesto: 50,
              precioAjustado: false,
              importe: 2250,
              porOrden: [
                {
                  idRequerimiento: 2,
                  idOrden: 50,
                  folioOrden: 7,
                  cantidad: 45,
                  cantidadPropuesta: 45,
                  precio: 50,
                  importe: 2250,
                  seEscribe: true,
                },
              ],
            },
          ],
          total: 2250,
          ordenes: [7],
        },
      ],
      omitidos: [],
      bloqueos: [] as string[],
      avisos,
      totalGeneral: 2250,
    };
  }

  async function llegarALaPreviaCon(avisos: string[]): Promise<void> {
    const plan = planConAvisos(avisos);
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        opciones.onSuccess?.(plan);
      },
    );
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
  }

  it('⭐⭐ lo que quedó sin color SÍ se avisa aquí, con las palabras del servidor', async () => {
    await llegarALaPreviaCon([
      '"Felpa" se va a pedir a Alsatex SIN decir de qué color (45 m, orden 7).',
    ]);
    expect(screen.getByTestId('exp-previa-avisos')).toBeInTheDocument();
    expect(screen.getByTestId('exp-previa-aviso')).toHaveTextContent('SIN decir de qué color');
    // 🔴 Y NO bloquea: comprar sin color siempre se ha podido, y la etapa no vino a prohibirlo.
    expect(screen.getByTestId('exp-confirmar-generar')).not.toBeDisabled();
  });

  it('sin nada que advertir NO se pinta el amarillo (el aviso es la excepción, no el saludo)', async () => {
    await llegarALaPreviaCon([]);
    expect(screen.queryByTestId('exp-previa-avisos')).toBeNull();
  });

  /**
   * ⭐⭐ **V1-E4d (§Post-F9.96)** — el mismo canal levanta ahora el OTRO aviso que salió de la
   * entrada: lo que **no entra** porque Desarrollo no lo ha liberado. La pantalla no lo redacta ni
   * lo distingue del color: pinta lo que el servidor manda (A1).
   */
  it('⭐⭐ lo que NO entra por no estar liberado también se avisa aquí', async () => {
    await llegarALaPreviaCon([
      '"CIE-53 — Cierre 53 cm" NO entra en esta compra: Desarrollo todavía no lo libera en la orden 7 (1 pza por prenda).',
    ]);
    expect(screen.getByTestId('exp-previa-aviso')).toHaveTextContent('NO entra en esta compra');
    // Tampoco bloquea: comprar lo liberado y dejar el resto es una manera legítima de trabajar.
    expect(screen.getByTestId('exp-confirmar-generar')).not.toBeDisabled();
  });
});

/**
 * ⭐⭐⭐ **V1-E4d (§Post-F9.96) — «PRIMERO EL LUGAR PARA LLENAR; EL AMARILLO, SÓLO SI NO SE LLENÓ»,
 * APLICADO A LOS OCHO AVISOS QUE QUEDABAN.**
 *
 * Daniel, 23-ago-2026, sobre esta pantalla: *"el proceso normal es llenar ahí la información. Los
 * mensajes amarillos parecieran que estamos haciendo algo mal. Primero que dé la opción de meterlo,
 * y si no se hace, entonces que mande los mensajes en amarillo"* · *"los avisos en amarillo salen
 * muchos y confunde lo que realmente se busca"*.
 *
 * V1-E4c lo aplicó al color de la tela; esto es lo mismo para los ocho restantes. De ellos, **tres
 * no eran avisos** (dos informaciones y la instrucción de la pantalla), **dos eran el mismo caso
 * contado dos veces** y **tres tenían acción** — y su acción, o ya vivía en el renglón, o se movió
 * a esta pantalla (la dirección).
 */
describe('ExplosionMaterialesPagina — V1-E4d: los avisos, en su lugar (§Post-F9.96)', () => {
  /**
   * ⚠️ **`mockReset()`, no `clearAllMocks()`.** Este archivo NO resetea mocks entre suites (no hay
   * `clearMocks` en la configuración), y `vi.clearAllMocks()` borra las LLAMADAS pero **conserva las
   * implementaciones**: la suite anterior deja un `previoMutateMock` que contesta solo abriendo la
   * revisión previa, y con él estas pruebas mirarían otra pantalla. Se resetean los que llevan
   * implementación propia.
   */
  beforeEach(() => {
    previoMutateMock.mockReset();
    crearDireccionMock.mockReset();
    useExplosionMock.mockReset();
    useDireccionesMock.mockReset();
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useAsignarProveedorMock.mockReturnValue({ mutate: asignarMutateMock, isPending: false });
    useAsignarProveedorEnBloqueMock.mockReturnValue({ mutate: bloqueMutateMock, isPending: false });
    useColoresDeVariasOrdenesMock.mockReturnValue([]);
    useAsignarColorTelaMock.mockReturnValue({ mutate: asignarColorMutateMock, isPending: false });
    useColoresDeTelaMock.mockReturnValue({ data: undefined, isPending: false });
    // Caso normal: hay una dirección FAVORITA (las pruebas que la quitan lo dicen).
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
  });

  /** Explosión con TODO lo que antes disparaba carteles a la vez (el peor caso real). */
  function explosionRuidosa() {
    const base = explosionDePrueba();
    return {
      ...base,
      // El renglón afectado por la desalineación va marcado, como lo marca el servidor: el aviso
      // dice "los renglones afectados están marcados" y tiene que ser verdad.
      grupos: base.grupos.map((g) => ({
        ...g,
        renglones: g.renglones.map((r) => (r.id === 1 ? { ...r, cambiosReceta: ['consumo'] } : r)),
      })),
      huboCambios: true,
      avisos: ['Tela "Felpa": la OC nace con el precio de REFERENCIA. Revísalo.'],
      desalineacion: {
        hayCambios: true,
        conOrdenCompra: false,
        critico: false,
        cambios: [
          {
            tipo: 'avio' as const,
            idRenglon: 9,
            material: 'BOT-01 — Botón',
            que: 'consumo',
            detalle: 'La cantidad de "BOT-01 — Botón" pasó de 6 a 8 en el modelo.',
          },
        ],
      },
      pendientesLiberar: [
        {
          tipo: 'avio' as const,
          idRenglon: 9,
          idOrden: 50,
          folioOrden: 7,
          idTela: null,
          idTelaColor: null,
          telaColor: null,
          idAvio: 21,
          material: 'CIE-53 — Cierre 53 cm',
          consumoPorPrenda: 1,
          unidad: 'pza',
        },
      ],
    };
  }

  async function abrir(datos: unknown = explosionRuidosa()): Promise<void> {
    useExplosionMock.mockReturnValue({ data: datos, isPending: false, isError: false });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
  }

  /**
   * ⭐⭐ **V1-E4f (§Post-F9.104) — ABRIR EL ALTA ES ELEGIR LA ÚLTIMA OPCIÓN DEL DESPLEGABLE.**
   *
   * Daniel, viéndolo funcionar como botón suelto: *"está mejor dentro del cuadro desplegable. **Casi
   * no se va a usar. No tiene caso tener un botón para eso**"*. El **diálogo** que se abre es el
   * mismo de V1-E4d —y lo que estas pruebas protegen sigue siendo lo de entonces—; lo único que
   * cambió es **por dónde se llega**. Por eso el camino vive en UN solo lugar: si mañana se mueve
   * otra vez, se cambia aquí y no en cada prueba.
   */
  async function abrirElAltaDeDireccion(
    usuario: ReturnType<typeof userEvent.setup>,
  ): Promise<void> {
    await usuario.selectOptions(screen.getByTestId('exp-direccion-entrega'), 'nueva');
  }

  /**
   * 🔴 **LA PRUEBA QUE DANIEL HARÍA: abrir la pantalla y mirar.** Con TODO en contra —BOM cambiado,
   * modelo desalineado, material sin liberar, notas de precio, un material sin proveedor y otro ya
   * comprado— arriba del primer renglón no puede quedar **ni un amarillo**. Si alguien devuelve
   * cualquiera de los ocho carteles a la entrada, esto se pone rojo y dice cuál.
   */
  it('⭐⭐⭐ al abrir, NINGÚN aviso amarillo antes del primer renglón', async () => {
    await abrir();
    expect(amarillosAntesDelPrimerRenglon().map((n) => n.dataset['testid'] ?? n.className)).toEqual(
      [],
    );
  });

  it('los tres que NO eran avisos caben en una línea informativa, sin caja de color', async () => {
    await abrir();
    const resumen = screen.getByTestId('exp-resumen');
    // La instrucción de la pantalla…
    expect(resumen).toHaveTextContent('material(es) por comprar');
    // …y la leyenda de las etiquetas del BOM.
    expect(resumen).toHaveTextContent('El BOM cambió');
    expect(claseAmarilla(resumen)).toBe(false);
    // Las tres cajas que había: ninguna vuelve.
    expect(screen.queryByTestId('exp-banner-faltantes')).toBeNull();
    expect(screen.queryByTestId('exp-ya-en-oc')).toBeNull();
    expect(screen.queryByTestId('exp-aviso-cambios')).toBeNull();
  });

  it('lo que falta liberar, la desalineación y las notas quedan DEBAJO de la lista', async () => {
    await abrir();
    const pendientes = screen.getByTestId('exp-pendientes-liberar');
    // Sigue completo: nombre, cantidad y el camino a resolverlo.
    expect(pendientes).toHaveTextContent('CIE-53 — Cierre 53 cm');
    expect(pendientes).toHaveTextContent('1 pza por prenda');
    expect(vaDespuesDeLaLista(pendientes)).toBe(true);
    expect(claseAmarilla(pendientes)).toBe(false);

    const desalineacion = screen.getByTestId('exp-desalineacion');
    expect(desalineacion).toHaveTextContent('pasó de 6 a 8 en el modelo');
    expect(vaDespuesDeLaLista(desalineacion)).toBe(true);
    expect(claseAmarilla(desalineacion)).toBe(false);
    // …y el renglón afectado se sigue marcando: el aviso apunta a algo que se ve.
    expect(screen.getByTestId('exp-renglon-desalineado')).toBeInTheDocument();

    expect(vaDespuesDeLaLista(screen.getByTestId('exp-avisos'))).toBe(true);
  });

  /**
   * ⚠️ La ÚNICA excepción declarada: §Post-F9.43(d) pide TEXTUALMENTE el rojo *"en el lugar de la
   * decisión"* cuando el modelo cambió y la orden **ya tiene compras**. Ahí sí hay dinero corriendo,
   * y callarlo por estética sería el defecto contrario.
   */
  it('la desalineación CRÍTICA conserva su rojo (pero sigue debajo de la lista)', async () => {
    const base = explosionRuidosa();
    await abrir({
      ...base,
      desalineacion: { ...base.desalineacion, critico: true, conOrdenCompra: true },
    });
    const aviso = screen.getByTestId('exp-desalineacion');
    expect(aviso).toHaveTextContent('ya tiene compras');
    expect(aviso.className).toContain('destructive');
    expect(vaDespuesDeLaLista(aviso)).toBe(true);
  });

  /**
   * ⭐⭐ **LA DIRECCIÓN: LO ÚNICO QUE BLOQUEA** (Daniel, 23-ago-2026: *no se genera una OC sin decir
   * a dónde se entrega*). Lo que cambia es el momento: al abrir es una **instrucción** gris junto a
   * su campo; el **amarillo** llega al intentar avanzar sin haberla llenado — y la petición NO sale.
   */
  it('⭐⭐ la dirección: instrucción al abrir, amarillo AL INTENTAR AVANZAR, y no se manda nada', async () => {
    // DOS sin favorita: el único caso en que de verdad hay que preguntar (ver la cascada).
    useDireccionesMock.mockReturnValue({
      data: {
        datos: [
          { id: 7, nombre: 'Naucalpan', favorita: false },
          { id: 8, nombre: 'Bodega Centro', favorita: false },
        ],
      },
      isPending: false,
    });
    await abrir();

    const antes = screen.getByTestId('exp-falta-direccion');
    expect(antes).toHaveAttribute('data-tono', 'instruccion');
    expect(claseAmarilla(antes)).toBe(false);

    const usuario = userEvent.setup();
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));

    // 🔴 Bloquear se sigue bloqueando: NO salió la petición del plan.
    expect(previoMutateMock).not.toHaveBeenCalled();
    const despues = screen.getByTestId('exp-falta-direccion');
    expect(despues).toHaveAttribute('data-tono', 'aviso');
    expect(claseAmarilla(despues)).toBe(true);
    expect(despues).toHaveTextContent('No se pueden generar las OC todavía');
    // Y el foco se va al campo donde se llena, no a buscarlo.
    expect(screen.getByTestId('exp-direccion-entrega')).toHaveFocus();

    // Al llenarlo, el aviso se va y la compra sigue su camino.
    await usuario.selectOptions(screen.getByTestId('exp-direccion-entrega'), '7');
    expect(screen.queryByTestId('exp-falta-direccion')).toBeNull();
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    expect(previoMutateMock).toHaveBeenCalledOnce();
  });

  /**
   * ⭐⭐ **DANIEL, 23-ago-2026 — «SIEMPRE DEJARLA FIJA».** *"El lugar de entrega en el 99% de las
   * órdenes es en el mismo lugar. Podemos dejar por default siempre la dirección de entrega…
   * podríamos modificarla si es que se requiera, pero siempre dejarla fija."*
   *
   * El default ya existía (la FAVORITA, única por dominio). Lo que frenaba era una **casilla sin
   * prender**: con una sola dirección en el catálogo, el sistema bloqueaba la OC pidiendo elegir
   * *"la favorita"* **entre una única opción** — la fricción exacta que §Post-F9.96 vino a quitar.
   */
  it('⭐⭐ con UNA SOLA dirección activa se usa sola, aunque no sea favorita', async () => {
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: false }] },
      isPending: false,
    });
    await abrir();

    // No se reclama nada: no hay ninguna decisión que tomar.
    expect(screen.queryByTestId('exp-falta-direccion')).toBeNull();
    expect(screen.getByTestId('exp-direccion-entrega')).toHaveValue('7');

    // 🔴 Y no es sólo que se calle: la dirección VIAJA al servidor (que sin ella bloquearía, porque
    // su fallback es la favorita y aquí no hay ninguna marcada).
    const usuario = userEvent.setup();
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ idDireccionEntrega?: number }];
    expect(cuerpo.idDireccionEntrega).toBe(7);
  });

  /**
   * 🔴 **EL CORTE: sólo con UNA.** Con dos y ninguna marcada hay una decisión REAL, y el sistema no
   * la inventa (§Post-F9.86: nunca escribir una suposición como si fuera un hecho). Si alguien
   * quitara el `length === 1`, la pantalla elegiría la primera de la lista por su cuenta — y esta
   * prueba se pone roja.
   */
  it('🔴 con DOS y ninguna favorita NO elige sola: pregunta, y lo dice con el conteo', async () => {
    useDireccionesMock.mockReturnValue({
      data: {
        datos: [
          { id: 7, nombre: 'Naucalpan', favorita: false },
          { id: 8, nombre: 'Bodega Centro', favorita: false },
        ],
      },
      isPending: false,
    });
    await abrir();

    const aviso = screen.getByTestId('exp-falta-direccion');
    expect(aviso).toHaveTextContent('Hay 2 direcciones de entrega y ninguna marcada como favorita');
    expect(screen.getByTestId('exp-direccion-entrega')).toHaveValue('');
    // Y sigue bloqueando (es lo único que bloquea): la petición no sale.
    const usuario = userEvent.setup();
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    expect(previoMutateMock).not.toHaveBeenCalled();
  });

  /** La FAVORITA sigue ganando sobre "la única": el orden de la cascada importa. */
  it('la favorita manda aunque haya varias (la cascada no se invierte)', async () => {
    useDireccionesMock.mockReturnValue({
      data: {
        datos: [
          { id: 7, nombre: 'Naucalpan', favorita: false },
          { id: 8, nombre: 'Bodega Centro', favorita: true },
        ],
      },
      isPending: false,
    });
    await abrir();
    expect(screen.queryByTestId('exp-falta-direccion')).toBeNull();
    expect(screen.getByTestId('exp-direccion-entrega')).toHaveValue('8');
  });

  /** Sin ninguna activa el mensaje dice ESO —no "ninguna favorita"— y manda a darla de alta aquí. */
  it('sin ninguna dirección activa, el mensaje dice eso y ofrece el alta', async () => {
    useDireccionesMock.mockReturnValue({ data: { datos: [] }, isPending: false });
    await abrir();
    const aviso = screen.getByTestId('exp-falta-direccion');
    expect(aviso).toHaveTextContent('No hay ninguna dirección de entrega activa');
    expect(aviso).not.toHaveTextContent('favorita');
    expect(screen.getByTestId('exp-alta-direccion')).toBeInTheDocument();
  });

  /**
   * 🔴 **M11 (2ª vuelta) — EL BOTÓN QUE NO SE APAGA TIENE QUE DECIR QUÉ FALTA.** La etapa quitó el
   * `disabled` y con él la única señal de "algo falta"; si el `title` tampoco lo dijera, el
   * comprador pulsaría un botón que **no hace nada visible más que un mensaje arriba**. Es la
   * mitad de la promesa "el botón ya no se apaga en silencio", y no la fijaba ninguna prueba.
   */
  it('🔴 el botón DICE que falta la dirección, aunque no se apague', async () => {
    useDireccionesMock.mockReturnValue({ data: { datos: [] }, isPending: false });
    await abrir();
    // 🔴 V1-E7f: en el título la FECHA va primero (es el primero de la barra), así que para medir
    // lo que esta prueba mide —que la dirección se dice— hay que capturar la fecha antes.
    capturarEntregaInicial();
    const boton = screen.getByTestId('exp-generar-oc');
    expect(boton).toBeEnabled();
    expect(boton).toHaveAttribute('title', expect.stringContaining('a dónde se entrega'));
  });

  /**
   * 🔴 **M12/M13 (2ª vuelta) — EL AMARILLO SE APAGA CUANDO SE ARREGLA, Y NO REAPARECE DE GOLPE.**
   *
   * Sin `setIntentoSinDireccion(false)`, el comprador que arregla la dirección y luego la vuelve a
   * vaciar —cambiar de idea es lo más normal del mundo— se encuentra otraVez el **amarillo**, sin
   * haber intentado nada. Eso es exactamente el defecto que esta etapa vino a quitar: recibir de
   * regaño a quien no ha tenido oportunidad. La marca se baja en {@link revisar} y al dar de alta.
   */
  it('🔴 arreglada la dirección y vuelta a vaciar, el mensaje vuelve GRIS (no amarillo)', async () => {
    useDireccionesMock.mockReturnValue({
      data: {
        datos: [
          { id: 7, nombre: 'Naucalpan', favorita: false },
          { id: 8, nombre: 'Bodega Centro', favorita: false },
        ],
      },
      isPending: false,
    });
    await abrir();
    const usuario = userEvent.setup();

    // 1) Intenta avanzar sin dirección → amarillo.
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    expect(screen.getByTestId('exp-falta-direccion')).toHaveAttribute('data-tono', 'aviso');

    // 2) La elige y avanza de verdad (aquí se baja la marca).
    await usuario.selectOptions(screen.getByTestId('exp-direccion-entrega'), '7');
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    expect(previoMutateMock).toHaveBeenCalledOnce();

    // 3) Cambia de idea y la vacía: el mensaje vuelve, pero como INSTRUCCIÓN.
    await usuario.selectOptions(screen.getByTestId('exp-direccion-entrega'), '');
    const otraVez = screen.getByTestId('exp-falta-direccion');
    expect(otraVez).toHaveAttribute('data-tono', 'instruccion');
    expect(claseAmarilla(otraVez)).toBe(false);
  });

  /** Lo mismo por la otra puerta: dar de alta la dirección también baja la marca. */
  it('🔴 dar de alta la dirección también apaga el amarillo del intento anterior', async () => {
    useDireccionesMock.mockReturnValue({ data: { datos: [] }, isPending: false });
    crearDireccionMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (d: unknown) => void }) => {
        opciones.onSuccess?.({ id: 9, nombre: 'Bodega Naucalpan', favorita: false });
      },
    );
    await abrir();
    const usuario = userEvent.setup();

    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    expect(screen.getByTestId('exp-falta-direccion')).toHaveAttribute('data-tono', 'aviso');

    await abrirElAltaDeDireccion(usuario);
    await usuario.type(screen.getByLabelText(/nombre corto/i), 'Bodega Naucalpan');
    await usuario.type(
      screen.getByLabelText(/dirección completa/i),
      'Av. Siempre Viva 1, Naucalpan',
    );
    await usuario.click(screen.getByTestId('guardar-direccion-entrega'));

    // La dirección quedó puesta (no hay nada que reclamar) y la marca del intento se bajó: si el
    // comprador la vacía, el mensaje vuelve GRIS.
    await waitFor(() => {
      expect(screen.queryByTestId('exp-falta-direccion')).toBeNull();
    });
    await usuario.selectOptions(screen.getByTestId('exp-direccion-entrega'), '');
    expect(screen.getByTestId('exp-falta-direccion')).toHaveAttribute('data-tono', 'instruccion');
  });

  /**
   * 🔴 **M17 (2ª vuelta) — MIENTRAS EL SERVIDOR PREPARA EL PLAN, EL BOTÓN SE APAGA.** Esta etapa
   * reescribió esa expresión y le dejó `isPending` como ÚNICO guardián: dos planes en vuelo es
   * justo lo que V1-E3z cerró (la respuesta que llega tarde pisa a la buena). El doble estático de
   * este archivo no la ejercitaba nunca — aquí se le da un `isPending: true` explícito.
   */
  it('🔴 con el plan en vuelo, «Revisar y generar OC» se apaga', async () => {
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: true,
      isError: false,
      isSuccess: false,
    });
    await abrir();
    const boton = screen.getByTestId('exp-generar-oc');
    expect(boton).toBeDisabled();
    expect(boton).toHaveTextContent('Preparando…');
  });

  /**
   * 🔴 **EL HECHO QUE EL REVIEWER RESCATÓ: LA COMPRA PARCIAL.** Con algo comprable y UN material
   * sin proveedor, nadie más lo nombra —el panel de a varios exige dos, y el título del botón calla
   * porque sí hay comprables—. El aviso amarillo no vuelve; el HECHO sí, en gris.
   */
  it('⭐ con UNO solo sin proveedor, el resumen dice que se queda fuera (en gris)', async () => {
    await abrir(explosionDePrueba());
    const resumen = screen.getByTestId('exp-resumen');
    expect(resumen).toHaveTextContent('1 sin proveedor: NO entran en esta compra');
    expect(claseAmarilla(resumen)).toBe(false);
    // Y sigue sin haber cartel amarillo arriba de la lista.
    expect(amarillosAntesDelPrimerRenglon()).toEqual([]);
    // El panel de a varios NO se pinta con uno solo: por eso hacía falta decirlo aquí.
    expect(screen.queryByTestId('exp-bloque')).toBeNull();
  });

  /**
   * ⭐⭐ **EL CATÁLOGO VACÍO SE RESUELVE AQUÍ.** Antes, el único camino era un enlace que sacaba de
   * la compra: al volver, la explosión y las OP elegidas ya no estaban. Ahora se da de alta con el
   * MISMO diálogo del catálogo y **la recién creada queda elegida** — quien la capturó para esta OC
   * ya dijo cuál quiere.
   */
  it('⭐⭐ da de alta la dirección SIN salir de la compra, y la deja elegida', async () => {
    useDireccionesMock.mockReturnValue({ data: { datos: [] }, isPending: false });
    // El alta la contesta el servidor; aquí se simula su respuesta para ver qué hace la pantalla.
    crearDireccionMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (d: unknown) => void }) => {
        // Ojo: NO viene marcada como favorita — el caso que el `direccionEfectiva` de siempre
        // dejaría fuera si la pantalla no adoptara la recién creada.
        opciones.onSuccess?.({ id: 9, nombre: 'Bodega Naucalpan', favorita: false });
      },
    );
    await abrir();

    const usuario = userEvent.setup();
    await abrirElAltaDeDireccion(usuario);
    await usuario.type(screen.getByLabelText(/nombre corto/i), 'Bodega Naucalpan');
    await usuario.type(
      screen.getByLabelText(/dirección completa/i),
      'Av. Siempre Viva 1, Naucalpan',
    );
    await usuario.click(screen.getByTestId('guardar-direccion-entrega'));

    expect(crearDireccionMock).toHaveBeenCalledOnce();
    // Se quedó ELEGIDA (aunque no sea favorita) y el reclamo desapareció.
    await waitFor(() => {
      expect(screen.queryByTestId('exp-falta-direccion')).toBeNull();
    });
    // 🔴 Y no es sólo que el aviso se calle: la dirección recién creada VIAJA al servidor.
    capturarEntregaInicial();
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ idDireccionEntrega?: number }];
    expect(cuerpo.idDireccionEntrega).toBe(9);
  });

  /** Sin `compras.administrar` no se pinta el alta: el servidor la rechazaría igual (§Post-F9.68). */
  it('sin permiso de administrar compras, el alta de dirección NI se pinta', async () => {
    useDireccionesMock.mockReturnValue({ data: { datos: [] }, isPending: false });
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    expect(screen.queryByTestId('exp-alta-direccion')).toBeNull();
    // ⭐ V1-E4f: lo que se esconde es la OPCIÓN, no el desplegable — quien sólo puede ver la compra
    // sigue viendo a dónde se entrega (y hasta la raya del separador sobra si no hay alta).
    expect(screen.getByTestId('exp-direccion-entrega')).toBeInTheDocument();
    expect(screen.queryByTestId('exp-separador-direccion')).toBeNull();
  });

  /**
   * ⭐⭐ **V1-E4f (§Post-F9.104) — EL ALTA, DENTRO DEL DESPLEGABLE.** Daniel, viéndola como botón
   * suelto: *"está mejor dentro del cuadro desplegable. **Casi no se va a usar. No tiene caso tener
   * un botón para eso**"*. No contradice §Post-F9.96 (el alta sigue a un clic, sin salir de la
   * compra): le quita **peso visual** a un caso excepcional que le estaba robando barra a lo que se
   * usa a diario. Lo que estas pruebas fijan es lo que Daniel notaría al instante si alguien
   * deshiciera el cambio: **dónde** está la opción y que **nunca se confunda con una dirección**.
   */
  describe('V1-E4f (§Post-F9.104): el alta vive DENTRO del desplegable', () => {
    /** Las opciones de «Entregar en», en el orden en que se ven. */
    function opcionesDeEntregarEn(): HTMLOptionElement[] {
      return Array.from(screen.getByTestId('exp-direccion-entrega').querySelectorAll('option'));
    }

    it('⭐⭐ la opción de alta va AL FINAL, separada de las direcciones de verdad', async () => {
      useDireccionesMock.mockReturnValue({
        data: {
          datos: [
            { id: 7, nombre: 'Naucalpan', favorita: true },
            { id: 8, nombre: 'Bodega Centro', favorita: false },
          ],
        },
        isPending: false,
      });
      await abrir();

      const opciones = opcionesDeEntregarEn();
      // 🔴 LA ÚLTIMA. Mezclada entre las direcciones reales se elegiría por error —y "elegir por
      // error" aquí significa abrir un alta en medio de una compra—.
      expect(opciones.at(-1)).toBe(screen.getByTestId('exp-alta-direccion'));
      // Y con una raya que la separa, que además NO se puede elegir (no es un destino de entrega).
      const separador = screen.getByTestId('exp-separador-direccion');
      expect(opciones.at(-2)).toBe(separador);
      expect(separador).toBeDisabled();
      // Delante, las direcciones reales en su orden (con el hueco de "elige una" al principio).
      expect(opciones.slice(0, -2).map((o) => o.value)).toEqual(['', '7', '8']);

      // 🔴 **Y NO HAY ADEMÁS UN BOTÓN SUELTO.** Es literalmente lo que Daniel mandó quitar (*"no
      // tiene caso tener un botón para eso"*): si vuelve, la barra recupera el peso visual que se
      // le quitó a un caso excepcional, y esto se pone rojo.
      expect(screen.getByTestId('exp-alta-direccion').tagName).toBe('OPTION');
      const botonesDeDireccion = screen
        .queryAllByRole('button')
        .filter((b) => /direcci[oó]n/i.test(b.textContent ?? ''));
      expect(botonesDeDireccion).toEqual([]);
    });

    /**
     * 🔴 **Y CON EL CATÁLOGO VACÍO TAMBIÉN** — es justo cuando más se necesita: esconder la única
     * puerta detrás de una lista sin elementos dejaría al comprador sin salida (el defecto que
     * §Post-F9.96 vino a cerrar, sólo que por otra puerta).
     */
    it('🔴 con el catálogo VACÍO la opción SIGUE ahí, y de verdad abre el alta', async () => {
      useDireccionesMock.mockReturnValue({ data: { datos: [] }, isPending: false });
      await abrir();

      expect(opcionesDeEntregarEn().at(-1)).toBe(screen.getByTestId('exp-alta-direccion'));
      // No hay ninguna dirección real de la que separarla: la raya sobraría.
      expect(screen.queryByTestId('exp-separador-direccion')).toBeNull();

      // …y no es una opción decorativa: abre el MISMO diálogo del catálogo.
      const usuario = userEvent.setup();
      await abrirElAltaDeDireccion(usuario);
      expect(screen.getByLabelText(/nombre corto/i)).toBeInTheDocument();
    });

    /**
     * 🔴 **ELEGIR EL ALTA NO ES ELEGIR UNA DIRECCIÓN.** La opción vale `'nueva'`, que no es un id:
     * si la pantalla la tratara como los demás valores, `Number('nueva')` sería `NaN` y ese `NaN`
     * viajaría como `idDireccionEntrega` — exactamente la clase de dato inventado que §Post-F9.86
     * prohíbe. Aquí se mira que la elegida de antes se queda intacta.
     */
    it('🔴 abrir el alta NO cambia la dirección elegida (ni inventa un id)', async () => {
      useDireccionesMock.mockReturnValue({
        data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
        isPending: false,
      });
      await abrir();
      const usuario = userEvent.setup();

      await abrirElAltaDeDireccion(usuario);
      // El desplegable no se quedó mostrando «＋ Nueva…»: sigue en la que estaba. (Con un `NaN`
      // guardado, `direccionEfectiva` no casaría con ninguna opción y esto valdría `''`.)
      expect(screen.getByTestId('exp-direccion-entrega')).toHaveValue('7');
    });
  });

  /**
   * ⭐⭐⭐ **V1-E4f (§Post-F9.103) — LA FECHA DE ENTREGA, A FUERZAS.** Daniel: *"la de entrega no
   * debería de poder estar vacía. **Tiene que tener fecha de entrega a fuerzas**"*. Una OC sin fecha
   * dice *qué* y *cuánto* pero no *cuándo*: no le pide nada al proveedor, no hay compromiso que
   * reclamar ni retraso que medir.
   *
   * Se reclama con la MISMA forma que la dirección (§Post-F9.96) a propósito —instrucción gris al
   * abrir, amarillo sólo al intentar generar—: Daniel pidió que *"las dos se comporten igual y nadie
   * tenga que aprender dos reglas"*.
   */
  describe('V1-E4f (§Post-F9.103): la fecha de entrega, a fuerzas', () => {
    /** La misma explosión, pero con las OP SIN fecha de entrega (como las que vienen de Access). */
    function sinFechaEnLasOp() {
      const base = explosionDePrueba();
      return {
        ...base,
        ordenes: base.ordenes.map((o) => ({ ...o, fechaEntrega: null as string | null })),
      };
    }

    it('⭐⭐ instrucción al abrir, amarillo AL INTENTAR AVANZAR, y la petición NO sale', async () => {
      await abrir(sinFechaEnLasOp());

      const antes = screen.getByTestId('exp-falta-fecha');
      expect(antes).toHaveAttribute('data-tono', 'instruccion');
      expect(claseAmarilla(antes)).toBe(false);
      // Dice DE QUIÉN es la OC que nacería sin fecha…
      expect(antes).toHaveTextContent('«Avíos Baratos»');
      // …y 🔴 NO nombra al grupo sin proveedor: de ése no sale ninguna OC, pedirle fecha sería
      // bloquear la compra por un documento que no existe.
      expect(antes).not.toHaveTextContent('Sin proveedor sugerido');

      const usuario = userEvent.setup();
      await usuario.click(screen.getByTestId('exp-generar-oc'));

      // 🔴 Bloquear se sigue bloqueando: NO salió la petición del plan.
      expect(previoMutateMock).not.toHaveBeenCalled();
      const despues = screen.getByTestId('exp-falta-fecha');
      expect(despues).toHaveAttribute('data-tono', 'aviso');
      expect(claseAmarilla(despues)).toBe(true);
      expect(despues).toHaveTextContent('No se pueden generar las OC todavía');
      // Y el foco se va al campo donde se llena, no a buscarlo.
      expect(screen.getByTestId('exp-fecha-entrega')).toHaveFocus();

      // Al capturarla, el reclamo se va y la compra sigue su camino.
      fireEvent.change(screen.getByTestId('exp-fecha-entrega'), {
        target: { value: '2026-10-15' },
      });
      expect(screen.queryByTestId('exp-falta-fecha')).toBeNull();
      await usuario.click(screen.getByTestId('exp-generar-oc'));
      expect(previoMutateMock).toHaveBeenCalledOnce();
    });

    /**
     * ⭐ **LO OBLIGATORIO ES QUE CADA OC TENGA FECHA, NO QUE SE LLENE EL CAMPO DE ARRIBA**
     * (§Post-F9.71: la de arriba es el *valor inicial de todas* y la del proveedor GANA). Pedir el
     * campo de arriba sería reclamar un dato que ya está capturado.
     */
    it('⭐ la fecha PROPIA del proveedor basta: no se pide la de arriba', async () => {
      await abrir(sinFechaEnLasOp());
      expect(screen.getByTestId('exp-falta-fecha')).toBeInTheDocument();

      fireEvent.change(screen.getAllByTestId('exp-fecha-grupo')[0] as HTMLElement, {
        target: { value: '2026-11-30' },
      });
      expect(screen.queryByTestId('exp-falta-fecha')).toBeNull();

      const usuario = userEvent.setup();
      await usuario.click(screen.getByTestId('exp-generar-oc'));
      expect(previoMutateMock).toHaveBeenCalledOnce();
    });

    /**
     * 🔴🔴🔴 **LA PRUEBA DE V1-E7f (§Post-F9.120) — LA OP *CON* FECHA NO EXIME DE CAPTURARLA.**
     *
     * Es EXACTAMENTE el caso de Daniel: su orden 7970 **sí** traía fecha de entrega, y por eso la
     * OC de tela nació con ella («*tomó la fecha de entrega de la OC del cliente*»). Esa fecha es
     * cuándo se le entrega al CLIENTE; la de la OC es cuándo tiene que llegar la TELA — pedirle al
     * proveedor la materia prima el día de la entrega final es imposible por definición.
     *
     * Hasta hoy esta misma prueba afirmaba lo contrario (*"la OC la hereda"*) y pasaba: la pantalla
     * se callaba y la petición salía. Ahora reclama, y **la petición NO sale**. Si alguien devuelve
     * el respaldo —aquí o en `ocSinFechaDeEntrega`—, esto se pone rojo por los dos lados.
     */
    it('🔴🔴🔴 con la fecha en las OP se reclama IGUAL: la OC no la hereda (§Post-F9.120)', async () => {
      // `explosionDePrueba()` trae las OP CON fecha de entrega (el caso de la 7970).
      await abrir(explosionDePrueba());

      const aviso = screen.getByTestId('exp-falta-fecha');
      expect(aviso).toHaveTextContent('«Avíos Baratos»');
      expect(aviso).toHaveTextContent('No se hereda de la orden de producción');

      const usuario = userEvent.setup();
      await usuario.click(screen.getByTestId('exp-generar-oc'));
      expect(previoMutateMock).not.toHaveBeenCalled();

      // Y capturándola —lo único que ahora la resuelve— la compra sigue su camino.
      fireEvent.change(screen.getByTestId('exp-fecha-entrega'), {
        target: { value: '2026-10-15' },
      });
      expect(screen.queryByTestId('exp-falta-fecha')).toBeNull();
      await usuario.click(screen.getByTestId('exp-generar-oc'));
      expect(previoMutateMock).toHaveBeenCalledOnce();
    });

    /**
     * 🔴 **NUNCA BLOQUEAR DE MÁS.** La pantalla no puede reproducir el plan del servidor, así que
     * se le pide lo contrario de la precisión: que **jamás pida una fecha para una OC que no va a
     * nacer**. Si de un grupo no sale nada comprable —aquí, un pendiente por debajo del mínimo que
     * una línea puede guardar— no hay documento del que reclamar el *cuándo*.
     */
    it('🔴 un grupo del que NO sale ninguna línea no reclama fecha', async () => {
      const base = sinFechaEnLasOp();
      await abrir({
        ...base,
        grupos: base.grupos.map((g) => ({
          ...g,
          renglones: g.renglones.map((r) => ({ ...r, cantidadPendiente: 0 })),
        })),
      });
      expect(screen.queryByTestId('exp-falta-fecha')).toBeNull();
    });

    /**
     * 🔴🔴 **LO MARCADO MANDA: no se pide fecha por una OC que el comprador dejó fuera.** La
     * pantalla deja comprar sólo unos renglones, y una compra parcial perfectamente válida no puede
     * quedar frenada por el *cuándo* de un proveedor al que no se le está comprando nada. Es la
     * misma regla que el servidor ya aplica (`resolverFechasDeOc` ignora a los que no compran): si
     * alguien quita el filtro de la selección, la pantalla bloquearía de MÁS — el único error que
     * esta comprobación no se puede permitir.
     */
    it('🔴🔴 con renglones MARCADOS, sólo se reclama la fecha de las OC que de verdad salen', async () => {
      // Un SEGUNDO proveedor con material comprable, calcado del primero (así la única diferencia
      // entre los dos grupos es a quién se le compra — que es lo que la prueba mide).
      const base = sinFechaEnLasOp();
      const otroProveedor = base.grupos
        .filter((g) => g.idProveedor !== null)
        .map((g) => ({
          ...g,
          idProveedor: 22,
          proveedor: 'Cierres del Sur',
          renglones: g.renglones.map((r) => ({
            ...r,
            id: 4,
            material: 'CIE-53 — Cierre 53 cm',
            idProveedorSugerido: 22,
            proveedorSugerido: 'Cierres del Sur',
            idsRequerimiento: [4],
          })),
        }));
      await abrir({ ...base, grupos: [...base.grupos, ...otroProveedor] });

      // Sin marcar nada, la compra es de los DOS: se reclaman las dos fechas.
      const todos = screen.getByTestId('exp-falta-fecha');
      expect(todos).toHaveTextContent('«Avíos Baratos»');
      expect(todos).toHaveTextContent('«Cierres del Sur»');

      // Se marca SÓLO el botón (el primer renglón comprable, el de Avíos Baratos).
      const usuario = userEvent.setup();
      await usuario.click(screen.getAllByTestId('exp-renglon-check')[0] as HTMLElement);

      const soloUno = screen.getByTestId('exp-falta-fecha');
      expect(soloUno).toHaveTextContent('«Avíos Baratos»');
      // 🔴 Del que quedó fuera NO se pide nada: de él no va a nacer ninguna OC.
      expect(soloUno).not.toHaveTextContent('Cierres del Sur');
    });

    /** El botón que ya no se apaga tiene que DECIR qué falta (la lección de M11 en V1-E4d). */
    it('🔴 el botón dice que falta la FECHA, aunque no se apague', async () => {
      await abrir(sinFechaEnLasOp());
      const boton = screen.getByTestId('exp-generar-oc');
      expect(boton).toBeEnabled();
      expect(boton).toHaveAttribute('title', expect.stringContaining('fecha de entrega'));
    });

    /**
     * 🔴 **LOS DOS QUE FALTAN SE DICEN DE UN GOLPE, no en cascada.** Con la fecha y la dirección
     * vacías, un `return` temprano dejaría la segunda en gris: el comprador arreglaría una, daría
     * otro clic y se encontraría un amarillo NUEVO — el regaño por entregas que §Post-F9.96 vino a
     * quitar.
     */
    it('🔴 sin fecha NI dirección, las DOS se ponen amarillas en el mismo clic', async () => {
      useDireccionesMock.mockReturnValue({
        data: {
          datos: [
            { id: 7, nombre: 'Naucalpan', favorita: false },
            { id: 8, nombre: 'Bodega Centro', favorita: false },
          ],
        },
        isPending: false,
      });
      await abrir(sinFechaEnLasOp());

      const usuario = userEvent.setup();
      await usuario.click(screen.getByTestId('exp-generar-oc'));

      expect(previoMutateMock).not.toHaveBeenCalled();
      expect(screen.getByTestId('exp-falta-fecha')).toHaveAttribute('data-tono', 'aviso');
      expect(screen.getByTestId('exp-falta-direccion')).toHaveAttribute('data-tono', 'aviso');
      // El foco va al PRIMERO que falta en el orden de la barra: la fecha.
      expect(screen.getByTestId('exp-fecha-entrega')).toHaveFocus();
    });

    /**
     * 🔴 **EL AMARILLO SE APAGA CUANDO SE ARREGLA, Y NO REAPARECE DE GOLPE** (M12/M13 de V1-E4d,
     * gemelo exacto para la fecha): quien la captura y luego cambia de idea y la vacía no puede
     * encontrarse el amarillo sin haber intentado nada.
     */
    it('🔴 capturada la fecha y vuelta a vaciar, el mensaje vuelve GRIS (no amarillo)', async () => {
      await abrir(sinFechaEnLasOp());
      const usuario = userEvent.setup();

      await usuario.click(screen.getByTestId('exp-generar-oc'));
      expect(screen.getByTestId('exp-falta-fecha')).toHaveAttribute('data-tono', 'aviso');

      const campo = screen.getByTestId('exp-fecha-entrega');
      fireEvent.change(campo, { target: { value: '2026-10-15' } });
      fireEvent.change(campo, { target: { value: '' } });

      const otraVez = screen.getByTestId('exp-falta-fecha');
      expect(otraVez).toHaveAttribute('data-tono', 'instruccion');
      expect(claseAmarilla(otraVez)).toBe(false);
    });
  });
});

/**
 * ⭐⭐ **V1-E4f — `ocPlaneadasEnPantalla`, VISTA DE FRENTE** (ronda de corrección del reviewer).
 *
 * Las pruebas de arriba la ejercitan **a través de la pantalla**, y ahí sus dos guardas del "sin
 * proveedor" son **indistinguibles**: el reviewer midió que neutralizar cualquiera de las dos por
 * separado deja las pruebas del archivo en VERDE, y sólo neutralizando **las dos a la vez** se
 * ponen rojas. No es un defecto —con los datos del servidor una guarda implica la otra, porque
 * `agruparPorProveedor` agrupa JUSTO por `idProveedorSugerido`—, pero el comentario 🔴 del código
 * afirmaba dos reglas y las pruebas sólo fijaban su conjunción.
 *
 * Aquí se fija **cada una por su lado**, llamando a la función pura con la forma incoherente que el
 * tipo permite y el servidor de hoy no produce. Es a propósito: lo que se está fijando es que la
 * pantalla **no pida una fecha por una OC que no existe** aunque el agrupador de allá cambie.
 */
describe('ocPlaneadasEnPantalla — V1-E4f: cada guarda del "sin proveedor", por separado', () => {
  /** Un renglón comprable, con lo mínimo que la función mira. */
  function renglon(idProveedorSugerido: number | null, extra?: { cantidadPendiente?: number }) {
    return {
      idProveedorSugerido,
      cantidadPendiente: extra?.cantidadPendiente ?? 180,
      idsRequerimiento: [1],
    };
  }

  it('el caso sano: un grupo coherente SÍ planea su OC', () => {
    expect(
      ocPlaneadasEnPantalla(
        [{ idProveedor: 11, proveedor: 'Avíos Baratos', renglones: [renglon(11)] }],
        new Set(),
      ),
    ).toEqual([{ idProveedor: 11, proveedor: 'Avíos Baratos' }]);
  });

  /**
   * 🔴 **GUARDA 1, sola**: el grupo dice `idProveedor: null` aunque su renglón traiga proveedor. Sin
   * `if (idProveedor === null) continue;` esto empujaría una OC planeada **con proveedor `null`** —
   * un documento que no existe, pidiendo fecha.
   */
  it('🔴 guarda del GRUPO: `idProveedor: null` no planea nada, aunque el renglón traiga proveedor', () => {
    expect(
      ocPlaneadasEnPantalla(
        [{ idProveedor: null, proveedor: 'Sin proveedor sugerido', renglones: [renglon(11)] }],
        new Set(),
      ),
    ).toEqual([]);
  });

  /**
   * 🔴 **GUARDA 2, sola**: el grupo tiene proveedor pero su único renglón no. Sin
   * `r.idProveedorSugerido !== null` ese renglón entraría y el grupo planearía una OC que no va a
   * nacer: el servidor descarta el renglón sin proveedor antes de agrupar.
   */
  it('🔴 guarda del RENGLÓN: un renglón sin proveedor no planea OC, aunque su grupo tenga uno', () => {
    expect(
      ocPlaneadasEnPantalla(
        [{ idProveedor: 11, proveedor: 'Avíos Baratos', renglones: [renglon(null)] }],
        new Set(),
      ),
    ).toEqual([]);
  });

  /**
   * 🔴🔴 **LA FRONTERA DEL FILTRO ES `>=`, Y ESO ES LA INVARIANTE — NO UN DETALLE** (2ª vuelta del
   * reviewer: mutar `>=` a `>` dejaba el archivo entero en verde).
   *
   * `0.01` **sí se guarda**: es exactamente lo mínimo que cabe en la columna, así que ese renglón SÍ
   * genera línea y su OC SÍ necesita fecha. Con `>` el grupo entero se caería del plan y la pantalla
   * **se callaría mientras el servidor pide la fecha** — y desde V1-E7f (§Post-F9.120), que nada se
   * hereda, callarse es exactamente el peor de los dos mundos: el comprador ve todo en orden y se
   * come el rechazo tres clics después.
   *
   * ⚠️ **Y un resto de un centavo es la forma NORMAL de estos datos**, no un caso de laboratorio:
   * el comentario de `mrp.ts` (busca *"3.7020"*) describe justo esa aritmética — un requerido largo
   * contra una línea ya guardada a 2 decimales deja pendientes de esa talla todo el tiempo.
   *
   * ⚠️ Esta prueba fijaba antes el corte por OP (`porOrden`), que existía para el respaldo y murió
   * con él; se re-apuntó al ÚNICO `>=` que queda —el del renglón—, que hasta hoy el código declaraba
   * *"no fijado por prueba"*.
   */
  it('🔴🔴 un renglón con pendiente de EXACTAMENTE 0.01 SÍ planea su OC (y por tanto pide fecha)', () => {
    expect(
      ocPlaneadasEnPantalla(
        [
          {
            idProveedor: 11,
            proveedor: 'Avíos Baratos',
            renglones: [renglon(11, { cantidadPendiente: 0.01 })],
          },
        ],
        new Set(),
      ),
    ).toEqual([{ idProveedor: 11, proveedor: 'Avíos Baratos' }]);
  });
});
