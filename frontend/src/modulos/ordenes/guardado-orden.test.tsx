import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  ProveedorGuardadoOrden,
  useRegistroGuardadoOrden,
  useReinicioBloqueado,
  useSeccionGuardable,
  type EjecutorGuardado,
  type PrepararGuardado,
} from './guardado-orden';

/**
 * Unit del registro del guardado ÚNICO del diálogo de la orden — los caminos que la pantalla real
 * no puede provocar hoy pero que NO deben degenerar: un `preparar` que revienta (debe tratarse como
 * fallo normal, no como rechazo sin manejar) y el olvido del "último fallo" al cambiar de orden.
 * El flujo feliz y el fallo de una mutación se cubren en `DialogoOrden.test.tsx`.
 */

/** Sección de mentira: registra el `preparar` que le pasen y dice si el reinicio está bloqueado. */
function SeccionDePrueba({ preparar }: { preparar: PrepararGuardado }): React.JSX.Element {
  useSeccionGuardable('encabezado', 'el encabezado', true, preparar);
  const bloqueado = useReinicioBloqueado();
  return <span data-testid="bloqueo">{bloqueado ? 'bloqueado' : 'libre'}</span>;
}

/** Arnés mínimo: el registro + una sección + el botón que dispara el guardado. */
function Arnes({
  preparar,
  idOrden = 1,
  alTerminar,
}: {
  preparar: PrepararGuardado;
  idOrden?: number;
  alTerminar?: (resultado: { ok: boolean; error?: string }) => void;
}): React.JSX.Element {
  const { valorContexto, guardarTodo } = useRegistroGuardadoOrden(idOrden);
  return (
    <ProveedorGuardadoOrden value={valorContexto}>
      <SeccionDePrueba preparar={preparar} />
      <button
        type="button"
        data-testid="guardar"
        onClick={() => void guardarTodo().then((r) => alTerminar?.(r))}
      >
        Guardar
      </button>
    </ProveedorGuardadoOrden>
  );
}

describe('useRegistroGuardadoOrden', () => {
  it('un `preparar` que REVIENTA se trata como fallo normal (sin rechazo sin manejar)', async () => {
    const usuario = userEvent.setup();
    const alTerminar = vi.fn();
    const preparar = (): Promise<EjecutorGuardado | null> => {
      throw new Error('boom');
    };
    render(<Arnes preparar={preparar} alTerminar={alTerminar} />);

    await usuario.click(screen.getByTestId('guardar'));

    await waitFor(() => expect(alTerminar).toHaveBeenCalledTimes(1));
    expect(alTerminar.mock.calls[0]?.[0]).toMatchObject({ ok: false });
    expect((alTerminar.mock.calls[0]?.[0] as { error?: string }).error).toMatch(
      /No se pudieron preparar los cambios: boom/,
    );
    // Y el guardado quedó marcado como fallido → la pantalla conserva lo capturado.
    await waitFor(() => expect(screen.getByTestId('bloqueo')).toHaveTextContent('bloqueado'));
  });

  it('una promesa RECHAZADA en `preparar` sigue el mismo camino', async () => {
    const usuario = userEvent.setup();
    const alTerminar = vi.fn();
    render(<Arnes preparar={() => Promise.reject(new Error('sin red'))} alTerminar={alTerminar} />);

    await usuario.click(screen.getByTestId('guardar'));

    await waitFor(() => expect(alTerminar).toHaveBeenCalledTimes(1));
    expect((alTerminar.mock.calls[0]?.[0] as { error?: string }).error).toMatch(/sin red/);
  });

  it('cambiar de orden OLVIDA el último guardado fallido', async () => {
    const usuario = userEvent.setup();
    const preparar = (): Promise<EjecutorGuardado | null> => {
      throw new Error('boom');
    };
    const { rerender } = render(<Arnes preparar={preparar} idOrden={1} />);

    await usuario.click(screen.getByTestId('guardar'));
    await waitFor(() => expect(screen.getByTestId('bloqueo')).toHaveTextContent('bloqueado'));

    rerender(<Arnes preparar={preparar} idOrden={2} />);
    await waitFor(() => expect(screen.getByTestId('bloqueo')).toHaveTextContent('libre'));
  });
});
