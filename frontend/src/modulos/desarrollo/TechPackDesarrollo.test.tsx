import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TechPackDesarrollo } from './TechPackDesarrollo';

const useAdjuntosDesarrolloMock = vi.fn();

vi.mock('@/api/adjuntos-desarrollo', () => ({
  useAdjuntosDesarrollo: (id: unknown) => useAdjuntosDesarrolloMock(id) as unknown,
  useSubirAdjuntoDesarrollo: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarAdjuntoDesarrollo: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Un id crudo con la pinta REAL de los del sistema (cuid) — es lo que NO debe verse nunca. */
const ID_CRUDO = 'cm5k2n8t0000qqqq5555abcd';

/** Un adjunto del tech pack, con overrides. */
function adjunto(over: Record<string, unknown> = {}) {
  return {
    idArchivo: 'arch_9',
    nombreOriginal: 'techpack-v2.pdf',
    tipoMime: 'application/pdf',
    tamanoBytes: 4096,
    urlDescarga: 'https://r2/get/techpack-v2.pdf',
    subidoPorId: 'u-ana',
    nombreSubidoPor: 'Ana Ruiz',
    creadoEn: '2026-07-03T12:00:00.000Z',
    ...over,
  };
}

/** El renglón del adjunto. */
function renglon(): HTMLElement {
  return screen.getByTestId('fila-tech-pack');
}

/**
 * V1 «los nombres, en vez de los ids».
 *
 * 🔴 Esta pantalla no tenía NINGUNA prueba, y su línea del autor era **carácter por carácter** la
 * misma que la de `AdjuntosOrden`. Es la rama gemela de manual: arreglar una y dar por buena la otra
 * dejaría el id crudo en producción con el verde puesto. Por eso las dos llevan su prueba, con
 * NOMBRES DISTINTOS en las fijaciones (aquí «Ana Ruiz», allá «Daniel Masri»): si alguien copia el
 * archivo de pruebas en vez de escribirlo, la aserción no cuadra y se nota.
 */
describe('TechPackDesarrollo · quién subió el adjunto (V1)', () => {
  beforeEach(() => {
    useAdjuntosDesarrolloMock.mockReset();
  });

  it('pinta el NOMBRE de quien lo subió, nunca su id', () => {
    useAdjuntosDesarrolloMock.mockReturnValue({
      data: [adjunto({ subidoPorId: ID_CRUDO })],
      isPending: false,
      isError: false,
    });
    renderConProveedores(<TechPackDesarrollo idDesarrollo={7} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']),
    });

    expect(renglon()).toHaveTextContent('por Ana Ruiz');
    expect(document.body.textContent).not.toContain(ID_CRUDO);
  });

  /** 🔴 D3 — el adjunto se sigue viendo y se sigue pudiendo DESCARGAR sin el nombre de su autor. */
  it('un autor cuyo id ya no resuelve: el adjunto SIGUE descargable', () => {
    useAdjuntosDesarrolloMock.mockReturnValue({
      data: [adjunto({ subidoPorId: ID_CRUDO, nombreSubidoPor: null })],
      isPending: false,
      isError: false,
    });
    renderConProveedores(<TechPackDesarrollo idDesarrollo={7} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']),
    });

    expect(renglon()).toHaveTextContent('por Usuario dado de baja');
    const enlace = screen.getByTestId('descargar-tech-pack');
    expect(enlace).toHaveTextContent('techpack-v2.pdf');
    expect(enlace).toHaveAttribute('href', 'https://r2/get/techpack-v2.pdf');
    expect(document.body.textContent).not.toContain(ID_CRUDO);
  });

  it('sin autor, omite el « · por …» (no dice «Sistema»)', () => {
    useAdjuntosDesarrolloMock.mockReturnValue({
      data: [adjunto({ subidoPorId: null, nombreSubidoPor: null })],
      isPending: false,
      isError: false,
    });
    renderConProveedores(<TechPackDesarrollo idDesarrollo={7} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']),
    });

    expect(renglon()).not.toHaveTextContent('por');
    expect(screen.getByTestId('descargar-tech-pack')).toHaveTextContent('techpack-v2.pdf');
  });
});
