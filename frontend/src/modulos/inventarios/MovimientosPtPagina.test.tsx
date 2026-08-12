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
const useExistenciasPtMock = vi.fn<() => Record<string, unknown>>();
vi.mock('@/api/inventarios', () => ({
  useCrearMovimientoPt: () => ({ mutate: crearMutate, isPending: false }),
  useTiposMovimiento: () => useTiposMovimientoMock(),
  useExistenciasPt: () => useExistenciasPtMock(),
}));

/** Existencias del modelo A-100 en el almacén 3: 20 pzas de la orden 55 y 6 «sin orden». */
const EXISTENCIAS_OK = {
  data: {
    filas: [
      {
        idModelo: 1,
        idColor: 7,
        idTalla: 11,
        idAlmacen: 3,
        idOrden: 55,
        folioOrden: 9001,
        existencia: 20,
      },
      {
        idModelo: 1,
        idColor: 7,
        idTalla: 11,
        idAlmacen: 3,
        idOrden: null,
        folioOrden: null,
        existencia: 6,
      },
    ],
    totalExistencia: 26,
  },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

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
    useExistenciasPtMock.mockReturnValue(EXISTENCIAS_OK);
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
  it('el selector de ORDEN ofrece solo las órdenes CON EXISTENCIA aquí, más «sin orden»', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MovimientosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);
    await usuario.selectOptions(screen.getByTestId('mov-almacen'), '3');

    const opciones = [...screen.getByTestId('mov-orden').querySelectorAll('option')];
    expect(opciones.map((o) => o.value)).toEqual(['sin', '55']);
    expect(opciones[1]?.textContent).toContain('9001'); // el folio, no el id interno
    expect(opciones[1]?.textContent).toContain('20'); // las piezas de ESE bucket
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
