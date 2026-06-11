import { describe, expect, it } from 'vitest';

import { MENSAJE_AUTH_DESCONOCIDO, traducirErrorAuth } from './mensajes-auth';

describe('traducirErrorAuth (mensajes del login en español)', () => {
  it('traduce el 401 de credenciales invalidas de better-auth', () => {
    expect(
      traducirErrorAuth({
        code: 'INVALID_USERNAME_OR_PASSWORD',
        message: 'Invalid username or password',
        status: 401,
      }),
    ).toBe('Usuario o contraseña incorrectos.');
  });

  it('muestra TAL CUAL el mensaje de bloqueo del servidor (403)', () => {
    expect(
      traducirErrorAuth({
        status: 403,
        message: 'Estás bloqueado. Contacta al administrador.',
      }),
    ).toBe('Estás bloqueado. Contacta al administrador.');
  });

  it('muestra TAL CUAL el mensaje de cuenta desactivada (403)', () => {
    expect(
      traducirErrorAuth({
        status: 403,
        message: 'Tu cuenta está desactivada. Contacta al administrador.',
      }),
    ).toBe('Tu cuenta está desactivada. Contacta al administrador.');
  });

  it('prioriza el 403 con mensaje aunque traiga un code conocido', () => {
    // Un 403 del servidor manda: su texto en español se respeta sobre la tabla.
    expect(
      traducirErrorAuth({
        code: 'INVALID_USERNAME_OR_PASSWORD',
        status: 403,
        message: 'Estás bloqueado. Contacta al administrador.',
      }),
    ).toBe('Estás bloqueado. Contacta al administrador.');
  });

  it('traduce errores de validacion de usuario de better-auth', () => {
    expect(traducirErrorAuth({ code: 'USERNAME_TOO_SHORT', status: 400 })).toBe(
      'El usuario es demasiado corto.',
    );
  });

  it('responde el mensaje de respaldo ante codigos desconocidos, sin error o sin mensaje', () => {
    expect(traducirErrorAuth({ code: 'ALGO_RARO', message: 'weird', status: 500 })).toBe(
      MENSAJE_AUTH_DESCONOCIDO,
    );
    expect(traducirErrorAuth(null)).toBe(MENSAJE_AUTH_DESCONOCIDO);
    expect(traducirErrorAuth({})).toBe(MENSAJE_AUTH_DESCONOCIDO);
    // Un 403 SIN mensaje no puede mostrarse tal cual: cae al respaldo.
    expect(traducirErrorAuth({ status: 403 })).toBe(MENSAJE_AUTH_DESCONOCIDO);
  });
});
