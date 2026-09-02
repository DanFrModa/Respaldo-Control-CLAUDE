import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden, OrdenCentro } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CentroOrdenesPagina } from './CentroOrdenesPagina';

/**
 * Pruebas de `<CentroOrdenesPagina>` (rediseño jul-2026, petición de Daniel):
 *  1) la FOTO del modelo se muestra ARRIBA del detalle (zona fija, sin scroll), no enterrada;
 *  2) la LISTA de órdenes se navega con las FLECHAS del teclado (↑/↓), sin romper el buscador;
 *  3) el DEEP-LINK (buscador ⌘K) deja la orden seleccionada EN LA LISTA (buscador = folio); y
 *  4) los filtros de select llevan su ✕ para quitarlos.
 * La capa de datos y los paneles pesados van simulados (sin red).
 */

// ── Capa de datos simulada ────────────────────────────────────────────────────
type EstadoCentro = {
  data: { datos: OrdenCentro[]; total: number; totalPaginas: number } | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: { message: string } | null;
  refetch: () => void;
};
// Los mocks reciben la QUERY/el id para que cada prueba conteste según los filtros (deep-link).
const useOrdenesCentro = vi.fn<(query?: unknown) => EstadoCentro>();
const useFotosModelo = vi.fn<() => { data: unknown[] }>();
const useOrden = vi.fn<(id?: number) => unknown>();

