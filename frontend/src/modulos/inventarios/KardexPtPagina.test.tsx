/**
 * Tests del KARDEX de PT, modo POR FOLIO — fila 0.100: la **reimpresión** de la hoja del traspaso.
 *
 * ⚠️ POR QUÉ EXISTEN: la hoja nació con UNA sola puerta, la barra que aparece al guardar en
 * `TraspasosPtPagina`. Con esa sola puerta, una impresora atascada, una pestaña cerrada o la simple
 * necesidad de una segunda copia dejaban el papel irrecuperable — en una fila que se llama «el
 * traspaso deja rastro». Ésta es la segunda puerta, la misma que la hoja de TELA ya tenía en
 * `ExistenciasTelasColorPagina` desde §Post-F9.38.
 *
 * Lo que se mide es la GUARDA, no sólo que el botón exista: la hoja es de traspasos, así que un
 * movimiento manual no la ofrece, y un traspaso CANCELADO tampoco (su papel no debe volver a salir
 * con un bulto). El backend rechaza los dos casos igual; el botón sólo evita ofrecer un camino que
 * terminaría en error.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiInventarios from '@/api/inventarios';
import type { Modelo } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { KardexPtPagina } from './KardexPtPagina';

const usePorFolioMock = vi.fn<() => Record<string, unknown>>();
/** Fila 0.138 — configurable, y ADEMÁS captura la query: así se ve QUÉ le pide la pantalla al API. */
const useKardexMock =
  vi.fn<
    (query: Record<string, unknown> | undefined, habilitado?: boolean) => Record<string, unknown>
  >();

vi.mock('@/api/inventarios', async (importarOriginal) => {
  // Solo se sustituyen los hooks (los que tocan la red). `urlImpresoTraspasoPt` se toma DEL MÓDULO
  // REAL: re-escribir aquí su literal haría que esta prueba afirmara su propio texto y no el del
  // código — con una copia, apuntar el helper a la ruta de TELA dejaba este archivo en VERDE. La
  // ruta en sí la fija `src/api/inventarios.impreso-traspaso.test.ts` contra el contrato.
  const real = await importarOriginal<typeof ApiInventarios>();
  return {
    useKardexPt: (query: Record<string, unknown> | undefined, habilitado?: boolean) =>
      useKardexMock(query, habilitado),
    useMovimientoPtPorFolio: () => usePorFolioMock(),
    useCancelarMovimientoPt: () => ({ mutate: vi.fn(), isPending: false }),
    urlImpresoTraspasoPt: real.urlImpresoTraspasoPt,
  };
});

/** Un modelo para poder ELEGIRLO en el combobox (los tests del periodo lo necesitan). */
const modeloDePrueba = {
  id: 1,
  codigo: 'A-100',
  descripcion: 'Playera',
  origen: 'produccion',
} as unknown as Modelo;

vi.mock('@/api/modelos', () => ({
  useModelos: () => ({
    data: { datos: [modeloDePrueba], total: 1, pagina: 1, porPagina: 8, totalPaginas: 1 },
    isPending: false,
    isError: false,
  }),
}));

/**
 * Un movimiento devuelto por «buscar por folio». `origenTipo` y `cancelado` YA venían en esta
 * respuesta antes de la fila 0.100: por eso la reimpresión no necesitó tocar el contrato.
 */
function movimiento(sobrescribir: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 200,
    folio: 9910,
    idEmpresa: 1,
    idTipoMov: 5,
    tipoMov: 'Transferencia (salida)',
    direccion: 'salida',
    idAlmacen: 3,
    almacen: 'Primeras',
    idModelo: 1,
    modelo: 'A-100',
    fecha: '2026-09-04',
    observaciones: 'Embarque del viernes',
    origenTipo: 'traspaso',
    cancelado: false,
    idMovimientoInverso: null,
    lineas: [
      {
        idColor: 7,
        color: 'Rojo',
        idOrden: null,
        folioOrden: null,
        tallas: [{ idTalla: 11, etiquetaTalla: 'CH', cantidad: 5 }],
        totalPiezas: 5,
      },
    ],
    totalPiezas: 5,
    creadoEn: '2026-09-04T10:00:00.000Z',
    creadoPorId: 'u-almacen',
    ...sobrescribir,
  };
}

const sesion = () => estadoSesionDePrueba(['inventario-pt.ver', 'inventario-pt.mover']);

/** Entra al modo «Por folio», escribe un folio y busca. */
async function buscarFolio(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  await usuario.click(screen.getByTestId('kardex-modo-folio'));
  await usuario.type(screen.getByTestId('kardex-folio-input'), '9910');
  await usuario.click(screen.getByTestId('kardex-folio-buscar'));
}

beforeEach(() => {
  useKardexMock.mockReset();
  useKardexMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
});

