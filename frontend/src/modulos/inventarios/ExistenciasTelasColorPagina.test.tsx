import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ExistenciasTelaColor, KardexTelaColor } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExistenciasTelasColorPagina } from './ExistenciasTelasColorPagina';

/** Existencias agrupadas TELA PADRE → colores (una tela CON complemento y una SIN). */
const existencias: ExistenciasTelaColor = {
  telas: [
    {
      idTela: 1,
      nombre: 'Felpa Suiza',
      categoria: 'Felpa',
      idProveedor: 2,
      proveedor: 'Alsatex',
      nombreProveedor: 'Felpa Suiza',
      unidadMedida: 'KG',
      nombreCuerpo: 'Felpa',
      nombreComplemento: 'Cardigan',
      totalCuerpo: 120,
      totalComplemento: 45,
      colores: [
        {
          idTelaColor: 11,
          nombre: 'Marino Alsa 3040',
          pantone: '19-3920',
          existenciaCuerpo: 100,
          existenciaComplemento: 40,
          almacenes: [{ idAlmacen: 5, almacen: 'Bodega A', cuerpo: 100, complemento: 40 }],
        },
        {
          idTelaColor: 12,
          nombre: 'Blanco',
          pantone: null,
          existenciaCuerpo: 20,
          existenciaComplemento: 5,
          almacenes: [{ idAlmacen: 5, almacen: 'Bodega A', cuerpo: 20, complemento: 5 }],
        },
      ],
    },
    {
      idTela: 2,
      nombre: 'Lisa Algodón',
      categoria: null,
      idProveedor: null,
      proveedor: null,
      nombreProveedor: null,
      unidadMedida: 'M',
      nombreCuerpo: null,
      nombreComplemento: null,
      totalCuerpo: 33,
      totalComplemento: 0,
      colores: [
        {
          idTelaColor: 21,
          nombre: 'Negro',
          pantone: null,
          existenciaCuerpo: 33,
          existenciaComplemento: 0,
          almacenes: [{ idAlmacen: 5, almacen: 'Bodega A', cuerpo: 33, complemento: 0 }],
        },
      ],
    },
  ],
  totalCuerpo: 153,
  totalComplemento: 45,
};

const kardex: KardexTelaColor = {
  idTela: 1,
  tela: 'Felpa Suiza',
  idTelaColor: 11,
  telaColor: 'Marino Alsa 3040',
  pantone: '19-3920',
  unidadMedida: 'KG',
  nombreCuerpo: 'Felpa',
  nombreComplemento: 'Cardigan',
  // Encabezado del PERIODO (fila 0.173): qué pedazo se está viendo y si se quedó algo fuera.
  desde: '2025-09-05',
  hasta: null,
  ventanaPorOmision: true,
  limite: 1000,
  truncado: false,
  saldosIniciales: [],
  renglones: [
    {
      idMovimiento: 1,
      folio: 1,
      fecha: '2026-08-06',
      idTipoMov: 1,
      tipoMov: 'Ajuste (Entrada)',
      direccion: 'entrada',
      idAlmacen: 5,
      almacen: 'Bodega A',
      idPartida: 1,
      partidaFolio: 1,
      loteProveedor: 'L-778',
      entradaCuerpo: 100,
      salidaCuerpo: 0,
      saldoCuerpo: 100,
      entradaComplemento: 40,
      salidaComplemento: 0,
      saldoComplemento: 40,
      costoUnit: null,
      costoUnitComplemento: null,
      importe: null,
      origenTipo: 'movimiento-manual',
      origenId: null,
      cancelado: false,
      observaciones: 'Conteo físico inicial',
    },
  ],
};

const [renglonBase] = kardex.renglones;
if (renglonBase === undefined) {
  throw new Error('El fixture `kardex` debe traer al menos un renglón.');
}

