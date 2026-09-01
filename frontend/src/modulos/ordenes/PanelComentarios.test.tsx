import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { PanelComentarios } from './PanelComentarios';

const agregarMutateMock = vi.fn();

vi.mock('@/api/ordenes', () => ({
  useAgregarComentario: () => ({ mutate: agregarMutateMock, isPending: false }),
}));

/** Un id crudo con la pinta REAL de los del sistema (cuid) — es lo que NO debe verse nunca. */
const ID_CRUDO = 'cm3x9k2q0000abcd1234efgh';

/** Orden mínima con los comentarios que se le pasen (sólo los campos que usa el panel). */
function ordenCon(comentarios: Orden['comentarios']): Orden {
  return { id: 50, folio: 1201, estado: 'capturada', comentarios } as unknown as Orden;
}

/** Un comentario con overrides. */
function comentario(
  over: Partial<Orden['comentarios'][number]> = {},
): Orden['comentarios'][number] {
  return {
    id: 1,
    idUsuario: 'u-daniel',
    nombreUsuario: 'Daniel Masri',
    comentario: 'Adelantar la entrega una semana.',
    fecha: '2026-07-01T10:00:00.000Z',
    ...over,
  };
}

/**
 * V1 «los nombres, en vez de los ids» — el panel de comentarios pintaba `comentario.idUsuario`, o
 * sea un cuid, donde debía ir el nombre de quien lo escribió.
 *
 * Es una de las TRES pantallas gemelas que viven en el mismo diálogo de orden (con los adjuntos y
 * los hitos): por eso cada una tiene su prueba propia, con un nombre distinto en la fijación, y no
 * se da por cubierta porque su hermana pase.
 */
describe('PanelComentarios · el autor del comentario (V1)', () => {
  beforeEach(() => {
    agregarMutateMock.mockReset();
  });

  it('pinta el NOMBRE de quien lo escribió, nunca su id', () => {
    renderConProveedores(
      <PanelComentarios orden={ordenCon([comentario({ idUsuario: ID_CRUDO })])} puedeAdministrar />,
      { sesion: estadoSesionDePrueba(['ordenes.ver', 'ordenes.administrar']) },
    );

    expect(screen.getByTestId('autor-comentario')).toHaveTextContent('Daniel Masri');
    // 🔴 El id crudo no aparece EN NINGÚN LADO de la pantalla.
    expect(screen.queryByText(ID_CRUDO)).toBeNull();
    expect(document.body.textContent).not.toContain(ID_CRUDO);
  });

  /**
   * 🔴 D3 — dar de baja a alguien NO borra la historia. El comentario se sigue LEYENDO completo; lo
   * único que se pierde es el nombre. Y no se cae al id crudo: un cuid no nombra a nadie.
   */
  it('un autor cuyo id ya no resuelve: se dice que fue una persona y el comentario SIGUE VISIBLE', () => {
    renderConProveedores(
      <PanelComentarios
        orden={ordenCon([comentario({ idUsuario: ID_CRUDO, nombreUsuario: null })])}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['ordenes.ver', 'ordenes.administrar']) },
    );

    expect(screen.getByTestId('autor-comentario')).toHaveTextContent('Usuario dado de baja');
    // Lo que de verdad importa: el texto no se perdió.
    expect(screen.getByText('Adelantar la entrega una semana.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(ID_CRUDO);
  });

  it('«Sistema» sólo cuando NADIE lo escribió (sin id)', () => {
    renderConProveedores(
      <PanelComentarios
        orden={ordenCon([comentario({ idUsuario: null, nombreUsuario: null })])}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['ordenes.ver', 'ordenes.administrar']) },
    );

    expect(screen.getByTestId('autor-comentario')).toHaveTextContent('Sistema');
  });

  it('distingue los tres casos en la MISMA lista (no los colapsa)', () => {
    renderConProveedores(
      <PanelComentarios
        orden={ordenCon([
          comentario({ id: 1, idUsuario: 'u-daniel', nombreUsuario: 'Daniel Masri' }),
          comentario({ id: 2, idUsuario: ID_CRUDO, nombreUsuario: null }),
          comentario({ id: 3, idUsuario: null, nombreUsuario: null }),
        ])}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['ordenes.ver', 'ordenes.administrar']) },
    );

    const autores = screen.getAllByTestId('autor-comentario').map((n) => n.textContent);
    expect(autores).toEqual(['Daniel Masri', 'Usuario dado de baja', 'Sistema']);
  });
});
