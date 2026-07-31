import { describe, expect, it } from 'vitest';

import {
  esquemaModeloBomBordadosCuerpo,
  esquemaModeloBomTelasCuerpo,
  esquemaModeloCopiarBomCuerpo,
  esquemaModeloCrear,
  esquemaModeloEditar,
  esquemaModeloFotoCrear,
  esquemaModelosQuery,
} from './modelo.js';

describe('esquemaModeloCrear', () => {
  it('acepta un alta válida y recorta espacios del código', () => {
    const datos = esquemaModeloCrear.parse({
      codigo: '  501  ',
      descripcion: '  Sudadera  ',
      maquilaBase: 35,
      idTemporada: 2,
    });
    expect(datos.codigo).toBe('501');
    expect(datos.descripcion).toBe('Sudadera');
    expect(datos.maquilaBase).toBe(35);
  });

  it('exige código no vacío', () => {
    expect(esquemaModeloCrear.safeParse({ codigo: '' }).success).toBe(false);
    expect(esquemaModeloCrear.safeParse({ codigo: '   ' }).success).toBe(false);
  });

  it('código basta: temporada/curva/género/maquila son opcionales (ETL E7)', () => {
    const datos = esquemaModeloCrear.parse({ codigo: 'X' });
    expect(datos.idTemporada).toBeUndefined();
    expect(datos.idCurvaTalla).toBeUndefined();
    expect(datos.idGenero).toBeUndefined();
    expect(datos.maquilaBase).toBeUndefined();
  });

  it('rechaza maquila base negativa', () => {
    expect(esquemaModeloCrear.safeParse({ codigo: 'X', maquilaBase: -1 }).success).toBe(false);
  });

  it('acepta la composición del desarrollo y la recorta (Daniel 24-jul-2026)', () => {
    const datos = esquemaModeloCrear.parse({ codigo: 'X', composicion: '  60% ALGODÓN  ' });
    expect(datos.composicion).toBe('60% ALGODÓN');
    expect(esquemaModeloCrear.parse({ codigo: 'X' }).composicion).toBeUndefined();
    expect(
      esquemaModeloCrear.safeParse({ codigo: 'X', composicion: 'a'.repeat(2001) }).success,
    ).toBe(false);
  });
});

describe('esquemaModeloEditar (PATCH parcial, M1)', () => {
  it('exige id y permite cambios parciales (incluido borrado suave)', () => {
    expect(esquemaModeloEditar.safeParse({ codigo: 'X' }).success).toBe(false);
    expect(esquemaModeloEditar.parse({ id: 3, activo: false })).toMatchObject({
      id: 3,
      activo: false,
    });
  });

  it('acepta null en maquilaBase y en las FK para vaciarlas (M1)', () => {
    const datos = esquemaModeloEditar.parse({
      id: 1,
      maquilaBase: null,
      idTemporada: null,
      idCurvaTalla: null,
      idGenero: null,
      descripcion: null,
      composicion: null,
    });
    expect(datos.maquilaBase).toBeNull();
    expect(datos.idTemporada).toBeNull();
    expect(datos.idCurvaTalla).toBeNull();
    expect(datos.idGenero).toBeNull();
    expect(datos.descripcion).toBeNull();
    expect(datos.composicion).toBeNull();
  });

  it('NO permite null en código (clave de negocio obligatoria)', () => {
    expect(esquemaModeloEditar.safeParse({ id: 1, codigo: null }).success).toBe(false);
  });

  it('omitir un campo lo deja undefined (no se toca)', () => {
    const datos = esquemaModeloEditar.parse({ id: 1, codigo: 'NUEVO' });
    expect(datos.codigo).toBe('NUEVO');
    expect(datos.idTemporada).toBeUndefined();
  });
});

