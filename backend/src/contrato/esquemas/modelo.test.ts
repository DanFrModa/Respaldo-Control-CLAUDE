import { describe, expect, it } from 'vitest';

import {
  esquemaModeloBomAviosCuerpo,
  esquemaModeloBomTelasCuerpo,
  esquemaModeloCopiarBomCuerpo,
  esquemaModeloCrear,
  esquemaModeloCrearMigracion,
  esquemaModeloEditar,
  esquemaModeloFotoCrear,
  esquemaModelosQuery,
} from './modelo.js';

/**
 * Los DOS DÍGITOS que el alta exige desde V1-E8j (§Post-F9.134): tipo de prenda (concepto) y género.
 * Se sacan a una constante porque ahora los lleva CADA alta válida de este archivo.
 */
const NOMENCLATURA = { idTipoProducto: 7, idGenero: 1 } as const;

describe('esquemaModeloCrear', () => {
  it('acepta un alta válida y recorta espacios del código', () => {
    const datos = esquemaModeloCrear.parse({
      codigo: '  501  ',
      descripcion: '  Sudadera  ',
      maquilaBase: 35,
      idTemporada: 2,
      ...NOMENCLATURA,
    });
    expect(datos.codigo).toBe('501');
    expect(datos.descripcion).toBe('Sudadera');
    expect(datos.maquilaBase).toBe(35);
  });

  it('exige código no vacío', () => {
    expect(esquemaModeloCrear.safeParse({ codigo: '' }).success).toBe(false);
    expect(esquemaModeloCrear.safeParse({ codigo: '   ' }).success).toBe(false);
  });

  /**
   * ⭐ V1-E8j (§Post-F9.134) — ESTA PRUEBA DECÍA LO CONTRARIO, Y SE VOLTEÓ CON SU RASTRO.
   *
   * Antes afirmaba *«código basta: temporada/curva/género/maquila son opcionales (ETL E7)»*. El
   * GÉNERO —y con él el tipo de prenda— dejaron de serlo: son los dos dígitos con los que se arma el
   * nº de producción, y desde que todo modelo nace en desarrollo, uno sin ellos no se puede
   * promover (llegaba a tumbar la importación de una OC completa).
   *
   * ⚠️ **El caso del ETL que esta prueba nombraba no se perdió: se mudó**, a
   * `esquemaModeloCrearMigracion` (ver el `describe` de abajo). Los ~4,987 modelos del Access no
   * traen género y ya son de producción con su número puesto, así que siguen entrando sin ellos —
   * pero por la puerta que lo dice, no por un opcional que valía para todos.
   */
  it('con los dos dígitos basta: temporada/curva/maquila siguen siendo opcionales', () => {
    const datos = esquemaModeloCrear.parse({ codigo: 'X', ...NOMENCLATURA });
    expect(datos.idTemporada).toBeUndefined();
    expect(datos.idCurvaTalla).toBeUndefined();
    expect(datos.maquilaBase).toBeUndefined();
    expect(datos.idGenero).toBe(NOMENCLATURA.idGenero);
    expect(datos.idTipoProducto).toBe(NOMENCLATURA.idTipoProducto);
  });

  it('🔴 sin género o sin tipo de prenda, el alta NO valida', () => {
    expect(esquemaModeloCrear.safeParse({ codigo: 'X' }).success).toBe(false);
    expect(esquemaModeloCrear.safeParse({ codigo: 'X', idGenero: 1 }).success).toBe(false);
    expect(esquemaModeloCrear.safeParse({ codigo: 'X', idTipoProducto: 7 }).success).toBe(false);
  });

  it('rechaza maquila base negativa', () => {
    expect(
      esquemaModeloCrear.safeParse({ codigo: 'X', maquilaBase: -1, ...NOMENCLATURA }).success,
    ).toBe(false);
  });

  it('acepta la composición del desarrollo y la recorta (Daniel 24-jul-2026)', () => {
    const datos = esquemaModeloCrear.parse({
      codigo: 'X',
      composicion: '  60% ALGODÓN  ',
      ...NOMENCLATURA,
    });
    expect(datos.composicion).toBe('60% ALGODÓN');
    expect(esquemaModeloCrear.parse({ codigo: 'X', ...NOMENCLATURA }).composicion).toBeUndefined();
    expect(
      esquemaModeloCrear.safeParse({ codigo: 'X', composicion: 'a'.repeat(2001), ...NOMENCLATURA })
        .success,
    ).toBe(false);
  });
});

/**
 * ⭐ V1-E8j — LA PUERTA DEL ETL, que es donde vive ahora la excepción.
 *
 * `crearModeloMigrado` es su ÚNICO usuario. Si algún día alguien lo cablea a una ruta REST, esta
 * pareja de pruebas no lo impide — pero deja escrito, y verificado, que la relajación es de la
 * migración y de nadie más.
 */
describe('esquemaModeloCrearMigracion (ETL del histórico)', () => {
  it('acepta el alta SIN los dos dígitos (el Access no trae género)', () => {
    const datos = esquemaModeloCrearMigracion.parse({ codigo: '71001' });
    expect(datos.idGenero).toBeUndefined();
    expect(datos.idTipoProducto).toBeUndefined();
  });

  it('…y sigue exigiendo lo demás: el código no puede ir vacío', () => {
    expect(esquemaModeloCrearMigracion.safeParse({ codigo: '   ' }).success).toBe(false);
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

describe('BOM: AMARRE de precio del renglón (R17, V1-E3c)', () => {
  it('la tela acepta el amarre al renglón proveedor–tela–precio y su default es null', () => {
    const sinAmarre = esquemaModeloBomTelasCuerpo.parse({
      telas: [{ idTela: 1, consumoPorPrenda: 1 }],
    });
    expect(sinAmarre.telas[0]?.idTelaProveedor).toBeNull();

    const conAmarre = esquemaModeloBomTelasCuerpo.parse({
      telas: [{ idTela: 1, consumoPorPrenda: 1, idTelaProveedor: 77 }],
    });
    expect(conAmarre.telas[0]?.idTelaProveedor).toBe(77);
  });

  it('el avío acepta el proveedor amarrado del par AvioProveedor y su default es null', () => {
    const sinAmarre = esquemaModeloBomAviosCuerpo.parse({
      avios: [{ idAvio: 3, consumoPorPrenda: 2 }],
    });
    expect(sinAmarre.avios[0]?.idAvioProveedor).toBeNull();

    const conAmarre = esquemaModeloBomAviosCuerpo.parse({
      avios: [{ idAvio: 3, consumoPorPrenda: 2, idAvioProveedor: 9 }],
    });
    expect(conAmarre.avios[0]?.idAvioProveedor).toBe(9);
  });

  it('rechaza amarres que no son enteros positivos (0, negativos, decimales)', () => {
    for (const idTelaProveedor of [0, -1, 1.5]) {
      expect(
        esquemaModeloBomTelasCuerpo.safeParse({
          telas: [{ idTela: 1, consumoPorPrenda: 1, idTelaProveedor }],
        }).success,
      ).toBe(false);
    }
    expect(
      esquemaModeloBomAviosCuerpo.safeParse({
        avios: [{ idAvio: 1, consumoPorPrenda: 1, idAvioProveedor: -3 }],
      }).success,
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
