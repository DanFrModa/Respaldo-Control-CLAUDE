import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Modelo } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { MovimientosPtPagina } from './MovimientosPtPagina';

// ── Mocks de la capa de datos (sin red) ──────────────────────────────────────
const crearMutate = vi.fn();
vi.mock('@/api/inventarios', () => ({
  useCrearMovimientoPt: () => ({ mutate: crearMutate, isPending: false }),
  useTiposMovimiento: () => ({
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
  }),
}));

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
});
