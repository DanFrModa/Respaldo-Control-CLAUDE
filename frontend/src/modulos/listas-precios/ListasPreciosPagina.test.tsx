import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ReactRouterDom from 'react-router-dom';
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
/** V1-E8t: la puerta «Ir a Pre-costeos» del vacío navega; se captura a dónde. */
const navegar = vi.fn();
vi.mock('react-router-dom', async (importarOriginal) => {
  const real = await importarOriginal<typeof ReactRouterDom>();
  return { ...real, useNavigate: () => navegar };
});

const quitarMutate = vi.fn();
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
  imprimirListaPdf: vi.fn(),
  descargarListaExcel: vi.fn(),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isPending: false, isFetching: false }),
  useDepartamentosCliente: () => ({ data: [], isPending: false }),
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
      // V1-E8d: `as string | null` para que el fixture admita encenderlo (`listaConAviso`); sin la
      // anotación TypeScript infiere el literal `null` y la variante no compila.
      avisoCostoViejo: null as string | null,
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
