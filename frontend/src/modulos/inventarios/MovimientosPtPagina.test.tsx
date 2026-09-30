import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Modelo } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { hoy } from './fecha-captura-pt';
import { MovimientosPtPagina } from './MovimientosPtPagina';
import { TOPE_EXISTENCIAS_PT } from './tope-existencias';

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

/**
 * Un renglón de existencia como lo devuelve el servidor. ⭐ Fila 0.215 — trae el NOMBRE del color y
 * la ETIQUETA/orden de la talla porque de estos renglones se arma el CUADRO de captura: son sus
 * filas y sus columnas, ya no las pone el catálogo global.
 */
function fila(
  idOrden: number | null,
  folioOrden: number | null,
  existencia: number,
  ejes: Partial<{
    idColor: number;
    color: string;
    colorActivo: boolean;
    idTalla: number;
    etiquetaTalla: string;
    ordenTalla: number;
  }> = {},
) {
  return {
    idModelo: 1,
    idColor: 7,
    color: 'Rojo',
    colorActivo: true,
    idTalla: 11,
    etiquetaTalla: 'CH',
    ordenTalla: 1,
    idAlmacen: 3,
    idOrden,
    folioOrden,
    existencia,
    ...ejes,
  };
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
 *
 * ⚠️ El bucket 55 va como UN renglón en CERO, no como dos (+100/−100): así lo devuelve el servidor,
 * porque `existencia_pt` es una vista AGREGADA por modelo×color×talla×orden×almacén. La forma
 * importa desde la fila 0.215: de estos renglones se arman los EJES del cuadro, y con dos renglones
 * el de +100 hacía de eje por su cuenta ⇒ la prueba del regreso del estampado no medía nada (medido:
 * quitarle el `incluirCeros` a los ejes no rompía ninguna prueba).
 */
const EXISTENCIAS_ENTRADA = {
  data: {
    filas: [fila(55, 9001, 0), fila(null, null, 6)],
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
  // ⭐ Fila 0.215 (ronda de corrección) — un SEGUNDO almacén de PT: sin él no se puede probar qué
  // le pasa al cuadro al CAMBIAR de almacén, que es donde se colaba el borrado silencioso.
  { id: 4, nombre: 'Segundas', tipo: 'PT' },
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
/**
 * ⭐ Fila 0.215 — el catálogo GLOBAL trae una talla ('G') que NUNCA tiene existencia. Es el cebo de
 * las dos pruebas del «Agregar talla»: en una SALIDA no debe aparecer (de lo que no hay no se saca)
 * y en una ENTRADA sí (ahí se meten piezas que el kardex no conoce todavía).
 */
vi.mock('@/api/tallas', () => ({
  useTallas: () => ({
    data: {
      datos: [
        { id: 11, etiqueta: 'CH', orden: 1 },
        { id: 13, etiqueta: 'G', orden: 3 },
      ],
    },
  }),
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

  /**
   * ⭐ FILA 0.192 — EL COLOR QUE YA ES FILA NO SE VUELVE A OFRECER.
   *
   * Al cambiar el `<select>` de la matriz por un BUSCADOR, quien esconde el color ya capturado dejó
   * de ser la matriz y pasó a ser el `excluirIds` que esta pantalla le pasa. Sin él, el buscador
   * invita a agregar dos veces el mismo color y el servidor lo rechaza al guardar: un callejón sin
   * salida. 🔑 Y hace falta decirlo: **quitar ese `excluirIds` no rompía NINGUNA prueba** —medido—
   * hasta que existió ésta.
   */
  it('el color que YA es fila desaparece del buscador (no se puede repetir la fila)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);
    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1');
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
    // ⭐ Fila 0.215 — "Rojo" ya es fila porque el CUADRO se armó con las existencias, no porque se
    // haya agregado a mano. La exclusión tiene que valer igual (el servidor rechaza el repetido).
    expect(screen.getByTestId('mov-matriz-fila')).toHaveTextContent('Rojo');

    // La lista se abre contra el MISMO catálogo del servidor (el mock siempre trae "Rojo"): si el
    // color que ya es fila siguiera ofreciéndose, aquí habría una opción.
    const input = screen.getByTestId('mov-matriz-agregar-color-busqueda');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Rojo' } });
    expect(await screen.findByText('No hay colores que coincidan.')).toBeInTheDocument();
  });

  it('guardar arranca DESHABILITADO y se habilita al completar la captura', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    expect(screen.getByTestId('mov-guardar')).toBeDisabled();

    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1');
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
    // ⭐ Fila 0.215 — la matriz ya viene ARMADA con lo que hay (Rojo × CH): no se agrega nada.
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
    // El `toEqual` va con la forma EXACTA a propósito —así un filtro que se cuele se ve—, y por eso
    // el `limite` de la fila 0.143 tiene que estar escrito aquí: es parte de la consulta.
    const encendidas = useExistenciasPtMock.mock.calls.filter(([, habilitado]) => habilitado);
    const ultima = encendidas.at(-1);
    expect(ultima?.[0]).toEqual({
      idModelo: 1,
      incluirCeros: 'true',
      limite: TOPE_EXISTENCIAS_PT,
    });
  });

  it('manda el idOrden elegido en cada renglón (sale del bucket de esa orden)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // salida
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
    await usuario.selectOptions(screen.getByTestId('mov-orden'), '55');
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
    const celda = screen.getByTestId('mov-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '3');

    await ponerMotivo(usuario);
    await usuario.click(screen.getByTestId('mov-guardar'));
    const [cuerpo] = crearMutate.mock.calls[0] as [{ lineas: Record<string, unknown>[] }];
    expect(cuerpo.lineas[0]).not.toHaveProperty('idOrden');
  });

  /**
   * ⭐ FILA 0.164 — EL COLOR RETIRADO QUE TIENE MERCANCÍA AQUÍ SE PUEDE ELEGIR.
   *
   * El catálogo de esta pantalla pide SOLO los colores activos, y así sigue. Pero al fusionar dos
   * duplicados (§Post-F9.222) el absorbido se apaga con sus piezas intactas: sin esto, ajustar a
   * mano esa mercancía no tenía puerta. Aparece rotulado —para que nadie lo confunda con uno del
   * catálogo— y sólo porque el SERVIDOR lo devuelve con existencia en este contexto.
   */
  it('el color RETIRADO con existencia es fila del cuadro, rotulado, y se captura con él', async () => {
    const usuario = userEvent.setup();
    useExistenciasPtMock.mockReturnValue({
      data: {
        filas: [fila(null, null, 30, { idColor: 9, color: 'Blanco Hueso', colorActivo: false })],
        totalExistencia: 30,
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);
    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // Otras Salidas (salida)
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

    // ⭐ Fila 0.215 — ya no hay que ir a buscarlo: si tiene piezas aquí, ES fila del cuadro. Y sigue
    // ROTULADO, para que nadie lo confunda con uno del catálogo vivo (fila 0.164).
    expect(screen.getByTestId('mov-matriz-fila')).toHaveTextContent('Blanco Hueso (retirado)');

    const celda = screen.getByTestId('mov-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '30');
    await ponerMotivo(usuario);
    await usuario.click(screen.getByTestId('mov-guardar'));

    // Lo que viaja es el `idColor`: el rótulo sólo se pinta.
    const [cuerpo] = crearMutate.mock.calls[0] as [{ lineas: { idColor: number }[] }];
    expect(cuerpo.lineas[0]?.idColor).toBe(9);
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
  /**
   * ⭐ FILA 0.143 — ESTA PANTALLA TAMBIÉN SE ENTERA DE QUE LA LISTA VINO CORTADA.
   *
   * El desplegable de órdenes se arma con las FILAS de existencias, y desde la 0.143 esas filas
   * vienen topadas. Si el tope alcanzara, faltaría un bucket y el operador leería «esa orden no
   * tiene piezas» donde en realidad dice «no cupo». Silencioso sería justo el defecto que la fila
   * vino a matar, sólo que una pantalla más allá.
   */
  describe('el TOPE de existencias (fila 0.143)', () => {
    /**
     * ⭐⭐ EL HALLAZGO DE LA RONDA DE CORRECCIÓN, convertido en guardián.
     *
     * El modo ENTRADA pide `incluirCeros` A PROPÓSITO (el regreso del estampado deja el bucket en
     * cero y hay que poder elegirlo), pero el corte del servidor ordena por `abs(existencia)` ⇒
     * **los renglones en cero son los ÚLTIMOS, o sea los PRIMEROS que el tope descarta**. Medido
     * contra la base: con sitio para 40 de 80 renglones, de los 16 en cero sobrevivieron **0**.
     * Con el `limite` por omisión, el único modo que existe para los ceros se quedaba sin ellos.
     */
    it.each([
      { modo: 'SALIDA', idTipo: '5' },
      { modo: 'ENTRADA (incluirCeros)', idTipo: '1' },
    ])(
      '⭐ el modo $modo pide el TECHO del contrato, no el `limite` por omisión',
      async ({ idTipo }) => {
        const usuario = userEvent.setup();
        renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
        await elegirModelo(usuario);
        await usuario.selectOptions(screen.getByTestId('mov-tipo'), idTipo);
        await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

        // Sólo las consultas ENCENDIDAS: las apagadas no piden nada al servidor.
        const encendidas = useExistenciasPtMock.mock.calls.filter(([, hab]) => hab !== false);
        expect(encendidas.length).toBeGreaterThan(0);
        for (const [q] of encendidas) expect(q.limite).toBe(TOPE_EXISTENCIAS_PT);
      },
    );

    it('⭐ y la del modo ENTRADA sigue pidiendo los CEROS (el techo no la sustituye)', async () => {
      // El techo evita que el tope se los coma; `incluirCeros` es lo que los trae. Las dos cosas
      // hacen falta: si alguien quitara la bandera «porque ya no se recorta», volvería el defecto.
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1'); // entrada

      const conCeros = useExistenciasPtMock.mock.calls
        .filter(([, hab]) => hab !== false)
        .map(([q]) => q)
        .filter((q) => q.incluirCeros === 'true');
      expect(conCeros.length).toBeGreaterThan(0);
      for (const q of conCeros) expect(q.limite).toBe(TOPE_EXISTENCIAS_PT);
    });

    it('⭐ avisa cuando la lista de existencias vino recortada', async () => {
      const usuario = userEvent.setup();
      useExistenciasPtMock.mockImplementation((query: Record<string, unknown>, hab?: boolean) => {
        const base = existenciasPorConsulta(query, hab);
        if (base.data === undefined) return base;
        return {
          ...base,
          data: { ...(base.data as object), truncado: true, totalFilas: 4321, limite: 1000 },
        };
      });
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // Otras Salidas
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

      const aviso = screen.getByTestId('mov-truncado');
      expect(aviso).toHaveTextContent('4,321');
      expect(aviso).toHaveTextContent(/no significa que no tenga piezas/);
    });

    it('y NO avisa cuando cupo todo (el aviso tiene que significar algo)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5');
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

      expect(screen.queryByTestId('mov-truncado')).not.toBeInTheDocument();
    });
  });

  /**
   * ⭐⭐ FILA 0.215 — EL MISMO DEFECTO QUE EN EL TRASPASO, EN ESTA PANTALLA.
   *
   * Daniel lo reportó del traspaso —*«me pone todas las tallas yo creo que existen en todos los
   * modelos»*, §Post-F9.243 p.11— y aquí estaba igual: las columnas salían del catálogo GLOBAL.
   * Ahora el cuadro se ARMA con los renglones de existencia del bucket, y el catálogo sólo queda
   * disponible donde de verdad hace falta: la ENTRADA.
   */
  describe('el cuadro se arma con lo que HAY (fila 0.215)', () => {
    it('⭐ trae la fila del color y la columna de la talla que tienen piezas, sin tocar nada', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // salida
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

      expect(screen.getByTestId('mov-matriz-fila')).toHaveTextContent('Rojo');
      expect(screen.getByTestId('mov-matriz-celda')).toBeInTheDocument();
    });

    /**
     * 🔴 EL GUARDIÁN DE LA SALIDA. El catálogo trae 'G', que no tiene existencia en ningún renglón.
     * Si el «Agregar talla» de una SALIDA volviera a alimentarse del catálogo, la 'G' aparecería y
     * se podría capturar una salida de algo que no hay — la que el servidor rechaza bajo bloqueo.
     * MEDIDO: con `tallasDisponibles={tallasDelCatalogo}` esta prueba falla.
     */
    it('⭐ en una SALIDA el «Agregar talla» NO ofrece el catálogo global', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // Otras Salidas (salida)
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

      const agregarTalla = screen.getByTestId('mov-matriz-agregar-talla');
      const opciones = [...agregarTalla.querySelectorAll('option')].map((o) =>
        (o.textContent ?? '').trim(),
      );
      expect(opciones).toEqual(['Agregar talla…']); // 'CH' ya es columna, 'G' no existe aquí
      expect(agregarTalla).toBeDisabled();
    });

    /**
     * ⭐ LA GEMELA POSITIVA, y no es simetría de adorno: la ENTRADA es el único modo que mete piezas
     * que el kardex todavía no conoce (el conteo inicial, §Post-F9.25). Ahí la talla puede no estar
     * en ningún renglón, y sin el catálogo el cuadro no tendría columna en la que capturarla.
     */
    it('⭐ en una ENTRADA el «Agregar talla» SÍ ofrece el catálogo (se meten piezas nuevas)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1'); // Inventario Inicial
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

      const opciones = [
        ...screen.getByTestId('mov-matriz-agregar-talla').querySelectorAll('option'),
      ].map((o) => (o.textContent ?? '').trim());
      expect(opciones).toEqual(['Agregar talla…', 'G']);
    });

    /**
     * 🔴🔴 EL REGRESO DEL ESTAMPADO: EL BUCKET EN **CERO** SIGUE TENIENDO EJES.
     *
     * Es la razón de que los ejes de la ENTRADA se pidan con `incluirCeros`. Las piezas de la orden
     * 55 salieron completas a Aplicación y su bucket quedó en 0; al volver tienen que encontrar SU
     * color y SU talla en el cuadro. Si el corte de «sin piezas no es eje» se aplicara también aquí,
     * el cuadro saldría vacío y las piezas acabarían entrando a «sin orden» — y entonces la entrega
     * al cliente de la orden 55 diría "no hay existencia" con la mercancía en el almacén.
     *
     * (Medido: sin el `{ incluirCeros: esEntrada }` de la llamada, esta prueba se pone roja y era la
     * única que faltaba — el hallazgo del reviewer sobre mis mutaciones supervivientes.)
     */
    it('🔴 en una ENTRADA, un bucket en CERO sigue trayendo su color y su talla', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1'); // Inventario Inicial
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
      await usuario.selectOptions(screen.getByTestId('mov-orden'), '55'); // bucket en 0

      expect(screen.getByTestId('mov-matriz-fila')).toHaveTextContent('Rojo');
      expect(screen.getByTestId('mov-matriz-tabla')).toHaveTextContent('CH');
      expect(screen.getByTestId('mov-matriz-celda')).toBeInTheDocument();
    });

    /**
     * ⭐ Y LA GEMELA NEGATIVA: en una SALIDA un renglón sin piezas NO es eje. Va **NEGATIVO** a
     * propósito, y por dos razones:
     *  1. es lo que el servidor puede devolver de verdad en una salida (descarta `<> 0`, **no** los
     *     negativos), así que el −3 —rastro de un error de captura— llegaba a la pantalla;
     *  2. el renglón va en el bucket «SIN ORDEN», que es el elegido por default ⇒ lo único que puede
     *     dejarlo fuera del cuadro es el corte de «sin piezas». Con una orden distinta, el filtro por
     *     bucket lo excluiría solo y esta prueba pasaría sin medir nada — que es como estaba escrita
     *     en la primera versión de esta ronda (lo cazó una mutación).
     */
    it('⭐ en una SALIDA, un renglón NEGATIVO no es eje (no se saca de menos que nada)', async () => {
      const usuario = userEvent.setup();
      useExistenciasPtMock.mockReturnValue({
        data: { filas: [fila(null, null, -3)], totalExistencia: -3 },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      });
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // Otras Salidas
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

      expect(screen.queryByTestId('mov-matriz-celda')).not.toBeInTheDocument();
      expect(screen.getByTestId('mov-sin-piezas')).toBeInTheDocument();
    });

    /**
     * 🔴🔴 CORREGIR EL ALMACÉN NO PUEDE BORRAR UNA CAPTURA DE ENTRADA.
     *
     * Hallazgo del reviewer, medido: la firma del cuadro llevaba `idTipoMov` e `idAlmacen` SIEMPRE, y
     * en una ENTRADA eso **borraba en silencio** la celda, la fila y la columna en cuanto se corregía
     * el almacén. Sobraba, además: la consulta de ENTRADA **no filtra por almacén** ⇒ sus ejes no
     * pueden cambiar por eso. El damnificado es justo el flujo que la asimetría existe para proteger:
     * el CONTEO INICIAL, donde se teclea un modelo entero a mano.
     *
     * 🔑 Se captura sobre una talla AGREGADA A MANO del catálogo ('G', que no está en ningún renglón
     * de existencia): así la prueba cubre las tres cosas que se perdían —la columna, la fila y el
     * número—, no sólo el número.
     */
    it('🔴 en una ENTRADA, cambiar de ALMACÉN conserva lo capturado (columna, fila y número)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1'); // Inventario Inicial
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
      // Talla del catálogo que NO existe en los renglones: sólo la entrada puede agregarla.
      await usuario.selectOptions(screen.getByTestId('mov-matriz-agregar-talla'), '13');
      const celdas = screen.getAllByTestId('mov-matriz-celda');
      const celdaG = celdas[celdas.length - 1] as HTMLElement;
      await usuario.clear(celdaG);
      await usuario.type(celdaG, '7');

      // Se corrige el almacén: la entrada no consulta por almacén, así que el cuadro es el mismo.
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '4');

      const despues = screen.getAllByTestId('mov-matriz-celda');
      expect(despues).toHaveLength(celdas.length);
      expect(despues[despues.length - 1]).toHaveValue(7);
      expect(screen.getByTestId('mov-matriz-tabla')).toHaveTextContent('G');
      expect(screen.getByTestId('mov-matriz-fila')).toHaveTextContent('Rojo');
    });

    /**
     * ⭐ Y EL OTRO SENTIDO, que es la razón de que el almacén SÍ siga en la firma de la SALIDA: aquí
     * la consulta lo filtra, y dos almacenes pueden tener los MISMOS colores y tallas con **saldos
     * distintos**. Arrastrar el número sería capturarlo contra un disponible que no es el suyo.
     * (El mock devuelve los mismos renglones para los dos almacenes: así lo único que puede vaciar el
     * cuadro es el almacén de la firma — si se le quitara, esta prueba se pone roja.)
     */
    it('⭐ en una SALIDA, cambiar de ALMACÉN sí vacía lo capturado (otro saldo, otro cuadro)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // Otras Salidas
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
      const celda = screen.getByTestId('mov-matriz-celda');
      await usuario.clear(celda);
      await usuario.type(celda, '5');
      expect(screen.getByTestId('mov-matriz-celda')).toHaveValue(5);

      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '4');
      expect(screen.getByTestId('mov-matriz-celda')).toHaveValue(null);
    });

    /**
     * ⚠️ UNA CONSULTA QUE FALLÓ NO ES UN ALMACÉN VACÍO (hallazgo del reviewer). El párrafo sólo
     * miraba `isPending`, así que con la consulta EN ERROR la pantalla AFIRMABA que no hay piezas de
     * ese modelo —y aconsejaba cambiar de almacén—, las dos cosas falsas. Es el mismo criterio que
     * `stockConocido` en la nota de salida, a tres metros de aquí.
     */
    it('⚠️ con las existencias EN ERROR no dice «no hay piezas» (eso sería mentir)', async () => {
      const usuario = userEvent.setup();
      useExistenciasPtMock.mockReturnValue({
        data: undefined,
        isPending: false,
        isError: true,
        refetch: vi.fn(),
      });
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // salida
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

      expect(screen.queryByTestId('mov-sin-piezas')).not.toBeInTheDocument();
      // Lo que sí se dice es que no se pudieron leer (el selector de orden ya lo avisa).
      expect(screen.getByTestId('mov-orden-error')).toBeInTheDocument();
    });

    it('⭐ en una SALIDA con el bucket vacío dice POR QUÉ el cuadro está vacío', async () => {
      const usuario = userEvent.setup();
      useExistenciasPtMock.mockReturnValue({
        data: { filas: [], totalExistencia: 0 },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      });
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // salida
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

      expect(screen.getByTestId('mov-sin-piezas')).toHaveTextContent(
        'De un bucket vacío no se puede sacar',
      );
    });

    /**
     * Y en una ENTRADA ese aviso NO sale, a propósito: capturar sobre un bucket vacío es justo lo
     * normal ahí (el conteo inicial y el regreso del estampado). Decirlo sería regañar por lo
     * correcto.
     */
    it('en una ENTRADA con el bucket vacío NO se avisa nada (ahí es lo normal)', async () => {
      const usuario = userEvent.setup();
      useExistenciasPtMock.mockReturnValue({
        data: { filas: [], totalExistencia: 0 },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      });
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1'); // entrada
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

      expect(screen.queryByTestId('mov-sin-piezas')).not.toBeInTheDocument();
    });
  });

  describe('Fila 0.100 · el motivo es obligatorio', () => {
    /** Deja la pantalla lista para guardar, SIN motivo. */
    async function capturaSinMotivo(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('mov-tipo'), '1');
      await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');
      // Fila 0.215 — la celda ya está: el cuadro se armó con las existencias del bucket.
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

    /**
     * 🔴🔴 AL GUARDAR, EL CUADRO SE VACÍA — Y ESTO ES LO QUE IMPIDE UN MOVIMIENTO DUPLICADO.
     *
     * Hallazgo del reviewer: con `limpiarMatriz()` en cuerpo VACÍO las 30 pruebas seguían verdes, y
     * es el único mecanismo que limpia el cuadro tras guardar (la fila 0.215 cambió de mecanismo:
     * antes vaciaba `lineas`/`tallas` a mano, ahora olvida la firma para que se rearme). Si se rompe,
     * las cantidades del movimiento ya asentado se quedan tecleadas y la siguiente pulsación lo
     * repite — en un módulo D3, donde deshacerlo exige un inverso auditado.
     *
     * ⚠️ Y no basta con que la firma cambie sola: un movimiento PARCIAL deja los MISMOS colores y
     * tallas ⇒ la firma no se mueve.
     */
    it('🔴 al guardar el CUADRO se vacía (o la siguiente pulsación duplica el movimiento)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
      await capturaSinMotivo(usuario);
      await ponerMotivo(usuario);
      expect(screen.getByTestId('mov-matriz-celda')).toHaveValue(12);

      await usuario.click(screen.getByTestId('mov-guardar'));
      const [, opciones] = crearMutate.mock.calls[0] as [
        unknown,
        { onSuccess: (mov: unknown) => void },
      ];
      act(() => {
        opciones.onSuccess({ folio: 4321, totalPiezas: 12 });
      });

      // El cuadro sigue ahí (tipo, modelo y almacén no cambiaron) pero SIN lo capturado.
      expect(screen.getByTestId('mov-matriz-celda')).toHaveValue(null);
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
