import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Modelo } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { hoy } from './fecha-captura-pt';
import { MovimientosPtPagina } from './MovimientosPtPagina';

// ── Mocks de la capa de datos (sin red) ──────────────────────────────────────
const crearMutate = vi.fn();
// Configurable: se re-programa por test para probar el aviso de error de catálogo.
const useTiposMovimientoMock = vi.fn<() => Record<string, unknown>>();
// §Post-F9.40 — existencias del modelo en el almacén: de ahí salen las ÓRDENES del selector.
const useExistenciasPtMock =
  vi.fn<(query: Record<string, unknown>, habilitado?: boolean) => Record<string, unknown>>();
vi.mock('@/api/inventarios', () => ({
  useCrearMovimientoPt: () => ({ mutate: crearMutate, isPending: false }),
  useTiposMovimiento: () => useTiposMovimientoMock(),
  useExistenciasPt: (query: Record<string, unknown>, habilitado?: boolean) =>
    useExistenciasPtMock(query, habilitado),
}));

function fila(idOrden: number | null, folioOrden: number | null, existencia: number) {
  return { idModelo: 1, idColor: 7, idTalla: 11, idAlmacen: 3, idOrden, folioOrden, existencia };
}

/**
 * Consulta de SALIDA (modelo A-100 en el almacén 3): 20 pzas de la orden 55, 6 «sin orden» y la
 * orden 60 en CERO — el servidor la devolvería solo con `incluirCeros`, aquí está para comprobar
 * que la salida sí la descarta.
 */
