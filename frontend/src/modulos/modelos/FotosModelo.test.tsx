import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModeloFoto } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { FotosModelo } from './FotosModelo';

/**
 * Pruebas de componente de `<FotosModelo>` (F1-E4): galería de fotos con su TIPO
 * (frente/espalda/otra). Cubre el NoFoto, la elección del tipo AL SUBIR, el cambio de tipo de
 * una foto existente (consume el `PATCH`), y el VISOR ampliado (lightbox) con su botón
 * Descargar (fetch→blob). La capa de datos va simulada (sin red).
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
const principalMutate = vi.fn();

vi.mock('@/api/modelos', () => ({
  useFotosModelo: () => useFotosModelo(),
  useSubirFotoModelo: () => ({ mutate: subirMutate, isPending: false }),
  useQuitarFotoModelo: () => ({ mutate: quitarMutate, isPending: false }),
  useActualizarFotoModelo: () => ({ mutate: actualizarMutate, isPending: false }),
  useMarcarFotoPrincipal: () => ({ mutate: principalMutate, isPending: false }),
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
    principalMutate.mockReset();
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

  it('en modo solo lectura no ofrece subir ni cambiar el tipo (pero sí ampliar)', () => {
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
    // Ampliar (solo lectura) sí está disponible.
    expect(screen.getByTestId('ampliar-foto-modelo-11')).toBeInTheDocument();
  });

  // FOTO PRINCIPAL (Daniel, 25-jul-2026): la principal es la PRIMERA de la lista que devuelve el
  // API (ordenada por `orden`). Se distingue con estrella + rótulo y las demás traen la acción.
  describe('foto principal', () => {
    it('distingue la PRIMERA como principal y ofrece la acción solo en las demás', async () => {
      const usuario = userEvent.setup();
      useFotosModelo.mockReturnValue({
        data: [foto(11, 'FRENTE'), foto(12, 'ESPALDA')],
        isPending: false,
        isError: false,
        error: null,
      });
      renderConProveedores(<FotosModelo idModelo={3} nombre="501" puedeAdministrar />, {
        sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
      });

      // El distintivo (con su texto, no solo el icono) está en la primera y en ninguna otra.
      expect(screen.getByTestId('foto-modelo-principal-11')).toHaveTextContent('Principal');
      expect(screen.queryByTestId('foto-modelo-principal-12')).not.toBeInTheDocument();
      expect(screen.getByTestId('foto-modelo-11')).toHaveAttribute('data-principal', 'si');
      expect(screen.getByTestId('foto-modelo-12')).toHaveAttribute('data-principal', 'no');

      // La acción SOLO aparece en la que no es principal, y manda el id correcto.
      expect(screen.queryByTestId('marcar-principal-foto-11')).not.toBeInTheDocument();
      await usuario.click(screen.getByTestId('marcar-principal-foto-12'));
      expect(principalMutate).toHaveBeenCalledTimes(1);
      expect(principalMutate.mock.calls[0]?.[0]).toEqual({ idModelo: 3, idFoto: 12 });
    });

    it('con UNA sola foto no ofrece la acción (ya es la principal por definición)', () => {
      useFotosModelo.mockReturnValue({
        data: [foto(11, 'FRENTE')],
        isPending: false,
        isError: false,
        error: null,
      });
      renderConProveedores(<FotosModelo idModelo={3} nombre="501" puedeAdministrar />, {
        sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
      });
      expect(screen.getByTestId('foto-modelo-principal-11')).toBeInTheDocument();
      expect(screen.queryByTestId('marcar-principal-foto-11')).not.toBeInTheDocument();
    });

    it('en solo lectura se ve el distintivo pero NO la acción', () => {
      useFotosModelo.mockReturnValue({
        data: [foto(11, 'FRENTE'), foto(12, 'ESPALDA')],
        isPending: false,
        isError: false,
        error: null,
      });
      renderConProveedores(<FotosModelo idModelo={3} nombre="501" puedeAdministrar={false} />, {
        sesion: estadoSesionDePrueba(['modelos.ver']),
      });
      expect(screen.getByTestId('foto-modelo-principal-11')).toBeInTheDocument();
      expect(screen.queryByTestId('marcar-principal-foto-12')).not.toBeInTheDocument();
    });
  });

  describe('visor ampliado (lightbox) + descargar', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('al hacer clic en una miniatura abre la vista grande con la imagen', async () => {
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

      // No hay visor hasta hacer clic.
      expect(screen.queryByTestId('visor-foto-modelo')).not.toBeInTheDocument();
      await usuario.click(screen.getByTestId('ampliar-foto-modelo-11'));

      const visor = await screen.findByTestId('visor-foto-modelo');
      const imagen = within(visor).getByTestId('imagen-foto-modelo');
      expect(imagen).toHaveAttribute('src', 'https://example.test/f.jpg');
      // El botón Descargar está disponible en la vista grande.
      expect(within(visor).getByTestId('descargar-foto-modelo')).toBeInTheDocument();
    });

    it('descarga la imagen vía fetch→blob al pulsar Descargar (filename del nombre original)', async () => {
      const usuario = userEvent.setup();
      useFotosModelo.mockReturnValue({
        data: [foto(11, 'FRENTE')],
        isPending: false,
        isError: false,
        error: null,
      });

      // Mock de la descarga cross-origin: fetch → blob → createObjectURL → <a download> → click.
      // Se simula la Response (jsdom no implementa Response.blob() sobre un Blob propio).
      const blob = new Blob(['imagen'], { type: 'image/jpeg' });
      const respuestaFalsa = { ok: true, blob: () => Promise.resolve(blob) } as unknown as Response;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuestaFalsa);
      const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:objeto-falso');
      const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      // jsdom no navega: capturamos el click del <a> y su `download`.
      let descargaFilename = '';
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        descargaFilename = this.download;
      });

      renderConProveedores(<FotosModelo idModelo={3} nombre="501" puedeAdministrar />, {
        sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
      });

      await usuario.click(screen.getByTestId('ampliar-foto-modelo-11'));
      const visor = await screen.findByTestId('visor-foto-modelo');
      await usuario.click(within(visor).getByTestId('descargar-foto-modelo'));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith('https://example.test/f.jpg');
      });
      expect(createUrlSpy).toHaveBeenCalledWith(blob);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      // El filename usa el nombre original del Archivo ("f.jpg").
      expect(descargaFilename).toBe('f.jpg');
      // Libera el object URL tras descargar (sin fugas).
      expect(revokeUrlSpy).toHaveBeenCalledWith('blob:objeto-falso');
    });
  });
});
