import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ReactRouterDom from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListaLinea } from '@/api/listas-precios';
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
/** V1-E8t: la puerta «Ir a Pre-costeos» del vacío navega; se captura a dónde. */
const navegar = vi.fn();
vi.mock('react-router-dom', async (importarOriginal) => {
  const real = await importarOriginal<typeof ReactRouterDom>();
  return { ...real, useNavigate: () => navegar };
});

const quitarMutate = vi.fn();
const estadoRenglonMutate = vi.fn();
const targetMutate = vi.fn();
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
  // V1-E8f: la consulta devuelve candidatos Y descartados; el doble copia esa forma (un doble con
  // la forma vieja probaría la suposición, no el sistema).
  useCandidatosLista: () => ({
    data: { datos: [], descartados: [], faltanFactores: false },
    isPending: false,
    isError: false,
  }),
  useCrearLista: () => ({ mutate: vi.fn(), isPending: false }),
  useEditarFactoresLista: () => ({ mutate: vi.fn(), isPending: false }),
  // ⭐ V1-E8w (§Post-F9.150): el TARGET del cliente lo captura Aurora desde este renglón.
  useFijarPrecioTarget: () => ({ mutate: targetMutate, isPending: false }),
  // ⭐ V1-E8y (§Post-F9.152) — la mesa abierta: agregar renglones, el encabezado de la cita y los
  // pendientes por modelo. Inertes aquí; cada pieza tiene su propia prueba.
  useAgregarLineasLista: () => ({ mutate: vi.fn(), isPending: false }),
  useEditarEncabezadoLista: () => ({ mutate: vi.fn(), isPending: false }),
  useCrearModeloEnLista: () => ({ mutate: vi.fn(), isPending: false }),
  useCrearPendiente: () => ({ mutate: vi.fn(), isPending: false }),
  useEditarPendiente: () => ({ mutate: vi.fn(), isPending: false }),
  useEliminarPendiente: () => ({ mutate: vi.fn(), isPending: false }),
  imprimirListaPdf: vi.fn(),
  descargarListaExcel: vi.fn(),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isPending: false, isFetching: false }),
  useDepartamentosCliente: () => ({ data: [], isPending: false }),
  // ⭐ V1-E8y: el diálogo de agregar modelos lee al CLIENTE para avisar, antes de teclear nada, si
  // le falta la abreviatura (sin ella el código del modelo no se puede armar). Con `undefined` el
  // aviso no se pinta, que es la rama neutra para las pruebas de esta página.
  useCliente: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/api/estados-lista', () => ({
  // ⚠️ Con UN estado, el chip existe y se puede pulsar: eso es lo que enciende el filtro DE
  // SERVIDOR y permite distinguir las dos ramas del vacío (V1-E8f, ronda de corrección).
  useEstadosLista: () => ({
    data: { datos: [{ id: 1, codigo: 'abierta', nombre: 'Abierta', orden: 1, activo: true }] },
    isPending: false,
  }),
}));
vi.mock('@/api/negociacion', () => ({
  useEventosLinea: () => ({ data: [], isPending: false, isError: false }),
  useRegistrarRonda: () => ({ mutate: vi.fn(), isPending: false }),
  useRegistrarAcuerdo: () => ({ mutate: vi.fn(), isPending: false }),
  useSimularNegociacion: () => ({ data: undefined, isPending: false }),
  useCambiarEstadoLista: () => ({ mutate: vi.fn(), isPending: false }),
  // ⭐ V1-E8x (§Post-F9.151): el estado del MODELO dentro de la lista.
  useCambiarEstadoRenglon: () => ({ mutate: estadoRenglonMutate, isPending: false }),
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
  // ⭐ V1-E8y: el LUGAR de la cita (§Post-F9.152). `as string | null` para que las variantes lo
  // puedan encender.
  lugar: null as string | null,
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
      // ⭐ V1-E8x: anotado (como `avisoCostoViejo`) para que las variantes puedan encender la
      // aprobación; sin la anotación TypeScript infiere el literal `null` y no compilan.
      precioAprobado: null as number | null,
      aprobado: false,
      aprobadoPorId: null as string | null,
      aprobadoEn: null as string | null,
      // V1-E8d: `as string | null` para que el fixture admita encenderlo (`listaConAviso`); sin la
      // anotación TypeScript infiere el literal `null` y la variante no compila.
      avisoCostoViejo: null as string | null,
      // ⭐ V1-E8w (§Post-F9.150): el TARGET del cliente. Mismo truco de anotación que el aviso, para
      // que `listaConTarget` pueda encenderlo. Por defecto NO lo dio ("si es que nos lo dio").
      precioTarget: null as number | null,
      tieneTarget: false,
      // ⭐ V1-E8x (§Post-F9.151): el estado del MODELO. `as` para que las variantes puedan moverlo
      // (si no, TypeScript infiere el literal y `listaConEstado` no compila).
      estado: 'abierto' as ListaLinea['estado'],
      nombreEstado: 'Abierto',
      estadoPorId: null as string | null,
      estadoEn: null as string | null,
      // ⭐ V1-E8y: los PENDIENTES del modelo (la libreta de la cita). Anotados para que las
      // variantes puedan poblarlos.
      pendientes: [] as ListaLinea['pendientes'],
    },
  ],
  creadoEn: '2026-08-10T10:00:00.000Z',
  modificadoEn: '2026-08-10T10:00:00.000Z',
};

