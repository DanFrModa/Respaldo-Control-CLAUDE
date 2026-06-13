import { describe, expect, it } from 'vitest';

import { esquemaAlmacenCrear, esquemaAlmacenEditar } from './almacen.js';
import { esquemaEmpresaCrear, esquemaEmpresaEditar } from './empresa.js';
import { esquemaEtiquetaMarcaCrear, esquemaEtiquetaMarcaEditar } from './etiqueta-marca.js';
import { esquemaLogin } from './login.js';
import { esquemaProveedorCrear, esquemaProveedorEditar } from './proveedor.js';
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

// REGRESIÓN (bug que cazó el CI): en Zod, `.partial()` NO elimina los `.default()`.
// Un esquema de EDICIÓN parcial debe sobrescribir como `.optional()` los campos que
// tienen `.default()` en el alta; si no, al omitir el campo en una edición, el parse lo
// rellena con su default y PISA el valor real en la BD (p.ej. desactivar un proveedor sin
// mandar `tipo` lo cambiaría a SIN_CLASIFICAR). Estos tests garantizan que el campo
// omitido quede `undefined` (no presente) en la salida del parse.
describe('esquemas de edición: omitir un campo con default NO lo rellena (Zod .partial())', () => {
  it('el alta SÍ aplica el default (control: comprueba que el default existe)', () => {
    expect(esquemaProveedorCrear.parse({ nombre: 'X' }).tipo).toBe('SIN_CLASIFICAR');
    expect(esquemaEtiquetaMarcaCrear.parse({ nombre: 'X' }).regalias).toBe(0);
    const empresa = esquemaEmpresaCrear.parse({ nombre: 'X' });
    expect(empresa.favorita).toBe(false);
    expect(empresa.paraIpt).toBe(false);
    expect(empresa.paraEdr).toBe(false);
  });

  it('esquemaProveedorEditar: omitir `tipo` lo deja undefined (no rellena SIN_CLASIFICAR)', () => {
    const datos = esquemaProveedorEditar.parse({ id: 1, activo: false });
    expect('tipo' in datos).toBe(false);
    expect(datos.tipo).toBeUndefined();
    expect(datos).toEqual({ id: 1, activo: false });
    // pero si se manda, sigue validándose contra el enum
    expect(esquemaProveedorEditar.parse({ id: 1, tipo: 'AVIOS' }).tipo).toBe('AVIOS');
    expect(esquemaProveedorEditar.safeParse({ id: 1, tipo: 'OTRO' }).success).toBe(false);
  });

  it('esquemaEtiquetaMarcaEditar: omitir `regalias` lo deja undefined (no rellena 0)', () => {
    const datos = esquemaEtiquetaMarcaEditar.parse({ id: 1, activo: false });
    expect('regalias' in datos).toBe(false);
    expect(datos.regalias).toBeUndefined();
    expect(datos).toEqual({ id: 1, activo: false });
    // si se manda, sigue acotado a 0–100
    expect(esquemaEtiquetaMarcaEditar.parse({ id: 1, regalias: 15 }).regalias).toBe(15);
    expect(esquemaEtiquetaMarcaEditar.safeParse({ id: 1, regalias: 150 }).success).toBe(false);
  });

  it('esquemaEmpresaEditar: omitir las banderas las deja undefined (no rellena false)', () => {
    const datos = esquemaEmpresaEditar.parse({ upc: '750' });
    expect('favorita' in datos).toBe(false);
    expect('paraIpt' in datos).toBe(false);
    expect('paraEdr' in datos).toBe(false);
    expect(datos.favorita).toBeUndefined();
    expect(datos.paraIpt).toBeUndefined();
    expect(datos.paraEdr).toBeUndefined();
    expect(datos).toEqual({ upc: '750' });
    // si se mandan, se respetan
    expect(esquemaEmpresaEditar.parse({ favorita: true }).favorita).toBe(true);
  });
});
