import { describe, expect, it } from 'vitest';

import { esquemaAlmacenCrear, esquemaAlmacenEditar } from './almacen.js';
import { esquemaLogin } from './login.js';
import { esquemaUsuarioCrear, esquemaUsuarioEditar } from './usuario.js';

describe('esquemaLogin', () => {
  it('acepta usuario y contraseña, recortando espacios del usuario', () => {
    const datos = esquemaLogin.parse({ username: '  admin  ', password: 'Control.2026!' });
    expect(datos.username).toBe('admin');
  });

  it('rechaza campos vacíos con mensajes en español', () => {
    const resultado = esquemaLogin.safeParse({ username: '', password: '' });
    expect(resultado.success).toBe(false);
    const mensajes = resultado.error?.issues.map((i) => i.message);
    expect(mensajes).toContain('El usuario es obligatorio');
    expect(mensajes).toContain('La contraseña es obligatoria');
  });
});

describe('esquemaAlmacen', () => {
  it('acepta un alta válida con tipo del kardex (PT|TELA|AVIO)', () => {
    const datos = esquemaAlmacenCrear.parse({ nombre: 'Almacén Naucalpan', tipo: 'TELA' });
    expect(datos).toEqual({ nombre: 'Almacén Naucalpan', tipo: 'TELA' });
  });

  it('rechaza tipo fuera del enum y nombre de más de 100 caracteres', () => {
    expect(esquemaAlmacenCrear.safeParse({ nombre: 'X', tipo: 'BODEGA' }).success).toBe(false);
    expect(esquemaAlmacenCrear.safeParse({ nombre: 'a'.repeat(101), tipo: 'PT' }).success).toBe(
      false,
    );
  });

  it('en edición exige id y permite cambios parciales (incluido borrado suave)', () => {
    expect(esquemaAlmacenEditar.safeParse({ activo: false }).success).toBe(false);
    expect(esquemaAlmacenEditar.parse({ id: 3, activo: false })).toEqual({
      id: 3,
      activo: false,
    });
  });
});

describe('esquemaUsuario', () => {
  it('normaliza el username a minúsculas y aplica defaults', () => {
    const datos = esquemaUsuarioCrear.parse({
      username: '  Daniel.Masri ',
      nombre: 'Daniel Masri',
      password: 'Control.2026!',
    });
    expect(datos.username).toBe('daniel.masri');
    expect(datos.esAuditor).toBe(false);
    expect(datos.idsRoles).toEqual([]);
  });

  it('rechaza username con caracteres inválidos y contraseña corta', () => {
    expect(
      esquemaUsuarioCrear.safeParse({
        username: 'daniel masri',
        nombre: 'Daniel',
        password: 'Control.2026!',
      }).success,
    ).toBe(false);
    expect(
      esquemaUsuarioCrear.safeParse({
        username: 'daniel',
        nombre: 'Daniel',
        password: 'corta',
      }).success,
    ).toBe(false);
  });

  it('en edición exige id y descarta campos no editables (username/password)', () => {
    expect(esquemaUsuarioEditar.safeParse({ nombre: 'Otro' }).success).toBe(false);
    const datos = esquemaUsuarioEditar.parse({
      id: 'abc',
      bloqueado: false,
      idsRoles: [1, 2],
      username: 'intruso',
      password: 'NuevaClave123',
    });
    expect(datos).toEqual({ id: 'abc', bloqueado: false, idsRoles: [1, 2] });
  });
});
