import { describe, expect, it } from 'vitest';

import {
  esquemaListarMaquileros,
  esquemaMaquileroCrear,
  esquemaMaquileroEditar,
  esquemaMaquileroPatchCuerpo,
} from './maquilero.js';

describe('esquemaMaquileroCrear', () => {
  it('acepta un alta válida y recorta espacios de corto/nombre', () => {
    const datos = esquemaMaquileroCrear.parse({
      corto: '  Intersew  ',
      nombre: '  Intersew  ',
      tipos: [1, 2],
    });
    expect(datos.corto).toBe('Intersew');
    expect(datos.nombre).toBe('Intersew');
    expect(datos.tipos).toEqual([1, 2]);
  });

  it('exige al menos un tipo de proceso (≥1)', () => {
    const sinTipos = esquemaMaquileroCrear.safeParse({ corto: 'X', nombre: 'X', tipos: [] });
    expect(sinTipos.success).toBe(false);
    const faltaCampo = esquemaMaquileroCrear.safeParse({ corto: 'X', nombre: 'X' });
    expect(faltaCampo.success).toBe(false);
  });

  it('rechaza tipos repetidos en la lista', () => {
    const repetidos = esquemaMaquileroCrear.safeParse({
      corto: 'X',
      nombre: 'X',
      tipos: [1, 1, 2],
    });
    expect(repetidos.success).toBe(false);
  });

  it('rechaza corto/nombre vacíos y demasiado largos', () => {
    expect(esquemaMaquileroCrear.safeParse({ corto: '', nombre: 'X', tipos: [1] }).success).toBe(
      false,
    );
    expect(
      esquemaMaquileroCrear.safeParse({ corto: 'a'.repeat(51), nombre: 'X', tipos: [1] }).success,
    ).toBe(false);
    expect(
      esquemaMaquileroCrear.safeParse({ corto: 'X', nombre: 'a'.repeat(201), tipos: [1] }).success,
    ).toBe(false);
  });

  it('rechaza ids de tipo no positivos o no enteros', () => {
    expect(esquemaMaquileroCrear.safeParse({ corto: 'X', nombre: 'X', tipos: [0] }).success).toBe(
      false,
    );
    expect(esquemaMaquileroCrear.safeParse({ corto: 'X', nombre: 'X', tipos: [1.5] }).success).toBe(
      false,
    );
  });
});

describe('esquemaMaquileroEditar (semántica del PATCH parcial, M1)', () => {
  it('exige id y permite cambios parciales (incluido borrado suave)', () => {
    expect(esquemaMaquileroEditar.safeParse({ corto: 'X' }).success).toBe(false);
    expect(esquemaMaquileroEditar.parse({ id: 3, activo: false })).toMatchObject({
      id: 3,
      activo: false,
    });
  });

  it('omitir un campo lo deja undefined (no se toca)', () => {
    const datos = esquemaMaquileroEditar.parse({ id: 1, corto: 'Nuevo' });
    expect(datos.corto).toBe('Nuevo');
    expect(datos.telefonos).toBeUndefined();
    expect(datos.observaciones).toBeUndefined();
    expect(datos.tipos).toBeUndefined();
  });

  it('acepta null en los textos opcionales para vaciarlos (M1)', () => {
    const datos = esquemaMaquileroEditar.parse({
      id: 1,
      apellidos: null,
      telefonos: null,
      direccion: null,
      observaciones: null,
      obsPago: null,
    });
    expect(datos.apellidos).toBeNull();
    expect(datos.telefonos).toBeNull();
    expect(datos.direccion).toBeNull();
    expect(datos.observaciones).toBeNull();
    expect(datos.obsPago).toBeNull();
  });

  it('NO permite null en corto ni en nombre (claves obligatorias)', () => {
    expect(esquemaMaquileroEditar.safeParse({ id: 1, corto: null }).success).toBe(false);
    expect(esquemaMaquileroEditar.safeParse({ id: 1, nombre: null }).success).toBe(false);
  });

  it('si se mandan tipos, deben ser ≥1 y sin repetidos', () => {
    expect(esquemaMaquileroEditar.safeParse({ id: 1, tipos: [] }).success).toBe(false);
    expect(esquemaMaquileroEditar.safeParse({ id: 1, tipos: [2, 2] }).success).toBe(false);
    expect(esquemaMaquileroEditar.parse({ id: 1, tipos: [2, 3] }).tipos).toEqual([2, 3]);
  });

  it('el cuerpo del PATCH no lleva id (va en la URL)', () => {
    expect('id' in esquemaMaquileroPatchCuerpo.parse({ corto: 'X' })).toBe(false);
  });
});

describe('esquemaListarMaquileros (querystring coaccionado)', () => {
  it('aplica defaults y coacciona números/banderas desde texto', () => {
    const filtros = esquemaListarMaquileros.parse({});
    expect(filtros).toMatchObject({
      pagina: 1,
      porPagina: 20,
      incluirInactivos: false,
      ordenarPor: 'corto',
      direccion: 'asc',
    });
    const conTexto = esquemaListarMaquileros.parse({
      pagina: '2',
      porPagina: '50',
      tipoProceso: '7',
      incluirInactivos: 'true',
    });
    expect(conTexto).toMatchObject({
      pagina: 2,
      porPagina: 50,
      tipoProceso: 7,
      incluirInactivos: true,
    });
  });

  it('rechaza columnas de orden fuera del enum y porPagina > 100', () => {
    expect(esquemaListarMaquileros.safeParse({ ordenarPor: 'asegurado' }).success).toBe(false);
    expect(esquemaListarMaquileros.safeParse({ porPagina: '101' }).success).toBe(false);
  });
});
