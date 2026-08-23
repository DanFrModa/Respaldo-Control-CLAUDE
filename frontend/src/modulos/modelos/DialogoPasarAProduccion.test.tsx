import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Modelo } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoPasarAProduccion } from './DialogoPasarAProduccion';

/**
 * «Pasar a producción» (§Post-F9.34 punto 4 + §Post-F9.46). Lo que estas pruebas fijan es lo que
 * Daniel pidió con todas sus letras: el campo llega **precargado** con el siguiente libre y **se
 * puede cambiar**; los avisos se ven pero no estorban.
 */
const propuestaMock = vi.fn<(id: number | undefined) => unknown>();
const promoverMutate = vi.fn();

vi.mock('@/api/modelos', () => ({
  usePropuestaProduccion: (id: number | undefined): unknown => propuestaMock(id),
  usePasarAProduccion: () => ({ mutate: promoverMutate, isPending: false }),
}));

function modeloDesarrollo(): Modelo {
  return {
    id: 42,
    codigo: 'CYA-26-71-003',
    codigoDesarrollo: 'CYA-26-71-003',
  } as unknown as Modelo;
}

function propuesta(
  numero: number | null,
  avisos: string[] = [],
  libres = 995,
): Record<string, unknown> {
  return {
    data: {
      numero,
      codigo: numero === null ? null : String(numero),
      serie: {
        par: '71',
        libre: numero === null ? null : numero % 1000,
        usados: 999 - libres,
        libres,
      },
      serieContinuada: false,
      avisos,
      yaEnProduccion: false,
    },
    isPending: false,
    isError: false,
    error: null,
  };
}

describe('<DialogoPasarAProduccion>', () => {
  beforeEach(() => {
    propuestaMock.mockReset();
    promoverMutate.mockReset();
  });

  it('llega con el campo YA LLENO con el número que propone el sistema', async () => {
    propuestaMock.mockReturnValue(propuesta(71_003));
    renderConProveedores(
      <DialogoPasarAProduccion abierto alCambiarAbierto={() => {}} modelo={modeloDesarrollo()} />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    // El valor CONCRETO: si el campo llegara vacío, o con otro número, esto se pone rojo.
    expect(await screen.findByTestId('numero-produccion')).toHaveValue('71003');
  });

  it('al confirmar manda el número precargado, sin tocarlo', async () => {
    propuestaMock.mockReturnValue(propuesta(71_003));
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoPasarAProduccion abierto alCambiarAbierto={() => {}} modelo={modeloDesarrollo()} />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    await usuario.click(await screen.findByTestId('confirmar-pasar-a-produccion'));
    expect(promoverMutate).toHaveBeenCalledWith(
      { id: 42, cuerpo: { numeroProduccion: 71_003 } },
      expect.anything(),
    );
  });

  it('el número se puede CAMBIAR y es el tecleado el que viaja', async () => {
    propuestaMock.mockReturnValue(propuesta(71_003));
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoPasarAProduccion abierto alCambiarAbierto={() => {}} modelo={modeloDesarrollo()} />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    const campo = await screen.findByTestId('numero-produccion');
    await usuario.clear(campo);
    await usuario.type(campo, '71777');
    await usuario.click(screen.getByTestId('confirmar-pasar-a-produccion'));

    // 71777, no 71003: la última palabra es de Daniel (§Post-F9.46).
    expect(promoverMutate).toHaveBeenCalledWith(
      { id: 42, cuerpo: { numeroProduccion: 71_777 } },
      expect.anything(),
    );
  });

  it('enseña los avisos del servidor SIN bloquear el botón', async () => {
    propuestaMock.mockReturnValue(
      propuesta(71_961, ['A la serie 71 le quedan 39 números de 999.'], 39),
    );
    renderConProveedores(
      <DialogoPasarAProduccion abierto alCambiarAbierto={() => {}} modelo={modeloDesarrollo()} />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    expect(await screen.findByTestId('aviso-produccion')).toHaveTextContent(
      'A la serie 71 le quedan 39 números de 999.',
    );
    expect(screen.getByTestId('confirmar-pasar-a-produccion')).toBeEnabled();
  });

  it('con la serie llena (sin propuesta) el campo queda vacío y no se puede confirmar en blanco', async () => {
    propuestaMock.mockReturnValue(
      propuesta(null, ['La serie 71 está LLENA (999 de 999 usados)…'], 0),
    );
    renderConProveedores(
      <DialogoPasarAProduccion abierto alCambiarAbierto={() => {}} modelo={modeloDesarrollo()} />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    expect(await screen.findByTestId('numero-produccion')).toHaveValue('');
    expect(screen.getByTestId('confirmar-pasar-a-produccion')).toBeDisabled();
  });

  it('no deja confirmar un número que no tiene 5 dígitos', async () => {
    propuestaMock.mockReturnValue(propuesta(71_003));
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoPasarAProduccion abierto alCambiarAbierto={() => {}} modelo={modeloDesarrollo()} />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    const campo = await screen.findByTestId('numero-produccion');
    await usuario.clear(campo);
    await usuario.type(campo, '710');
    expect(screen.getByTestId('confirmar-pasar-a-produccion')).toBeDisabled();
    expect(promoverMutate).not.toHaveBeenCalled();
  });
});
