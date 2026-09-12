/**
 * Tests UNIT de la ÚNICA lista de códigos de conceptos del precosteo (fila 0.152, §Post-F9.210).
 *
 * Por qué existe: esta lista decide tres cosas distintas que el usuario ve —si un concepto se puede
 * agregar dos veces, si lleva cantidad, y de qué catálogo sale su insumo— y hasta esta fila vivía
 * DUPLICADA (una copia en el dominio y otra tecleada a mano en `DialogoPrecosto.tsx`). Lo que se
 * fija aquí es el CONTENIDO de las listas y que las tres preguntas se contesten por separado: si
 * mañana alguien mueve un código de una a otra, este archivo se pone rojo.
 */
import { describe, expect, it } from 'vitest';

import {
  banderasDelConcepto,
  esConceptoAncla,
  esConceptoSoloPrecio,
  insumoDeCatalogoDelConcepto,
} from './conceptos-precosto.js';

describe('los conceptos de SÓLO PRECIO (§Post-F9.210·3)', () => {
  it('son corte, maquila y empaque — y nadie más', () => {
    expect(esConceptoSoloPrecio('corte')).toBe(true);
    expect(esConceptoSoloPrecio('maquila')).toBe(true);
    expect(esConceptoSoloPrecio('empaque')).toBe(true);
  });

  it('los conceptos con insumo (tela/avíos) y los abiertos SÍ llevan cantidad', () => {
    for (const codigo of ['tela', 'avios', 'bordado', 'estampado', 'flete-muestras']) {
      expect(esConceptoSoloPrecio(codigo)).toBe(false);
    }
  });
});

describe('el CATÁLOGO obligatorio del insumo (§Post-F9.210·12)', () => {
  it('la tela sale del catálogo de telas y el avío del de avíos', () => {
    expect(insumoDeCatalogoDelConcepto('tela')).toBe('tela');
    expect(insumoDeCatalogoDelConcepto('avios')).toBe('avio');
  });

  it('los conceptos de COSTO no tienen catálogo: ahí el texto libre se conserva', () => {
    // Daniel fue explícito: prohibir el texto libre en corte/maquila/empaque/fletes sería
    // malinterpretar la decisión — ahí el texto *es* el punto.
    for (const codigo of ['corte', 'maquila', 'empaque', 'bordado', 'flete-muestras']) {
      expect(insumoDeCatalogoDelConcepto(codigo)).toBeNull();
    }
  });
});

describe('las ANCLAS fijas siguen siendo su propia pregunta', () => {
  it('son las mismas tres de hoy, pero se preguntan aparte del "sólo precio"', () => {
    expect(esConceptoAncla('maquila')).toBe(true);
    expect(esConceptoAncla('corte')).toBe(true);
    expect(esConceptoAncla('empaque')).toBe(true);
    expect(esConceptoAncla('tela')).toBe(false);
    expect(esConceptoAncla('estampado')).toBe(false);
  });
});

describe('banderasDelConcepto — lo que viaja en el contrato', () => {
  it('la tela: no es ancla, lleva cantidad y exige catálogo de telas', () => {
    expect(banderasDelConcepto('tela')).toEqual({
      anclaFija: false,
      soloPrecio: false,
      insumoCatalogo: 'tela',
    });
  });

  it('el corte: ancla, sólo precio y sin catálogo', () => {
    expect(banderasDelConcepto('corte')).toEqual({
      anclaFija: true,
      soloPrecio: true,
      insumoCatalogo: null,
    });
  });

  it('un concepto inventado por el usuario es abierto en las tres banderas', () => {
    expect(banderasDelConcepto('lavado-especial')).toEqual({
      anclaFija: false,
      soloPrecio: false,
      insumoCatalogo: null,
    });
  });
});
