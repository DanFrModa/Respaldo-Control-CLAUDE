import { describe, expect, it } from 'vitest';

import {
  esquemaComposicionTelaEditar,
  esquemaListarTelas,
  esquemaTelaCategoriaEditar,
  esquemaTelaColorEntrada,
  esquemaTelaCrear,
  esquemaTelaCrearMigracion,
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
  it('acepta un alta mínima (nombre + unidad + proveedor) y aplica defaults', () => {
    const datos = esquemaTelaCrear.parse({
      nombre: '  Felpa  ',
      unidadMedida: 'KG',
      idProveedor: 4,
    });
    expect(datos.nombre).toBe('Felpa');
    expect(datos.unidadMedida).toBe('KG');
    expect(datos.idProveedor).toBe(4);
    expect(datos.tipoComponente).toBe('OTRO');
    expect(datos.favorito).toBe(false);
    expect(datos.paraProduccion).toBe(true);
    expect(datos.colores).toEqual([]);
  });

  // La unidad NO tiene default a propósito: una tela de metros que naciera en kilos ensuciaría el
  // stock, el consumo y el costo por prenda sin que nadie lo note (Daniel, 30-jul-2026).
  it('RECHAZA un alta sin unidad, y solo acepta kilos o metros', () => {
    expect(esquemaTelaCrear.safeParse({ nombre: 'Felpa', idProveedor: 4 }).success).toBe(false);
    expect(
      esquemaTelaCrear.safeParse({ nombre: 'Felpa', idProveedor: 4, unidadMedida: 'YARDA' })
        .success,
    ).toBe(false);
    expect(
      esquemaTelaCrear.safeParse({ nombre: 'Felpa', idProveedor: 4, unidadMedida: 'M' }).success,
    ).toBe(true);
  });

  // §Post-F9.11: la tela ES de un proveedor. El contrato del alta lo exige; SOLO la
  // variante de MIGRACIÓN (el ETL: telas viejas sin proveedor) lo deja opcional.
  it('RECHAZA un alta sin PROVEEDOR; la variante de migración sí lo permite omitir', () => {
    expect(esquemaTelaCrear.safeParse({ nombre: 'Felpa', unidadMedida: 'KG' }).success).toBe(false);
    expect(
      esquemaTelaCrear.safeParse({ nombre: 'F', unidadMedida: 'KG', idProveedor: 0 }).success,
    ).toBe(false);
    expect(
      esquemaTelaCrearMigracion.safeParse({ nombre: 'FelpaAlsa100', unidadMedida: 'KG' }).success,
    ).toBe(true);
  });

  it('acepta la identidad completa (composición, nombres del proveedor/cuerpo/complemento)', () => {
    const datos = esquemaTelaCrear.parse({
      nombre: 'Felpa Suiza Alsatex',
      unidadMedida: 'KG',
      idProveedor: 4,
      idComposicion: 9,
      nombreProveedor: '  Felpa Suiza  ',
      nombreCuerpo: 'Felpa',
      nombreComplemento: 'Cardigan',
    });
    expect(datos.idComposicion).toBe(9);
    expect(datos.nombreProveedor).toBe('Felpa Suiza');
    expect(datos.nombreCuerpo).toBe('Felpa');
    expect(datos.nombreComplemento).toBe('Cardigan');
  });

  it('acepta un grid de colores con y sin precio', () => {
    const datos = esquemaTelaCrear.parse({
      nombre: 'Jersey',
      unidadMedida: 'KG',
      idProveedor: 4,
      colores: [{ nombre: 'Negro', precio: 95.5 }, { nombre: 'Blanco' }],
    });
    expect(datos.colores).toEqual([{ nombre: 'Negro', precio: 95.5 }, { nombre: 'Blanco' }]);
  });

  it('permite un grid de colores VACÍO (una tela sin colores es válida)', () => {
    expect(
      esquemaTelaCrear.safeParse({
        nombre: 'Sin colores',
        unidadMedida: 'KG',
        idProveedor: 4,
        colores: [],
      }).success,
    ).toBe(true);
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

describe('esquemaTelaColorEntrada (hijo de la tela: nombre libre + pantone + dos precios)', () => {
  it('acepta nombre libre + pantone + dos precios; rechaza inválidos', () => {
    expect(
      esquemaTelaColorEntrada.parse({
        nombre: ' Marino Alsa 3040 ',
        precio: 95,
        precioComplemento: 60,
        pantone: ' 19-4005 TCX ',
      }),
    ).toEqual({
      nombre: 'Marino Alsa 3040',
      precio: 95,
      precioComplemento: 60,
      pantone: '19-4005 TCX',
    });
    expect(
      esquemaTelaColorEntrada.safeParse({ nombre: 'Negro', precioComplemento: -1 }).success,
    ).toBe(false);
    expect(
      esquemaTelaColorEntrada.safeParse({ nombre: 'Negro', pantone: 'x'.repeat(51) }).success,
    ).toBe(false);
    // El color de tela ya NO lleva id del catálogo de prenda: el NOMBRE es su identidad.
    expect(esquemaTelaColorEntrada.safeParse({ idColor: 1 }).success).toBe(false);
  });

  // R3-1: el `id` opcional de la FILA hace que renombrar no la destruya (liga legacy).
  it('acepta el id de la fila (opcional) y rechaza ids no positivos', () => {
    expect(esquemaTelaColorEntrada.parse({ id: 7, nombre: 'Marino Alsa 3040' })).toEqual({
      id: 7,
      nombre: 'Marino Alsa 3040',
    });
    expect(esquemaTelaColorEntrada.safeParse({ id: 0, nombre: 'X' }).success).toBe(false);
    expect(esquemaTelaColorEntrada.safeParse({ id: 1.5, nombre: 'X' }).success).toBe(false);
  });

  it('rechaza NOMBRES repetidos en el grid, sin importar mayúsculas (Zod refine)', () => {
    expect(
      esquemaTelaCrear.safeParse({
        nombre: 'Repe',
        unidadMedida: 'KG',
        idProveedor: 4,
        colores: [{ nombre: 'Negro' }, { nombre: ' NEGRO ' }],
      }).success,
    ).toBe(false);
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

  it('acepta null para vaciar descripcion y para quitar categoría/composición/precio', () => {
    const datos = esquemaTelaEditar.parse({
      id: 1,
      descripcion: null,
      idCategoria: null,
      idComposicion: null,
      nombreComplemento: null,
      precioSugerido: null,
    });
    expect(datos.descripcion).toBeNull();
    expect(datos.idCategoria).toBeNull();
    expect(datos.idComposicion).toBeNull();
    expect(datos.nombreComplemento).toBeNull();
    expect(datos.precioSugerido).toBeNull();
  });

  it('el PROVEEDOR se corrige pero NO se vacía (identidad de la tela, §Post-F9.11)', () => {
    expect(esquemaTelaEditar.safeParse({ id: 1, idProveedor: 9 }).success).toBe(true);
    expect(esquemaTelaEditar.safeParse({ id: 1, idProveedor: null }).success).toBe(false);
    // Omitirlo se vale: "no tocar" (una migrada sin proveedor se edita sin exigirlo).
    expect(esquemaTelaEditar.safeParse({ id: 1 }).success).toBe(true);
  });

  it('la unidad NO se puede vaciar en la edición (una tela sin unidad no existe)', () => {
    expect(esquemaTelaEditar.safeParse({ id: 1, unidadMedida: null }).success).toBe(false);
    // Omitirla sí se vale: "no tocar".
    expect(esquemaTelaEditar.safeParse({ id: 1 }).success).toBe(true);
    expect(esquemaTelaEditar.safeParse({ id: 1, unidadMedida: 'M' }).success).toBe(true);
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

describe('esquemaComposicionTelaEditar (no arrastra defaults)', () => {
  it('exige id; nombre opcional; activo para borrado suave', () => {
    expect(esquemaComposicionTelaEditar.safeParse({ nombre: 'X' }).success).toBe(false);
    expect(esquemaComposicionTelaEditar.parse({ id: 2, activo: false })).toMatchObject({
      id: 2,
      activo: false,
    });
    expect(esquemaComposicionTelaEditar.parse({ id: 2 }).nombre).toBeUndefined();
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

  it('rechaza columnas de orden fuera del enum y porPagina > 100', () => {
    expect(esquemaListarTelas.safeParse({ ordenarPor: 'favorito' }).success).toBe(false);
    // El tope es 100 porque es el que aplica el DOMINIO al re-validar (`esquemaPaginacion`).
    // Estuvo publicado en 500 —para que los dropdowns cargaran el catálogo entero— pero el
    // dominio nunca lo acompañó: pedir 500 devolvía 400, no 500 renglones. La coherencia
    // entre los dos lados la vigila `paginacion-honesta.test.ts`; aquí sólo se fija el borde.
    expect(esquemaListarTelas.safeParse({ porPagina: '100' }).success).toBe(true);
    expect(esquemaListarTelas.safeParse({ porPagina: '101' }).success).toBe(false);
  });
});
