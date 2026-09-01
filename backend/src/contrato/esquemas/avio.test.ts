import { describe, expect, it } from 'vitest';

import {
  esquemaAvioCrear,
  esquemaAvioEditar,
  esquemaAvioPatchCuerpo,
  esquemaListarAvios,
} from './avio.js';

describe('esquemaAvioCrear', () => {
  it('acepta un alta válida y recorta espacios de clave/descripción', () => {
    const datos = esquemaAvioCrear.parse({
      clave: '  BTN-01  ',
      descripcion: '  Botón 2 cm  ',
      unidad: 'pza',
      presentacion: 'caja',
    });
    expect(datos.clave).toBe('BTN-01');
    expect(datos.descripcion).toBe('Botón 2 cm');
    // favorito/esGenerico aplican su default.
    expect(datos.favorito).toBe(false);
    expect(datos.esGenerico).toBe(false);
  });

  it('unidad y presentación son OPCIONALES en el contrato (ADR-0009; el form las exige)', () => {
    const datos = esquemaAvioCrear.parse({ clave: 'X', descripcion: 'Avío migrado' });
    expect(datos.unidad).toBeUndefined();
    expect(datos.presentacion).toBeUndefined();
  });

  it('exige clave y descripción no vacías', () => {
    expect(esquemaAvioCrear.safeParse({ clave: '', descripcion: 'X' }).success).toBe(false);
    expect(esquemaAvioCrear.safeParse({ clave: 'X', descripcion: '' }).success).toBe(false);
  });

  it('favorito ⇒ cantFav obligatoria (>0)', () => {
    // Favorito sin cantFav: falla.
    expect(
      esquemaAvioCrear.safeParse({ clave: 'X', descripcion: 'X', favorito: true }).success,
    ).toBe(false);
    // Favorito con cantFav = 0: falla (debe ser > 0).
    expect(
      esquemaAvioCrear.safeParse({ clave: 'X', descripcion: 'X', favorito: true, cantFav: 0 })
        .success,
    ).toBe(false);
    // Favorito con cantFav > 0: ok.
    expect(
      esquemaAvioCrear.safeParse({ clave: 'X', descripcion: 'X', favorito: true, cantFav: 12 })
        .success,
    ).toBe(true);
    // No favorito sin cantFav: ok.
    expect(esquemaAvioCrear.safeParse({ clave: 'X', descripcion: 'X' }).success).toBe(true);
  });

  it('acepta proveedores inline con precio/condiciones y rechaza repetidos', () => {
    const ok = esquemaAvioCrear.safeParse({
      clave: 'X',
      descripcion: 'X',
      proveedores: [{ idProveedor: 1, precio: 0.5, condiciones: 'contado' }, { idProveedor: 2 }],
    });
    expect(ok.success).toBe(true);

    const repetido = esquemaAvioCrear.safeParse({
      clave: 'X',
      descripcion: 'X',
      proveedores: [{ idProveedor: 1 }, { idProveedor: 1 }],
    });
    expect(repetido.success).toBe(false);
  });

  it('un avío PUEDE no tener proveedores (≥0)', () => {
    expect(
      esquemaAvioCrear.safeParse({ clave: 'X', descripcion: 'X', proveedores: [] }).success,
    ).toBe(true);
  });

  it('rechaza precio de proveedor negativo y precioReferencia negativo', () => {
    expect(
      esquemaAvioCrear.safeParse({
        clave: 'X',
        descripcion: 'X',
        proveedores: [{ idProveedor: 1, precio: -1 }],
      }).success,
    ).toBe(false);
    expect(
      esquemaAvioCrear.safeParse({ clave: 'X', descripcion: 'X', precioReferencia: -1 }).success,
    ).toBe(false);
  });
});

