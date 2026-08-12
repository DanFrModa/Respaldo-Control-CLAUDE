import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Modelo } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TraspasosPtPagina } from './TraspasosPtPagina';

const crearMutate = vi.fn();
// §Post-F9.40 — las existencias del ORIGEN alimentan el selector de orden; configurable por test.
const useExistenciasPtMock = vi.fn<() => Record<string, unknown>>();
vi.mock('@/api/inventarios', () => ({
  useCrearTraspasoPt: () => ({ mutate: crearMutate, isPending: false }),
  useExistenciasPt: () => useExistenciasPtMock(),
}));

/** Sin existencias (el caso base de los tests viejos). */
const EXISTENCIAS_VACIAS = {
  data: { filas: [], totalExistencia: 0 },
  refetch: vi.fn(),
  isPending: false,
  isError: false,
};

/** En el origen (almacén 3): 15 pzas de la orden 55 (folio 9001) y 4 «sin orden». */
const EXISTENCIAS_CON_ORDEN = {
  data: {
    filas: [
      { idColor: 7, idTalla: 11, idAlmacen: 3, idOrden: 55, folioOrden: 9001, existencia: 15 },
      { idColor: 7, idTalla: 11, idAlmacen: 3, idOrden: null, folioOrden: null, existencia: 4 },
    ],
    totalExistencia: 19,
  },
  refetch: vi.fn(),
  isPending: false,
  isError: false,
};

vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: {
      datos: [
        { id: 3, nombre: 'Primeras' },
        { id: 4, nombre: 'Segundas' },
      ],
    },
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

async function elegirModelo(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  // El selector es un combobox POPOVER (R9): la lista abre al enfocar el input de búsqueda.
  await usuario.click(screen.getByTestId('selector-modelo-busqueda'));
  await usuario.click(screen.getByTestId('selector-modelo-opcion'));
}

describe('TraspasosPtPagina (F3-E3)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    useExistenciasPtMock.mockReset();
    useExistenciasPtMock.mockReturnValue(EXISTENCIAS_VACIAS);
  });

  it('avisa y NO permite guardar si origen = destino', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');
    await usuario.selectOptions(screen.getByTestId('traspaso-destino'), '3');
    expect(screen.getByText(/almacenes distintos/i)).toBeInTheDocument();
    expect(screen.getByTestId('traspaso-guardar')).toBeDisabled();
  });

  it('habilita guardar con origen≠destino y una captura, y envía al servicio', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');
    await usuario.selectOptions(screen.getByTestId('traspaso-destino'), '4');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-color'), '7');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-talla'), '11');
    const celda = screen.getByTestId('traspaso-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '5');

    const guardar = screen.getByTestId('traspaso-guardar');
    expect(guardar).toBeEnabled();
    await usuario.click(guardar);
    expect(crearMutate).toHaveBeenCalledTimes(1);
    const [cuerpo] = crearMutate.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo.idAlmacenOrigen).toBe(3);
    expect(cuerpo.idAlmacenDestino).toBe(4);
    expect(cuerpo.idModelo).toBe(1);
  });

  // ── §Post-F9.40: se traspasa el bucket de una ORDEN, no solo «sin orden» ────
  it('ofrece las órdenes con existencia en el ORIGEN y traspasa el bucket elegido', async () => {
    const usuario = userEvent.setup();
    useExistenciasPtMock.mockReturnValue(EXISTENCIAS_CON_ORDEN);
    renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');
    await usuario.selectOptions(screen.getByTestId('traspaso-destino'), '4');
    const opciones = [...screen.getByTestId('traspaso-orden').querySelectorAll('option')];
    expect(opciones.map((o) => o.value)).toEqual(['sin', '55']);

    await usuario.selectOptions(screen.getByTestId('traspaso-orden'), '55');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-color'), '7');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-talla'), '11');
    const celda = screen.getByTestId('traspaso-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '5');

    await usuario.click(screen.getByTestId('traspaso-guardar'));
    const [cuerpo] = crearMutate.mock.calls[0] as [{ lineas: { idOrden?: number }[] }];
    expect(cuerpo.lineas[0]?.idOrden).toBe(55);
  });

  it('el aviso de sobre-traspaso compara contra el bucket ELEGIDO, no contra el total del modelo', async () => {
    const usuario = userEvent.setup();
    useExistenciasPtMock.mockReturnValue(EXISTENCIAS_CON_ORDEN);
    renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');
    await usuario.selectOptions(screen.getByTestId('traspaso-destino'), '4');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-color'), '7');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-talla'), '11');
    const celda = screen.getByTestId('traspaso-matriz-celda');
    await usuario.clear(celda);
    // 6 pzas: caben en la orden 55 (15) pero NO en el bucket «sin orden» (4), que es el default.
    await usuario.type(celda, '6');
    expect(screen.getByTestId('traspaso-aviso-excede')).toBeInTheDocument();

    await usuario.selectOptions(screen.getByTestId('traspaso-orden'), '55');
    expect(screen.queryByTestId('traspaso-aviso-excede')).not.toBeInTheDocument();
  });
});
