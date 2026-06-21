import { describe, expect, it } from 'vitest';

import {
  esquemaListarTelas,
  esquemaTelaCategoriaEditar,
  esquemaTelaCrear,
  esquemaTelaEditar,
} from './tela.js';

/**
 * Unit del contrato de Telas (F1-E3) — reglas de captura puras (Zod), sin base de datos.
 * Cubre lo crítico del esquema: nombre obligatorio/único de forma, grid de colores
 * (vacío permitido, sin repetidos, precio no negativo), defaults del alta y la semántica
 * del PATCH parcial (M1) — en especial que `.partial()` NO arrastre los `default()` a la
 * edición (el bug que el CI atrapó en F1-E1). La integridad transaccional real se prueba
 * en `telas.int.test.ts` (CI).
 */

describe('esquemaTelaCrear', () => {
  it('acepta un alta mínima (solo nombre) y aplica defaults', () => {
    const datos = esquemaTelaCrear.parse({ nombre: '  Felpa  ' });
    expect(datos.nombre).toBe('Felpa');
    expect(datos.tipoComponente).toBe('OTRO');
    expect(datos.favorito).toBe(false);
    expect(datos.paraProduccion).toBe(true);
    expect(datos.colores).toEqual([]);
  });

  it('acepta un grid de colores con y sin precio', () => {
    const datos = esquemaTelaCrear.parse({
      nombre: 'Jersey',
      colores: [{ idColor: 1, precio: 95.5 }, { idColor: 2 }],
    });
    expect(datos.colores).toEqual([{ idColor: 1, precio: 95.5 }, { idColor: 2 }]);
  });

  it('permite un grid de colores VACÍO (una tela sin colores es válida)', () => {
    expect(esquemaTelaCrear.safeParse({ nombre: 'Sin colores', colores: [] }).success).toBe(true);
  });

  it('rechaza colores repetidos dentro de la misma tela', () => {
    const repetidos = esquemaTelaCrear.safeParse({
      nombre: 'Repe',
      colores: [
        { idColor: 5, precio: 1 },
        { idColor: 5, precio: 2 },
      ],
    });
    expect(repetidos.success).toBe(false);
  });

  it('rechaza precio de color negativo y precio sugerido negativo', () => {
    expect(
      esquemaTelaCrear.safeParse({ nombre: 'X', colores: [{ idColor: 1, precio: -1 }] }).success,
    ).toBe(false);
    expect(esquemaTelaCrear.safeParse({ nombre: 'X', precioSugerido: -3 }).success).toBe(false);
  });

  it('rechaza ids de color/categoría no positivos o no enteros', () => {
    expect(esquemaTelaCrear.safeParse({ nombre: 'X', idCategoria: 0 }).success).toBe(false);
    expect(esquemaTelaCrear.safeParse({ nombre: 'X', idCategoria: 1.5 }).success).toBe(false);
    expect(esquemaTelaCrear.safeParse({ nombre: 'X', colores: [{ idColor: -2 }] }).success).toBe(
      false,
    );
  });

  it('rechaza nombre vacío, demasiado largo o tipoComponente fuera del enum', () => {
    expect(esquemaTelaCrear.safeParse({ nombre: '   ' }).success).toBe(false);
    expect(esquemaTelaCrear.safeParse({ nombre: 'a'.repeat(151) }).success).toBe(false);
    expect(esquemaTelaCrear.safeParse({ nombre: 'X', tipoComponente: 'FELPA' }).success).toBe(
      false,
    );
  });
});

describe('esquemaTelaEditar (semántica del PATCH parcial, M1)', () => {
  it('exige id y permite cambios parciales (incluido borrado suave)', () => {
    expect(esquemaTelaEditar.safeParse({ nombre: 'X' }).success).toBe(false);
    expect(esquemaTelaEditar.parse({ id: 3, activo: false })).toMatchObject({
      id: 3,
      activo: false,
    });
  });

  it('omitir un campo lo deja undefined (no se toca): banderas/enums NO heredan default', () => {
    const datos = esquemaTelaEditar.parse({ id: 1, nombre: 'Nueva' });
    expect(datos.nombre).toBe('Nueva');
    // Clave: .partial() NO debe arrastrar los default() del alta a la edición. Omitir
    // tipoComponente/favorito/paraProduccion los deja undefined (no 'OTRO'/false/true).
    expect(datos.tipoComponente).toBeUndefined();
    expect(datos.favorito).toBeUndefined();
    expect(datos.paraProduccion).toBeUndefined();
    expect(datos.colores).toBeUndefined();
    expect(datos.descripcion).toBeUndefined();
  });

  it('acepta null para vaciar descripcion/unidadMedida y para quitar categoría/precio', () => {
    const datos = esquemaTelaEditar.parse({
      id: 1,
      descripcion: null,
      unidadMedida: null,
      idCategoria: null,
      precioSugerido: null,
    });
    expect(datos.descripcion).toBeNull();
    expect(datos.unidadMedida).toBeNull();
    expect(datos.idCategoria).toBeNull();
    expect(datos.precioSugerido).toBeNull();
  });

  it('NO permite null en el nombre (clave obligatoria)', () => {
    expect(esquemaTelaEditar.safeParse({ id: 1, nombre: null }).success).toBe(false);
  });

  it('si se manda colores, valida sin repetidos; puede ir vacío (reemplaza por vacío)', () => {
    expect(
      esquemaTelaEditar.safeParse({ id: 1, colores: [{ idColor: 2 }, { idColor: 2 }] }).success,
    ).toBe(false);
    expect(esquemaTelaEditar.parse({ id: 1, colores: [] }).colores).toEqual([]);
  });
});

describe('esquemaTelaCategoriaEditar (no arrastra defaults)', () => {
  it('exige id; nombre opcional; activo para borrado suave', () => {
    expect(esquemaTelaCategoriaEditar.safeParse({ nombre: 'X' }).success).toBe(false);
    expect(esquemaTelaCategoriaEditar.parse({ id: 2, activo: false })).toMatchObject({
      id: 2,
      activo: false,
    });
    expect(esquemaTelaCategoriaEditar.parse({ id: 2 }).nombre).toBeUndefined();
  });
});

describe('esquemaListarTelas (querystring coaccionado)', () => {
  it('aplica defaults y coacciona números/banderas desde texto', () => {
    expect(esquemaListarTelas.parse({})).toMatchObject({
      pagina: 1,
      porPagina: 20,
      incluirInactivos: false,
      ordenarPor: 'nombre',
      direccion: 'asc',
    });
    const conTexto = esquemaListarTelas.parse({
      pagina: '2',
      porPagina: '50',
      idCategoria: '7',
      incluirInactivos: 'true',
    });
    expect(conTexto).toMatchObject({
      pagina: 2,
      porPagina: 50,
      idCategoria: 7,
      incluirInactivos: true,
    });
  });

  it('rechaza columnas de orden fuera del enum y porPagina > 500', () => {
    expect(esquemaListarTelas.safeParse({ ordenarPor: 'favorito' }).success).toBe(false);
    // El tope se subió a 500 para que los dropdowns carguen todo el catálogo (fix dropdowns).
    expect(esquemaListarTelas.safeParse({ porPagina: '500' }).success).toBe(true);
    expect(esquemaListarTelas.safeParse({ porPagina: '501' }).success).toBe(false);
  });
});
