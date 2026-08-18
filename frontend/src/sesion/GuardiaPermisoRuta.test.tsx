import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { ClavePermiso } from '@/api/tipos';
import { CascaronSistema } from '@/modulos/CascaronSistema';
import { NoEncontrado } from '@/paginas/NoEncontrado';
import { Proximamente } from '@/paginas/Proximamente';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';
import { GuardiaPermisoRuta } from '@/sesion/GuardiaPermisoRuta';

/**
 * LA CAPA DE RUTA (V1-E6b · `DECISIONES.md §Post-F9.68`): la pantalla que el
 * usuario no puede usar NO SE MONTA.
 *
 * ⚠️ Cada prueba de ocultamiento va CON SU GEMELA POSITIVA (con el permiso, el
 * contenido SÍ está). Una prueba que solo comprueba la ausencia pasa igual si
 * el contenido nunca aparece por otro motivo — y entonces no prueba nada.
 */

const TEXTO_PANTALLA = 'contenido de la pantalla';
const TEXTO_AVISO = 'Esta pantalla no está disponible para tu usuario.';

function Pantalla(): React.JSX.Element {
  return <p>{TEXTO_PANTALLA}</p>;
}

function renderGuardia(pathname: string, permisos: ClavePermiso[] = []): void {
  renderConProveedores(
    <GuardiaPermisoRuta>
      <Pantalla />
    </GuardiaPermisoRuta>,
    { sesion: estadoSesionDePrueba(permisos), rutaInicial: pathname },
  );
}

describe('GuardiaPermisoRuta', () => {
  it('SIN el permiso de la ruta, la pantalla no se monta y se ve el aviso del enlace compartido', () => {
    renderGuardia('/costos/costeo');
    expect(screen.queryByText(TEXTO_PANTALLA)).toBeNull();
    expect(screen.getByText(TEXTO_AVISO)).toBeInTheDocument();
  });

  it('CON el permiso de la ruta, la pantalla sí se monta (gemela positiva)', () => {
    renderGuardia('/costos/costeo', ['costos.ver']);
    expect(screen.getByText(TEXTO_PANTALLA)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_AVISO)).toBeNull();
  });

  it('el aviso NO nombra el permiso, ni a quién pedirlo, ni trae código de error', () => {
    renderGuardia('/costos/costeo');
    const aviso = screen.getByTestId('pantalla-no-disponible');
    expect(aviso.textContent).not.toMatch(/permiso|costos\.ver|403|401|administrador|solicit/i);
  });

  it('una ruta sin declaración no se cierra (la capa es de presentación, A4)', () => {
    renderGuardia('/ruta-inventada-que-no-existe');
    expect(screen.getByText(TEXTO_PANTALLA)).toBeInTheDocument();
  });
});

describe('el texto de permisos vive en UN solo lugar', () => {
  // §Post-F9.68 (hallazgo MEDIA del reviewer, 18-ago-2026): el 404 decía "no
  // existe O NO TIENES PERMISO PARA VERLA" — el único texto de la app que le
  // hablaba de permisos al usuario, y falso desde que existe la capa de ruta.
  it('el 404 ya no habla de permisos: solo dice que la página no existe', () => {
    renderConProveedores(<NoEncontrado />, { sesion: estadoSesionDePrueba([]) });
    expect(screen.getByText(/no existe/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/permiso/i);
  });

  it('un módulo que los permisos esconden responde con el texto aprobado, no con el 404', () => {
    // `/costos` es entrada del menú con permisos; sin ellos NO es "no existe".
    renderConProveedores(
      <Routes>
        <Route path=":modulo" element={<Proximamente />} />
      </Routes>,
      { sesion: estadoSesionDePrueba([]), rutaInicial: '/costos' },
    );
    expect(screen.getByText(TEXTO_AVISO)).toBeInTheDocument();
    expect(screen.queryByText(/no existe/i)).toBeNull();
  });

  it('un módulo que SÍ es visible se pinta (gemela positiva) y una ruta inventada da 404', () => {
    renderConProveedores(
      <Routes>
        <Route path=":modulo" element={<Proximamente />} />
      </Routes>,
      { sesion: estadoSesionDePrueba(['costos.ver']), rutaInicial: '/costos' },
    );
    expect(screen.queryByText(TEXTO_AVISO)).toBeNull();

    renderConProveedores(
      <Routes>
        <Route path=":modulo" element={<Proximamente />} />
      </Routes>,
      { sesion: estadoSesionDePrueba(['costos.ver']), rutaInicial: '/modulo-inventado' },
    );
    expect(screen.getByText(/no existe/i)).toBeInTheDocument();
  });
});

/**
 * Que el guard exista no sirve de nada si el cascarón no lo usa: esto prueba el
 * CABLEADO real (`CascaronSistema` → `<main>` → guard → `<Outlet />`).
 */
describe('CascaronSistema monta la capa de ruta', () => {
  function renderCascaron(permisos: ClavePermiso[]): void {
    renderConProveedores(
      <Routes>
        <Route element={<CascaronSistema />}>
          <Route path="costos/costeo" element={<Pantalla />} />
        </Route>
      </Routes>,
      { sesion: estadoSesionDePrueba(permisos), rutaInicial: '/costos/costeo' },
    );
  }

  it('sin el permiso, el cascarón sigue en pie pero la pantalla no', () => {
    renderCascaron([]);
    expect(screen.queryByText(TEXTO_PANTALLA)).toBeNull();
    expect(screen.getByText(TEXTO_AVISO)).toBeInTheDocument();
    // El riel y la topbar siguen ahí: el que llega por un enlace puede irse.
    expect(screen.getByTestId('menu-usuario')).toBeInTheDocument();
  });

  it('con el permiso, el cascarón renderiza la pantalla (gemela positiva)', () => {
    renderCascaron(['costos.ver']);
    expect(screen.getByText(TEXTO_PANTALLA)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_AVISO)).toBeNull();
  });
});
