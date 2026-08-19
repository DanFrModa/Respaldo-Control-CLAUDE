import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProveedorSesion } from '@/sesion/ProveedorSesion';
import { derivarEstadoSesion } from '@/sesion/contexto';
import { useSesion } from '@/sesion/useSesion';

/**
 * ⭐ V1-E3i — la sesión frente a un parpadeo de red. Dos capas:
 *  • `derivarEstadoSesion`: la REGLA (qué significa cada combinación), probada sin montar React.
 *  • `ProveedorSesion`: que de verdad REINTENTE y que, mientras no sepa, no diga "no hay sesión".
 */

vi.mock('@/api/sesion', () => ({ obtenerSesion: vi.fn() }));
const { obtenerSesion } = await import('@/api/sesion');
const obtenerSesionMock = vi.mocked(obtenerSesion);

const SESION_OK = {
  autenticado: true as const,
  sesion: {
    id: 'u1',
    username: 'admin',
    nombre: 'Administrador',
    empresaActiva: { id: 1, nombre: 'FR Moda', idArchivoLogo: null },
    permisos: [],
  },
};

/** Sonda: pinta el estado que el proveedor está publicando. */
function Sonda(): React.JSX.Element {
  const { estado, sesion } = useSesion();
  return (
    <p data-testid="sonda">
      {estado}
      {sesion === null ? ' · sin-usuario' : ' · con-usuario'}
    </p>
  );
}

function montar(): void {
  // El cliente REAL de la app no lleva `retry: false` (el helper de pruebas sí), porque justamente
  // lo que se prueba aquí es la política de reintento que el proveedor declara.
  const cliente = new QueryClient();
  render(
    <QueryClientProvider client={cliente}>
      <ProveedorSesion>
        <Sonda />
      </ProveedorSesion>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  obtenerSesionMock.mockReset();
});

describe('derivarEstadoSesion', () => {
  it('con datos manda el dato, aunque la última consulta haya fallado', () => {
    expect(derivarEstadoSesion({ data: SESION_OK, esError: false })).toBe('con-sesion');
    // 🔴 el caso del bug: ya sabíamos que hay sesión y un refetch truena → NO se echa al usuario.
    expect(derivarEstadoSesion({ data: SESION_OK, esError: true })).toBe('con-sesion');
  });

  it('el 401 llega como DATO y sí significa "no hay sesión"', () => {
    expect(derivarEstadoSesion({ data: { autenticado: false }, esError: false })).toBe(
      'sin-sesion',
    );
  });

  it('🔴 sin datos y con fallo NO es "sin sesión": es "no se sabe"', () => {
    expect(derivarEstadoSesion({ data: undefined, esError: true })).toBe('indeterminado');
  });

  it('sin datos y sin fallo sigue cargando (aquí caen los reintentos en curso)', () => {
    expect(derivarEstadoSesion({ data: undefined, esError: false })).toBe('cargando');
  });
});

describe('ProveedorSesion', () => {
  it('un fallo pasajero se reintenta y termina con la sesión abierta', async () => {
    obtenerSesionMock
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(SESION_OK);
    montar();

    // Durante el reintento NO se anuncia "sin sesión" (que es lo que mandaba al login).
    expect(screen.getByTestId('sonda')).not.toHaveTextContent('sin-sesion');
    await waitFor(
      () => {
        expect(screen.getByTestId('sonda')).toHaveTextContent('con-sesion · con-usuario');
      },
      { timeout: 5000 },
    );
    expect(obtenerSesionMock).toHaveBeenCalledTimes(2);
  });

  it('🔴 si nunca se puede preguntar, queda INDETERMINADO (nunca "sin-sesion")', async () => {
    obtenerSesionMock.mockRejectedValue(new Error('Failed to fetch'));
    montar();

    await waitFor(
      () => {
        expect(screen.getByTestId('sonda')).toHaveTextContent('indeterminado');
      },
      { timeout: 15000 },
    );
    // 4 llamadas = la primera + los 3 reintentos.
    expect(obtenerSesionMock).toHaveBeenCalledTimes(4);
  }, 20000);

  it('el 401 sí deja "sin sesión" y NO se reintenta (no es un error)', async () => {
    obtenerSesionMock.mockResolvedValue({ autenticado: false });
    montar();

    await waitFor(() => {
      expect(screen.getByTestId('sonda')).toHaveTextContent('sin-sesion · sin-usuario');
    });
    expect(obtenerSesionMock).toHaveBeenCalledTimes(1);
  });
});
