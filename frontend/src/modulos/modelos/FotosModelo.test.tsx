import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModeloFoto } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { FotosModelo } from './FotosModelo';

/**
 * Pruebas de componente de `<FotosModelo>` (F1-E4): galería de fotos con su TIPO
 * (frente/espalda/otra). Cubre el NoFoto, la elección del tipo AL SUBIR y el cambio de tipo de
 * una foto existente (consume el `PATCH`). La capa de datos va simulada (sin red).
 */
type EstadoFotos = {
  data: ModeloFoto[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
};

const useFotosModelo = vi.fn<() => EstadoFotos>();
const subirMutate = vi.fn();
const actualizarMutate = vi.fn();
const quitarMutate = vi.fn();

vi.mock('@/api/modelos', () => ({
  useFotosModelo: () => useFotosModelo(),
  useSubirFotoModelo: () => ({ mutate: subirMutate, isPending: false }),
  useQuitarFotoModelo: () => ({ mutate: quitarMutate, isPending: false }),
  useActualizarFotoModelo: () => ({ mutate: actualizarMutate, isPending: false }),
}));

/** Foto de ejemplo con su tipo. */
function foto(idFoto: number, tipo: ModeloFoto['tipo']): ModeloFoto {
  return {
    idFoto,
    idArchivo: `arch-${idFoto}`,
    tipo,
    orden: 0,
    nombreOriginal: 'f.jpg',
    tipoMime: 'image/jpeg',
    tamanoBytes: 100,
    urlDescarga: 'https://example.test/f.jpg',
  };
}

describe('<FotosModelo>', () => {
  beforeEach(() => {
    useFotosModelo.mockReset();
    subirMutate.mockReset();
    actualizarMutate.mockReset();
    quitarMutate.mockReset();
  });

  it('muestra el placeholder NoFoto cuando el modelo no tiene fotos', () => {
    useFotosModelo.mockReturnValue({ data: [], isPending: false, isError: false, error: null });
    renderConProveedores(<FotosModelo idModelo={1} nombre="501" puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });
    expect(screen.getByTestId('modelo-sin-fotos')).toBeInTheDocument();
  });

  it('sube con el TIPO elegido (frente/espalda/otra)', async () => {
    const usuario = userEvent.setup();
    useFotosModelo.mockReturnValue({ data: [], isPending: false, isError: false, error: null });
    renderConProveedores(<FotosModelo idModelo={7} nombre="501" puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    // Elige ESPALDA y sube una imagen.
    await usuario.selectOptions(screen.getByTestId('tipo-foto-nueva'), 'ESPALDA');
    const png = new File([new Uint8Array([1, 2, 3])], 'espalda.png', { type: 'image/png' });
    await usuario.upload(screen.getByTestId('archivo-foto-modelo'), png);

    expect(subirMutate).toHaveBeenCalledTimes(1);
    const args = subirMutate.mock.calls[0]?.[0] as { idModelo: number; tipo: string };
    expect(args.idModelo).toBe(7);
    expect(args.tipo).toBe('ESPALDA');
  });

  it('cambia el TIPO de una foto existente consumiendo el PATCH', async () => {
    const usuario = userEvent.setup();
    useFotosModelo.mockReturnValue({
      data: [foto(11, 'FRENTE')],
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<FotosModelo idModelo={3} nombre="501" puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    const galeria = screen.getByTestId('galeria-fotos-modelo');
    await usuario.selectOptions(within(galeria).getByTestId('tipo-foto-modelo-11'), 'ESPALDA');

    expect(actualizarMutate).toHaveBeenCalledTimes(1);
    const args = actualizarMutate.mock.calls[0]?.[0] as {
      idModelo: number;
      idFoto: number;
      cuerpo: { tipo: string };
    };
    expect(args).toMatchObject({ idModelo: 3, idFoto: 11, cuerpo: { tipo: 'ESPALDA' } });
  });

  it('en modo solo lectura no ofrece subir ni cambiar el tipo', () => {
    useFotosModelo.mockReturnValue({
      data: [foto(11, 'FRENTE')],
      isPending: false,
      isError: false,
      error: null,
    });
    renderConProveedores(<FotosModelo idModelo={3} nombre="501" puedeAdministrar={false} />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });
    expect(screen.queryByTestId('tipo-foto-nueva')).not.toBeInTheDocument();
    expect(screen.queryByTestId('subir-foto-modelo-bloque')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tipo-foto-modelo-11')).not.toBeInTheDocument();
  });
});
