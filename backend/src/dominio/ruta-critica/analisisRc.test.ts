/**
 * Tests UNITARIOS del scoring del tablero "Análisis RC" (R7). Sin BD: las agregaciones tocan la base
 * (se cubren en `analisisRc.int.test.ts`), pero el corazón del bono — calificación, badge y bono — es
 * PURO y se prueba a mano aquí.
 */
import { describe, expect, it } from 'vitest';

import {
  badgeDeCalificacion,
  calcularCalificacion,
  ganaBono,
  PENALIZACION_POR_VENCIDO,
  UMBRAL_BONO,
} from './analisisRc.js';

describe('calcularCalificacion — % en tiempo − penalización por vencidos', () => {
  it('sin capturas medibles no hay calificación (null)', () => {
    expect(calcularCalificacion(null, 0)).toBeNull();
    expect(calcularCalificacion(null, 3)).toBeNull();
  });

  it('100% en tiempo y 0 vencidos = 100', () => {
    expect(calcularCalificacion(1, 0)).toBe(100);
  });

  it('penaliza cada vencido con los puntos configurados', () => {
    // 100 − 2·PENALIZACION.
    expect(calcularCalificacion(1, 2)).toBe(100 - 2 * PENALIZACION_POR_VENCIDO);
  });

  it('acota a [0, 100] (nunca negativa)', () => {
    expect(calcularCalificacion(0, 100)).toBe(0);
    expect(calcularCalificacion(0.5, 0)).toBe(50);
  });
});

describe('badgeDeCalificacion — Excelente/Bien/Regular/Bajo', () => {
  it('mapea los cortes 90/75/60', () => {
    expect(badgeDeCalificacion(95)).toBe('excelente');
    expect(badgeDeCalificacion(90)).toBe('excelente');
    expect(badgeDeCalificacion(80)).toBe('bien');
    expect(badgeDeCalificacion(75)).toBe('bien');
    expect(badgeDeCalificacion(65)).toBe('regular');
    expect(badgeDeCalificacion(60)).toBe('regular');
    expect(badgeDeCalificacion(59)).toBe('bajo');
    expect(badgeDeCalificacion(0)).toBe('bajo');
  });
});

describe('ganaBono — calificación ≥ umbral Y 0 vencidos', () => {
  it('gana con calificación alta y cero vencidos', () => {
    expect(ganaBono(UMBRAL_BONO, 0)).toBe(true);
    expect(ganaBono(100, 0)).toBe(true);
  });

  it('NO gana si tiene aunque sea un vencido, por alta que sea la calificación', () => {
    expect(ganaBono(100, 1)).toBe(false);
  });

  it('NO gana por debajo del umbral', () => {
    expect(ganaBono(UMBRAL_BONO - 1, 0)).toBe(false);
  });

  it('NO gana sin calificación (null)', () => {
    expect(ganaBono(null, 0)).toBe(false);
  });
});
