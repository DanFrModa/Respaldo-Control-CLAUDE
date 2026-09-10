import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendienteLinea } from '@/api/listas-precios';
import { renderConProveedores } from '@/pruebas/utilidades';

import { PendientesRenglon } from './PendientesRenglon';

const crearMutate = vi.fn();
const editarMutate = vi.fn();
const eliminarMutate = vi.fn();

vi.mock('@/api/listas-precios', () => ({
  useCrearPendiente: () => ({ mutate: crearMutate, isPending: false }),
  useEditarPendiente: () => ({ mutate: editarMutate, isPending: false }),
  useEliminarPendiente: () => ({ mutate: eliminarMutate, isPending: false }),
}));

function pendiente(
  over: Partial<PendienteLinea> & Pick<PendienteLinea, 'id' | 'texto'>,
): PendienteLinea {
  return {
    idListaLinea: 10,
    resuelto: false,
    resueltoEn: null,
    resueltoPorId: null,
    creadoEn: '2026-08-31T00:00:00.000Z',
    creadoPorId: 'u1',
    ...over,
  };
}

function pintar(pendientes: PendienteLinea[], puedeEditar = true): void {
  renderConProveedores(
    <PendientesRenglon
      idLinea={10}
      codigoModelo="CYA-26-71-001"
      pendientes={pendientes}
      puedeEditar={puedeEditar}
    />,
  );
}

describe('<PendientesRenglon> — la libreta de la cita (§Post-F9.152)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    editarMutate.mockReset();
    eliminarMutate.mockReset();
  });

  it('sin pendientes dice qué se anota aquí (no deja un hueco mudo)', () => {
    pintar([]);
    expect(screen.getByTestId('sin-pendientes')).toHaveTextContent(/falta muestra de color/i);
  });

  it('🔴 el pendiente TACHADO se ve tachado y el abierto no', () => {
    pintar([
      pendiente({ id: 1, texto: 'Falta muestra de color' }),
      pendiente({ id: 2, texto: 'Pedir precio de jareta', resuelto: true }),
    ]);
    const textos = screen.getAllByTestId('texto-pendiente');
    expect(textos[0]).toHaveAttribute('data-resuelto', 'false');
    expect(textos[0]?.className).not.toContain('line-through');
    expect(textos[1]).toHaveAttribute('data-resuelto', 'true');
    expect(textos[1]?.className).toContain('line-through');
  });

  it('🔴 tachar manda `resuelto: true` para ESE pendiente', async () => {
    const usuario = userEvent.setup();
    pintar([pendiente({ id: 7, texto: 'Falta muestra de color' })]);

    await usuario.click(screen.getByTestId('alternar-pendiente'));

    expect(editarMutate).toHaveBeenCalledTimes(1);
    expect(editarMutate.mock.calls[0]?.[0]).toMatchObject({
      idLinea: 10,
      idPendiente: 7,
      cuerpo: { resuelto: true },
    });
  });

  it('🔴 destachar manda `resuelto: false` (la casilla es un interruptor, no un candado)', async () => {
    const usuario = userEvent.setup();
    pintar([pendiente({ id: 7, texto: 'Ya se resolvió', resuelto: true })]);

    await usuario.click(screen.getByTestId('alternar-pendiente'));

    expect(editarMutate.mock.calls[0]?.[0]).toMatchObject({ cuerpo: { resuelto: false } });
  });

  it('anota un pendiente nuevo con el texto tecleado', async () => {
    const usuario = userEvent.setup();
    pintar([]);

    await usuario.type(screen.getByTestId('nuevo-pendiente'), 'Pedir precio de la jareta');
    await usuario.click(screen.getByTestId('agregar-pendiente'));

    expect(crearMutate.mock.calls[0]?.[0]).toMatchObject({
      idLinea: 10,
      cuerpo: { texto: 'Pedir precio de la jareta' },
    });
  });

  it('🔴 Enter anota (en la cita se teclea a la carrera, sin buscar el botón)', async () => {
    const usuario = userEvent.setup();
    pintar([]);

    await usuario.type(screen.getByTestId('nuevo-pendiente'), 'Falta el sketch{Enter}');

    expect(crearMutate).toHaveBeenCalledTimes(1);
    expect(crearMutate.mock.calls[0]?.[0]).toMatchObject({ cuerpo: { texto: 'Falta el sketch' } });
  });

  it('no anota vacíos ni espacios en blanco', async () => {
    const usuario = userEvent.setup();
    pintar([]);

    await usuario.type(screen.getByTestId('nuevo-pendiente'), '   {Enter}');

    expect(crearMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('agregar-pendiente')).toBeDisabled();
  });

  it('borra el pendiente indicado', async () => {
    const usuario = userEvent.setup();
    pintar([pendiente({ id: 3, texto: 'Recado mal escrito' })]);

    await usuario.click(screen.getByTestId('borrar-pendiente'));

    expect(eliminarMutate.mock.calls[0]?.[0]).toMatchObject({ idLinea: 10, idPendiente: 3 });
  });

  it('🔴 sin `listas.administrar` la libreta SE LEE pero no se escribe', () => {
    pintar([pendiente({ id: 1, texto: 'Falta muestra de color' })], false);
    expect(screen.getByTestId('texto-pendiente')).toHaveTextContent('Falta muestra de color');
    expect(screen.queryByTestId('nuevo-pendiente')).toBeNull();
    expect(screen.queryByTestId('borrar-pendiente')).toBeNull();
    expect(screen.getByTestId('alternar-pendiente')).toBeDisabled();
  });
});

