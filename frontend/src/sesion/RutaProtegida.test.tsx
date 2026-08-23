import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';
import { RutaProtegida } from '@/sesion/RutaProtegida';
import type { EstadoSesion } from '@/sesion/contexto';

/**
 * ⭐ V1-E3i — UN PARPADEO DE RED NO SACA AL USUARIO. El guard decidía con `sesion === null`, que
 * mezclaba "el servidor dijo que no hay sesión" con "no pude preguntar": un 500 o un corte lo
 * mandaba a `/login` con lo que estuviera capturando dentro.
 *
 * ⚠️ Cada prueba va CON SU GEMELA: la que comprueba que NO redirige se acompaña de la que comprueba
 * que SÍ redirige cuando toca. Una prueba que sólo mira la ausencia del login pasaría igual si el
 * guard se hubiera quedado en blanco por otro motivo.
 */

const TEXTO_PANTALLA = 'pantalla protegida';
const TEXTO_LOGIN = 'pantalla de login';

function renderGuard(sobrescribir: Partial<EstadoSesion>): void {
  renderConProveedores(
    <Routes>
      <Route element={<RutaProtegida />}>
        <Route path="/" element={<p>{TEXTO_PANTALLA}</p>} />
      </Route>
      <Route path="/login" element={<p>{TEXTO_LOGIN}</p>} />
    </Routes>,
    { sesion: estadoSesionDePrueba([], sobrescribir), rutaInicial: '/' },
  );
}

describe('RutaProtegida', () => {
  it('con sesión, monta la pantalla', () => {
    renderGuard({ estado: 'con-sesion' });
    expect(screen.getByText(TEXTO_PANTALLA)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_LOGIN)).toBeNull();
  });

  it('SIN sesión (el servidor contestó 401), manda al login — gemela positiva', () => {
    renderGuard({ estado: 'sin-sesion', sesion: null });
    expect(screen.getByText(TEXTO_LOGIN)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_PANTALLA)).toBeNull();
  });

  it('🔴 con la sesión INDETERMINADA (no se pudo preguntar) NO manda al login', () => {
    renderGuard({ estado: 'indeterminado', sesion: null, errorConsulta: 'Failed to fetch' });
    expect(screen.queryByText(TEXTO_LOGIN)).toBeNull();
    expect(screen.getByTestId('sesion-indeterminada')).toBeInTheDocument();
  });

  it('lo dice sin mentir: no afirma que la sesión se cerró, y enseña el motivo técnico', () => {
    renderGuard({ estado: 'indeterminado', sesion: null, errorConsulta: 'Failed to fetch' });
    const aviso = screen.getByTestId('sesion-indeterminada');
    expect(aviso.textContent).toMatch(/No pudimos confirmar tu sesión/i);
    expect(aviso.textContent).toMatch(/No cerramos tu sesión/i);
    expect(aviso.textContent).toContain('Failed to fetch');
  });

  it('el botón de reintentar vuelve a preguntar (no obliga a recargar la página)', async () => {
    const refrescar = vi.fn().mockResolvedValue(undefined);
    renderGuard({ estado: 'indeterminado', sesion: null, refrescar });
    await userEvent.click(screen.getByTestId('sesion-reintentar'));
    expect(refrescar).toHaveBeenCalledTimes(1);
  });

  it('mientras carga (incluidos los reintentos) espera, no decide', () => {
    renderGuard({ estado: 'cargando', cargando: true, sesion: null });
    expect(screen.queryByText(TEXTO_LOGIN)).toBeNull();
    expect(screen.queryByText(TEXTO_PANTALLA)).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