describe('BOM: telas (consumo + 3 banderas 🔑) y sus reglas', () => {
  it('aplica el default true a las tres banderas y exige consumo > 0', () => {
    const datos = esquemaModeloBomTelasCuerpo.parse({
      telas: [{ idTela: 1, consumoPorPrenda: 2 }],
    });
    const renglon = datos.telas[0];
    expect(renglon).toMatchObject({
      idTela: 1,
      consumoPorPrenda: 2,
      paraPreCosto: true,
      paraProduccion: true,
      paraCosto: true,
    });
  });

  it('conserva banderas mixtas (costear sin producir y viceversa — doc 01-Modelos §2)', () => {
    const datos = esquemaModeloBomTelasCuerpo.parse({
      telas: [{ idTela: 1, consumoPorPrenda: 1, paraProduccion: false, paraCosto: true }],
    });
    expect(datos.telas[0]).toMatchObject({ paraProduccion: false, paraCosto: true });
  });

  it('rechaza consumo <= 0', () => {
    expect(
      esquemaModeloBomTelasCuerpo.safeParse({ telas: [{ idTela: 1, consumoPorPrenda: 0 }] })
        .success,
    ).toBe(false);
    expect(
      esquemaModeloBomTelasCuerpo.safeParse({ telas: [{ idTela: 1, consumoPorPrenda: -1 }] })
        .success,
    ).toBe(false);
  });

  it('rechaza telas repetidas y acepta set vacío', () => {
    expect(
      esquemaModeloBomTelasCuerpo.safeParse({
        telas: [
          { idTela: 1, consumoPorPrenda: 1 },
          { idTela: 1, consumoPorPrenda: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(esquemaModeloBomTelasCuerpo.safeParse({ telas: [] }).success).toBe(true);
  });
});

describe('BOM: bordados (precio por renglón, SIN banderas ni cantidad)', () => {
  it('acepta precio opcional (relajado para ETL) y rechaza repetidos', () => {
    const ok = esquemaModeloBomBordadosCuerpo.safeParse({
      bordados: [{ idBordado: 1, precio: 30 }, { idBordado: 2 }],
    });
    expect(ok.success).toBe(true);

    const repetido = esquemaModeloBomBordadosCuerpo.safeParse({
      bordados: [{ idBordado: 1 }, { idBordado: 1 }],
    });
    expect(repetido.success).toBe(false);
  });

  it('rechaza precio negativo', () => {
    expect(
      esquemaModeloBomBordadosCuerpo.safeParse({ bordados: [{ idBordado: 1, precio: -1 }] })
        .success,
    ).toBe(false);
  });
});

describe('esquemaModeloCopiarBomCuerpo', () => {
  it('exige idOrigen y aplica reemplazar=true por defecto', () => {
    const datos = esquemaModeloCopiarBomCuerpo.parse({ idOrigen: 5 });
    expect(datos).toMatchObject({ idOrigen: 5, reemplazar: true });
  });

  it('rechaza idOrigen no positivo', () => {
    expect(esquemaModeloCopiarBomCuerpo.safeParse({ idOrigen: 0 }).success).toBe(false);
  });
});

describe('esquemaModeloFotoCrear', () => {
  it('acepta una imagen con tipo por defecto OTRO', () => {
    const datos = esquemaModeloFotoCrear.parse({
      nombreOriginal: 'frente.jpg',
      tipoMime: 'image/jpeg',
      tamanoBytes: 4096,
    });
    expect(datos.tipo).toBe('OTRO');
  });

  it('rechaza un MIME que no es imagen', () => {
    expect(
      esquemaModeloFotoCrear.safeParse({
        nombreOriginal: 'doc.pdf',
        tipoMime: 'application/pdf',
        tamanoBytes: 10,
      }).success,
    ).toBe(false);
  });

  it('rechaza tamaño no positivo', () => {
    expect(
      esquemaModeloFotoCrear.safeParse({
        nombreOriginal: 'x.png',
        tipoMime: 'image/png',
        tamanoBytes: 0,
      }).success,
    ).toBe(false);
  });
});

describe('esquemaModelosQuery (querystring coaccionado)', () => {
  it('aplica defaults y coacciona números/banderas desde texto', () => {
    const filtros = esquemaModelosQuery.parse({});
    expect(filtros).toMatchObject({
      pagina: 1,
      porPagina: 20,
      incluirInactivos: false,
      ordenarPor: 'codigo',
      direccion: 'asc',
    });
    expect(filtros.idTemporada).toBeUndefined();

    const conTexto = esquemaModelosQuery.parse({
      pagina: '2',
      porPagina: '50',
      idTemporada: '3',
      incluirInactivos: 'true',
    });
    expect(conTexto).toMatchObject({
      pagina: 2,
      porPagina: 50,
      idTemporada: 3,
      incluirInactivos: true,
    });
  });

  it('rechaza columnas de orden fuera del enum y porPagina > 100', () => {
    expect(esquemaModelosQuery.safeParse({ ordenarPor: 'maquilaBase' }).success).toBe(false);
    expect(esquemaModelosQuery.safeParse({ porPagina: '101' }).success).toBe(false);
  });
});