/**
 * FILA 0.177 — el kardex de un color en el que un TRASPASO se repartió FIFO entre dos partidas.
 *
 * No es un caso rebuscado: es el que el propio sistema documenta. `repartirPorPartidaFifo` devuelve
 * UNA LÍNEA POR LOTE, `traspasarTelaColor` las escribe como detalles del MISMO `Movimiento` y
 * `kardexTelaColor` emite un renglón por detalle ⇒ dos renglones con el mismo movimiento, el mismo
 * almacén y el mismo folio, distinguidos sólo por la partida.
 */
const kardexFifo: KardexTelaColor = {
  ...kardex,
  saldosIniciales: [],
  renglones: [
    // Las DOS patas del mismo traspaso: idMovimiento/idAlmacen/folio IDÉNTICOS.
    {
      ...renglonBase,
      idMovimiento: 7,
      folio: 70,
      tipoMov: 'Traspaso (Salida)',
      origenTipo: 'traspaso',
      idPartida: 1,
      partidaFolio: 1,
      loteProveedor: 'L-778',
    },
    {
      ...renglonBase,
      idMovimiento: 7,
      folio: 70,
      tipoMov: 'Traspaso (Salida)',
      origenTipo: 'traspaso',
      idPartida: 2,
      partidaFolio: 2,
      loteProveedor: 'L-779',
    },
    // Un movimiento distinto, sobre una tercera partida.
    {
      ...renglonBase,
      idMovimiento: 8,
      folio: 80,
      idPartida: 3,
      partidaFolio: 3,
      loteProveedor: 'L-780',
    },
  ],
};

const useKardexTelaColor = vi.fn<(q: unknown) => unknown>();
const cancelarMutate = vi.fn();

vi.mock('@/api/inventario-materiales', () => ({
  useExistenciasTelaColor: () => ({
    data: existencias,
    isPending: false,
    isError: false,
    error: null,
  }),
  useKardexTelaColor: (q: unknown) => useKardexTelaColor(q),
  // Partidas del color (para el filtro del cajón) y cancelación (inverso auditado).
  usePartidasTela: () => ({
    data: {
      datos: [
        {
          id: 1,
          folio: 1,
          idTelaColor: 11,
          telaColor: 'Marino Alsa 3040',
          idTela: 1,
          tela: 'Felpa Suiza',
          loteProveedor: 'L-778',
          factura: null,
          fecha: '2026-08-06',
          creadoEn: '2026-08-06T12:00:00.000Z',
        },
        // Fila 0.177: hacen falta DOS partidas más para poder reproducir el reparto FIFO (un
        // traspaso que sale de dos partidas) y luego filtrar a la partida de OTRO movimiento.
        {
          id: 2,
          folio: 2,
          idTelaColor: 11,
          telaColor: 'Marino Alsa 3040',
          idTela: 1,
          tela: 'Felpa Suiza',
          loteProveedor: 'L-779',
          factura: null,
          fecha: '2026-08-07',
          creadoEn: '2026-08-07T12:00:00.000Z',
        },
        {
          id: 3,
          folio: 3,
          idTelaColor: 11,
          telaColor: 'Marino Alsa 3040',
          idTela: 1,
          tela: 'Felpa Suiza',
          loteProveedor: 'L-780',
          factura: null,
          fecha: '2026-08-08',
          creadoEn: '2026-08-08T12:00:00.000Z',
        },
      ],
    },
    isPending: false,
    isError: false,
  }),
  useCancelarTelaColor: () => ({ mutate: cancelarMutate, isPending: false }),
  urlImpresoTraspasoTela: (id: number) => `/api/inventarios/telas/traspasos/${String(id)}/impreso`,
  // El doble del constructor de la URL ECHA los filtros en el querystring (igual que el real): así
  // la prueba del botón puede distinguir "manda los filtros" de "manda una URL pelona".
  urlImpresoInventarioTelas: (query: Record<string, unknown> = {}) => {
    const qs = Object.entries(query)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('&');
    return `/api/inventarios/telas/impreso${qs.length > 0 ? `?${qs}` : ''}`;
  },
}));
// `etiquetaUnidadTela` salió de la pantalla a `@/api/telas` para que todas escriban igual la
// unidad (kg/m) — el mock la incluye porque la tabla la usa en cada renglón.
vi.mock('@/api/telas', () => ({
  useTelasCategorias: () => ({ data: { datos: [] } }),
  etiquetaUnidadTela: (unidad: 'KG' | 'M') => (unidad === 'KG' ? 'kg' : 'm'),
}));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] } }),
  // V1-E3f (§Post-F9.52 punto 7): los selectores de proveedor pasaron al `ComboboxBuscable` con
  // búsqueda en el SERVIDOR, que consume estos dos hooks.
  useProveedoresPorRol: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useRolesProveedor: () => ({ data: [], isPending: false }),
}));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));