describe('<PendientesRenglon> — corregir el texto en la misma fila (V1-E8y, ronda de corrección)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    editarMutate.mockReset();
    eliminarMutate.mockReset();
  });

  it('🔴 el lápiz abre el editor y guardar manda el TEXTO corregido', async () => {
    const usuario = userEvent.setup();
    pintar([pendiente({ id: 4, texto: 'jareat' })]);

    await usuario.click(screen.getByTestId('corregir-pendiente'));
    const campo = screen.getByTestId('editar-texto-pendiente');
    await usuario.clear(campo);
    await usuario.type(campo, 'Pedir precio de la jareta');
    await usuario.click(screen.getByTestId('guardar-pendiente'));

    expect(editarMutate.mock.calls[0]?.[0]).toMatchObject({
      idLinea: 10,
      idPendiente: 4,
      cuerpo: { texto: 'Pedir precio de la jareta' },
    });
  });

  it('Enter guarda desde el editor', async () => {
    const usuario = userEvent.setup();
    pintar([pendiente({ id: 4, texto: 'jareat' })]);

    await usuario.click(screen.getByTestId('corregir-pendiente'));
    await usuario.clear(screen.getByTestId('editar-texto-pendiente'));
    await usuario.type(screen.getByTestId('editar-texto-pendiente'), 'Corregido{Enter}');

    expect(editarMutate.mock.calls[0]?.[0]).toMatchObject({ cuerpo: { texto: 'Corregido' } });
  });

  it('🔴 Escape cancela: no llama al servidor y devuelve el texto original a la vista', async () => {
    const usuario = userEvent.setup();
    pintar([pendiente({ id: 4, texto: 'jareat' })]);

    await usuario.click(screen.getByTestId('corregir-pendiente'));
    await usuario.type(screen.getByTestId('editar-texto-pendiente'), 'xxx{Escape}');

    expect(editarMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('texto-pendiente')).toHaveTextContent('jareat');
  });

  it('🔴 guardar SIN cambios (o vacío) no llama al servidor: un PATCH inútil sólo ensucia la bitácora', async () => {
    const usuario = userEvent.setup();
    pintar([pendiente({ id: 4, texto: 'jareat' })]);

    await usuario.click(screen.getByTestId('corregir-pendiente'));
    await usuario.click(screen.getByTestId('guardar-pendiente'));
    expect(editarMutate).not.toHaveBeenCalled();

    await usuario.click(screen.getByTestId('corregir-pendiente'));
    await usuario.clear(screen.getByTestId('editar-texto-pendiente'));
    await usuario.click(screen.getByTestId('guardar-pendiente'));
    expect(editarMutate).not.toHaveBeenCalled();
  });

  it('sin permiso no hay lápiz (la libreta se lee, no se corrige)', () => {
    pintar([pendiente({ id: 4, texto: 'jareat' })], false);
    expect(screen.queryByTestId('corregir-pendiente')).toBeNull();
  });
});