const PERM: ClavePermiso[] = ['listas.ver', 'listas.administrar', 'consultas.ver-importes'];

/**
 * Abre el drill-in del detalle de la lista (la pantalla arranca en el listado).
 *
 * `lista` permite variar el detalle sin tocar el fixture compartido (V1-E8d lo usa para encender el
 * aviso de costo viejo en un renglón).
 */
async function abrirDetalle(
  permisos: ClavePermiso[] = PERM,
  lista: typeof LISTA = LISTA,
): Promise<void> {
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
        renglonesDropeados: 0,
        renglonesAprobados: 0,
        creadoEn: LISTA.creadoEn,
      },
    ],
    isPending: false,
    isError: false,
    error: null,
  });
  useListaPreciosMock.mockReturnValue({
    data: lista,
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

  // ⭐ V1-E8b (§Post-F9.125) — LOS TRES CANDADOS DE ESTA PANTALLA.
  //
  // Los levantó el reviewer, no el barrido: los tres se podían revertir con la suite en VERDE. La
  // frontera de seguridad es el servidor y está probada aparte —si el panel se revirtiera, Aurora
  // vería cuatro guiones, no el margen—, pero el botón de editar es exactamente «un botón que falla
  // al pulsarlo», y la pantalla gemela del Cliente sí recibió sus pruebas en esta misma etapa: la
  // cobertura había quedado asimétrica DENTRO del entregable.

  it('⭐ los CUATRO factores y su botón son SÓLO del dueño: a Aurora ni se le pintan', async () => {
    // Aurora = Gerencial: administra y negocia listas y ve importes, pero NO aprueba.
    await abrirDetalle([
      'listas.ver',
      'listas.administrar',
      'listas.negociar',
      'consultas.ver-importes',
    ] as ClavePermiso[]);

    // Ni el panel de lectura...
    expect(screen.queryByText('Margen')).not.toBeInTheDocument();
    expect(screen.queryByText('Descuentos')).not.toBeInTheDocument();
    expect(screen.queryByText('Regalías')).not.toBeInTheDocument();
    expect(screen.queryByText('Costo de ventas')).not.toBeInTheDocument();
    // ...ni el botón que abriría el editor (el servidor lo rechazaría con 403).
    expect(screen.queryByTestId('editar-factores-lista')).not.toBeInTheDocument();
  });

  it('⭐ al DUEÑO sí se le pintan los cuatro, con su botón', async () => {
    await abrirDetalle([
      'listas.ver',
      'listas.administrar',
      'listas.aprobar',
      'consultas.ver-importes',
    ] as ClavePermiso[]);

    expect(screen.getByText('Margen')).toBeInTheDocument();
    expect(screen.getByText('Costo de ventas')).toBeInTheDocument();
    expect(screen.getByTestId('editar-factores-lista')).toBeInTheDocument();
  });

  it('⭐ sin TODOS los renglones aprobados, ni el PDF ni el Excel se pueden bajar', async () => {
    // El renglón del fixture tiene `precioAprobado: null` ⇒ la lista NO está completa.
    // Daniel: "si no está aprobado no debería de poder bajar ni un borrador porque puede confundir
    // al cliente". El servidor los rechaza con 409; aquí se comprueba que la pantalla no ofrece un
    // botón que va a fallar.
    await abrirDetalle();

    expect(screen.getByTestId('descargar-lista-pdf')).toBeDisabled();
    expect(screen.getByTestId('descargar-lista-excel')).toBeDisabled();
  });
});