vi.mock('@/api/ordenes-centro', () => ({
  useOrdenesCentro: (query: unknown) => useOrdenesCentro(query),
}));
vi.mock('@/api/ordenes', () => ({
  useOrden: (id?: number) => useOrden(id),
}));
vi.mock('@/api/modelos', () => ({
  useFotosModelo: () => useFotosModelo(),
}));
// Fotos subidas a la orden (adjuntos): no intervienen en estas pruebas → siempre vacío.
vi.mock('@/api/adjuntos-orden', () => ({
  useAdjuntosOrden: () => ({ data: [] }),
  useSubirAdjuntoOrden: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarAdjuntoOrden: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isFetching: false }),
}));
vi.mock('@/api/empresas', () => ({
  useEmpresas: () => ({ data: [] }),
}));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isFetching: false }),
  useRolesProveedor: () => ({ data: [] }),
}));
vi.mock('@/api/liga-orden', () => ({
  useSugerenciaLiga: () => ({ data: undefined }),
  useExpedienteOrden: () => ({ data: undefined }),
  // Con `desarrollo.ver` el panel monta también el expediente (F8-E6), que usa estos hooks.
  useLigarOrden: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarLiga: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/ordenes-consulta', () => ({
  imprimirOrden: vi.fn(),
}));
// Paneles pesados del detalle: no intervienen en estas pruebas.
vi.mock('./PanelPreciosOrden', () => ({ PanelPreciosOrden: () => null }));
// El expediente Desarrollo↔Producción (F8-E6) tampoco interviene aquí.
vi.mock('./SeccionDesarrolloOrden', () => ({ SeccionDesarrolloOrden: () => null }));
// ⭐ V1-E3h + V1-E3j: la RECETA se alcanza desde el panel de la OP. Desde V1-E3j lo que vive aquí
// es el RESUMEN (el trabajo se hace en `/produccion/ordenes/:id/receta`, que no cabía en el cajón).
// Aquí solo importa QUE ESTÉ y con qué permiso; su contenido lo prueban `ResumenRecetaOrden.test.tsx`
// y `PanelRecetaOrden.test.tsx`.
vi.mock('./ResumenRecetaOrden', () => ({
  ResumenRecetaOrden: ({ idOrden }: { idOrden: number }) => (
    <div data-testid="panel-receta" data-id-orden={String(idOrden)} />
  ),
}));
vi.mock('@/modulos/ruta-critica/PanelRutaOrden', () => ({ PanelRutaOrden: () => null }));
// El panel de avance se simula: aquí solo importa DÓNDE se abre, no su contenido.
vi.mock('@/modulos/produccion/AvanceProduccion', () => ({
  AvanceProduccion: () => <div data-testid="avance-produccion">Avance</div>,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
function fila(id: number, folio: number): OrdenCentro {
  return {
    id,
    folio,
    idEmpresa: 1,
    empresa: 'FR',
    codigoModelo: `M-${folio}`,
    pedidoCliente: null,
    cantOrdenada: 100,
    cantCortada: 0,
    maquilero: null,
    numMaquileros: 0,
    estampador: null,
    folioPedido: null,
    ocTelaFolio: null,
    mesEntrega: null,
    cliente: `Cliente ${folio}`,
    estado: 'capturada',
    // Regla del estado automático (V1-E3d): a esta orden le falta LIBERAR su receta.
    faltantes: ['receta'],
    // ⭐⭐ fila 0.068 (a): por omisión, la OP va igual que sus hermanas (o no tiene ninguna).
    frenteAlGrupo: {
      hermanas: 0,
      foliosHermanas: [],
      fueraDeLaComparacion: 0,
      diferencias: [],
      aviso: null,
      notaFueraDeLaComparacion: null,
    },
  } as unknown as OrdenCentro;
}

/** Una OP que NO va igual que sus hermanas, con el aviso ya redactado por el servidor. */
function filaDesviada(id: number, folio: number): OrdenCentro {
  return {
    ...fila(id, folio),
    frenteAlGrupo: {
      hermanas: 2,
      foliosHermanas: [5001, 5002],
      fueraDeLaComparacion: 0,
      notaFueraDeLaComparacion: null,
      diferencias: [
        {
          tipo: 'avio',
          material: 'CIE-02 — Cierre café',
          que: 'solo-esta',
          detalle: '«CIE-02 — Cierre café»: esta OP lleva 1 · OP 5001, 5002 no lo llevan.',
        },
      ],
      aviso: 'Esta OP no va igual que sus 2 hermanas: «CIE-02 — Cierre café».',
    },
  } as unknown as OrdenCentro;
}

function ordenDetalle(id = 1, folio = 101): Orden {
  return {
    id,
    folio,
    codigoModelo: `M-${folio}`,
    idModelo: 55,
    cliente: `Cliente ${folio}`,
    estado: 'capturada',
    requisitos: {
      tallas: false,
      receta: true,
      arte: 'no-aplica',
      completa: false,
      faltantes: ['tallas'],
    },
    referencias: [],
    lineas: [],
    totalPiezas: 0,
    ocCliente: null,
  } as unknown as Orden;
}

/** Estado "resuelto" de `useOrden` para el detalle. */
function detalleResuelto(orden: Orden): unknown {
  return { data: orden, isPending: false, isError: false, error: null };
}

function conFilas(filas: OrdenCentro[]): EstadoCentro {
  return {
    data: { datos: filas, total: filas.length, totalPaginas: 1 },
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<CentroOrdenesPagina>', () => {
  beforeEach(() => {
    useOrdenesCentro.mockReset();
    useFotosModelo.mockReset();
    useFotosModelo.mockReturnValue({ data: [] });
    useOrden.mockReset();
    useOrden.mockImplementation((id?: number) =>
      detalleResuelto(ordenDetalle(id ?? 1, 100 + (id ?? 1))),
    );
  });

  it('muestra las MINIATURAS del modelo ARRIBA del detalle (zona fija, no en el scroll)', () => {
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
    useFotosModelo.mockReturnValue({
      data: [{ idFoto: 1, urlDescarga: 'https://ej.test/a.jpg' }],
    });
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    const tira = screen.getByTestId('fotos-modelo-orden');
    // Vive dentro de la zona FIJA del detalle (lo primero que se ve, sin scroll).
    expect(tira.closest('[data-testid="centro-detalle-fijo"]')).not.toBeNull();
    // Ya no hay una sección "Foto del modelo" enterrada abajo.
    expect(screen.queryByText('Foto del modelo')).not.toBeInTheDocument();
  });

  // ── Transparencia del estado automático (Daniel 26-jul-2026) ──
  it('dice QUÉ LE FALTA a la orden para estar completa (lista y detalle)', () => {
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    // En la lista, junto al chip de avance: la fila no tiene su receta liberada.
    expect(screen.getAllByText('Falta: liberar la receta').length).toBeGreaterThan(0);
    // En el detalle (que en el fixture es una orden SIN matriz): falta la captura de tallas.
    expect(screen.getByText('Falta: tallas')).toBeInTheDocument();
  });

  it('no dice nada de faltantes cuando la orden ya cumple todo', () => {
    useOrdenesCentro.mockReturnValue(conFilas([{ ...fila(1, 101), faltantes: [] }]));
    useOrden.mockImplementation(() =>
      detalleResuelto({
        ...ordenDetalle(1, 101),
        estado: 'completa',
        requisitos: {
          tallas: true,
          receta: true,
          arte: true,
          completa: true,
          faltantes: [],
        },
      } as unknown as Orden),
    );
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    expect(screen.queryByText(/^Falta: /)).not.toBeInTheDocument();
  });

  it('no pinta bloque de foto cuando el modelo no tiene fotos', () => {
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
    useFotosModelo.mockReturnValue({ data: [] });
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    expect(screen.queryByTestId('fotos-modelo-orden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('foto-modelo-orden')).not.toBeInTheDocument();
  });

  it('las flechas ↑/↓ mueven la selección de la lista (con clamp)', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102), fila(3, 103)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    const filas = () => screen.getAllByTestId('centro-fila');
    // Por defecto se selecciona la primera fila.
    expect(filas()[0]).toHaveAttribute('data-seleccionada');
    expect(filas()[1]).not.toHaveAttribute('data-seleccionada');

    await usuario.keyboard('{ArrowDown}');
    expect(filas()[1]).toHaveAttribute('data-seleccionada');
    expect(filas()[0]).not.toHaveAttribute('data-seleccionada');

    await usuario.keyboard('{ArrowDown}');
    expect(filas()[2]).toHaveAttribute('data-seleccionada');

    // Clamp: en el último renglón, ↓ no envuelve al primero.
    await usuario.keyboard('{ArrowDown}');
    expect(filas()[2]).toHaveAttribute('data-seleccionada');

    await usuario.keyboard('{ArrowUp}');
    expect(filas()[1]).toHaveAttribute('data-seleccionada');
  });

  it('ignora las flechas cuando el foco está en el buscador', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    const filas = () => screen.getAllByTestId('centro-fila');
    expect(filas()[0]).toHaveAttribute('data-seleccionada');

    const buscador = screen.getByTestId('centro-busqueda');
    await usuario.click(buscador);
    await usuario.keyboard('{ArrowDown}');

    // La selección NO cambió (la flecha no se secuestró estando en el input).
    expect(filas()[0]).toHaveAttribute('data-seleccionada');
    expect(filas()[1]).not.toHaveAttribute('data-seleccionada');
  });

  it('ignora las flechas cuando hay un diálogo/sheet abierto (no cambia la orden del fondo)', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    const filas = () => screen.getAllByTestId('centro-fila');
    expect(filas()[0]).toHaveAttribute('data-seleccionada');

    // Simula un modal Radix abierto (AvanceProduccion / DialogoOrden / cancelar / copiar matriz…),
    // que marca su overlay con role="dialog" + data-state="open".
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('data-state', 'open');
    document.body.appendChild(modal);
    try {
      await usuario.keyboard('{ArrowDown}');
      // La orden de fondo NO cambió: la flecha se ignoró por el diálogo abierto.
      expect(filas()[0]).toHaveAttribute('data-seleccionada');
      expect(filas()[1]).not.toHaveAttribute('data-seleccionada');
    } finally {
      modal.remove();
    }
  });

  it('la selección por teclado enfoca el renglón y usa el mismo panel de detalle', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    await usuario.keyboard('{ArrowDown}');
    const filaActiva = screen.getAllByTestId('centro-fila')[1];
    expect(filaActiva).toHaveAttribute('data-seleccionada');
    // El foco se movió al renglón seleccionado.
    expect(document.activeElement).toBe(filaActiva);
    // El detalle sigue siendo el mismo panel único (no hay estado paralelo de selección).
    expect(
      within(screen.getByTestId('centro-detalle')).getByTestId('centro-detalle-fijo'),
    ).toBeInTheDocument();
  });

  it('deep-link con la orden FUERA de la página: pone el buscador al folio y la fila queda seleccionada', async () => {
    // La lista "normal" NO trae la orden 5; solo al buscar su folio (105) aparece. `useOrden(5)`
    // (el detalle que el panel ya carga) es quien conoce el folio.
    useOrdenesCentro.mockImplementation((query) => {
      const q = query as { busqueda?: string } | undefined;
      return q?.busqueda === '105'
        ? conFilas([fila(5, 105)])
        : conFilas([fila(1, 101), fila(2, 102)]);
    });
    renderConProveedores(<CentroOrdenesPagina />, {
      sesion: estadoSesionDePrueba([]),
      rutaInicial: { pathname: '/produccion/ordenes', state: { idOrden: 5 } },
    });

    // El buscador queda con el folio de la orden del deep-link…
    const buscador = screen.getByTestId('centro-busqueda');
    await waitFor(() => expect(buscador).toHaveValue('105'));
    // …y (tras el debounce del buscador) la fila aparece en la lista, SELECCIONADA.
    await waitFor(() => {
      const filasEl = screen.getAllByTestId('centro-fila');
      expect(filasEl).toHaveLength(1);
      expect(filasEl[0]).toHaveAttribute('data-seleccionada');
      expect(filasEl[0]).toHaveTextContent('105');
    });
  });

  it('deep-link con la orden en ERROR (404/sin permiso): apaga el pendiente y NO toca el buscador', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102)]));
    // La orden 5 del deep-link FALLA (p. ej. de otra empresa → 404); las demás resuelven normal.
    useOrden.mockImplementation((id?: number) =>
      id === 5
        ? { data: undefined, isPending: false, isError: true, error: { message: 'No encontrada' } }
        : detalleResuelto(ordenDetalle(id ?? 1, 100 + (id ?? 1))),
    );
    renderConProveedores(<CentroOrdenesPagina />, {
      sesion: estadoSesionDePrueba([]),
      rutaInicial: { pathname: '/produccion/ordenes', state: { idOrden: 5 } },
    });

    // El buscador NO se tocó (no hay folio que poner).
    const buscador = screen.getByTestId('centro-busqueda');
    expect(buscador).toHaveValue('');

    // El pendiente se APAGÓ: en el siguiente render (cambiar la selección con ↓) ya nadie vuelve a
    // pedir la orden 5 — sin el guard de error, la query seguiría habilitada refetcheando por siempre.
    useOrden.mockClear();
    await usuario.keyboard('{ArrowDown}');
    await waitFor(() => expect(useOrden).toHaveBeenCalledWith(1));
    expect(useOrden).not.toHaveBeenCalledWith(5);
    expect(buscador).toHaveValue('');
  });

  it('si el usuario teclea mientras el folio del deep-link viene en vuelo, su texto NO se pisa', async () => {
    const usuario = userEvent.setup();
    let resuelta = false;
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), fila(2, 102)]));
    // La orden 5 del deep-link tarda: primero pending; "llega" cuando `resuelta` se enciende.
    useOrden.mockImplementation((id?: number) =>
      id === 5
        ? resuelta
          ? detalleResuelto(ordenDetalle(5, 105))
          : { data: undefined, isPending: true, isError: false, error: null }
        : detalleResuelto(ordenDetalle(id ?? 1, 100 + (id ?? 1))),
    );
    renderConProveedores(<CentroOrdenesPagina />, {
      sesion: estadoSesionDePrueba([]),
      rutaInicial: { pathname: '/produccion/ordenes', state: { idOrden: 5 } },
    });

    const buscador = screen.getByTestId('centro-busqueda');
    // El usuario teclea ANTES de que llegue el folio: su escritura cancela el deep-link pendiente.
    await usuario.type(buscador, '777');
    resuelta = true;
    // Con la orden ya "resuelta", otro tecleo re-renderiza: el folio 105 NO debe pisar lo escrito.
    await usuario.type(buscador, '8');
    expect(buscador).toHaveValue('7778');
  });

  it('los filtros de select llevan su ✕ para quitarlos (mes de entrega)', async () => {
    const usuario = userEvent.setup();
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    const select = screen.getByTestId('centro-filtro-mes');
    // Sin valor elegido no hay ✕ (nada que limpiar).
    expect(screen.queryByTestId('centro-filtro-mes-limpiar')).not.toBeInTheDocument();

    await usuario.selectOptions(select, '3');
    expect(select).toHaveValue('3');

    // La ✕ regresa el filtro a su default ("Mes de entrega" = todos) y desaparece.
    await usuario.click(screen.getByTestId('centro-filtro-mes-limpiar'));
    expect(select).toHaveValue('');
    expect(screen.queryByTestId('centro-filtro-mes-limpiar')).not.toBeInTheDocument();
  });

  // En móvil el detalle vive en el CAJÓN (Sheet portalizado al body), y el panel de avance se pinta
  // EN LÍNEA dentro de la página: con el cajón abierto quedaba tapado y el botón "no servía"
  // (reporte de Daniel, jul-2026). Abrir el avance tiene que cerrar el cajón.
  it('en móvil abrir el avance CIERRA el cajón (si no, el panel quedaba debajo)', async () => {
    const usuario = userEvent.setup();
    const anchoReal = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 500, writable: true, configurable: true });
    try {
      useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
      renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

      // Tocar el renglón abre el cajón (pantalla angosta).
      await usuario.click(screen.getAllByTestId('centro-fila')[0] as HTMLElement);
      expect(document.querySelector('[data-slot="cajon-detalle"]')).not.toBeNull();

      // El botón del detalle DENTRO del cajón: abre el avance y deja el cajón cerrado.
      const botones = screen.getAllByTestId('centro-registrar-avance');
      const enElCajon = botones.find((b) => b.closest('[data-slot="cajon-detalle"]') !== null);
      expect(enElCajon).toBeDefined();
      await usuario.click(enElCajon as HTMLElement);

      expect(screen.getByTestId('avance-produccion')).toBeInTheDocument();
      await waitFor(() => {
        expect(document.querySelector('[data-slot="cajon-detalle"]')).toBeNull();
      });
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        value: anchoReal,
        writable: true,
        configurable: true,
      });
    }
  });
  // ── §Post-F9.68 · esconder, no negar ───────────────────────────────────────
  // Los MOSAICOS del detalle llevan a otras pantallas (Modelo, Notas, O.C.,
  // Consumo de tela) o abren paneles (Avíos, Ruta Crítica). El que el usuario no
  // puede abrir NO se pinta: ni apagado ni con tooltip explicando el permiso.
  // Las dos pruebas van EN PAREJA — la negativa sola pasaría igual si el detalle
  // no montara.
  describe('mosaicos del detalle (esconder, no negar)', () => {
    const MOSAICOS = [
      'mosaico-modelo',
      'mosaico-habilitacion',
      'mosaico-notas',
      'mosaico-oc',
      'mosaico-rc',
      'mosaico-tela',
    ] as const;

    it('sin ningún permiso de destino, NINGÚN mosaico de navegación se pinta', () => {
      useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
      renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

      for (const testid of MOSAICOS) {
        expect(screen.queryByTestId(testid)).toBeNull();
      }
      // El que no depende de otro módulo sigue ahí (si no, la prueba de
      // arriba pasaría solo porque el detalle no se montó).
      expect(screen.getByTestId('mosaico-imprimir')).toBeInTheDocument();
      // ⭐ V1-E3h (§Post-F9.72): «Modificar» TAMBIÉN se esconde. Abre el diálogo que edita la OP
      // entera —cantidades, fechas, matriz—, así que exige `ordenes.administrar`; estaba sin gate,
      // a diferencia de los otros. Lo detectó el repaso de Daniel del 19-ago.
      expect(screen.queryByTestId('mosaico-modificar')).toBeNull();
      // Y NADA habla de permisos (ni tooltip ni letrero).
      expect(screen.getByTestId('centro-mosaicos').textContent).not.toMatch(/permiso/i);
    });

    it('con los permisos de destino, los seis mosaicos aparecen (gemela positiva)', () => {
      useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
      renderConProveedores(<CentroOrdenesPagina />, {
        sesion: estadoSesionDePrueba([
          'modelos.ver',
          'ordenes.habilitacion',
          'notas.ver',
          'compras.ver',
          'rc.ruta-ver',
          'inventario-telas.mover',
        ]),
      });

      for (const testid of MOSAICOS) {
        expect(screen.getByTestId(testid)).toBeInTheDocument();
      }
      // Esta sesión NO trae `ordenes.administrar`, así que «Modificar» sigue escondido.
      expect(screen.queryByTestId('mosaico-modificar')).toBeNull();
    });

    /**
     * ⭐ V1-E3h (§Post-F9.72) — EL PUNTO ENTERO DE LA ETAPA. Daniel: *"nadie va a tener permiso de
     * modificar la OP más que yo"*. Si la receta —y con ella el botón de LIBERAR, que es la puerta
     * que abre la compra— sigue viviendo tras «Modificar», o Daniel se vuelve el cuello de botella
     * firmando todas las recetas, o hay que darle a Desarrollo permiso sobre la OP entera.
     */
    it('⭐ V1-E3h: la RECETA se alcanza desde el panel de la OP, con `desarrollo.ver` y SIN `ordenes.administrar`', () => {
      useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
      renderConProveedores(<CentroOrdenesPagina />, {
        sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']),
      });

      // V1-E3j: el resumen recibe LA ORDEN ABIERTA (si tomara otra, enseñaría la receta de alguien
      // más y el botón llevaría a la pantalla equivocada).
      expect(screen.getByTestId('panel-receta')).toHaveAttribute('data-id-orden', '1');
      // Y sin poder tocar la OP: el mosaico de «Modificar» no está.
      expect(screen.queryByTestId('mosaico-modificar')).toBeNull();
    });

    it('con `desarrollo.ver` pero SIN `.administrar` la receta se sigue alcanzando (leer no exige firmar)', () => {
      useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
      renderConProveedores(<CentroOrdenesPagina />, {
        sesion: estadoSesionDePrueba(['desarrollo.ver']),
      });

      // Qué se puede TOCAR lo decide la pantalla de la receta (y el backend), no este resumen:
      // aquí no hay ninguna acción que esconder.
      expect(screen.getByTestId('panel-receta')).toBeInTheDocument();
    });

    it('sin `desarrollo.ver` la receta NI SE PINTA (§Post-F9.68)', () => {
      useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
      renderConProveedores(<CentroOrdenesPagina />, {
        sesion: estadoSesionDePrueba(['ordenes.administrar']),
      });

      expect(screen.queryByTestId('panel-receta')).toBeNull();
    });

    it('⭐ V1-E3h: «Modificar» aparece SOLO con `ordenes.administrar` (gemela positiva)', () => {
      useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
      renderConProveedores(<CentroOrdenesPagina />, {
        sesion: estadoSesionDePrueba(['ordenes.administrar']),
      });

      expect(screen.getByTestId('mosaico-modificar')).toBeInTheDocument();
    });

    it('un mosaico aparece SOLO con su propio permiso, no con el de otro', () => {
      useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101)]));
      renderConProveedores(<CentroOrdenesPagina />, {
        sesion: estadoSesionDePrueba(['compras.ver']),
      });

      expect(screen.getByTestId('mosaico-oc')).toBeInTheDocument();
      expect(screen.queryByTestId('mosaico-rc')).toBeNull();
      expect(screen.queryByTestId('mosaico-modelo')).toBeNull();
    });
  });
});