describe('ExistenciasTelasColorPagina (A2 — inventario nuevo por color)', () => {
  it('agrupa TELA PADRE → colores con cuerpo y complemento juntos', () => {
    useKardexTelaColor.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    // Tabla (escritorio) y tarjetas (móvil) montadas a la vez (la visibilidad es de Tailwind).
    expect(screen.getByTestId('telas-color-tabla')).toBeInTheDocument();
    expect(screen.getByTestId('telas-color-tarjetas')).toBeInTheDocument();
    // Las telas padre y sus colores (arrancan desplegadas).
    expect(screen.getAllByText('Felpa Suiza').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Marino Alsa 3040').length).toBeGreaterThan(0);
    // El pantone del color se ve.
    expect(screen.getAllByText('19-3920').length).toBeGreaterThan(0);
    // Totales del pie (cuerpo y complemento).
    expect(screen.getByText('Cuerpo:')).toBeInTheDocument();
    expect(screen.getByText('Complemento:')).toBeInTheDocument();
  });

  it('la tela SIN complemento muestra "—" en esa columna', () => {
    useKardexTelaColor.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    const filaNegro = screen.getByTestId('telas-color-fila-21');
    expect(filaNegro).toHaveTextContent('—');
  });

  it('colapsa y re-expande los colores de una tela con el toggle', () => {
    useKardexTelaColor.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    expect(screen.getByTestId('telas-color-fila-11')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('telas-color-toggle-1'));
    expect(screen.queryByTestId('telas-color-fila-11')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('telas-color-toggle-1'));
    expect(screen.getByTestId('telas-color-fila-11')).toBeInTheDocument();
  });

  it('el botón de kardex (y el doble clic) abren el cajón con el saldo de ambos componentes', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: kardex, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    // El botón explícito (móvil y escritorio)…
    const [botonKardex] = screen.getAllByLabelText('Kardex de Felpa Suiza Marino Alsa 3040');
    expect(botonKardex).toBeDefined();
    if (botonKardex === undefined) return; // estrecha el tipo (sin `!`)
    fireEvent.click(botonKardex);
    // …abre el cajón con el kardex del color (partida + saldos corridos).
    expect(screen.getByText('Kardex · Felpa Suiza · Marino Alsa 3040')).toBeInTheDocument();
    expect(screen.getByTestId('kardex-color-tabla')).toBeInTheDocument();
    expect(screen.getByText('#1 · L-778')).toBeInTheDocument();
    // La consulta se pidió con el color correcto.
    expect(useKardexTelaColor).toHaveBeenCalledWith(expect.objectContaining({ idTelaColor: 11 }));
  });

  it('con permiso de mover, el kardex ofrece cancelar (inverso auditado) y filtrar por partida', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: kardex, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));
    // El filtro por partida está montado con la partida del color.
    expect(screen.getByTestId('kardex-color-partida')).toBeInTheDocument();
    expect(screen.getByText('Partida #1 · L-778')).toBeInTheDocument();
    // El botón de cancelar abre el diálogo (motivo obligatorio) y dispara la mutación.
    fireEvent.click(screen.getByTestId('kardex-color-cancelar-1'));
    fireEvent.change(screen.getByTestId('mat-motivo-cancelar'), {
      target: { value: 'Captura equivocada' },
    });
    fireEvent.click(screen.getByTestId('confirmar-cancelar-material'));
    expect(cancelarMutate).toHaveBeenCalledWith(
      { id: 1, cuerpo: { motivo: 'Captura equivocada' } },
      expect.anything(),
    );
  });

  // ── fila 0.173: el cajón del kardex también tiene PERIODO, y tiene que decirlo ─────────────
  //
  // ⭐ Este kardex pedía el histórico entero del color. Ahora el servidor recorta con una ventana
  // por omisión; si el cajón no dijera el periodo, esa ventana se leería como «este color no tiene
  // más movimientos» — que es la mentira que la fila 0.138 ya había cerrado en producto terminado.
  it('⭐ el cajón dice qué PERIODO está viendo y manda las fechas al servidor', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: kardex, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));

    const periodo = screen.getByTestId('kardex-color-periodo');
    expect(periodo).toHaveTextContent('2025-09-05');
    expect(periodo).toHaveTextContent(/últimos 12 meses por omisión/);
    // Sin techo NO se dice «a hoy» (el servidor lo deja abierto a propósito).
    expect(periodo).not.toHaveTextContent(/hoy/);

    // Y las fechas VIAJAN: la pantalla no recorta lo que ya llegó.
    fireEvent.change(screen.getByTestId('kardex-color-desde'), {
      target: { value: '2026-06-01' },
    });
    expect(useKardexTelaColor).toHaveBeenLastCalledWith(
      expect.objectContaining({ idTelaColor: 11, desde: '2026-06-01' }),
    );
  });

  /**
   * ⭐⭐ EL SALDO ANTERIOR SE PINTA, o las DOS columnas «Saldo» mienten. Con periodo, el primer
   * renglón visible no arranca de cero: arranca de lo que el almacén ya traía.
   */
  it('⭐⭐ el cajón pinta el SALDO ANTERIOR (cuerpo y complemento) de donde arranca la columna', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : {
            data: {
              ...kardex,
              saldosIniciales: [
                { idAlmacen: 5, almacen: 'Bodega A', saldoCuerpo: 300, saldoComplemento: 120 },
              ],
            },
            isPending: false,
            isError: false,
          },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));
    const fila = screen.getByTestId('kardex-color-saldo-inicial');
    expect(fila).toHaveTextContent('Bodega A');
    expect(fila).toHaveTextContent('300');
    expect(fila).toHaveTextContent('120');
  });

  it('y si el cajón vino CORTADO lo dice (nadie debe creer que está viendo todo)', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: { ...kardex, truncado: true, limite: 1000 }, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));
    expect(screen.getByTestId('kardex-color-truncado')).toHaveTextContent(/más\s+RECIENTES/);
  });

  it('sin acciones que ofrecer, el kardex NO pinta la columna de acciones (a quien solo consulta)', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: kardex, isPending: false, isError: false },
    );
    // Solo `.ver` y ningún renglón de traspaso: no hay cancelar ni hoja que imprimir.
    const { unmount } = renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));
    // 12 columnas de datos (5 + 3 del cuerpo + 3 del complemento + «Observaciones», fila 0.176),
    // sin la vacía de acciones.
    const encabezados = () =>
      screen.getByTestId('kardex-color-tabla').querySelectorAll('thead th').length;
    expect(encabezados()).toBe(12);
    unmount();

    // Con `.mover` sí hay algo que ofrecer (cancelar) → la columna vuelve.
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));
    expect(encabezados()).toBe(13);
  });

  it('sin permiso de mover, el kardex NO ofrece cancelar', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: kardex, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));
    expect(screen.queryByTestId('kardex-color-cancelar-1')).not.toBeInTheDocument();
  });

  // ── §Post-F9.38: la hoja del traspaso se REIMPRIME desde el historial ───────
  it('el kardex ofrece REIMPRIMIR la hoja de un traspaso (solo con `.ver`, sin `.mover`)', () => {
    const conTraspaso: KardexTelaColor = {
      ...kardex,
      renglones: [
        ...kardex.renglones,
        {
          ...(kardex.renglones[0] as KardexTelaColor['renglones'][number]),
          idMovimiento: 2,
          folio: 2,
          tipoMov: 'Transferencia entre Almacenes (Salida)',
          direccion: 'salida',
          entradaCuerpo: 0,
          salidaCuerpo: 20,
          origenTipo: 'traspaso',
        },
      ],
    };
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: conTraspaso, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));

    // El traspaso sí ofrece su hoja; un movimiento manual no (no hay bulto que acompañar).
    expect(screen.getByTestId('kardex-color-imprimir-2')).toBeInTheDocument();
    expect(screen.queryByTestId('kardex-color-imprimir-1')).not.toBeInTheDocument();
  });

  it('un traspaso CANCELADO no se puede reimprimir (su papel no vuelve a salir con un bulto)', () => {
    const cancelado: KardexTelaColor = {
      ...kardex,
      renglones: [
        {
          ...(kardex.renglones[0] as KardexTelaColor['renglones'][number]),
          idMovimiento: 3,
          folio: 3,
          origenTipo: 'traspaso',
          cancelado: true,
        },
      ],
    };
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: cancelado, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));
    expect(screen.queryByTestId('kardex-color-imprimir-3')).not.toBeInTheDocument();
  });

  it('el doble clic en el renglón del color también abre el kardex', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: kardex, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));
    expect(screen.getByText('Kardex · Felpa Suiza · Marino Alsa 3040')).toBeInTheDocument();
  });

  /**
   * ⭐⭐ FILA 0.176 — EL MOTIVO DEL TRASPASO SE PUEDE LEER.
   *
   * Éste es EL kardex donde importa: la 0.172 volvió OBLIGATORIO el motivo del traspaso de tela por
   * color, y `traspasarTelaColor` lo guarda en las `observaciones` de las dos patas. El backend ya
   * lo devolvía (`kardexTelaColor`) y hasta el fixture de este archivo ya lo traía — lo que faltaba
   * era la columna. Sin ella se exigía una explicación que después no salía en ninguna pantalla.
   *
   * ⚠️ A diferencia del kardex de materiales, este cajón tiene UNA SOLA superficie (una tabla con
   * scroll horizontal): no hay tarjetas de móvil dentro del cajón, así que no hay una segunda
   * superficie que pueda tapar el hueco. Se ancla igual con `within` para que la aserción no pueda
   * cumplirse con texto de la pantalla de existencias que está debajo.
   */
  it('⭐⭐ el kardex enseña el MOTIVO del movimiento (fila 0.176)', () => {
    const conMotivo: KardexTelaColor = {
      ...kardexFifo,
      renglones: [
        { ...renglonBase, idMovimiento: 9, folio: 90, observaciones: null },
        {
          ...renglonBase,
          idMovimiento: 7,
          folio: 70,
          tipoMov: 'Traspaso (Salida)',
          origenTipo: 'traspaso',
          observaciones: 'Al cortador Ríos para la OP 4471',
        },
      ],
    };
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: conMotivo, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));

    const celdas = within(screen.getByTestId('kardex-color-tabla')).getAllByTestId(
      'kardex-color-obs',
    );
    expect(celdas).toHaveLength(2);
    // Sin motivo, la celda dice «—»: la tabla no puede descuadrarse por un renglón sin nota.
    expect(celdas[0]).toHaveTextContent('—');
    // Y el motivo del traspaso —el que la 0.172 volvió obligatorio— se LEE.
    expect(celdas[1]).toHaveTextContent('Al cortador Ríos para la OP 4471');
    // Completo en el `title`, porque la celda trunca: un motivo largo no puede quedar ilegible.
    expect(celdas[1]).toHaveAttribute('title', 'Al cortador Ríos para la OP 4471');
  });

  /**
   * ⭐⭐ FILA 0.177 — LA LLAVE DEL RENGLÓN LLEVA EL ÍNDICE, O EL CAJÓN ENSEÑA UN FANTASMA.
   *
   * La llave era `idMovimiento-idAlmacen-folio`, y esos tres campos COLISIONAN justo en el caso que
   * el sistema ya documenta: un traspaso que se reparte FIFO entre partidas escribe varios detalles
   * del MISMO `Movimiento`, y `kardexTelaColor` emite un renglón por detalle.
   *
   * ⚠️ Lo que NO se mide aquí es el aviso de React («Encountered two children with the same key»):
   * la configuración de pruebas del frontend no convierte `console.error` en fallo, así que una
   * prueba apoyada en el warning no mediría NADA. Y medir el número de renglones del PRIMER pintado
   * tampoco sirve: se comprobó que React 19 pinta los 3 renglones igual, con llave repetida o sin
   * ella. Lo que sí rompe —y es lo que esta prueba fija— es la RECONCILIACIÓN: al filtrar por una
   * partida, React reusa el fiber equivocado y deja en pantalla un renglón de un movimiento que el
   * servidor ya no mandó. Un movimiento fantasma en un kardex.
   */
  it('⭐⭐ al filtrar por partida no queda ningún renglón FANTASMA (llave con índice)', () => {
    useKardexTelaColor.mockImplementation((q) => {
      if (q === undefined) {
        return { data: undefined, isPending: true, isError: false };
      }
      // El SERVIDOR filtra por partida (la pantalla no recorta lo que ya llegó): el doble hace lo
      // mismo, para que lo que se mide sea el re-pintado con la lista nueva.
      const { idPartida } = q as { idPartida?: number };
      return {
        data:
          idPartida === undefined
            ? kardexFifo
            : {
                ...kardexFifo,
                renglones: kardexFifo.renglones.filter((r) => r.idPartida === idPartida),
              },
        isPending: false,
        isError: false,
      };
    });
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));

    // Sin filtro: los 3 renglones (las dos patas FIFO del traspaso #70 + el movimiento #80).
    const cuerpo = (): Element[] => [
      ...screen.getByTestId('kardex-color-tabla').querySelectorAll('tbody tr'),
    ];
    expect(cuerpo()).toHaveLength(3);

    // Se filtra a la partida #3, que SOLO toca el movimiento #80: el servidor manda UN renglón.
    fireEvent.change(screen.getByTestId('kardex-color-partida'), { target: { value: '3' } });
    expect(useKardexTelaColor).toHaveBeenLastCalledWith(
      expect.objectContaining({ idTelaColor: 11, idPartida: 3 }),
    );

    // …y la pantalla enseña UNO, no dos. Con la llave colisionada aquí sobrevivía la pata FIFO
    // «#1 · L-778» del traspaso, que ya no está en la respuesta.
    const tabla = screen.getByTestId('kardex-color-tabla');
    expect(cuerpo()).toHaveLength(1);
    expect(within(tabla).getByText('#3 · L-780')).toBeInTheDocument();
    expect(within(tabla).queryByText('#1 · L-778')).not.toBeInTheDocument();
    expect(within(tabla).queryByText('#2 · L-779')).not.toBeInTheDocument();
  });

  // 🔴 fila 0.098 — el botón «Imprimir PDF» del inventario de telas colgaba de la vista LEGADA por
  // lote (y el impreso leía ESA consulta, la del inventario legado: hoja en blanco). Vive aquí,
  // con LOS filtros.
  it('ofrece imprimir el PDF con los MISMOS filtros que se están viendo', () => {
    useKardexTelaColor.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    const enlace = screen.getByTestId('telas-color-imprimir').closest('a');
    // Sin filtros: URL pelona.
    expect(enlace).toHaveAttribute('href', '/api/inventarios/telas/impreso');
    // Al mover un filtro de la pantalla, el enlace lo lleva (si el botón mandara una URL fija —el
    // defecto que se está arreglando— esta aserción moriría).
    fireEvent.click(screen.getByTestId('telas-color-ceros'));
    expect(screen.getByTestId('telas-color-imprimir').closest('a')).toHaveAttribute(
      'href',
      '/api/inventarios/telas/impreso?incluirCeros=true',
    );
  });
});
