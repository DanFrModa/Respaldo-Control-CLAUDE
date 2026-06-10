import { describe, expect, it, vi } from 'vitest';

import { ErrorBloqueado } from '../comun/errores.js';
import type { EvaluacionPrevia, ResultadoIntentoFallido } from '../dominio/auth/login.js';

import {
  aplicarBloqueoAntesDeLogin,
  aplicarBloqueoDespuesDeLogin,
  usernameDelCuerpo,
  type ServiciosBloqueo,
} from './bloqueo.js';

describe('usernameDelCuerpo', () => {
  it('normaliza a minúsculas y recorta espacios', () => {
    expect(usernameDelCuerpo({ username: '  Admin  ' })).toBe('admin');
  });

  it('devuelve null si no hay username utilizable', () => {
    expect(usernameDelCuerpo({})).toBeNull();
    expect(usernameDelCuerpo({ username: '   ' })).toBeNull();
    expect(usernameDelCuerpo({ username: 123 })).toBeNull();
    expect(usernameDelCuerpo(null)).toBeNull();
    expect(usernameDelCuerpo('texto')).toBeNull();
  });
});

describe('aplicarBloqueoAntesDeLogin', () => {
  const lanzar = (mensaje: string): never => {
    throw new ErrorBloqueado(mensaje);
  };

  it('no hace nada si el cuerpo no trae username (lo maneja el motor)', async () => {
    const evaluar = vi.fn<(u: string) => Promise<EvaluacionPrevia>>();
    await aplicarBloqueoAntesDeLogin({}, evaluar, lanzar);
    expect(evaluar).not.toHaveBeenCalled();
  });

  it('deja pasar a un usuario permitido', async () => {
    const evaluar = vi
      .fn<(u: string) => Promise<EvaluacionPrevia>>()
      .mockResolvedValue({ estado: 'permitido', idUsuario: 'u1' });
    await expect(
      aplicarBloqueoAntesDeLogin({ username: 'admin' }, evaluar, lanzar),
    ).resolves.toBeUndefined();
    expect(evaluar).toHaveBeenCalledWith('admin');
  });

  it('deja pasar a un usuario desconocido (no se revela su ausencia)', async () => {
    const evaluar = vi
      .fn<(u: string) => Promise<EvaluacionPrevia>>()
      .mockResolvedValue({ estado: 'desconocido' });
    await expect(
      aplicarBloqueoAntesDeLogin({ username: 'fantasma' }, evaluar, lanzar),
    ).resolves.toBeUndefined();
  });

  it('traduce el bloqueo del dominio mediante la función inyectada', async () => {
    const evaluar = vi
      .fn<(u: string) => Promise<EvaluacionPrevia>>()
      .mockRejectedValue(new ErrorBloqueado('Estás bloqueado. Contacta al administrador.'));
    const lanzarSpy = vi.fn(lanzar);
    await expect(
      aplicarBloqueoAntesDeLogin({ username: 'admin' }, evaluar, lanzarSpy),
    ).rejects.toBeInstanceOf(ErrorBloqueado);
    expect(lanzarSpy).toHaveBeenCalledWith('Estás bloqueado. Contacta al administrador.');
  });
});

describe('aplicarBloqueoDespuesDeLogin', () => {
  function servicios(): ServiciosBloqueo & {
    exitoso: ReturnType<typeof vi.fn>;
    fallido: ReturnType<typeof vi.fn>;
  } {
    const exitoso = vi.fn<(id: string) => Promise<void>>().mockResolvedValue();
    const fallido = vi
      .fn<(u: string) => Promise<ResultadoIntentoFallido | null>>()
      .mockResolvedValue({ intentosFallidos: 1, bloqueado: false });
    return { registrarAccesoExitoso: exitoso, registrarIntentoFallido: fallido, exitoso, fallido };
  }

  it('en éxito reinicia los intentos (no registra fallo)', async () => {
    const svc = servicios();
    await aplicarBloqueoDespuesDeLogin({ username: 'admin' }, true, 'u1', svc);
    expect(svc.exitoso).toHaveBeenCalledWith('u1');
    expect(svc.fallido).not.toHaveBeenCalled();
  });

  it('en fallo registra el intento fallido con el username', async () => {
    const svc = servicios();
    await aplicarBloqueoDespuesDeLogin({ username: 'Admin' }, false, undefined, svc);
    expect(svc.fallido).toHaveBeenCalledWith('admin');
    expect(svc.exitoso).not.toHaveBeenCalled();
  });

  it('en fallo sin username utilizable no hace nada', async () => {
    const svc = servicios();
    await aplicarBloqueoDespuesDeLogin({}, false, undefined, svc);
    expect(svc.fallido).not.toHaveBeenCalled();
    expect(svc.exitoso).not.toHaveBeenCalled();
  });

  it('éxito sin idUsuario no intenta reiniciar (defensa)', async () => {
    const svc = servicios();
    await aplicarBloqueoDespuesDeLogin({ username: 'admin' }, true, undefined, svc);
    expect(svc.exitoso).not.toHaveBeenCalled();
  });
});
