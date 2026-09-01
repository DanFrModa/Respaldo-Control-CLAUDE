import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { AdjuntosOrden } from './AdjuntosOrden';

const useAdjuntosOrdenMock = vi.fn();
const subirMutateMock = vi.fn();
const quitarMutateMock = vi.fn();

vi.mock('@/api/adjuntos-orden', () => ({
  useAdjuntosOrden: (id: unknown) => useAdjuntosOrdenMock(id) as unknown,
  useSubirAdjuntoOrden: () => ({ mutate: subirMutateMock, isPending: false }),
  useQuitarAdjuntoOrden: () => ({ mutate: quitarMutateMock, isPending: false }),
}));

/** Un adjunto de prueba. */
function adjuntoDePrueba(over: Record<string, unknown> = {}) {
  return {
    idArchivo: 'arch_1',
    nombreOriginal: 'ficha.pdf',
    tipoMime: 'application/pdf',
    tamanoBytes: 2048,
    urlDescarga: 'https://r2/get/ficha.pdf',
    subidoPorId: 'daniel',
    nombreSubidoPor: 'Daniel Masri',
    creadoEn: '2026-07-01T10:00:00.000Z',
    ...over,
  };
}

/** Un id crudo con la pinta REAL de los del sistema (cuid) — es lo que NO debe verse nunca. */
const ID_CRUDO = 'cm9w3r7b0000tttt2468mnop';

describe('AdjuntosOrden (F8-E6, R6)', () => {
  beforeEach(() => {
    useAdjuntosOrdenMock.mockReset();
    subirMutateMock.mockReset();
    quitarMutateMock.mockReset();
  });

  it('lista los adjuntos con su enlace de descarga', () => {
    useAdjuntosOrdenMock.mockReturnValue({
      data: [adjuntoDePrueba()],
      isPending: false,
      isError: false,
    });
    renderConProveedores(<AdjuntosOrden idOrden={50} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['ordenes.ver', 'ordenes.administrar']),
    });
    const enlace = screen.getByTestId('descargar-adjunto-orden');
    expect(enlace).toHaveTextContent('ficha.pdf');
    expect(enlace).toHaveAttribute('href', 'https://r2/get/ficha.pdf');
  });

  it('sube un archivo elegido (presigned)', async () => {
    useAdjuntosOrdenMock.mockReturnValue({ data: [], isPending: false, isError: false });
    const usuario = userEvent.setup();
    renderConProveedores(<AdjuntosOrden idOrden={50} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['ordenes.ver', 'ordenes.administrar']),
    });
    const archivo = new File(['x'], 'costos.xlsx', { type: 'application/vnd.ms-excel' });
    await usuario.upload(screen.getByTestId('adjunto-orden-archivo'), archivo);
    expect(subirMutateMock).toHaveBeenCalledOnce();
    const [args] = subirMutateMock.mock.calls[0] as [{ idOrden: number; archivo: File }];
    expect(args.idOrden).toBe(50);
    expect(args.archivo.name).toBe('costos.xlsx');
  });

  it('quita un adjunto', async () => {
    useAdjuntosOrdenMock.mockReturnValue({
      data: [adjuntoDePrueba()],
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<AdjuntosOrden idOrden={50} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['ordenes.ver', 'ordenes.administrar']),
    });
    await usuario.click(screen.getByTestId('quitar-adjunto-orden'));
    expect(quitarMutateMock).toHaveBeenCalledOnce();
    const [args] = quitarMutateMock.mock.calls[0] as [{ idOrden: number; idArchivo: string }];
    expect(args).toEqual({ idOrden: 50, idArchivo: 'arch_1' });
  });

  it('sin ordenes.administrar oculta subir y quitar (solo lectura/descarga)', () => {
    useAdjuntosOrdenMock.mockReturnValue({
      data: [adjuntoDePrueba()],
      isPending: false,
      isError: false,
    });
    renderConProveedores(<AdjuntosOrden idOrden={50} puedeAdministrar={false} />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    expect(screen.queryByTestId('elegir-adjunto-orden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quitar-adjunto-orden')).not.toBeInTheDocument();
    // Pero sí puede descargar.
    expect(screen.getByTestId('descargar-adjunto-orden')).toBeInTheDocument();
  });
  /**
   * V1 «los nombres, en vez de los ids» — esta línea pintaba `adjunto.subidoPorId`, o sea un cuid.
   *
   * 🔴 Su gemela literal vive en `TechPackDesarrollo` (misma línea, carácter por carácter) y tiene
   * su propia prueba con OTRO nombre en la fijación: ninguna de las dos se da por cubierta porque
   * la otra pase.
   */
  describe('quién subió el adjunto (V1)', () => {
    it('pinta el NOMBRE de quien lo subió, nunca su id', () => {
      useAdjuntosOrdenMock.mockReturnValue({
        data: [adjuntoDePrueba({ subidoPorId: ID_CRUDO })],
        isPending: false,
        isError: false,
      });
      renderConProveedores(<AdjuntosOrden idOrden={50} puedeAdministrar />, {
        sesion: estadoSesionDePrueba(['ordenes.ver', 'ordenes.administrar']),
      });

      expect(screen.getByTestId('fila-adjunto-orden')).toHaveTextContent('por Daniel Masri');
      expect(document.body.textContent).not.toContain(ID_CRUDO);
    });

    /** 🔴 D3 — el adjunto se sigue viendo y descargando aunque su autor ya no resuelva. */
    it('un autor cuyo id ya no resuelve: el adjunto SIGUE descargable', () => {
      useAdjuntosOrdenMock.mockReturnValue({
        data: [adjuntoDePrueba({ subidoPorId: ID_CRUDO, nombreSubidoPor: null })],
        isPending: false,
        isError: false,
      });
      renderConProveedores(<AdjuntosOrden idOrden={50} puedeAdministrar />, {
        sesion: estadoSesionDePrueba(['ordenes.ver', 'ordenes.administrar']),
      });

      expect(screen.getByTestId('fila-adjunto-orden')).toHaveTextContent(
        'por Usuario dado de baja',
      );
      expect(screen.getByTestId('descargar-adjunto-orden')).toHaveAttribute(
        'href',
        'https://r2/get/ficha.pdf',
      );
      expect(document.body.textContent).not.toContain(ID_CRUDO);
    });

    it('sin autor, omite el « · por …» (no dice «Sistema»)', () => {
      useAdjuntosOrdenMock.mockReturnValue({
        data: [adjuntoDePrueba({ subidoPorId: null, nombreSubidoPor: null })],
        isPending: false,
        isError: false,
      });
      renderConProveedores(<AdjuntosOrden idOrden={50} puedeAdministrar />, {
        sesion: estadoSesionDePrueba(['ordenes.ver', 'ordenes.administrar']),
      });

      expect(screen.getByTestId('fila-adjunto-orden')).not.toHaveTextContent('por');
      expect(screen.getByTestId('descargar-adjunto-orden')).toHaveTextContent('ficha.pdf');
    });
  });
});
