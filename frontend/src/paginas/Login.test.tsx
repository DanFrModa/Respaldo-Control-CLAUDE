import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { Login } from './Login';

import type * as MensajesAuth from '@/lib/mensajes-auth';

// El cliente de better-auth se reemplaza por un mock controlable; `traducirErrorAuth`
// se conserva REAL (se re-exporta), para probar el camino completo error -> mensaje.
// `vi.hoisted` permite usar el mock dentro de la factory de `vi.mock` (que se eleva
// al tope del archivo) sin caer en el error de "variable antes de inicializar".
const { signInUsername } = vi.hoisted(() => ({
  signInUsername: vi.fn<(datos: { username: string; password: string }) => Promise<unknown>>(),
}));
vi.mock('@/lib/auth-client', async () => {
  const real = await vi.importActual<typeof MensajesAuth>('@/lib/mensajes-auth');
  return {
    authClient: { signIn: { username: signInUsername } },
    traducirErrorAuth: real.traducirErrorAuth,
  };
});

describe('<Login>', () => {
  beforeEach(() => {
    signInUsername.mockReset();
  });

  it('valida la captura: muestra errores en español si se envia vacio', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<Login />, {
      sesion: estadoSesionDePrueba([], { sesion: null }),
    });

    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('El usuario es obligatorio')).toBeInTheDocument();
    expect(screen.getByText('La contraseña es obligatoria')).toBeInTheDocument();
    // No se llama al backend si la validacion de captura falla.
    expect(signInUsername).not.toHaveBeenCalled();
  });

  it('muestra "usuario o contraseña incorrectos" cuando el backend rechaza (401)', async () => {
    const usuario = userEvent.setup();
    signInUsername.mockResolvedValue({
      error: { code: 'INVALID_USERNAME_OR_PASSWORD', status: 401 },
    });
    renderConProveedores(<Login />, {
      sesion: estadoSesionDePrueba([], { sesion: null }),
    });

    await usuario.type(screen.getByLabelText('Usuario'), 'admin');
    await usuario.type(screen.getByLabelText('Contraseña'), 'malo');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByTestId('error-login')).toHaveTextContent(
      'Usuario o contraseña incorrectos.',
    );
  });

  it('muestra TAL CUAL el mensaje de bloqueo del servidor (403)', async () => {
    const usuario = userEvent.setup();
    signInUsername.mockResolvedValue({
      error: { status: 403, message: 'Estás bloqueado. Contacta al administrador.' },
    });
    renderConProveedores(<Login />, {
      sesion: estadoSesionDePrueba([], { sesion: null }),
    });

    await usuario.type(screen.getByLabelText('Usuario'), 'pepe');
    await usuario.type(screen.getByLabelText('Contraseña'), 'loquesea');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByTestId('error-login')).toHaveTextContent(
      'Estás bloqueado. Contacta al administrador.',
    );
  });

  it('al iniciar sesion con exito refresca la sesion', async () => {
    const usuario = userEvent.setup();
    const refrescar = vi.fn(() => Promise.resolve());
    signInUsername.mockResolvedValue({ data: { ok: true } });
    renderConProveedores(<Login />, {
      sesion: estadoSesionDePrueba([], { sesion: null, refrescar }),
    });

    await usuario.type(screen.getByLabelText('Usuario'), 'admin');
    await usuario.type(screen.getByLabelText('Contraseña'), 'Control.2026!');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      expect(signInUsername).toHaveBeenCalledWith({
        username: 'admin',
        password: 'Control.2026!',
      });
    });
    await waitFor(() => {
      expect(refrescar).toHaveBeenCalled();
    });
  });
});
