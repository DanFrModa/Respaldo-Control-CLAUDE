import { describe, expect, it } from 'vitest';

import {
  ErrorBloqueado,
  ErrorConflicto,
  ErrorDominio,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
  esErrorDominio,
} from './errores.js';

describe('errores de dominio', () => {
  it('cada error expone su código estable (el front mapea por código, no por mensaje)', () => {
    expect(new ErrorValidacion('x').codigo).toBe('VALIDACION');
    expect(new ErrorNoEncontrado('Almacen', 1).codigo).toBe('NO_ENCONTRADO');
    expect(new ErrorPermiso().codigo).toBe('PERMISO');
    expect(new ErrorConflicto('x').codigo).toBe('CONFLICTO');
    expect(new ErrorBloqueado('x').codigo).toBe('BLOQUEADO');
  });

  it('todos heredan de ErrorDominio y de Error (instanceof funciona para catch)', () => {
    const errores = [
      new ErrorValidacion('x'),
      new ErrorNoEncontrado('Almacen', 1),
      new ErrorPermiso(),
      new ErrorConflicto('x'),
      new ErrorBloqueado('x'),
    ];
    for (const error of errores) {
      expect(error).toBeInstanceOf(ErrorDominio);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('name refleja la subclase concreta (legible en logs)', () => {
    expect(new ErrorConflicto('x').name).toBe('ErrorConflicto');
    expect(new ErrorNoEncontrado('Almacen', 1).name).toBe('ErrorNoEncontrado');
  });

  it('ErrorNoEncontrado arma el mensaje con entidad e id y los expone como campos', () => {
    const error = new ErrorNoEncontrado('Almacen', 42n);
    expect(error.message).toBe('No se encontró Almacen con id 42.');
    expect(error.entidad).toBe('Almacen');
    expect(error.id).toBe('42');
  });

  it('ErrorPermiso tiene mensaje por defecto en español y conserva la clave faltante', () => {
    const sinClave = new ErrorPermiso();
    expect(sinClave.message).toBe('No tienes permiso para realizar esta operación.');
    const conClave = new ErrorPermiso(undefined, 'admin.almacenes');
    expect(conClave.permiso).toBe('admin.almacenes');
  });

  it('conserva detalles serializables y la causa original', () => {
    const causa = new Error('falla interna');
    const error = new ErrorValidacion('Datos inválidos.', {
      detalles: { campo: 'nombre' },
      causa,
    });
    expect(error.detalles).toEqual({ campo: 'nombre' });
    expect(error.cause).toBe(causa);
  });

  it('esErrorDominio distingue errores de negocio de fallas internas', () => {
    expect(esErrorDominio(new ErrorConflicto('x'))).toBe(true);
    expect(esErrorDominio(new Error('interna'))).toBe(false);
    expect(esErrorDominio(null)).toBe(false);
    expect(esErrorDominio('texto')).toBe(false);
  });
});