// ── ⭐ V1-E8d (§Post-F9.127): EL AVISO DE COSTO VIEJO LLEGA A LA PANTALLA ──────────────
//
// Daniel: *"Si. Ok. **Que me avise.**"* La cicatriz de este proyecto es *"la frase del servidor
// nunca llega a la pantalla"*, así que lo que se prueba aquí NO es que exista un símbolo: es que la
// FRASE COMPLETA —qué parte de la receta cambió y cuándo— se pinta pegada a su renglón.
//
// El criterio de CUÁNDO avisar no vive aquí (es del servidor, `dominio/desarrollo/costo-viejo.ts`,
// probado en `costo-viejo.test.ts`): la pantalla sólo obedece al campo `avisoCostoViejo`.

const AVISO =
  'Cambió las TELAS de este modelo el 27/8/2026, DESPUÉS de congelarse el costo con el que está ' +
  'calculado (v3, del 20/8/2026). El precio APROBADO sigue en pie sobre ese costo.';

/** El mismo detalle, con el renglón marcado (o no) con el aviso de costo viejo. */
function listaConAviso(aviso: string | null): typeof LISTA {
  return { ...LISTA, lineas: LISTA.lineas.map((ln) => ({ ...ln, avisoCostoViejo: aviso })) };
}

/** Abre el detalle con el renglón marcado (o no) con el aviso de costo viejo. */
async function abrirDetalleConAviso(
  aviso: string | null,
  permisos: ClavePermiso[] = PERM,
): Promise<void> {
  await abrirDetalle(permisos, listaConAviso(aviso));
}

