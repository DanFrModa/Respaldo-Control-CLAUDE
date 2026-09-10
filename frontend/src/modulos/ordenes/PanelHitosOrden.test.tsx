import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HitoOrden, Orden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { PanelHitosOrden } from './PanelHitosOrden';

const useHitosOrdenMock = vi.fn();

vi.mock('@/api/hitos-orden', () => ({
  useHitosOrden: (id: unknown) => useHitosOrdenMock(id) as unknown,
  useRegistrarHito: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarHito: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Un id crudo con la pinta REAL de los del sistema (cuid) — es lo que NO debe verse nunca. */
const ID_CRUDO = 'cm7h1p4v0000zzzz9876wxyz';

/** Orden mínima (el panel sólo usa el id). */
const ORDEN = { id: 50, folio: 1201, estado: 'capturada' } as unknown as Orden;

/** Un hito vivo de "revisión de la OP", con overrides. */
function hito(over: Partial<HitoOrden> = {}): HitoOrden {
  return {
    id: 1,
    idOrden: 50,
    tipo: 'revisionOp',
    registradoPorId: 'u-gabriel',
    nombreRegistradoPor: 'Gabriel Núñez',
    fecha: '2026-07-02',
    creadoEn: '2026-07-02T09:00:00.000Z',
    ...over,
  };
}

/** El renglón del hito de "revisión de la OP" (el que las fijaciones registran). */
function renglonRevision(): HTMLElement {
  return screen.getByTestId('hito-revisionOp');
}

/**
 * V1 «los nombres, en vez de los ids» — el panel de hitos pintaba `vivo.registradoPorId`, o sea un
 * cuid, donde debía ir el nombre de quien lo registró.
 *
 * Gemela de `PanelComentarios` y `AdjuntosOrden`: las tres se montan en el MISMO diálogo de orden,
 * a cinco centímetros una de otra. Cada una lleva su prueba, con su propio nombre en la fijación.
 */
describe('PanelHitosOrden · quién registró el hito (V1)', () => {
  beforeEach(() => {
    useHitosOrdenMock.mockReset();
  });

  it('pinta el NOMBRE de quien lo registró, nunca su id', () => {
    useHitosOrdenMock.mockReturnValue({
      data: [hito({ registradoPorId: ID_CRUDO })],
      isPending: false,
      isError: false,
    });
    renderConProveedores(<PanelHitosOrden orden={ORDEN} puedeCapturar />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.capturar']),
    });

    expect(renglonRevision()).toHaveTextContent('por Gabriel Núñez');
    expect(document.body.textContent).not.toContain(ID_CRUDO);
  });

  /** 🔴 D3 — el hito se sigue viendo (y marcado «Registrado») aunque su autor ya no resuelva. */
  it('un autor cuyo id ya no resuelve: el hito SIGUE registrado y visible', () => {
    useHitosOrdenMock.mockReturnValue({
      data: [hito({ registradoPorId: ID_CRUDO, nombreRegistradoPor: null })],
      isPending: false,
      isError: false,
    });
    renderConProveedores(<PanelHitosOrden orden={ORDEN} puedeCapturar />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.capturar']),
    });

    const renglon = renglonRevision();
    expect(renglon).toHaveTextContent('por Usuario dado de baja');
    // El hito NO desaparece ni vuelve a "Pendiente" por perder el nombre de su autor.
    expect(within(renglon).getByText('Registrado')).toBeInTheDocument();
    expect(renglon).not.toHaveTextContent('Pendiente');
    expect(document.body.textContent).not.toContain(ID_CRUDO);
  });

  /**
   * Sin id no hay a quién nombrar: esta pantalla OMITE el « · por …» (no dice «Sistema», que es lo
   * que hace el panel de comentarios). Cada pantalla conserva lo que ya hacía en ese caso.
   */
  it('sin autor, omite el « · por …» y deja la fecha sola', () => {
    useHitosOrdenMock.mockReturnValue({
      data: [hito({ registradoPorId: null, nombreRegistradoPor: null })],
      isPending: false,
      isError: false,
    });
    renderConProveedores(<PanelHitosOrden orden={ORDEN} puedeCapturar />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.capturar']),
    });

    const renglon = renglonRevision();
    expect(renglon).not.toHaveTextContent('por');
    expect(within(renglon).getByText('Registrado')).toBeInTheDocument();
  });

  it('un hito que nadie ha registrado sigue diciendo «Pendiente»', () => {
    useHitosOrdenMock.mockReturnValue({ data: [], isPending: false, isError: false });
    renderConProveedores(<PanelHitosOrden orden={ORDEN} puedeCapturar />, {
      sesion: estadoSesionDePrueba(['rc.ruta-ver', 'rc.capturar']),
    });

    expect(renglonRevision()).toHaveTextContent('Pendiente');
  });
});
