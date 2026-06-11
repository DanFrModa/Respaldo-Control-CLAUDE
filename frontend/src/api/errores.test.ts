import { describe, expect, it } from 'vitest';

import { ErrorDeApi, MENSAJE_ERROR_DESCONOCIDO, mensajeDeError } from './errores';

describe('mensajeDeError', () => {
  it('usa el mensaje en español del cuerpo de error del API', () => {
    expect(
      mensajeDeError({ codigo: 'CONFLICTO', mensaje: 'Ya existe un almacén con ese nombre.' }),
    ).toBe('Ya existe un almacén con ese nombre.');
  });

  it('cae al mensaje de respaldo ante un error de red (Error suelto)', () => {
    expect(mensajeDeError(new Error('Failed to fetch'))).toBe(MENSAJE_ERROR_DESCONOCIDO);
  });

  it('cae al mensaje de respaldo ante formas no reconocidas', () => {
    expect(mensajeDeError(undefined)).toBe(MENSAJE_ERROR_DESCONOCIDO);
    expect(mensajeDeError({ algo: 'raro' })).toBe(MENSAJE_ERROR_DESCONOCIDO);
    // Un cuerpo sin `codigo` no es un ErrorApi valido: respaldo.
    expect(mensajeDeError({ mensaje: 'sin codigo' })).toBe(MENSAJE_ERROR_DESCONOCIDO);
  });
});

describe('ErrorDeApi', () => {
  it('lleva el mensaje y el codigo del error del API', () => {
    const error = new ErrorDeApi({ codigo: 'PERMISO', mensaje: 'No tienes permiso.' });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('No tienes permiso.');
    expect(error.codigo).toBe('PERMISO');
  });

  it('usa codigo DESCONOCIDO y mensaje de respaldo cuando el error no es del API', () => {
    const error = new ErrorDeApi(new Error('boom'));
    expect(error.message).toBe(MENSAJE_ERROR_DESCONOCIDO);
    expect(error.codigo).toBe('DESCONOCIDO');
  });
});