const EXISTENCIAS_SALIDA = {
  data: {
    filas: [fila(55, 9001, 20), fila(null, null, 6), fila(60, 9002, 0)],
    totalExistencia: 26,
  },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

/**
 * Consulta de ENTRADA (`incluirCeros`, sin filtro de almacén): la orden 55 salió COMPLETA a
 * Aplicación y su bucket quedó en 0 — es justo la que tiene que poder elegirse al regresar.
 */
const EXISTENCIAS_ENTRADA = {
  data: {
    filas: [fila(55, 9001, 100), fila(55, 9001, -100), fila(null, null, 6)],
    totalExistencia: 6,
  },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

/** Lo que devuelve una query apagada (o aún sin responder): nada, y en «pendiente». */
const SIN_DATOS = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };

/** Enruta el mock según la consulta REAL que hace la pantalla (salida vs. entrada). */
function existenciasPorConsulta(
  query: Record<string, unknown>,
  habilitado?: boolean,
): Record<string, unknown> {
  if (habilitado === false) return SIN_DATOS;
  return query.incluirCeros === 'true' ? EXISTENCIAS_ENTRADA : EXISTENCIAS_SALIDA;
}

const TIPOS_MOV_OK = {
  data: {
    datos: [
      {
        id: 1,
        codigo: 'inventario-inicial',
        nombre: 'Inventario Inicial',
        direccion: 'entrada',
        capturaManual: true,
      },
      // La SALIDA legítima de siempre: existe desde el sistema viejo y el PT la usa a mano.
      {
        id: 5,
        codigo: 'otras-salidas',
        nombre: 'Otras Salidas',
        direccion: 'salida',
        capturaManual: true,
      },
      // ⛔ Fila 0.171 — «Entrega a Cliente» pasó a estar reservada al SISTEMA: la escribe la
      // entrega (que además marca la orden y alimenta la RC), no una captura. Va con dirección
      // `salida` y `capturaManual: false`, como la manda el servidor.
      {
        id: 6,
        codigo: 'entrega-cliente',
        nombre: 'Entrega a Cliente',
        direccion: 'salida',
        capturaManual: false,
      },
      // ⛔ Fila 0.171 — de los doce del sistema: es el rótulo que se estampa al CANCELAR.
      {
        id: 11,
        codigo: 'error-entrada',
        nombre: 'Error de Entrada',
        direccion: 'salida',
        capturaManual: false,
      },
      // ⛔ Fila 0.171 — LA PATA de un traspaso. Va con dirección `salida` a propósito: el filtro por
      // dirección (que excluye `transferencia-almacenes`, el tipo viejo) NO la ve, así que hasta
      // esta fila se ofrecía. Capturarla a mano es media transferencia: sale del origen y no entra
      // a ningún destino.
      {
        id: 21,
        codigo: 'transferencia-salida',
        nombre: 'Transferencia entre Almacenes (Salida)',
        direccion: 'salida',
        capturaManual: false,
      },
      {
        id: 9,
        codigo: 'transferencia-almacenes',
        nombre: 'Transferencia entre almacenes',
        direccion: 'traspaso',
        capturaManual: true,
      },
      // ⛔ Fila 0.104 — los dos rótulos RESERVADOS a la salida de material sin orden. El catálogo
      // de tipos es GLOBAL, así que el API los DEVUELVE también aquí; lo que no puede pasar es que
      // esta pantalla los OFREZCA (el servidor los rechaza igual, pero no se enseña una puerta que
      // no abre). Van con dirección `salida` a propósito: el filtro viejo, que sólo miraba
      // `direccion !== 'traspaso'`, los dejaba pasar.
      {
        id: 30,
        codigo: 'devolucion-proveedor',
        nombre: 'Devolución a Proveedor',
        direccion: 'salida',
        capturaManual: false,
      },
      {
        id: 31,
        codigo: 'venta-material',
        nombre: 'Venta de Material',
        direccion: 'salida',
        capturaManual: false,
      },
    ],
  },
  isError: false,
  refetch: vi.fn(),
};

/**
 * Catálogo de mentiras con LOS TRES tipos de almacén (fila 0.137). El mock de `useAlmacenes` filtra
 * por el `tipo` que pide la pantalla: si la pantalla se olvidara de pedirlo, los tres saldrían en el
 * desplegable y la prueba lo cazaría — que es justo lo que se quiere fijar, y no un
 * `toHaveBeenCalledWith` que solo mira la consulta.
 */
const ALMACENES_TODOS = [
  { id: 3, nombre: 'Primeras', tipo: 'PT' },
  { id: 5, nombre: 'Naucalpan', tipo: 'TELA' },
  { id: 7, nombre: 'Almacén de avíos', tipo: 'AVIO' },
];

/** Los del `tipo` pedido (o todos si la pantalla no filtra — el caso que la prueba caza). */
function almacenesDelTipo(query: { tipo?: string } | undefined) {
  const tipo = query?.tipo;
  return tipo === undefined ? ALMACENES_TODOS : ALMACENES_TODOS.filter((a) => a.tipo === tipo);
}

vi.mock('@/api/almacenes', () => ({
  useAlmacenes: (query: { tipo?: string } | undefined) => ({
    data: { datos: almacenesDelTipo(query) },
  }),
}));
vi.mock('@/api/colores', () => ({
  useColores: () => ({ data: { datos: [{ id: 7, nombre: 'Rojo' }] } }),
}));
vi.mock('@/api/tallas', () => ({
  useTallas: () => ({ data: { datos: [{ id: 11, etiqueta: 'CH', orden: 1 }] } }),
}));

const modelo: Modelo = {
  id: 1,
  codigo: 'A-100',
  descripcion: 'Playera',
  activo: true,
} as unknown as Modelo;

vi.mock('@/api/modelos', () => ({
  useModelos: () => ({
    data: { datos: [modelo], total: 1, pagina: 1, porPagina: 8, totalPaginas: 1 },
    isPending: false,
    isError: false,
  }),
}));

const sesion = () => estadoSesionDePrueba(['inventario-pt.ver', 'inventario-pt.mover']);
/** La misma sesión CON la llave de fecha libre (ex acceso #28 del viejo, fila 0.171). */
const sesionConFechaLibre = () =>
  estadoSesionDePrueba(['inventario-pt.ver', 'inventario-pt.mover', 'ipt.fecha-libre']);

/** Fila 0.100 — el motivo es OBLIGATORIO: sin él el botón de guardar no se habilita. */
async function ponerMotivo(
  usuario: ReturnType<typeof userEvent.setup>,
  texto = 'Conteo físico de septiembre',
): Promise<void> {
  await usuario.type(screen.getByTestId('mov-motivo'), texto);
}

async function elegirModelo(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  // El selector es un combobox POPOVER (R9): la lista abre al enfocar el input de búsqueda.
  await usuario.click(screen.getByTestId('selector-modelo-busqueda'));
  await usuario.click(screen.getByTestId('selector-modelo-opcion'));
}

describe('MovimientosPtPagina (F3-E3)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    useTiposMovimientoMock.mockReset();
    useTiposMovimientoMock.mockReturnValue(TIPOS_MOV_OK);
    useExistenciasPtMock.mockReset();
    useExistenciasPtMock.mockImplementation(existenciasPorConsulta);
  });

  /**
   * Fila 0.137 — el desplegable de almacenes sólo ofrece los de PT. El filtro lo aplica el SERVIDOR
   * (la pantalla pide la lista ya acotada): si se olvidara, el mock devolvería los tres tipos y la
   * bodega de telas aparecería aquí — el mismo cruce que el dominio ya rechaza con un 400.
   */
  it('el desplegable de almacenes SOLO ofrece los de PT (fila 0.137)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    const selector = within(screen.getByTestId('mov-almacen'));
    expect(selector.getByRole('option', { name: 'Primeras' })).toBeInTheDocument();
    expect(selector.queryByRole('option', { name: 'Naucalpan' })).not.toBeInTheDocument();
    expect(selector.queryByRole('option', { name: 'Almacén de avíos' })).not.toBeInTheDocument();
  });

  it('avisa (reintentable) si falla un catálogo de la captura', () => {
    useTiposMovimientoMock.mockReturnValue({ data: undefined, isError: true, refetch: vi.fn() });
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });

    expect(screen.getByTestId('mov-error-catalogo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('el dropdown de tipo EXCLUYE las direcciones "traspaso"', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    const opciones = screen.getByTestId('mov-tipo').querySelectorAll('option');
    const textos = [...opciones].map((o) => o.textContent ?? '');
    expect(textos.some((t) => t.includes('Inventario Inicial'))).toBe(true);
    expect(textos.some((t) => t.includes('Otras Salidas'))).toBe(true);
    expect(textos.some((t) => t.includes('Transferencia entre almacenes'))).toBe(false);
  });

  it('⛔ el dropdown NO ofrece los rótulos RESERVADOS (fila 0.104 + fila 0.171)', async () => {
    // «Devolución a Proveedor» y «Venta de Material» nacieron en la 0.104 para telas y avíos, pero
    // el catálogo de tipos es GLOBAL: se colaban aquí, y cualquiera con `inventario-pt.mover`
    // —que son 8 de los 9 perfiles— podía estampar el rótulo que Daniel se reservó. Quien luego
    // leyera el kardex creería que esa salida la autorizó él. La venta de producto terminado tiene
    // su propia fila (0.130), con cliente y precio.
    //
    // Fila 0.171 — y a esos dos se suman los DOCE que escribe SÓLO el sistema (las dos patas de un
    // traspaso, los dos rótulos de una cancelación, los dos del ajuste por cíclico, la recepción,
    // la salida de tela a orden, la de avío por nota, el recibo de maquila, la entrega y la merma).
    // Son dos reservas distintas: los de la 0.104 SÍ los captura la dirección por su pantalla;
    // éstos no los captura nadie, nunca.
    //
    // Ojo con lo que fija esta prueba: NO basta con excluir por dirección (todos son `salida`,
    // igual que «Otras Salidas», que sí debe estar). La pantalla se fía de la bandera
    // `capturaManual` que decide el SERVIDOR, para no repetir los códigos aquí.
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    const textos = [...screen.getByTestId('mov-tipo').querySelectorAll('option')].map(
      (o) => o.textContent ?? '',
    );
    expect(textos.some((t) => t.includes('Devolución a Proveedor'))).toBe(false);
    expect(textos.some((t) => t.includes('Venta de Material'))).toBe(false);
    // ⭐ Fila 0.171 — y tampoco los que escribe SÓLO el sistema. «Error de Entrada» es el peor: es
    // el rótulo de una CANCELACIÓN, así que a mano el kardex afirmaría una que nunca ocurrió.
    expect(textos.some((t) => t.includes('Entrega a Cliente'))).toBe(false);
    expect(textos.some((t) => t.includes('Error de Entrada'))).toBe(false);
    // ⭐ Y la pata del traspaso, que es la que el filtro por dirección NO alcanzaba.
    expect(textos.some((t) => t.includes('Transferencia entre Almacenes (Salida)'))).toBe(false);
    // Y las salidas legítimas siguen ahí: la reserva no se llevó por delante lo de siempre.
    expect(textos.some((t) => t.includes('Otras Salidas'))).toBe(true);
  });

  it('guardar arranca DESHABILITADO y se habilita al completar la captura', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    expect(screen.getByTestId('mov-guardar')).toBeDisabled();

    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1');
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
    // La matriz arranca vacía: se agrega un color y una talla del catálogo, luego se captura.
    await usuario.selectOptions(screen.getByTestId('mov-matriz-agregar-color'), '7');
    await usuario.selectOptions(screen.getByTestId('mov-matriz-agregar-talla'), '11');
    const celda = screen.getByTestId('mov-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '12');

    await ponerMotivo(usuario);

    const guardar = screen.getByTestId('mov-guardar');
    expect(guardar).toBeEnabled();
    await usuario.click(guardar);
    expect(crearMutate).toHaveBeenCalledTimes(1);
    const [cuerpo] = crearMutate.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo.idTipoMov).toBe(1);
    expect(cuerpo.idAlmacen).toBe(3);
    expect(cuerpo.idModelo).toBe(1);
  });

  // ── §Post-F9.40: el PT etiquetado por orden se puede mover ──────────────────
  it('en una SALIDA el selector ofrece solo las órdenes CON EXISTENCIA aquí, más «sin orden»', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);
    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // Otras Salidas (salida)
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

    const opciones = [...screen.getByTestId('mov-orden').querySelectorAll('option')];
    // La orden 60 está en CERO: de un bucket vacío no se puede sacar, así que no se ofrece.
    expect(opciones.map((o) => o.value)).toEqual(['sin', '55']);
    expect(opciones[1]?.textContent).toContain('9001'); // el folio, no el id interno
    expect(opciones[1]?.textContent).toContain('20'); // las piezas de ESE bucket (sí son el tope)
  });

  // ── El va-y-ven de estampado: lo que sale de una orden puede VOLVER a ella ───
  it('en una ENTRADA ofrece también la orden cuyo bucket quedó en CERO', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);
    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1'); // Inventario Inicial (entrada)
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

    const opciones = [...screen.getByTestId('mov-orden').querySelectorAll('option')];
    expect(opciones.map((o) => o.value)).toEqual(['sin', '55']);
    // En una entrada el disponible NO es un tope: no se anuncian piezas (un "0 pzas" se leería
    // como que esa orden no se puede elegir, y sí se puede).
    expect(opciones[1]?.textContent).toContain('9001');
    expect(opciones[1]?.textContent).not.toContain('pzas');
    expect(opciones[0]?.textContent).not.toContain('pzas');
  });

  it('la ENTRADA a una orden en cero manda su idOrden (las piezas regresan a su producción)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1'); // entrada
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
    await usuario.selectOptions(screen.getByTestId('mov-orden'), '55');
    await usuario.selectOptions(screen.getByTestId('mov-matriz-agregar-color'), '7');
    await usuario.selectOptions(screen.getByTestId('mov-matriz-agregar-talla'), '11');
    const celda = screen.getByTestId('mov-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '100');

    await ponerMotivo(usuario);
    await usuario.click(screen.getByTestId('mov-guardar'));
    const [cuerpo] = crearMutate.mock.calls[0] as [{ lineas: { idOrden?: number }[] }];
    expect(cuerpo.lineas[0]?.idOrden).toBe(55);
  });

  it('la consulta de ENTRADA pide los ceros y NO filtra por almacén', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);
    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1'); // entrada
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

    // La query encendida (2º argumento `true`) tiene que ser la de entrada: con `incluirCeros` y
    // sin `idAlmacen` (las piezas pueden regresar a otro almacén sin perder su orden).
    const encendidas = useExistenciasPtMock.mock.calls.filter(([, habilitado]) => habilitado);
    const ultima = encendidas.at(-1);
    expect(ultima?.[0]).toEqual({ idModelo: 1, incluirCeros: 'true' });
  });

  it('manda el idOrden elegido en cada renglón (sale del bucket de esa orden)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // salida
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
    await usuario.selectOptions(screen.getByTestId('mov-orden'), '55');
    await usuario.selectOptions(screen.getByTestId('mov-matriz-agregar-color'), '7');
    await usuario.selectOptions(screen.getByTestId('mov-matriz-agregar-talla'), '11');
    const celda = screen.getByTestId('mov-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '4');

    await ponerMotivo(usuario);
    await usuario.click(screen.getByTestId('mov-guardar'));
    const [cuerpo] = crearMutate.mock.calls[0] as [{ lineas: { idOrden?: number }[] }];
    expect(cuerpo.lineas[0]?.idOrden).toBe(55);
  });

  it('por default el movimiento sale del bucket «sin orden» (no manda idOrden)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1');
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
    await usuario.selectOptions(screen.getByTestId('mov-matriz-agregar-color'), '7');
    await usuario.selectOptions(screen.getByTestId('mov-matriz-agregar-talla'), '11');
    const celda = screen.getByTestId('mov-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '3');

    await ponerMotivo(usuario);
    await usuario.click(screen.getByTestId('mov-guardar'));
    const [cuerpo] = crearMutate.mock.calls[0] as [{ lineas: Record<string, unknown>[] }];
    expect(cuerpo.lineas[0]).not.toHaveProperty('idOrden');
  });

  it('si NO se pueden leer las existencias lo DICE (no inventa órdenes)', async () => {
    const usuario = userEvent.setup();
    useExistenciasPtMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

    expect(screen.getByTestId('mov-orden-error')).toBeInTheDocument();
    const opciones = [...screen.getByTestId('mov-orden').querySelectorAll('option')];
    expect(opciones.map((o) => o.value)).toEqual(['sin']);
  });

  // ── Fila 0.100: motivo obligatorio al meter o sacar PT a mano (§Post-F9.193) ─
  describe('Fila 0.100 · el motivo es obligatorio', () => {
    /** Deja la pantalla lista para guardar, SIN motivo. */
    async function capturaSinMotivo(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1');
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
      await usuario.selectOptions(screen.getByTestId('mov-matriz-agregar-color'), '7');
      await usuario.selectOptions(screen.getByTestId('mov-matriz-agregar-talla'), '11');
      const celda = screen.getByTestId('mov-matriz-celda');
      await usuario.clear(celda);
      await usuario.type(celda, '12');
    }

    it('el campo existe y está rotulado como obligatorio', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);

      expect(screen.getByTestId('mov-motivo')).toBeInTheDocument();
      expect(screen.getByText(/Motivo \(obligatorio\)/i)).toBeInTheDocument();
    });

    it('SIN motivo no deja guardar, aunque todo lo demás esté capturado', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await capturaSinMotivo(usuario);

      expect(screen.getByTestId('mov-guardar')).toBeDisabled();
      expect(crearMutate).not.toHaveBeenCalled();
    });

    it('un motivo DEMASIADO CORTO tampoco habilita (mismo mínimo que el servidor)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await capturaSinMotivo(usuario);
      await ponerMotivo(usuario, 'ab');

      expect(screen.getByTestId('mov-guardar')).toBeDisabled();
    });

    it('⭐ con motivo lo MANDA recortado, y al guardar el campo QUEDA VACÍO', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await capturaSinMotivo(usuario);
      await ponerMotivo(usuario, '  Merma por manchas  ');

      await usuario.click(screen.getByTestId('mov-guardar'));
      const [cuerpo, opciones] = crearMutate.mock.calls[0] as [
        Record<string, unknown>,
        { onSuccess: (mov: unknown) => void },
      ];
      expect(cuerpo.motivo).toBe('Merma por manchas');
      expect(cuerpo.observaciones).toBeUndefined();

      // ⭐ Y el campo se VACÍA al guardar. Si ese reset se perdiera, el motivo del movimiento
      // anterior quedaría pegado, seguiría siendo válido (≥3 caracteres) y se adjuntaría EN
      // SILENCIO al siguiente: una palabra equivocada en el rastro es peor que ninguna, y el
      // rastro es justo lo que esta fila vino a construir.
      act(() => {
        opciones.onSuccess({ folio: 4321, totalPiezas: 12 });
      });
      expect(screen.getByTestId('mov-motivo')).toHaveValue('');
    });
  });

  /**
   * ⏳ Fila 0.171 — LA VENTANA DE FECHA. La guarda de verdad está en el dominio (sin
   * `ipt.fecha-libre`, sólo los últimos 7 días y nunca futura); esto sólo fija que la pantalla no
   * ofrezca una fecha que el servidor va a rebotar. Se mide con `min`/`max` porque es lo que
   * acota el selector nativo sin pintar un control roto.
   */
  describe('la fecha del movimiento (fila 0.171, ex acceso #28)', () => {
    it('SIN `ipt.fecha-libre` el selector se acota a la ventana (min = hace 7 días, max = hoy)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      // El campo de fecha sólo se pinta con un modelo elegido (la captura arranca por ahí).
      await elegirModelo(usuario);
      const campo = screen.getByTestId('mov-fecha');
      // ⚠️ El `min` se calcula APARTE, no con la misma función que lo produce: si se afirmara con
      // `inicioVentanaCapturaPt()` la prueba diría «el helper es igual a sí mismo» y un error de
      // aritmética pasaría en verde. Aquí se mide lo que importa: son 7 días completos hacia atrás.
      // ⏳ Fila 0.174: se cuenta sobre el día DEL NEGOCIO (México), no sobre el día UTC. Contarlo
      // en UTC ataba esta prueba a la hora a la que corriera: de 18:00 a 23:59 de México el día
      // UTC va uno adelante y el `min` esperado salía corrido un día.
      const hoyDelNegocio = new Date().toLocaleDateString('en-CA', {
        timeZone: 'America/Mexico_City',
      });
      const sieteAtras = new Date(Date.parse(`${hoyDelNegocio}T00:00:00.000Z`) - 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(campo).toHaveAttribute('max', hoy());
      expect(campo).toHaveAttribute('min', sieteAtras);
    });

    it('CON `ipt.fecha-libre` no hay tope: cualquier fecha (gemela positiva)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesionConFechaLibre() });
      await elegirModelo(usuario);
      const campo = screen.getByTestId('mov-fecha');
      expect(campo).not.toHaveAttribute('min');
      expect(campo).not.toHaveAttribute('max');
    });
  });
});