describe('KardexPtPagina · modo por folio — fila 0.100 (reimpresión de la hoja)', () => {
  beforeEach(() => {
    usePorFolioMock.mockReset();
    usePorFolioMock.mockReturnValue({
      data: movimiento(),
      isPending: false,
      isError: false,
    });
  });

  it('⭐ un TRASPASO vivo ofrece «Hoja del traspaso» y apunta al folio buscado', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await buscarFolio(usuario);

    const boton = screen.getByTestId('kardex-folio-imprimir');
    expect(boton).toBeInTheDocument();

    // Y ABRE la hoja de ESE movimiento: sin esto el botón podría existir apuntando a cualquier lado.
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    await usuario.click(boton);
    expect(abrir).toHaveBeenCalledWith(
      '/api/inventarios/pt/traspasos/200/impreso',
      '_blank',
      'noopener',
    );
    abrir.mockRestore();
  });

  it('un movimiento MANUAL no ofrece la hoja (no es un traspaso)', async () => {
    usePorFolioMock.mockReturnValue({
      data: movimiento({ origenTipo: 'movimiento-manual' }),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await buscarFolio(usuario);

    expect(screen.queryByTestId('kardex-folio-imprimir')).not.toBeInTheDocument();
    // Pero el detalle SÍ salió: lo que falta es el botón, no la pantalla.
    expect(screen.getByTestId('kardex-folio-detalle')).toBeInTheDocument();
  });

  it('⭐ un traspaso CANCELADO no se reimprime (su papel no vuelve a salir con un bulto)', async () => {
    usePorFolioMock.mockReturnValue({
      data: movimiento({ cancelado: true }),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await buscarFolio(usuario);

    expect(screen.queryByTestId('kardex-folio-imprimir')).not.toBeInTheDocument();
  });

  it('un movimiento con `origenTipo` NULL (migrado) tampoco la ofrece, y no truena', async () => {
    // REGLA 0-B: lo viejo se lee tal cual. `origenTipo` null no es un traspaso reconocible.
    usePorFolioMock.mockReturnValue({
      data: movimiento({ origenTipo: null }),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await buscarFolio(usuario);

    expect(screen.queryByTestId('kardex-folio-imprimir')).not.toBeInTheDocument();
    expect(screen.getByTestId('kardex-folio-detalle')).toBeInTheDocument();
  });

  it('la hoja se ofrece con SOLO `inventario-pt.ver` (leer y reimprimir no es mover)', async () => {
    // La reimpresión va con el permiso de VER, igual que la ruta del backend. Quien no puede mover
    // sigue pudiendo sacar el papel — y no ve el botón de cancelar.
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, {
      sesion: estadoSesionDePrueba(['inventario-pt.ver']),
    });
    await buscarFolio(usuario);

    expect(screen.getByTestId('kardex-folio-imprimir')).toBeInTheDocument();
    expect(screen.queryByTestId('kardex-folio-cancelar')).not.toBeInTheDocument();
  });
});

/**
 * ⭐ FILA 0.138 — EL PERIODO EN LA PANTALLA.
 *
 * El recorte lo hace el servidor; lo que a esta pantalla le toca es (1) MANDAR las fechas —no
 * recortar aquí lo que ya llegó— y (2) DECIR qué pedazo se está viendo. Lo segundo no es adorno:
 * con una ventana por omisión, una lista corta se leería como «este modelo no tiene más
 * movimientos», que es exactamente lo contrario de lo que pasa.
 */
describe('KardexPtPagina · modo por modelo — el PERIODO (fila 0.138)', () => {
  /** Respuesta del kardex con los campos del periodo (los mismos que declara el contrato). */
  function respuesta(sobrescribir: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      idModelo: 1,
      modelo: 'A-100',
      desde: '2025-09-05',
      hasta: null,
      ventanaPorOmision: true,
      limite: 1000,
      truncado: false,
      saldosIniciales: [],
      renglones: [
        {
          idMovimiento: 1,
          folio: 10,
          fecha: '2026-06-20',
          idTipoMov: 1,
          tipoMov: 'Inventario Inicial',
          direccion: 'entrada',
          idAlmacen: 3,
          almacen: 'Primeras',
          idColor: 7,
          color: 'Rojo',
          idTalla: 11,
          etiquetaTalla: 'CH',
          idOrden: null,
          folioOrden: null,
          numOrdenV1: null,
          entrada: 7,
          salida: 0,
          saldo: 37,
          cancelado: false,
          observaciones: null,
        },
      ],
      ...sobrescribir,
    };
  }

  /** Elige el modelo en el combobox (la tabla y el periodo sólo aparecen con modelo). */
  async function elegirModelo(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
    await usuario.click(screen.getByTestId('selector-modelo-busqueda'));
    await usuario.click(screen.getByTestId('selector-modelo-opcion'));
  }

  it('⭐ las fechas VIAJAN al servidor (la pantalla no recorta lo que ya llegó)', async () => {
    useKardexMock.mockReturnValue({ data: respuesta(), isPending: false, isError: false });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    // Sin fechas escritas no se mandan: el servidor pone su ventana por omisión.
    expect(useKardexMock).toHaveBeenLastCalledWith({ idModelo: 1 }, true);

    await usuario.type(screen.getByTestId('kardex-desde'), '2026-06-01');
    await usuario.type(screen.getByTestId('kardex-hasta'), '2026-06-30');

    expect(useKardexMock).toHaveBeenLastCalledWith(
      { idModelo: 1, desde: '2026-06-01', hasta: '2026-06-30' },
      true,
    );
  });

  it('⭐ dice QUÉ periodo está viendo, y avisa cuando es el de por omisión', async () => {
    useKardexMock.mockReturnValue({ data: respuesta(), isPending: false, isError: false });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    const periodo = screen.getByTestId('kardex-periodo');
    expect(periodo).toHaveTextContent('2025-09-05');
    expect(periodo).toHaveTextContent(/últimos 12 meses por omisión/);
  });

  /**
   * ⭐ SIN TECHO NO ES «HASTA HOY». El servidor deja `hasta` abierto a propósito para que salgan los
   * movimientos con fecha FUTURA (se capturan con la fecha del documento). La línea decía «a hoy» y
   * la tabla enseñaba un renglón de 2027: la única línea cuyo trabajo es no mentir, mintiendo.
   */
  it('⭐ sin fecha de corte NO dice «a hoy» (y la tabla sí trae fechas futuras)', async () => {
    useKardexMock.mockReturnValue({
      data: respuesta({
        desde: '2027-01-01',
        hasta: null,
        ventanaPorOmision: false,
        renglones: [
          { ...(respuesta().renglones as Record<string, unknown>[])[0], fecha: '2027-03-15' },
        ],
      }),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    const periodo = screen.getByTestId('kardex-periodo');
    expect(periodo).not.toHaveTextContent(/hoy/);
    expect(periodo).toHaveTextContent(/en adelante/);
    // Y el renglón posterior a hoy está ahí: por eso «a hoy» era falso, no impreciso.
    expect(screen.getByTestId('kardex-tabla')).toHaveTextContent('2027-03-15');
  });

  /**
   * ⭐ CON SÓLO «HASTA», la ventana son los 12 meses que TERMINAN ahí. Decir «últimos 12 meses por
   * omisión — pon fechas» era doblemente falso: ni son los últimos doce, ni el usuario dejó de
   * poner fechas (puso una).
   */
  it('⭐ con sólo «hasta», explica que son los 12 meses ANTERIORES a esa fecha', async () => {
    useKardexMock.mockReturnValue({
      data: respuesta({ desde: '2019-03-31', hasta: '2020-03-31', ventanaPorOmision: true }),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    const periodo = screen.getByTestId('kardex-periodo');
    expect(periodo).toHaveTextContent(/12 meses ANTERIORES a esa fecha/);
    expect(periodo).not.toHaveTextContent(/últimos 12 meses/);
  });

  it('con un periodo pedido a mano ya no dice «por omisión»', async () => {
    useKardexMock.mockReturnValue({
      data: respuesta({ desde: '2026-06-01', hasta: '2026-06-30', ventanaPorOmision: false }),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    const periodo = screen.getByTestId('kardex-periodo');
    expect(periodo).toHaveTextContent('2026-06-30');
    expect(periodo).not.toHaveTextContent(/por omisión/);
  });

  it('⭐ si la lista vino CORTADA lo dice — nadie debe creer que está viendo todo', async () => {
    useKardexMock.mockReturnValue({
      data: respuesta({ truncado: true, limite: 1000 }),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    // ⭐ Y dice QUÉ pedazo se ve: los más RECIENTES. Lo que se pierde es el principio del periodo.
    expect(screen.getByTestId('kardex-truncado')).toHaveTextContent(/más\s+RECIENTES/);
  });

  it('sin corte, no hay aviso (el aviso tiene que significar algo)', async () => {
    useKardexMock.mockReturnValue({ data: respuesta(), isPending: false, isError: false });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    expect(screen.queryByTestId('kardex-truncado')).not.toBeInTheDocument();
  });

  it('⭐ enseña el SALDO ANTERIOR: de ahí arranca la columna Saldo del periodo', async () => {
    useKardexMock.mockReturnValue({
      data: respuesta({
        saldosIniciales: [
          {
            idColor: 7,
            color: 'Rojo',
            idTalla: 11,
            etiquetaTalla: 'CH',
            idAlmacen: 3,
            almacen: 'Primeras',
            idOrden: null,
            folioOrden: null,
            saldo: 30,
          },
        ],
      }),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<KardexPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    const fila = screen.getByTestId('kardex-saldo-inicial');
    expect(fila).toHaveTextContent('Saldo anterior');
    expect(fila).toHaveTextContent('30');
    expect(fila).toHaveTextContent('Rojo');
  });
});
