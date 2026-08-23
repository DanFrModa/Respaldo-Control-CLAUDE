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

/**
 * 🔴 **V1-E3z (3a vuelta) — LAS FRASES DEL CONTRATO TIENEN QUE LLEGAR A LA PANTALLA.**
 *
 * Los cuerpos de este bloque son **los del backend, copiados de su handler**
 * (`backend/src/api/errores.ts`, rama 2: `codigo: 'VALIDACION'`, `mensaje` generico y la frase
 * especifica dentro de `detalles[].mensaje`). Esa es la parte que importa: la version anterior de
 * esta suite solo probaba cuerpos SIN `detalles`, asi que el defecto —devolver unicamente el
 * generico— pasaba entre las pruebas sin tocarlas.
 */
describe('mensajeDeError — las frases especificas de `detalles` (cuerpo REAL del backend)', () => {
  /** Lo que responde el backend cuando Zod rechaza un ajuste con precio negativo. */
  const rechazoDeValidacion = {
    codigo: 'VALIDACION',
    mensaje: 'Los datos enviados no son válidos.',
    detalles: [{ campo: '/ajustes/0/precioUnitario', mensaje: 'El precio no puede ser negativo' }],
  };

  it('🔴 pega la frase especifica al mensaje generico (antes se perdia)', () => {
    // 🔴 Antes esto devolvia solo 'Los datos enviados no son válidos.' y el usuario no sabia que
    // campo ni por que — incumpliendo el estandar de la propia etapa: un aviso a secas obliga a
    // adivinar cual de veinte renglones fue.
    expect(mensajeDeError(rechazoDeValidacion)).toBe(
      'Los datos enviados no son válidos. El precio no puede ser negativo.',
    );
  });

  it('la misma frase repetida en varios renglones se dice UNA vez', () => {
    expect(
      mensajeDeError({
        ...rechazoDeValidacion,
        detalles: [
          { campo: '/ajustes/0/precioUnitario', mensaje: 'El precio no puede ser negativo' },
          { campo: '/ajustes/3/precioUnitario', mensaje: 'El precio no puede ser negativo' },
        ],
      }),
    ).toBe('Los datos enviados no son válidos. El precio no puede ser negativo.');
  });

  it('dos frases DISTINTAS se dicen las dos', () => {
    const texto = mensajeDeError({
      ...rechazoDeValidacion,
      detalles: [
        { campo: '/ajustes/0/precioUnitario', mensaje: 'El precio no puede ser negativo' },
        {
          campo: '/ajustes/1/cantidadTotal',
          mensaje: 'La cantidad a comprar debe ser mayor que cero',
        },
      ],
    });
    expect(texto).toContain('El precio no puede ser negativo.');
    expect(texto).toContain('La cantidad a comprar debe ser mayor que cero.');
  });

  it('con muchas, dice las primeras y CUENTA el resto (un aviso larguisimo no se lee)', () => {
    const texto = mensajeDeError({
      ...rechazoDeValidacion,
      detalles: [1, 2, 3, 4, 5].map((n) => ({
        campo: `/x/${String(n)}`,
        mensaje: `Problema ${String(n)}`,
      })),
    });
    expect(texto).toContain('Problema 1.');
    expect(texto).toContain('Problema 3.');
    expect(texto).not.toContain('Problema 4');
    expect(texto).toContain('y 2 problema(s) más.');
  });

  it('sin `detalles` se comporta igual que siempre (no inventa nada)', () => {
    expect(mensajeDeError({ codigo: 'CONFLICTO', mensaje: 'Ya existe.' })).toBe('Ya existe.');
  });

  it('`detalles` con basura no rompe ni ensucia el mensaje', () => {
    for (const detalles of [null, 'texto', 42, [null, 7, {}, { mensaje: '   ' }]]) {
      expect(mensajeDeError({ ...rechazoDeValidacion, detalles })).toBe(
        'Los datos enviados no son válidos.',
      );
    }
  });

  it('⭐ y `ErrorDeApi` lo hereda: es lo que de verdad llega a las pantallas', () => {
    // Las pantallas no llaman a `mensajeDeError`: leen `error.message` del hook, que es esto.
    expect(new ErrorDeApi(rechazoDeValidacion).message).toBe(
      'Los datos enviados no son válidos. El precio no puede ser negativo.',
    );
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
