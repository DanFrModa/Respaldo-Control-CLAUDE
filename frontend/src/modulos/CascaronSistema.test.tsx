import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// El CÓDIGO FUENTE del cascarón como texto (import `?raw` de Vite, como la
// prueba de deriva de rutas): sirve para exigir que el número NO se escriba a
// mano en el JSX.
import fuenteCascaron from '@/modulos/CascaronSistema.tsx?raw';
import { CascaronSistema } from '@/modulos/CascaronSistema';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';
import { VERSION } from '@/version';

/**
 * LA VERSIÓN EN LA TOPBAR (petición de Daniel, 19-ago-2026: «pon la versión al
 * lado en chiquito de donde dice Control v2»).
 *
 * Se prueba que el breadcrumb pinta la versión REAL (la constante de
 * `@/version`, no un literal escrito a mano en el JSX) y que sigue siendo un
 * dato de referencia: chiquito y apagado, no un segundo título.
 */
describe('CascaronSistema · versión en el breadcrumb', () => {
  function renderizarCascaron(): void {
    // Sin permisos: el riel queda vacío y la campana de RC ni se monta (no hay
    // consultas al backend). Con eso basta para la topbar.
    renderConProveedores(<CascaronSistema />, {
      sesion: estadoSesionDePrueba([]),
      rutaInicial: '/modelos',
    });
  }

  it('pinta la versión junto a «Control v2»', () => {
    renderizarCascaron();

    const nombre = screen.getByText('Control v2');
    const version = screen.getByText(VERSION);

    // Hermanos dentro del mismo bloque del breadcrumb, en ese orden.
    expect(version.parentElement).toBe(nombre.parentElement);
    expect(nombre.compareDocumentPosition(version) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // El breadcrumb sigue siendo «Control v2 <versión> › vista actual».
    expect(nombre.parentElement?.parentElement).toHaveTextContent(
      new RegExp(`Control v2\\s*${VERSION.replace('.', '\\.')}\\s*Modelos`),
    );
  });

  it('la versión se ve más chica y apagada que el nombre (dato, no título)', () => {
    renderizarCascaron();

    const version = screen.getByText(VERSION);
    expect(version.className).toContain('text-[11px]'); // el breadcrumb es text-sm (14px)
    expect(version.className).toContain('text-faint'); // el nombre va en text-foreground
  });

  it('toma el número de `@/version`, no de un literal escrito a mano', () => {
    // Un literal pasaría estas pruebas hoy y se quedaría viejo mañana: la
    // constante es la ÚNICA fuente, y aquí se verifica que así siga.
    expect(fuenteCascaron).toContain('{VERSION}');
    expect(fuenteCascaron).not.toMatch(/\d+\.\d{3}/);
  });

  it('no se encoge ni empuja al nombre de la vista', () => {
    renderizarCascaron();

    // El grupo «nombre + versión» es shrink-0: quien se recorta al faltar ancho
    // es el título de la vista, que lleva `truncate`.
    const grupo = screen.getByText('Control v2').parentElement;
    expect(grupo?.className).toContain('shrink-0');
    expect(screen.getByText('Modelos').className).toContain('truncate');
  });
});
