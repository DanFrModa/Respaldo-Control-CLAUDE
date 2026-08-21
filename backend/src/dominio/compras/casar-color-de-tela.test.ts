/**
 * Pruebas de la PROPUESTA de color de tela (V1-E3u, §Post-F9.89).
 *
 * Lo que de verdad se está protegiendo aquí no es "que proponga": es **el orden de las reglas** y
 * —sobre todo— **que no proponga cuando no puede saberlo**. Proponer de más es peor que no
 * proponer: la persona confirma sin leer y el color equivocado llega hasta el almacén.
 */
import { describe, expect, it } from 'vitest';

import { proponerColorDeTela, type ColorDeTelaCandidato } from './casar-color-de-tela.js';

const marinoLigado: ColorDeTelaCandidato = {
  id: 11,
  nombre: 'Azul del proveedor',
  pantone: '19-4052 TCX',
  idColor: 7,
};
const negroPorNombre: ColorDeTelaCandidato = {
  id: 12,
  nombre: 'NEGRO',
  pantone: '11-0601 TCX',
  idColor: null,
};
const otroPorPantone: ColorDeTelaCandidato = {
  id: 13,
  nombre: 'Tinta 3040',
  pantone: '19-4052 TCX',
  idColor: null,
};

describe('proponerColorDeTela', () => {
  it('la LIGA del catálogo gana sobre el nombre y sobre el pantone', () => {
    const propuesta = proponerColorDeTela(
      [negroPorNombre, otroPorPantone, marinoLigado],
      { idColor: 7, nombre: 'NEGRO', pantone: '19-4052 TCX' },
      2,
    );
    // Aunque el contexto casa por nombre con el 12 y por pantone con el 13, manda el dato capturado.
    expect(propuesta).toEqual({
      idTelaColor: 11,
      nombre: 'Azul del proveedor',
      origen: 'liga-catalogo',
    });
  });

  it('sin liga, el PANTONE gana sobre el nombre (un código vale más que una palabra)', () => {
    const propuesta = proponerColorDeTela(
      [negroPorNombre, otroPorPantone],
      { idColor: 99, nombre: 'NEGRO', pantone: '19-4052 TCX' },
      2,
    );
    expect(propuesta.idTelaColor).toBe(13);
    expect(propuesta.origen).toBe('mismo-pantone');
  });

  it('casa por NOMBRE sin importar mayúsculas ni espacios', () => {
    const propuesta = proponerColorDeTela(
      [negroPorNombre],
      { idColor: 99, nombre: '  negro ', pantone: null },
      3,
    );
    expect(propuesta.idTelaColor).toBe(12);
    expect(propuesta.origen).toBe('mismo-nombre');
  });

  it('NO casa dos pantones vacíos (un vacío no es igual a otro vacío)', () => {
    const sinPantone: ColorDeTelaCandidato = {
      id: 20,
      nombre: 'Marino',
      pantone: null,
      idColor: null,
    };
    const propuesta = proponerColorDeTela(
      [sinPantone],
      { idColor: 99, nombre: 'Rojo', pantone: '   ' },
      2,
    );
    expect(propuesta.origen).toBe('sin-propuesta');
    expect(propuesta.idTelaColor).toBeNull();
  });

  it('propone el ÚNICO color sólo cuando la orden también es de UN color', () => {
    const unico: ColorDeTelaCandidato = { id: 30, nombre: 'Crudo', pantone: null, idColor: null };
    const conUnColor = proponerColorDeTela([unico], { idColor: 5, nombre: 'Rojo', pantone: null }, 1);
    expect(conUnColor).toEqual({ idTelaColor: 30, nombre: 'Crudo', origen: 'unico-color' });

    // 🔴 EL CASO QUE IMPORTA: con DOS colores de orden y uno de tela, proponer el mismo para los dos
    // inventaría que la tela se compra en un solo tono — el error que la etapa vino a quitar.
    const conDos = proponerColorDeTela([unico], { idColor: 5, nombre: 'Rojo', pantone: null }, 2);
    expect(conDos.origen).toBe('sin-propuesta');
    expect(conDos.idTelaColor).toBeNull();
  });

  it('con la tela SIN colores dados de alta, no propone nada', () => {
    const propuesta = proponerColorDeTela([], { idColor: 5, nombre: 'Rojo', pantone: null }, 1);
    expect(propuesta).toEqual({ idTelaColor: null, nombre: null, origen: 'sin-propuesta' });
  });
});
