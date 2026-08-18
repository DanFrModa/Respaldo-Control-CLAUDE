import { describe, expect, it } from 'vitest';

import { avisoValorFueraDeRango, etiquetaMedida, normalizarUnidad } from './unidades-avio.js';

/**
 * Unit del módulo PURO de unidades del avío (V1-E3g, §Post-F9.66). Lo que se prueba aquí es lo que
 * sostiene la decisión: la etiqueta la DERIVA el sistema (nadie teclea "53 cm") y el aviso de valor
 * absurdo **avisa sin bloquear**, callándose cuando no tiene nada útil que decir.
 */
describe('normalizarUnidad', () => {
  it('recorta y baja a minúsculas; el vacío es null', () => {
    expect(normalizarUnidad('  CM ')).toBe('cm');
    expect(normalizarUnidad('')).toBeNull();
    expect(normalizarUnidad('   ')).toBeNull();
    expect(normalizarUnidad(null)).toBeNull();
    expect(normalizarUnidad(undefined)).toBeNull();
  });
});

describe('etiquetaMedida', () => {
  it('junta el número con la unidad del avío', () => {
    expect(etiquetaMedida(53, 'cm')).toBe('53 cm');
    expect(etiquetaMedida(0.75, 'm')).toBe('0.75 m');
    expect(etiquetaMedida(53, ' CM ')).toBe('53 cm');
  });

  it('sin unidad sale solo el número (no se inventa una)', () => {
    expect(etiquetaMedida(53, null)).toBe('53');
    expect(etiquetaMedida(53, '')).toBe('53');
  });
});

describe('avisoValorFueraDeRango (avisa, NO bloquea)', () => {
  it('avisa cuando el número es absurdo para la unidad', () => {
    // El caso que Daniel describió: un `1` en un cierre en cm casi seguro quiso ser 100.
    const aviso = avisoValorFueraDeRango('La medida "1 cm"', 1, 'cm');
    expect(aviso).not.toBeNull();
    expect(aviso).toContain('cm');
    expect(aviso).toContain('La medida "1 cm"');
  });

  it('calla cuando el número es normal para la unidad', () => {
    expect(avisoValorFueraDeRango('La medida', 53, 'cm')).toBeNull();
    expect(avisoValorFueraDeRango('El consumo', 0.75, 'm')).toBeNull();
    expect(avisoValorFueraDeRango('El consumo', 1, 'pza')).toBeNull();
  });

  it('calla con unidad desconocida o ausente: mejor callarse que gritar en falso', () => {
    expect(avisoValorFueraDeRango('La medida', 1, 'rollo')).toBeNull();
    expect(avisoValorFueraDeRango('La medida', 1, null)).toBeNull();
    expect(avisoValorFueraDeRango('La medida', 1, '')).toBeNull();
  });

  it('el CERO nunca avisa: es deliberado (esa talla no lleva el avío), no un dedazo', () => {
    expect(avisoValorFueraDeRango('El consumo', 0, 'cm')).toBeNull();
    expect(avisoValorFueraDeRango('El consumo', 0, 'm')).toBeNull();
  });

  it('avisa también por el techo (0.75 tecleado en cm son 75 cm de elástico por prenda)', () => {
    expect(avisoValorFueraDeRango('El consumo', 500, 'cm')).not.toBeNull();
    expect(avisoValorFueraDeRango('El consumo', 75, 'm')).not.toBeNull();
  });
});
