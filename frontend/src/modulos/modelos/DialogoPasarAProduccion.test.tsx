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

  /**
   * ⭐⭐ V1-E3 (§Post-F9.172(b)) — **EL AVISO ES LA ÚNICA MITIGACIÓN DEL RESIDUO QUE NO SE TAPÓ.**
   *
   * `promoverAProduccionNucleo` tiene UNA guarda —modelo con hijos— y por eso **cualquier
   * desarrollo SIN hijos todavía se sigue promoviendo**, tenga o no ficha de Desarrollo. Al
   * promoverlo queda con UN número para todos sus colores y **sin vuelta atrás**: sus OP salen
   * todas por la rama `heredado`. Es el bug que Daniel reportó, reproducible por un clic.
   *
   * 🔴 Se decidió no ponerle una valla (la que haría falta retira una capacidad, y eso lo decide
   * Daniel), así que **lo único que queda entre el usuario y el bug es este aviso**. Sin esta
   * prueba, quien ordene el diálogo se lo lleva por delante sin que nada se ponga rojo — y el clic
   * vuelve a ser silencioso, que es exactamente el estado que V1-E3 vino a sacar.
   */
  it('⭐⭐ AVISA, antes del clic, que esto le da UN número a todo el modelo y no tiene vuelta atrás', async () => {
    propuestaMock.mockReturnValue(propuesta(71_003));
    renderConProveedores(
      <DialogoPasarAProduccion abierto alCambiarAbierto={() => {}} modelo={modeloDesarrollo()} />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    const aviso = await screen.findByTestId('aviso-un-numero-para-todos-los-colores');
    // Las TRES cosas que el aviso tiene que decir, cada una por separado: qué hace, cuál es el
    // camino normal, y que no se puede deshacer.
    expect(aviso).toHaveTextContent('UN número a todo el modelo, no uno por color');
    expect(aviso).toHaveTextContent('OP');
    expect(aviso).toHaveTextContent('No hay vuelta atrás');
    // Y avisa SIN estorbar: el botón sigue disponible (no es una valla, es una advertencia).
    expect(screen.getByTestId('confirmar-pasar-a-produccion')).toBeEnabled();
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
