/**
 * Unit del reconocimiento del cliente C&A para sembrar su plantilla (§Post-F9.70 punto 2).
 *
 * Lo que se prueba es la frontera: el nombre lo escribe quien capturó el catálogo (o el ETL de
 * Access), así que la comparación tiene que aguantar signos, espacios y acentos — y a la vez NO
 * puede llevarse por delante a cualquier cliente que empiece con "C". Las dos mitades van juntas a
 * propósito: una lista que acepta de más es peor que una que acepta de menos, porque le mete una
 * plantilla ajena a un cliente que no la pidió.
 */
import { describe, expect, it } from 'vitest';

import {
  CAMPOS_VARIABLES_DEFAULT_CYA,
  esNombreDeCya,
  PORCENTAJE_ADICIONAL_CYA,
} from './plantilla-cya.js';

describe('esNombreDeCya', () => {
  it('reconoce las grafías con las que C&A puede estar capturado', () => {
    for (const nombre of [
      'C&A',
      'c&a',
      'C & A',
      'C. & A.',
      '  C&A  ',
      'CYA',
      'C y A',
      'C&A México',
      'CYA MEXICO',
    ]) {
      expect(esNombreDeCya(nombre), nombre).toBe(true);
    }
  });

  it('NO se lleva por delante a otros clientes', () => {
    for (const nombre of [
      'Calzado del Norte',
      'Cadena Comercial',
      'Liverpool',
      'Coppel',
      'C&A Textiles del Bajío',
      'Casa',
      'Cya Sport',
    ]) {
      expect(esNombreDeCya(nombre), nombre).toBe(false);
    }
  });
});

describe('configuración de fábrica de C&A', () => {
  it('el % adicional es 7 (5% que acepta el cliente + 2% de merma, §Post-F9.2)', () => {
    expect(PORCENTAJE_ADICIONAL_CYA).toBe(7);
  });

  it('el NÚMERO DE ORDEN va primero: es la referencia principal del cliente (D7)', () => {
    expect(CAMPOS_VARIABLES_DEFAULT_CYA[0]?.campo).toBe('numeroOrden');
    expect(CAMPOS_VARIABLES_DEFAULT_CYA.map((c) => c.campo)).toContain('modeloCliente');
  });
});