describe('⭐ V1-E8d — el aviso de costo viejo se VE donde se aprueban los precios', () => {
  beforeEach(() => {
    useListaPreciosMock.mockReset();
    useListasPreciosMock.mockReset();
  });

  it('⭐ pinta la FRASE ENTERA del servidor, no un símbolo mudo', async () => {
    await abrirDetalleConAviso(AVISO);

    const fila = await screen.findByTestId('aviso-costo-viejo');
    // El QUÉ y el CUÁNDO, que es lo que le sirve a quien decide si recostea.
    expect(fila).toHaveTextContent(/las TELAS/);
    expect(fila).toHaveTextContent(/27\/8\/2026/);
    expect(fila).toHaveTextContent(/v3, del 20\/8\/2026/);
    // Y de qué renglón habla.
    expect(fila).toHaveTextContent(/KM-114/);
  });

  it('el resumen de arriba dice CUÁNTOS y CUÁLES', async () => {
    await abrirDetalleConAviso(AVISO);

    const resumen = await screen.findByTestId('aviso-costo-viejo-resumen');
    expect(resumen).toHaveTextContent(/receta vieja/i);
    expect(resumen).toHaveTextContent(/KM-114/);
  });

  it('el chip permite cazarlo de un vistazo en una lista larga', async () => {
    await abrirDetalleConAviso(AVISO);
    expect(await screen.findByTestId('chip-costo-viejo')).toHaveTextContent('Costo viejo');
  });

  it('⭐ sin aviso del servidor, la pantalla NO inventa ninguno', async () => {
    await abrirDetalleConAviso(null);

    expect(screen.queryByTestId('aviso-costo-viejo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('aviso-costo-viejo-resumen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chip-costo-viejo')).not.toBeInTheDocument();
  });

  it('⭐ es un AVISO, no un candado: el botón de aprobar sigue ahí', async () => {
    // Daniel pidió que le AVISE. Tumbar la firma o bloquear la aprobación sería MÁS de lo que
    // pidió, y es decisión suya, no del código (§Post-F9.127).
    await abrirDetalleConAviso(AVISO, [
      'listas.ver',
      'listas.administrar',
      'listas.aprobar',
      'consultas.ver-importes',
    ] as ClavePermiso[]);

    expect(screen.getByTestId('aprobar-renglon')).toBeEnabled();
  });
});

describe('⭐ V1-E8f — el vacío distingue «no hay ninguna» de «no hay ninguna AQUÍ»', () => {
  // 🔴 Estas dos nacieron de un hallazgo del reviewer, y duele: la primera redacción decidía con
  // `listas.length === 0`, pero esa lista YA VIENE FILTRADA POR EL SERVIDOR. Filtrar por un estado
  // sin listas contestaba *"todavía no hay ninguna… ve a congelar precostos"* — mandando a arreglar
  // algo que no está roto.
  //
  // Es el muro de Daniel construido OTRA VEZ, tres pantallas más allá, DENTRO de la etapa que
  // existe para cerrarlo. Por eso lleva prueba por rama: la afirmación de la ficha decía que se
  // distinguían y ninguna prueba lo tocaba.
  beforeEach(() => {
    useListasPreciosMock.mockReset();
    useListaPreciosMock.mockReset();
  });

  function renderVacio(): void {
    useListasPreciosMock.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      error: null,
    });
    useListaPreciosMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<ListasPreciosPagina />, { sesion: estadoSesionDePrueba(PERM) });
  }

  it('SIN filtro puesto: dice que no hay ninguna y explica cómo se arma una', () => {
    renderVacio();
    expect(screen.getByTestId('lista-precios-vacio')).toHaveTextContent(
      /Todavía no hay ninguna lista de precios/i,
    );
  });

  /**
   * ⭐ V1-E8t (§Post-F9.145) — el vacío NOMBRABA el lugar («Desarrollo › Pre-costeos») y dejaba al
   * usuario buscarlo en el menú. Ahora lleva, con la MISMA puerta y la MISMA medida que el diálogo
   * de crear lista (`puerta-precosteos.ts`).
   */
  it('con `desarrollo.ver` el vacío ofrece la puerta y lleva a Pre-costeos', async () => {
    const usuario = userEvent.setup();
    navegar.mockClear();
    useListasPreciosMock.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      error: null,
    });
    useListaPreciosMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<ListasPreciosPagina />, {
      sesion: estadoSesionDePrueba([...PERM, 'desarrollo.ver']),
    });

    await usuario.click(screen.getByTestId('ir-a-precosteos-desde-vacio'));
    expect(navegar).toHaveBeenCalledWith('/desarrollo');
  });

  it('SIN `desarrollo.ver` no se pinta la puerta (no se manda a donde no se puede entrar)', () => {
    renderVacio();
    expect(screen.queryByTestId('ir-a-precosteos-desde-vacio')).not.toBeInTheDocument();
  });

  it('🔴 CON un filtro puesto: NO manda a congelar precostos — dice que no coincide', async () => {
    const usuario = userEvent.setup();
    renderVacio();

    // Encender el filtro de ESTADO: a partir de aquí, el cero es del filtro, no del universo.
    await usuario.click(screen.getByText('Abierta'));

    const vacio = screen.getByTestId('lista-precios-vacio');
    expect(vacio).toHaveTextContent(/no coincidan|no hay listas de precios que coincidan/i);
    // 🔴 Lo que la pone roja si alguien revierte el arreglo: el texto que manda a Desarrollo.
    expect(vacio).not.toHaveTextContent(/congélalos en Desarrollo/i);
  });
});

// ── ⭐ V1-E8w (§Post-F9.150): EL TARGET PRICE DEL CLIENTE, EN LA LISTA ────────────────
//
// Daniel: *«aveces los clientes nos dan sus target prices…. y es importante saberlo a la hora de la
// negociacion. Eso lo debe de poner Aurora desde que hace la lista de precios… Debe de tener un
// liugar para poner el target que le dio el cliente si es que nos lo dio.»*
//
// 🔴 Se prueba **A NIVEL DE RENDER**, que es donde viviría el defecto: la etapa agregó la columna,
// su botón y su diálogo, y lo único nuevo en esta suite era el mock —`targetMutate` se declaraba y
// no se aseveraba nunca—. Se copia la forma del precedente de arriba («los CUATRO factores… a
// Aurora ni se le pintan»): la frontera de seguridad es el servidor y está probada aparte, pero un
// botón que no debería estar, o un número que se enseña a quien no puede ver dinero, sólo se cazan
// pintando la pantalla.

