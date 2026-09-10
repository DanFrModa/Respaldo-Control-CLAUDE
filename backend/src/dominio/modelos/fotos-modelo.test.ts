/**
 * ⭐⭐ V1-E3 (§Post-F9.172(b)) — **DE QUIÉN SON LAS FOTOS QUE SE VEN.**
 *
 * La regla cabe en una línea y por eso vive en una función PURA: *la foto propia gana; si no hay,
 * se ven las del padre*. Se prueba sola —sin base de datos— porque la aplican TRES consumidores por
 * caminos distintos (la ficha y el impreso por `leerFotosModelo`, la galería por su gemela de lote
 * `adjuntarFotoPrincipal`), y lo que no se puede permitir es que uno de los tres la implemente
 * distinto. Que cada uno de esos caminos la use de verdad lo demuestran sus propias pruebas.
 */
import { describe, expect, it } from 'vitest';

import { idModeloDeLasFotos } from './fotos-modelo.js';

describe('idModeloDeLasFotos — la foto propia gana; si no hay, las del padre', () => {
  it('⭐ un HIJO por color SIN fotos propias enseña las de su modelo de DESARROLLO', () => {
    // El caso de la etapa: los cuatro modelos que nacen de un desarrollo no traen fotos (las fotos
    // viven en R2 y no se clonan por color), y el padre que sí las tiene lo esconde el filtro por
    // default del catálogo (`origen = produccion`).
    expect(idModeloDeLasFotos({ id: 77, idModeloDesarrollo: 7 }, false)).toBe(7);
  });

  it('⭐⭐ un HIJO CON foto propia enseña LA SUYA, no la del padre', () => {
    // 🔴 Ésta es la mitad que impide que una escritura se la trague el sistema: subirle una foto al
    // hijo («ésta es la roja») es lo natural y está permitido. Si la lectura resolviera SIEMPRE al
    // padre, esa foto se guardaría y no se vería nunca.
    expect(idModeloDeLasFotos({ id: 77, idModeloDesarrollo: 7 }, true)).toBe(77);
  });

  it('un modelo SIN linaje se enseña a sí mismo, tenga o no fotos (el 100 % de lo de hoy)', () => {
    // Los ~4,987 migrados del Access, lo capturado a mano y los propios modelos de desarrollo:
    // `idModeloDesarrollo` en null significa «las fotos son mías», que es la conducta de siempre.
    expect(idModeloDeLasFotos({ id: 9, idModeloDesarrollo: null }, true)).toBe(9);
    expect(idModeloDeLasFotos({ id: 9, idModeloDesarrollo: null }, false)).toBe(9);
  });
});
