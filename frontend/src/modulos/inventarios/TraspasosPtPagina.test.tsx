import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Modelo } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TraspasosPtPagina } from './TraspasosPtPagina';

const crearMutate = vi.fn();
vi.mock('@/api/inventarios', () => ({
  useCrearTraspasoPt: () => ({ mutate: crearMutate, isPending: false }),
  useExistenciasPt: () => ({
    data: { filas: [], totalExistencia: 0 },
    refetch: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));

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
  await usuario.click(screen.getByTestId('selector-modelo-opcion'));
}

describe('TraspasosPtPagina (F3-E3)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
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
});
