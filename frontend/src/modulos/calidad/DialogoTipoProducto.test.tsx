import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TipoProducto } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoTipoProducto } from './DialogoTipoProducto';

/**
 * El DÍGITO DE CONCEPTO en el catálogo (V1-E3n). Antes de esta etapa el campo no existía en ninguna
 * pantalla, y el alta de un modelo de desarrollo terminaba diciendo *"captúralo en su catálogo"* —
 * un catálogo que no lo tenía. Estas pruebas fijan que se captura, se precarga al editar y se puede
 * QUITAR (que es lo que distingue "no lo toqué" de "lo borré").
 */
const crearMutate = vi.fn();
const actualizarMutate = vi.fn();

vi.mock('@/api/calidad', () => ({
  useCrearTipoProducto: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarTipoProducto: () => ({ mutate: actualizarMutate, isPending: false }),
}));

function tipo(digitoConcepto: number | null): TipoProducto {
  return {
    id: 7,
    nombre: 'Chamarra',
    digitoConcepto,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

describe('<DialogoTipoProducto> · dígito de concepto', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
  });

  it('en el alta manda el dígito capturado junto al nombre', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoTipoProducto abierto alCambiarAbierto={() => {}} tipo={undefined} />,
      { sesion: estadoSesionDePrueba(['calidad.administrar-catalogo']) },
    );

    await usuario.type(screen.getByRole('textbox', { name: /Nombre/ }), 'Chamarra');
    await usuario.type(screen.getByTestId('tipo-digito-concepto'), '8');
    await usuario.click(screen.getByTestId('guardar-tipo-producto'));

    // El 8 concreto: con un `digitoConcepto` ausente o distinto, esto se pone rojo.
    expect(crearMutate).toHaveBeenCalledWith(
      { nombre: 'Chamarra', digitoConcepto: 8 },
      expect.anything(),
    );
  });

  it('sin dígito, el alta lo OMITE (el tipo se crea igual, sin numerar)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoTipoProducto abierto alCambiarAbierto={() => {}} tipo={undefined} />,
      { sesion: estadoSesionDePrueba(['calidad.administrar-catalogo']) },
    );

    await usuario.type(screen.getByRole('textbox', { name: /Nombre/ }), 'Ropa interior');
    await usuario.click(screen.getByTestId('guardar-tipo-producto'));

    expect(crearMutate).toHaveBeenCalledWith({ nombre: 'Ropa interior' }, expect.anything());
  });

  it('al editar llega PRECARGADO con el dígito que ya tiene', () => {
    renderConProveedores(
      <DialogoTipoProducto abierto alCambiarAbierto={() => {}} tipo={tipo(8)} />,
      { sesion: estadoSesionDePrueba(['calidad.administrar-catalogo']) },
    );
    expect(screen.getByTestId('tipo-digito-concepto')).toHaveValue('8');
  });

  it('vaciar el campo en la edición manda `null` (lo QUITA, no lo deja como estaba)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoTipoProducto abierto alCambiarAbierto={() => {}} tipo={tipo(8)} />,
      { sesion: estadoSesionDePrueba(['calidad.administrar-catalogo']) },
    );

    await usuario.clear(screen.getByTestId('tipo-digito-concepto'));
    await usuario.click(screen.getByTestId('guardar-tipo-producto'));

    expect(actualizarMutate).toHaveBeenCalledWith(
      { id: 7, cuerpo: { nombre: 'Chamarra', digitoConcepto: null } },
      expect.anything(),
    );
  });

  it('no deja guardar un dígito fuera del 2–9 (el 0 y el 1 no se usan)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoTipoProducto abierto alCambiarAbierto={() => {}} tipo={undefined} />,
      { sesion: estadoSesionDePrueba(['calidad.administrar-catalogo']) },
    );

    await usuario.type(screen.getByRole('textbox', { name: /Nombre/ }), 'Raro');
    await usuario.type(screen.getByTestId('tipo-digito-concepto'), '1');
    await usuario.click(screen.getByTestId('guardar-tipo-producto'));

    expect(crearMutate).not.toHaveBeenCalled();
    expect(await screen.findByText(/del 2 al 9/)).toBeInTheDocument();
  });
});
