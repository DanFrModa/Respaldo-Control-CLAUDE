import { describe, expect, it } from 'vitest';

import {
  esquemaClienteCampoCrear,
  esquemaClienteCampoEditar,
  esquemaClienteCrear,
  esquemaClienteEditar,
  esquemaListarClientes,
} from './cliente.js';

describe('esquemaClienteCrear', () => {
  it('acepta un alta válida y recorta espacios del nombre/contacto', () => {
    const datos = esquemaClienteCrear.parse({
      nombre: '  Liverpool  ',
      contacto: '  Ana  ',
      email: 'compras@liverpool.mx',
    });
    expect(datos.nombre).toBe('Liverpool');
    expect(datos.contacto).toBe('Ana');
    expect(datos.email).toBe('compras@liverpool.mx');
  });

  it('permite crear solo con nombre (contacto/email opcionales)', () => {
    const datos = esquemaClienteCrear.parse({ nombre: 'Pumas' });
    expect(datos.nombre).toBe('Pumas');
    expect(datos.contacto).toBeUndefined();
    expect(datos.email).toBeUndefined();
    expect(datos.razonSocial).toBeUndefined();
  });

  it('acepta la razón social opcional y la recorta', () => {
    const datos = esquemaClienteCrear.parse({
      nombre: 'Liverpool',
      razonSocial: '  El Puerto de Liverpool, S.A.B. de C.V.  ',
    });
    expect(datos.razonSocial).toBe('El Puerto de Liverpool, S.A.B. de C.V.');
    expect(
      esquemaClienteCrear.safeParse({ nombre: 'X', razonSocial: 'a'.repeat(201) }).success,
    ).toBe(false);
  });

  it('rechaza nombre vacío y demasiado largo', () => {
    expect(esquemaClienteCrear.safeParse({ nombre: '' }).success).toBe(false);
    expect(esquemaClienteCrear.safeParse({ nombre: 'a'.repeat(201) }).success).toBe(false);
  });

  it('rechaza un email mal formado', () => {
    expect(esquemaClienteCrear.safeParse({ nombre: 'X', email: 'no-es-email' }).success).toBe(
      false,
    );
  });
});

describe('esquemaClienteEditar (semántica del PATCH parcial, M1)', () => {
  it('exige id y permite cambios parciales (incluido borrado suave)', () => {
    expect(esquemaClienteEditar.safeParse({ nombre: 'X' }).success).toBe(false);
    expect(esquemaClienteEditar.parse({ id: 3, activo: false })).toMatchObject({
      id: 3,
      activo: false,
    });
  });

  it('omitir un campo lo deja undefined (no se toca)', () => {
    const datos = esquemaClienteEditar.parse({ id: 1, nombre: 'Nuevo' });
    expect(datos.nombre).toBe('Nuevo');
    expect(datos.telefono).toBeUndefined();
    expect(datos.email).toBeUndefined();
  });

  it('acepta null en los datos de contacto para vaciarlos (M1)', () => {
    const datos = esquemaClienteEditar.parse({
      id: 1,
      razonSocial: null,
      contacto: null,
      telefono: null,
      email: null,
      direccion: null,
    });
    expect(datos.razonSocial).toBeNull();
    expect(datos.contacto).toBeNull();
    expect(datos.telefono).toBeNull();
    expect(datos.email).toBeNull();
    expect(datos.direccion).toBeNull();
  });

  it('NO permite null en el nombre (clave de negocio obligatoria)', () => {
    expect(esquemaClienteEditar.safeParse({ id: 1, nombre: null }).success).toBe(false);
  });

  it('si se manda un email, debe ser válido (aunque sea en edición)', () => {
    expect(esquemaClienteEditar.safeParse({ id: 1, email: 'malo' }).success).toBe(false);
    expect(esquemaClienteEditar.parse({ id: 1, email: 'a@b.mx' }).email).toBe('a@b.mx');
  });
});

describe('esquemaClienteCampoCrear (campo de referencia D7)', () => {
  it('acepta un alta válida, recorta la etiqueta y usa TEXTO por defecto', () => {
    const datos = esquemaClienteCampoCrear.parse({ etiqueta: '  No. pedido  ' });
    expect(datos.etiqueta).toBe('No. pedido');
    expect(datos.tipo).toBe('TEXTO');
    expect(datos.orden).toBeUndefined();
  });

  it('acepta los tres tipos (TEXTO/NUMERO/FECHA) y rechaza otro', () => {
    expect(esquemaClienteCampoCrear.parse({ etiqueta: 'X', tipo: 'NUMERO' }).tipo).toBe('NUMERO');
    expect(esquemaClienteCampoCrear.parse({ etiqueta: 'X', tipo: 'FECHA' }).tipo).toBe('FECHA');
    expect(esquemaClienteCampoCrear.safeParse({ etiqueta: 'X', tipo: 'BOOL' }).success).toBe(false);
  });

  it('rechaza etiqueta vacía y demasiado larga', () => {
    expect(esquemaClienteCampoCrear.safeParse({ etiqueta: '' }).success).toBe(false);
    expect(esquemaClienteCampoCrear.safeParse({ etiqueta: 'a'.repeat(101) }).success).toBe(false);
  });

  it('rechaza orden negativo o no entero', () => {
    expect(esquemaClienteCampoCrear.safeParse({ etiqueta: 'X', orden: -1 }).success).toBe(false);
    expect(esquemaClienteCampoCrear.safeParse({ etiqueta: 'X', orden: 1.5 }).success).toBe(false);
  });
});

describe('esquemaClienteCampoEditar (PATCH parcial del campo)', () => {
  it('exige id y permite cambios parciales (incluido borrado suave)', () => {
    expect(esquemaClienteCampoEditar.safeParse({ etiqueta: 'X' }).success).toBe(false);
    expect(esquemaClienteCampoEditar.parse({ id: 5, activo: false })).toMatchObject({
      id: 5,
      activo: false,
    });
  });

  it('omitir un campo lo deja undefined (no se toca)', () => {
    const datos = esquemaClienteCampoEditar.parse({ id: 1, etiqueta: 'Nuevo' });
    expect(datos.etiqueta).toBe('Nuevo');
    expect(datos.tipo).toBeUndefined();
    expect(datos.orden).toBeUndefined();
  });
});

describe('esquemaListarClientes (querystring coaccionado)', () => {
  it('aplica defaults y coacciona números/banderas desde texto', () => {
    const filtros = esquemaListarClientes.parse({});
    expect(filtros).toMatchObject({
      pagina: 1,
      porPagina: 20,
      incluirInactivos: false,
      ordenarPor: 'nombre',
      direccion: 'asc',
    });
    const conTexto = esquemaListarClientes.parse({
      pagina: '2',
      porPagina: '50',
      incluirInactivos: 'true',
    });
    expect(conTexto).toMatchObject({ pagina: 2, porPagina: 50, incluirInactivos: true });
  });

  it('rechaza columnas de orden fuera del enum y porPagina > 100', () => {
    expect(esquemaListarClientes.safeParse({ ordenarPor: 'email' }).success).toBe(false);
    expect(esquemaListarClientes.safeParse({ porPagina: '101' }).success).toBe(false);
  });
});