/**
 * ⭐⭐ fila 0.068 (a) — **EL AVISO DE LA OP QUE SE DESVÍA DEL GRUPO, EN LA FAMILIA.**
 *
 * El Centro es la única pantalla que enseña juntas todas las OP de un modelo, así que es donde se
 * reconoce a la que se salió del grupo. La pantalla **no compara nada**: pinta lo que el servidor
 * ya redactó.
 */
describe('<CentroOrdenesPagina> — la OP que no va igual que sus hermanas', () => {
  beforeEach(() => {
    useOrdenesCentro.mockReset();
    useFotosModelo.mockReset();
    useFotosModelo.mockReturnValue({ data: [] });
    useOrden.mockReset();
    useOrden.mockImplementation(() => detalleResuelto(ordenDetalle()));
  });

  /**
   * 🔴🔴 **LAS DOS SUPERFICIES SE COMPRUEBAN POR SEPARADO, y no es paranoia.** El Centro pinta cada
   * orden DOS veces —una fila de tabla (escritorio) y una tarjeta (móvil)—, y las dos llevan el
   * chip. Medido con mutación: un `getAllByTestId` genérico **sobrevive a que se borre cualquiera
   * de las dos**, porque la otra basta para satisfacerlo. Media pantalla se quedaría sin el aviso y
   * la prueba seguiría verde. Por eso se busca DENTRO de cada contenedor.
   */
  function chipDeLaTabla(): HTMLElement | null {
    const fila = screen.getAllByRole('row').find((r) => r.textContent?.includes('102') === true);
    return fila === undefined ? null : within(fila).queryByTestId('chip-hermanas');
  }
  function chipDeLaTarjeta(): HTMLElement | null {
    const tarjeta = screen
      .getAllByTestId('centro-tarjeta')
      .find((t) => t.textContent?.includes('102') === true);
    return tarjeta === undefined ? null : within(tarjeta).queryByTestId('chip-hermanas');
  }

  it('pinta el aviso del servidor TAL CUAL, en la TABLA y en la TARJETA móvil', () => {
    useOrdenesCentro.mockReturnValue(conFilas([filaDesviada(2, 102)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    const texto = 'Esta OP no va igual que sus 2 hermanas: «CIE-02 — Cierre café».';
    const enTabla = chipDeLaTabla();
    const enTarjeta = chipDeLaTarjeta();
    expect(enTabla).not.toBeNull();
    expect(enTarjeta).not.toBeNull();
    expect(enTabla).toHaveTextContent(texto);
    expect(enTarjeta).toHaveTextContent(texto);
    // El detalle (qué lleva cada una) viaja en el title, para no ir a comparar a mano.
    expect(enTabla?.getAttribute('title')).toContain('OP 5001, 5002 no lo llevan');
    expect(enTarjeta?.getAttribute('title')).toContain('OP 5001, 5002 no lo llevan');
  });

  it('🔴 CONTROL NEGATIVO: una OP que va igual NO pinta chip en ninguna de las dos', () => {
    useOrdenesCentro.mockReturnValue(conFilas([fila(2, 102)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    expect(chipDeLaTabla()).toBeNull();
    expect(chipDeLaTarjeta()).toBeNull();
    expect(screen.queryByTestId('chip-hermanas')).not.toBeInTheDocument();
  });

  it('⚠️ EL LÍMITE: si la familia quedó fuera, la fila del Centro sale LIMPIA (sólo lo dice la receta)', () => {
    /*
     * 🔴 Fija un límite conocido, no una victoria. Cuando toda la familia es histórico de un
     * backfill, no hay grupo y no hay aviso ⇒ el chip no aparece y **el Centro no dice nada**: la
     * nota de «quedaron fuera» sólo la enseña el banner de la receta de la OP. Está declarado en el
     * encabezado de `hermanas-de-la-op.ts` y en el contrato.
     *
     * Se deja así a propósito: poner un chip en cada fila con historia migrada llenaría la pantalla
     * principal de ruido el día del arranque, que es cuando TODAS lo son.
     */
    useOrdenesCentro.mockReturnValue(
      conFilas([
        {
          ...fila(2, 102),
          frenteAlGrupo: {
            hermanas: 0,
            foliosHermanas: [],
            fueraDeLaComparacion: 3,
            diferencias: [],
            aviso: null,
            notaFueraDeLaComparacion:
              '3 OP del modelo quedaron fuera de la comparación (son histórico migrado, o no tienen receta capturada).',
          },
        },
      ]),
    );
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });
    expect(screen.queryByTestId('chip-hermanas')).not.toBeInTheDocument();
  });

  it('🔴 el chip va en la fila de SU orden, no en la de la vecina', () => {
    // El fallo que caza: pintar el aviso a partir del índice del lote en vez de la fila.
    useOrdenesCentro.mockReturnValue(conFilas([fila(1, 101), filaDesviada(2, 102)]));
    renderConProveedores(<CentroOrdenesPagina />, { sesion: estadoSesionDePrueba([]) });

    // La 102 lo lleva en sus dos superficies...
    expect(chipDeLaTabla()).not.toBeNull();
    expect(chipDeLaTarjeta()).not.toBeNull();
    // ...y la 101, en ninguna.
    for (const chip of screen.getAllByTestId('chip-hermanas')) {
      const contenedor = chip.closest('tr') ?? chip.closest('[data-testid="centro-tarjeta"]');
      expect(contenedor?.textContent).toContain('102');
      expect(contenedor?.textContent).not.toContain('101');
    }
  });
});
