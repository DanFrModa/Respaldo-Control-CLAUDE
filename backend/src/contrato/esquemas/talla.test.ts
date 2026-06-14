import { describe, expect, it } from 'vitest';

import {
  esquemaCurvaCrear,
  esquemaCurvaEditar,
  esquemaListarCurvas,
  esquemaListarTallas,
  esquemaTallaCrear,
  esquemaTallaEditar,
} from './talla.js';

describe('esquemaTallaCrear', () => {
  it('acepta un alta válida y recorta espacios de la etiqueta', () => {
    const datos = esquemaTallaCrear.parse({ etiqueta: '  CH  ', orden: 2 });
    expect(datos.etiqueta).toBe('CH');
    expect(datos.orden).toBe(2);
  });

  it('el orden es opcional (lo asigna el dominio si falta)', () => {
    expect(esquemaTallaCrear.parse({ etiqueta: 'M' }).orden).toBeUndefined();
  });

  it('rechaza etiqueta vacía o demasiado larga', () => {
    expect(esquemaTallaCrear.safeParse({ etiqueta: '' }).success).toBe(false);
    expect(esquemaTallaCrear.safeParse({ etiqueta: '   ' }).success).toBe(false);
    expect(esquemaTallaCrear.safeParse({ etiqueta: 'a'.repeat(51) }).success).toBe(false);
  });

  it('rechaza orden negativo o no entero', () => {
    expect(esquemaTallaCrear.safeParse({ etiqueta: 'M', orden: -1 }).success).toBe(false);
    expect(esquemaTallaCrear.safeParse({ etiqueta: 'M', orden: 1.5 }).success).toBe(false);
  });
});

describe('esquemaTallaEditar (semántica del PATCH parcial)', () => {
  it('exige id y permite cambios parciales (incluido borrado suave)', () => {
    expect(esquemaTallaEditar.safeParse({ etiqueta: 'M' }).success).toBe(false);
    expect(esquemaTallaEditar.parse({ id: 3, activo: false })).toMatchObject({
      id: 3,
      activo: false,
    });
  });

  it('omitir un campo lo deja undefined (no se toca)', () => {
    const datos = esquemaTallaEditar.parse({ id: 1, etiqueta: 'G' });
    expect(datos.etiqueta).toBe('G');
    expect(datos.orden).toBeUndefined();
    expect(datos.activo).toBeUndefined();
  });

  it('rechaza id no positivo o no entero', () => {
    expect(esquemaTallaEditar.safeParse({ id: 0 }).success).toBe(false);
    expect(esquemaTallaEditar.safeParse({ id: 1.5 }).success).toBe(false);
  });
});

describe('esquemaCurvaCrear (items ordenados)', () => {
  it('acepta un alta válida y conserva el ORDEN del arreglo de items', () => {
    const datos = esquemaCurvaCrear.parse({ nombre: '  Dama  ', items: [3, 1, 2] });
    expect(datos.nombre).toBe('Dama');
    // El orden se conserva tal cual (la posición la asigna el dominio por este orden).
    expect(datos.items).toEqual([3, 1, 2]);
  });

  it('exige al menos una talla (≥1)', () => {
    expect(esquemaCurvaCrear.safeParse({ nombre: 'X', items: [] }).success).toBe(false);
    expect(esquemaCurvaCrear.safeParse({ nombre: 'X' }).success).toBe(false);
  });

  it('rechaza tallas repetidas en la curva', () => {
    expect(esquemaCurvaCrear.safeParse({ nombre: 'X', items: [1, 1, 2] }).success).toBe(false);
  });

  it('rechaza ids de talla no positivos o no enteros', () => {
    expect(esquemaCurvaCrear.safeParse({ nombre: 'X', items: [0] }).success).toBe(false);
    expect(esquemaCurvaCrear.safeParse({ nombre: 'X', items: [1.5] }).success).toBe(false);
  });

  it('rechaza nombre vacío o demasiado largo', () => {
    expect(esquemaCurvaCrear.safeParse({ nombre: '', items: [1] }).success).toBe(false);
    expect(esquemaCurvaCrear.safeParse({ nombre: 'a'.repeat(151), items: [1] }).success).toBe(
      false,
    );
  });
});

describe('esquemaCurvaEditar (PATCH parcial; items reemplazan el set)', () => {
  it('exige id; omitir items los deja undefined (no se tocan)', () => {
    expect(esquemaCurvaEditar.safeParse({ nombre: 'X' }).success).toBe(false);
    const datos = esquemaCurvaEditar.parse({ id: 1, nombre: 'Nueva' });
    expect(datos.nombre).toBe('Nueva');
    expect(datos.items).toBeUndefined();
  });

  it('si se mandan items, deben ser ≥1 y sin repetidos', () => {
    expect(esquemaCurvaEditar.safeParse({ id: 1, items: [] }).success).toBe(false);
    expect(esquemaCurvaEditar.safeParse({ id: 1, items: [2, 2] }).success).toBe(false);
    expect(esquemaCurvaEditar.parse({ id: 1, items: [2, 3] }).items).toEqual([2, 3]);
  });
});

describe('esquemaListarTallas / esquemaListarCurvas (querystring coaccionado)', () => {
  it('tallas: aplica defaults y coacciona números/banderas desde texto', () => {
    expect(esquemaListarTallas.parse({})).toMatchObject({
      pagina: 1,
      porPagina: 20,
      incluirInactivos: false,
      ordenarPor: 'orden',
      direccion: 'asc',
    });
    expect(
      esquemaListarTallas.parse({ pagina: '2', porPagina: '50', incluirInactivos: 'true' }),
    ).toMatchObject({ pagina: 2, porPagina: 50, incluirInactivos: true });
  });

  it('curvas: el orden por defecto es por nombre', () => {
    expect(esquemaListarCurvas.parse({})).toMatchObject({ ordenarPor: 'nombre', direccion: 'asc' });
  });

  it('rechaza columnas de orden fuera del enum y porPagina > 100', () => {
    expect(esquemaListarTallas.safeParse({ ordenarPor: 'activo' }).success).toBe(false);
    expect(esquemaListarCurvas.safeParse({ porPagina: '101' }).success).toBe(false);
  });
});
