import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Modelo } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

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
      { id: 1, codigo: 'inventario-inicial', nombre: 'Inventario Inicial', direccion: 'entrada' },
      { id: 5, codigo: 'entrega-cliente', nombre: 'Entrega a Cliente', direccion: 'salida' },
      {
        id: 9,
        codigo: 'transferencia-almacenes',
        nombre: 'Transferencia entre almacenes',
        direccion: 'traspaso',
      },
    ],
  },
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({ data: { datos: [{ id: 3, nombre: 'Primeras' }] } }),
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
    expect(textos.some((t) => t.includes('Entrega a Cliente'))).toBe(true);
    expect(textos.some((t) => t.includes('Transferencia entre almacenes'))).toBe(false);
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
    await usuario.selectOptions(screen.getByTestId('mov-tipo'), '5'); // Entrega a Cliente (salida)
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
});