describe('⭐ V1-E8w — el TARGET del cliente: columna, candados y captura', () => {
  beforeEach(() => {
    targetMutate.mockReset();
    useListaPreciosMock.mockReset();
    useListasPreciosMock.mockReset();
  });

  /** El mismo detalle, con el renglón trayendo (o no) el target que dio el cliente. */
  function listaConTarget(target: number | null): typeof LISTA {
    return {
      ...LISTA,
      lineas: LISTA.lineas.map((ln) => ({
        ...ln,
        precioTarget: target,
        tieneTarget: target !== null,
      })),
    };
  }

  it('con target y con `consultas.ver-importes`, la celda enseña el NÚMERO', async () => {
    await abrirDetalle(PERM, listaConTarget(130));

    expect(screen.getByTestId('target-cliente')).toHaveTextContent('$130.00');
  });

  /**
   * 🔴 El target ES dinero: sin `consultas.ver-importes` se dice que lo HAY —eso es una señal útil
   * para quien negocia— pero **nunca cuánto**. El servidor ya manda `precioTarget: null` con
   * `tieneTarget: true`; esto exige que la pantalla no invente el número por su cuenta.
   */
  it('🔴 sin `consultas.ver-importes` dice que HAY target, pero NO cuánto', async () => {
    await abrirDetalle(['listas.ver', 'listas.administrar'] as ClavePermiso[], listaConTarget(130));

    const celda = screen.getByTestId('target-cliente');
    expect(celda).toHaveTextContent('Sí');
    expect(celda).not.toHaveTextContent('130');
  });

  it('sin target se ve el hueco (que también es un dato: «no nos lo dio»)', async () => {
    await abrirDetalle(PERM, listaConTarget(null));

    expect(screen.getByTestId('target-cliente')).toHaveTextContent('—');
  });

  /**
   * 🔴 La captura es **de Aurora** (`listas.administrar`), no del dueño: el botón cuelga de la misma
   * puerta con la que se agrega y se quita un renglón. Quien sólo consulta VE el target y no puede
   * tocarlo — el servidor lo rechazaría con 403, y aquí se comprueba que no se ofrece un botón que
   * va a fallar.
   */
  it('🔴 sin `listas.administrar` el target se VE pero el botón de capturarlo ni se pinta', async () => {
    await abrirDetalle(
      ['listas.ver', 'consultas.ver-importes'] as ClavePermiso[],
      listaConTarget(130),
    );

    expect(screen.getByTestId('target-cliente')).toHaveTextContent('$130.00');
    expect(screen.queryByTestId('capturar-target')).not.toBeInTheDocument();
  });

  it('⭐ capturar el target manda EL VALOR tecleado al servidor', async () => {
    const usuario = userEvent.setup();
    await abrirDetalle(PERM, listaConTarget(null));

    await usuario.click(screen.getByTestId('capturar-target'));
    await usuario.type(await screen.findByTestId('input-target'), '250');
    await usuario.click(screen.getByTestId('guardar-target'));

    expect(targetMutate).toHaveBeenCalledWith(
      { idLinea: 91, cuerpo: { precioTarget: 250 } },
      expect.anything(),
    );
  });

  /**
   * 🔴 *"si es que nos lo dio"*: un target capturado por error no puede atrapar a nadie —en la mesa,
   * un target falso es peor que ninguno—, así que **se borra** (`precioTarget: null`). Y la puerta
   * de borrar sólo existe cuando hay algo que borrar.
   */
  it('🔴 «Borrar target» sólo aparece si HAY target, y borra con null', async () => {
    const usuario = userEvent.setup();
    await abrirDetalle(PERM, listaConTarget(130));

    await usuario.click(screen.getByTestId('capturar-target'));
    await usuario.click(await screen.findByTestId('borrar-target'));

    expect(targetMutate).toHaveBeenCalledWith(
      { idLinea: 91, cuerpo: { precioTarget: null } },
      expect.anything(),
    );
  });

  it('sin target, el diálogo NO ofrece borrar (no hay nada que borrar)', async () => {
    const usuario = userEvent.setup();
    await abrirDetalle(PERM, listaConTarget(null));

    await usuario.click(screen.getByTestId('capturar-target'));
    await screen.findByTestId('input-target');
    expect(screen.queryByTestId('borrar-target')).not.toBeInTheDocument();
  });
});

// ── ⭐⭐ V1-E8x (§Post-F9.151 / §Post-F9.155): LOS CUATRO ESTADOS DEL MODELO ──────────
//
// Daniel: *«seria bueno saber los modelos que ya cerre…. a veces de una lista de 10 modelos, cierro
// 5 y los otros ya no los vendo»* · *«Que empiece todo en "Abierto", y luego estan los otros 3
// estados. En negociacion, cerrado, dropeado. en total son 4 estados»*.
//
// Lo que se blinda en la PANTALLA (las reglas son del servidor y se prueban allá):
//  • 🔴 el chip del MODELO no se confunde con el de la LISTA («En negociación» es el mismo string);
//  • 🔴 un dropeado ya NO bloquea el PDF/Excel — era el defecto que rompía la versión;
//  • 🔴 y se DICE que no sale en el papel, en vez de que el usuario cuente modelos y no cuadre.

