/**
 * Tests del contrato del ARTE del modelo (V1-E3d §Post-F9.35 + V1-E3f §Post-F9.52/.58). Lo que se
 * cuida aquí: la `descripcion` OBLIGATORIA que reemplazó al nombre retirado, el `idTipoArte` del
 * catálogo único (ex enum), la `posicion` de texto libre, el proveedor del arte y la semántica del
 * PATCH parcial (omitir ≠ vaciar).
 */
import { describe, expect, it } from 'vitest';

import {
  esquemaArteCopiarCuerpo,
  esquemaArteCrear,
  esquemaArtePatchCuerpo,
  esquemaGaleriaArteQuery,
} from './arte.js';

describe('esquemaArteCrear', () => {
  it('acepta un alta completa y recorta espacios de descripción y posición', () => {
    const datos = esquemaArteCrear.parse({
      descripcion: '  Águila bordada  ',
      posicion: '  frente  ',
      idTipoArte: 3,
      puntadas: 12_000,
      precio: 15.5,
      idProveedor: 7,
    });
    expect(datos).toMatchObject({
      descripcion: 'Águila bordada',
      posicion: 'frente',
      idTipoArte: 3,
      puntadas: 12_000,
      precio: 15.5,
      idProveedor: 7,
    });
  });

  it('descripción y tipo son obligatorios; el resto es opcional', () => {
    const datos = esquemaArteCrear.parse({ descripcion: 'Solo lo mínimo', idTipoArte: 1 });
    expect(datos.precio).toBeUndefined();
    expect(datos.posicion).toBeUndefined();
    expect(datos.idProveedor).toBeUndefined();

    // Sin tipo NO pasa: ya no hay default BORDADO que lo tape (el enum se retiró).
    expect(esquemaArteCrear.safeParse({ descripcion: 'X' }).success).toBe(false);
  });

  it('rechaza descripción vacía, precio negativo, tipo y proveedor no positivos', () => {
    expect(esquemaArteCrear.safeParse({ descripcion: '   ', idTipoArte: 1 }).success).toBe(false);
    expect(esquemaArteCrear.safeParse({ descripcion: 'X', idTipoArte: 1, precio: -1 }).success).toBe(
      false,
    );
    expect(esquemaArteCrear.safeParse({ descripcion: 'X', idTipoArte: 0 }).success).toBe(false);
    expect(
      esquemaArteCrear.safeParse({ descripcion: 'X', idTipoArte: 1, idProveedor: 0 }).success,
    ).toBe(false);
  });
});

describe('esquemaArtePatchCuerpo (edición parcial, M1)', () => {
  it('omitir un campo lo deja intacto; mandar null lo vacía', () => {
    const omitido = esquemaArtePatchCuerpo.parse({ descripcion: 'Nueva' });
    expect(omitido.precio).toBeUndefined();
    expect(omitido.posicion).toBeUndefined();
    expect(omitido.idProveedor).toBeUndefined();

    const vaciado = esquemaArtePatchCuerpo.parse({
      precio: null,
      idProveedor: null,
      posicion: null,
    });
    expect(vaciado.precio).toBeNull();
    expect(vaciado.idProveedor).toBeNull();
    expect(vaciado.posicion).toBeNull();
  });

  it('omitir `idTipoArte` NO lo cambia (no hay default en la edición)', () => {
    expect(esquemaArtePatchCuerpo.parse({ descripcion: 'X' }).idTipoArte).toBeUndefined();
  });

  it('la descripción y el tipo NO son vaciables (siempre tienen valor)', () => {
    expect(esquemaArtePatchCuerpo.safeParse({ descripcion: null }).success).toBe(false);
    expect(esquemaArtePatchCuerpo.safeParse({ descripcion: '   ' }).success).toBe(false);
    expect(esquemaArtePatchCuerpo.safeParse({ idTipoArte: null }).success).toBe(false);
  });
});

describe('esquemaArteCopiarCuerpo', () => {
  it('exige el arte de origen y deja la descripción opcional (se conserva la del origen)', () => {
    expect(esquemaArteCopiarCuerpo.parse({ idArteOrigen: 3 })).toEqual({ idArteOrigen: 3 });
    expect(
      esquemaArteCopiarCuerpo.parse({ idArteOrigen: 3, descripcion: ' Copia ' }).descripcion,
    ).toBe('Copia');
    expect(esquemaArteCopiarCuerpo.safeParse({}).success).toBe(false);
  });
});

describe('esquemaGaleriaArteQuery', () => {
  it('coacciona lo que viene como texto en la URL y aplica los defaults', () => {
    const q = esquemaGaleriaArteQuery.parse({
      pagina: '2',
      porPagina: '48',
      soloConFoto: 'true',
      idTipoArte: '5',
    });
    expect(q).toMatchObject({
      pagina: 2,
      porPagina: 48,
      soloConFoto: true,
      idTipoArte: 5,
      ordenarPor: 'descripcion',
      direccion: 'asc',
    });
  });

  it('permite ordenar por MODELO (la galería dice de qué modelo es cada foto)', () => {
    expect(esquemaGaleriaArteQuery.parse({ ordenarPor: 'modelo' }).ordenarPor).toBe('modelo');
    expect(esquemaGaleriaArteQuery.safeParse({ ordenarPor: 'inventado' }).success).toBe(false);
    // 'nombre' ya NO es una columna ordenable: el campo se retiró (§Post-F9.52 punto 1).
    expect(esquemaGaleriaArteQuery.safeParse({ ordenarPor: 'nombre' }).success).toBe(false);
  });
});
