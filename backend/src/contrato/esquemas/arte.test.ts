/**
 * Tests del contrato del ARTE del modelo (V1-E3d, §Post-F9.35). Lo que se cuida aquí es lo que
 * el catálogo viejo ya cuidaba (nombre obligatorio, precio no negativo, tipo BORDADO/ESTAMPADO)
 * más lo NUEVO: el proveedor del arte y la semántica del PATCH parcial (omitir ≠ vaciar).
 */
import { describe, expect, it } from 'vitest';

import {
  esquemaArteCopiarCuerpo,
  esquemaArteCrear,
  esquemaArtePatchCuerpo,
  esquemaGaleriaArteQuery,
} from './arte.js';

describe('esquemaArteCrear', () => {
  it('acepta un alta completa y recorta espacios del nombre', () => {
    const datos = esquemaArteCrear.parse({
      nombre: '  Logo pecho  ',
      tipo: 'ESTAMPADO',
      puntadas: 12_000,
      precio: 15.5,
      idProveedor: 7,
    });
    expect(datos).toMatchObject({
      nombre: 'Logo pecho',
      tipo: 'ESTAMPADO',
      puntadas: 12_000,
      precio: 15.5,
      idProveedor: 7,
    });
  });

  it('el tipo por omisión es BORDADO y el resto de campos es opcional', () => {
    const datos = esquemaArteCrear.parse({ nombre: 'Solo nombre' });
    expect(datos.tipo).toBe('BORDADO');
    expect(datos.precio).toBeUndefined();
    expect(datos.idProveedor).toBeUndefined();
  });

  it('rechaza nombre vacío, precio negativo y proveedor no positivo', () => {
    expect(esquemaArteCrear.safeParse({ nombre: '   ' }).success).toBe(false);
    expect(esquemaArteCrear.safeParse({ nombre: 'X', precio: -1 }).success).toBe(false);
    expect(esquemaArteCrear.safeParse({ nombre: 'X', idProveedor: 0 }).success).toBe(false);
  });
});

describe('esquemaArtePatchCuerpo (edición parcial, M1)', () => {
  it('omitir un campo lo deja intacto; mandar null lo vacía', () => {
    const omitido = esquemaArtePatchCuerpo.parse({ nombre: 'Nuevo' });
    expect(omitido.precio).toBeUndefined();
    expect(omitido.idProveedor).toBeUndefined();

    const vaciado = esquemaArtePatchCuerpo.parse({ precio: null, idProveedor: null });
    expect(vaciado.precio).toBeNull();
    expect(vaciado.idProveedor).toBeNull();
  });

  it('omitir `tipo` NO lo resetea a BORDADO (el default es solo del alta)', () => {
    expect(esquemaArtePatchCuerpo.parse({ nombre: 'X' }).tipo).toBeUndefined();
  });

  it('el nombre NO es vaciable (es la clave de negocio dentro del modelo)', () => {
    expect(esquemaArtePatchCuerpo.safeParse({ nombre: null }).success).toBe(false);
  });
});

describe('esquemaArteCopiarCuerpo', () => {
  it('exige el arte de origen y deja el nombre opcional (se conserva el del origen)', () => {
    expect(esquemaArteCopiarCuerpo.parse({ idArteOrigen: 3 })).toEqual({ idArteOrigen: 3 });
    expect(esquemaArteCopiarCuerpo.parse({ idArteOrigen: 3, nombre: ' Copia ' }).nombre).toBe(
      'Copia',
    );
    expect(esquemaArteCopiarCuerpo.safeParse({}).success).toBe(false);
  });
});

describe('esquemaGaleriaArteQuery', () => {
  it('coacciona lo que viene como texto en la URL y aplica los defaults', () => {
    const q = esquemaGaleriaArteQuery.parse({ pagina: '2', porPagina: '48', soloConFoto: 'true' });
    expect(q).toMatchObject({
      pagina: 2,
      porPagina: 48,
      soloConFoto: true,
      ordenarPor: 'nombre',
      direccion: 'asc',
    });
  });

  it('permite ordenar por MODELO (la galería dice de qué modelo es cada foto)', () => {
    expect(esquemaGaleriaArteQuery.parse({ ordenarPor: 'modelo' }).ordenarPor).toBe('modelo');
    expect(esquemaGaleriaArteQuery.safeParse({ ordenarPor: 'inventado' }).success).toBe(false);
  });
});