/**
 * Un detalle con DOS renglones: uno dropeado y SIN firmar (el que antes bloqueaba el papel para
 * siempre) y uno vigente ya aprobado. Es el escenario de Daniel en pequeño.
 */
function listaConVigenteYDropeado(): typeof LISTA {
  const base = LISTA.lineas[0];
  if (base === undefined) {
    throw new Error('El fixture LISTA perdió su renglón: la prueba ya no prueba lo que dice.');
  }
  return {
    ...LISTA,
    lineas: [
      { ...base, estado: 'dropeado', nombreEstado: 'Dropeado' },
      { ...base, id: 92, codigoModelo: 'KM-200', precioAprobado: 180, aprobado: true },
    ],
  };
}

/** El mismo detalle, con el renglón en el estado dado. */
function listaConEstado(
  estado: ListaLinea['estado'],
  extra: Partial<(typeof LISTA)['lineas'][number]> = {},
): typeof LISTA {
  return {
    ...LISTA,
    lineas: LISTA.lineas.map((ln) => ({
      ...ln,
      estado,
      nombreEstado:
        estado === 'dropeado'
          ? 'Dropeado'
          : estado === 'cerrado'
            ? 'Cerrado'
            : estado === 'en_negociacion'
              ? 'En negociación'
              : 'Abierto',
      ...extra,
    })),
  };
}