describe('esquemaAvioEditar (semántica del PATCH parcial, M1)', () => {
  it('exige id y permite cambios parciales (incluido borrado suave)', () => {
    expect(esquemaAvioEditar.safeParse({ clave: 'X' }).success).toBe(false);
    expect(esquemaAvioEditar.parse({ id: 3, activo: false })).toMatchObject({
      id: 3,
      activo: false,
    });
  });

  it('omitir un campo lo deja undefined (no se toca)', () => {
    const datos = esquemaAvioEditar.parse({ id: 1, clave: 'NUEVA' });
    expect(datos.clave).toBe('NUEVA');
    expect(datos.unidad).toBeUndefined();
    expect(datos.proveedores).toBeUndefined();
  });

  it('acepta null en unidad/presentación/cantFav/precioReferencia para vaciarlos (M1)', () => {
    const datos = esquemaAvioEditar.parse({
      id: 1,
      unidad: null,
      presentacion: null,
      cantFav: null,
      precioReferencia: null,
    });
    expect(datos.unidad).toBeNull();
    expect(datos.presentacion).toBeNull();
    expect(datos.cantFav).toBeNull();
    expect(datos.precioReferencia).toBeNull();
  });

  it('NO permite null en clave ni descripción (obligatorias)', () => {
    expect(esquemaAvioEditar.safeParse({ id: 1, clave: null }).success).toBe(false);
    expect(esquemaAvioEditar.safeParse({ id: 1, descripcion: null }).success).toBe(false);
  });

  it('favorito ⇒ cantFav también se valida en edición cuando el payload pone favorito:true', () => {
    expect(esquemaAvioEditar.safeParse({ id: 1, favorito: true }).success).toBe(false);
    expect(esquemaAvioEditar.safeParse({ id: 1, favorito: true, cantFav: 5 }).success).toBe(true);
  });

  it('si se mandan proveedores, sin repetidos (puede ser [])', () => {
    expect(
      esquemaAvioEditar.safeParse({ id: 1, proveedores: [{ idProveedor: 1 }, { idProveedor: 1 }] })
        .success,
    ).toBe(false);
    expect(esquemaAvioEditar.safeParse({ id: 1, proveedores: [] }).success).toBe(true);
  });

  it('el cuerpo del PATCH no lleva id (va en la URL)', () => {
    expect('id' in esquemaAvioPatchCuerpo.parse({ clave: 'X' })).toBe(false);
  });
});

describe('esquemaListarAvios (querystring coaccionado)', () => {
  it('aplica defaults y coacciona números/banderas desde texto', () => {
    const filtros = esquemaListarAvios.parse({});
    expect(filtros).toMatchObject({
      pagina: 1,
      porPagina: 20,
      incluirInactivos: false,
      ordenarPor: 'clave',
      direccion: 'asc',
    });
    expect(filtros.esGenerico).toBeUndefined();

    const conTexto = esquemaListarAvios.parse({
      pagina: '2',
      porPagina: '50',
      esGenerico: 'true',
      incluirInactivos: 'true',
    });
    expect(conTexto).toMatchObject({
      pagina: 2,
      porPagina: 50,
      esGenerico: true,
      incluirInactivos: true,
    });
  });

  it('rechaza columnas de orden fuera del enum y porPagina > 100', () => {
    expect(esquemaListarAvios.safeParse({ ordenarPor: 'favorito' }).success).toBe(false);
    // El tope es 100 porque es el que aplica el DOMINIO al re-validar (`esquemaPaginacion`).
    // Estuvo publicado en 500 —para que los dropdowns cargaran el catálogo entero— pero el
    // dominio nunca lo acompañó: pedir 500 devolvía 400, no 500 renglones. La coherencia
    // entre los dos lados la vigila `paginacion-honesta.test.ts`; aquí sólo se fija el borde.
    expect(esquemaListarAvios.safeParse({ porPagina: '100' }).success).toBe(true);
    expect(esquemaListarAvios.safeParse({ porPagina: '101' }).success).toBe(false);
  });
});