describe('⭐⭐ V1-E8x — el estado del MODELO dentro de la lista', () => {
  beforeEach(() => {
    estadoRenglonMutate.mockReset();
    useListaPreciosMock.mockReset();
    useListasPreciosMock.mockReset();
  });

  it('el renglón enseña su estado con el nombre que manda el servidor', async () => {
    await abrirDetalle(PERM, listaConEstado('en_negociacion'));
    const chip = screen.getByTestId('chip-estado-renglon');
    expect(chip).toHaveTextContent('En negociación');
    expect(chip).toHaveAttribute('data-estado', 'en_negociacion');
  });

  /**
   * 🔴 EL CHOQUE VISUAL. «En negociación» es el MISMO string en los dos ejes y los dos chips
   * conviven en esta pantalla. Se separan por tres cosas a la vez: el chip del renglón va con
   * CONTORNO (no relleno), la columna se llama «Estado del modelo», y cada chip dice en su `title`
   * de qué eje es. Si alguien igualara los dos, esto se pone rojo.
   */
  it('🔴 el chip del MODELO no se confunde con el de la LISTA: contorno, columna y title propios', async () => {
    // La lista está «Abierta»; el renglón, «En negociación» — los dos chips a la vez en pantalla.
    await abrirDetalle(PERM, listaConEstado('en_negociacion'));

    const chipRenglon = screen.getByTestId('chip-estado-renglon');
    expect(chipRenglon).toHaveAttribute(
      'title',
      'Estado del MODELO dentro de la lista: En negociación',
    );
    // Y con firma, el title dice DESDE CUÁNDO (la firma vigente del estado).
    expect(chipRenglon).not.toHaveAttribute('title', expect.stringContaining('desde'));
    // Contorno + fondo transparente: el de la lista va relleno.
    expect(chipRenglon.className).toContain('border');
    expect(chipRenglon.className).toContain('bg-transparent');
    // El encabezado de la columna NOMBRA el eje.
    expect(screen.getByText('Estado del modelo')).toBeInTheDocument();
    // Y el de la lista se identifica como el del documento.
    const chipLista = screen.getByTitle('Estado de la LISTA (el documento): Abierta');
    expect(chipLista).toBeInTheDocument();
    expect(chipLista.className).not.toContain('bg-transparent');
  });

  it('el chip dice DESDE CUÁNDO está en ese estado cuando hay firma', async () => {
    await abrirDetalle(
      PERM,
      listaConEstado('cerrado', { estadoEn: '2026-08-30T18:00:00.000Z', estadoPorId: 'daniel' }),
    );
    expect(screen.getByTestId('chip-estado-renglon').getAttribute('title')).toMatch(
      /Estado del MODELO dentro de la lista: Cerrado · desde .+/,
    );
  });

  it('con `listas.negociar` se puede mover el estado desde la fila, y manda el destino elegido', async () => {
    const usuario = userEvent.setup();
    await abrirDetalle([...PERM, 'listas.negociar'] as ClavePermiso[], listaConEstado('abierto'));

    await usuario.selectOptions(screen.getByTestId('estado-renglon'), 'dropeado');

    expect(estadoRenglonMutate).toHaveBeenCalledWith(
      { idLinea: 91, cuerpo: { estado: 'dropeado' } },
      expect.anything(),
    );
  });

  it('🔴 desde un modelo DROPEADO el selector sólo ofrece REVIVIR (espejo del servidor)', async () => {
    await abrirDetalle([...PERM, 'listas.negociar'] as ClavePermiso[], listaConEstado('dropeado'));

    const opciones = [...screen.getByTestId('estado-renglon').querySelectorAll('option')].map(
      (o) => o.value,
    );
    expect(opciones).toEqual(['', 'abierto', 'en_negociacion']);
    expect(opciones).not.toContain('cerrado');
  });

  it('sin `listas.negociar` el selector ni se pinta (no se ofrece lo que el servidor va a negar)', async () => {
    await abrirDetalle(PERM, listaConEstado('abierto'));
    expect(screen.queryByTestId('estado-renglon')).not.toBeInTheDocument();
    // Pero el chip sí: saber en qué va cada modelo no pide permiso de negociar.
    expect(screen.getByTestId('chip-estado-renglon')).toBeInTheDocument();
  });

  /**
   * 🔴🔴 EL DEFECTO QUE ROMPÍA LA VERSIÓN. Un dropeado nunca se va a aprobar; con el criterio viejo
   * («todos los renglones firmados») la lista se quedaba sin PDF, sin Excel y sin cotización PARA
   * SIEMPRE — justo el escenario con el que Daniel pidió los estados.
   */
  it('🔴 un DROPEADO sin firmar ya NO bloquea el PDF ni el Excel', async () => {
    // El renglón del fixture NO tiene precio aprobado (`precioAprobado: null`) y está dropeado ⇒
    // el papel sí puede salir… salvo que aquí no queda NINGÚN vigente. Se prueban los dos casos:
    // primero uno dropeado + uno vigente firmado.
    const dosRenglones = listaConVigenteYDropeado();
    await abrirDetalle(PERM, dosRenglones);

    expect(screen.getByTestId('descargar-lista-pdf')).toBeEnabled();
    expect(screen.getByTestId('descargar-lista-excel')).toBeEnabled();
  });

  it('🔴 y se DICE que el dropeado no sale en el papel (nombrándolo)', async () => {
    const dosRenglones = listaConVigenteYDropeado();
    await abrirDetalle(PERM, dosRenglones);

    const aviso = screen.getByTestId('aviso-dropeados');
    expect(aviso).toHaveTextContent('KM-114');
    expect(aviso).toHaveTextContent(/no sale/i);
    expect(aviso).toHaveTextContent(/PDF/);
    // Y dice el remedio, no sólo el hecho.
    expect(aviso).toHaveTextContent(/[Rr]evívelos/);
  });

  it('⚠️ CASO LÍMITE — con TODOS dropeados el papel se apaga y se explica por qué', async () => {
    await abrirDetalle(PERM, listaConEstado('dropeado', { precioAprobado: 150, aprobado: true }));

    expect(screen.getByTestId('descargar-lista-pdf')).toBeDisabled();
    const aviso = screen.getByTestId('aviso-sin-aprobar');
    expect(aviso).toHaveTextContent(/todos los modelos de la lista están dropeados/i);
    expect(aviso).toHaveTextContent(/[Rr]evive al menos uno/);
  });

  it('sin dropeados NO se inventa el aviso (la pantalla no habla de más)', async () => {
    await abrirDetalle(PERM, listaConEstado('abierto'));
    expect(screen.queryByTestId('aviso-dropeados')).not.toBeInTheDocument();
  });

  /**
   * ⭐ V1-E8x (ronda de corrección) — el RESUMEN de costo viejo cuenta sobre los VIGENTES, igual que
   * el diálogo de emitir cotización. Un dropeado con la receta movida levanta un aviso sin
   * consecuencia (no va en ningún papel), y tener a las dos pantallas diciendo cosas distintas del
   * mismo hecho es peor que no avisar.
   */
  it('🔴 el resumen de COSTO VIEJO no cuenta a los dropeados (un solo criterio con la cotización)', async () => {
    await abrirDetalle(PERM, listaConEstado('dropeado', { avisoCostoViejo: AVISO }));
    expect(screen.queryByTestId('aviso-costo-viejo-resumen')).not.toBeInTheDocument();
    // Pero el aviso PEGADO a su renglón sí sigue: ahí es información local del modelo, y al
    // revivirlo vuelve a importar.
    expect(screen.getByTestId('aviso-costo-viejo')).toBeInTheDocument();
  });

  it('y sobre un renglón VIGENTE el resumen sí aparece (no se apagó de más)', async () => {
    await abrirDetalle(PERM, listaConEstado('en_negociacion', { avisoCostoViejo: AVISO }));
    expect(screen.getByTestId('aviso-costo-viejo-resumen')).toHaveTextContent('KM-114');
  });

  it('un modelo dropeado se APAGA en la fila (pero sigue ahí: se puede revivir)', async () => {
    await abrirDetalle(PERM, listaConEstado('dropeado'));
    const fila = screen.getByTestId('fila-renglon-lista');
    expect(fila).toHaveAttribute('data-estado', 'dropeado');
    expect(fila.className).toContain('opacity-60');
    expect(fila).toHaveTextContent('Playera Cherry');
  });
});

describe('⭐⭐ V1-E8y — la mesa abierta (§Post-F9.152)', () => {
  beforeEach(() => {
    useListaPreciosMock.mockReset();
    useListasPreciosMock.mockReset();
  });

  it('🔴 el diálogo de agregar modelos NO se monta hasta pulsarlo (dispara 5 consultas)', async () => {
    const usuario = userEvent.setup();
    await abrirDetalle();

    // Cerrado: ni el panel ni sus pestañas existen en el DOM.
    expect(screen.queryByTestId('panel-cotizados')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('abrir-agregar-modelos'));
    expect(await screen.findByTestId('modo-agregar')).toBeInTheDocument();
  });

  it('sin `listas.administrar` no se ofrece agregar modelos', async () => {
    await abrirDetalle(['listas.ver', 'consultas.ver-importes']);
    expect(screen.queryByTestId('abrir-agregar-modelos')).not.toBeInTheDocument();
  });

  it('⭐ el LUGAR de la cita se enseña junto a la fecha cuando lo hay', async () => {
    await abrirDetalle(PERM, { ...LISTA, lugar: 'Oficinas de C&A, Santa Fe' });
    expect(screen.getByTestId('lugar-cita')).toHaveTextContent('Oficinas de C&A, Santa Fe');
  });

  it('sin lugar capturado no se pinta un hueco, y el botón invita a ponerlo', async () => {
    await abrirDetalle();
    expect(screen.queryByTestId('lugar-cita')).not.toBeInTheDocument();
    expect(screen.getByTestId('editar-datos-cita')).toHaveTextContent(/Lugar de la cita/i);
  });

  it('🔴 el chip cuenta los pendientes SIN tachar (los tachados ya no son pendientes)', async () => {
    const base = LISTA.lineas[0];
    if (base === undefined) {
      throw new Error('El fixture LISTA perdió su renglón: la prueba ya no prueba lo que dice.');
    }
    await abrirDetalle(PERM, {
      ...LISTA,
      lineas: [
        {
          ...base,
          pendientes: [
            {
              id: 1,
              idListaLinea: 91,
              texto: 'Falta muestra de color',
              resuelto: false,
              resueltoEn: null,
              resueltoPorId: null,
              creadoEn: '2026-08-31T00:00:00.000Z',
              creadoPorId: 'u1',
            },
            {
              id: 2,
              idListaLinea: 91,
              texto: 'Ya se pidió el precio',
              resuelto: true,
              resueltoEn: '2026-08-31T01:00:00.000Z',
              resueltoPorId: 'u1',
              creadoEn: '2026-08-31T00:00:00.000Z',
              creadoPorId: 'u1',
            },
          ],
        },
      ],
    });
    expect(screen.getByTestId('chip-pendientes')).toHaveTextContent('1');
  });

  it('sin pendientes abiertos no se pinta el chip (no hay nada que recordar)', async () => {
    await abrirDetalle();
    expect(screen.queryByTestId('chip-pendientes')).not.toBeInTheDocument();
  });
});
