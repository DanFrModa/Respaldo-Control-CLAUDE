/**
 * Tests UNITARIOS de `calcularDuracion` (F5-E3) — números calculados A MANO desde los CSV reales
 * (CP_Cant / RC_TipoTelas / RC_Aplicaciones). Cubre las 4 reglas + el caso "cantidad sin rango".
 * Sin BD: la función es pura.
 */
import { describe, expect, it } from 'vitest';

import {
  calcularDuracion,
  factorPorCantidad,
  type RangoFactorCantidad,
} from './calcularDuracion.js';

// Rangos reales de CP_Cant.
const FACTORES: RangoFactorCantidad[] = [
  { deCant: 1, aCant: 500, factor: 0.6 },
  { deCant: 501, aCant: 999, factor: 0.8 },
  { deCant: 1000, aCant: 1500, factor: 1.0 },
  { deCant: 1501, aCant: 2000, factor: 1.2 },
  { deCant: 2001, aCant: 3000, factor: 1.5 },
  { deCant: 3001, aCant: 4000, factor: 1.8 },
  { deCant: 4001, aCant: 5000, factor: 2.0 },
  { deCant: 5001, aCant: 6000, factor: 2.2 },
  { deCant: 6001, aCant: 8000, factor: 2.5 },
  { deCant: 8001, aCant: 10000, factor: 2.8 },
  { deCant: 10001, aCant: 20000, factor: 3.0 },
];

describe('factorPorCantidad', () => {
  it('encuentra el factor del rango donde cae la cantidad', () => {
    expect(factorPorCantidad(1200, FACTORES)).toEqual({ factor: 1.0, enRango: true });
    expect(factorPorCantidad(4500, FACTORES)).toEqual({ factor: 2.0, enRango: true });
    expect(factorPorCantidad(500, FACTORES)).toEqual({ factor: 0.6, enRango: true }); // borde superior
    expect(factorPorCantidad(501, FACTORES)).toEqual({ factor: 0.8, enRango: true }); // borde inferior
  });

  it('fuera de todo rango devuelve factor 1 (sin factor)', () => {
    expect(factorPorCantidad(0, FACTORES)).toEqual({ factor: 1, enRango: false });
    expect(factorPorCantidad(50000, FACTORES)).toEqual({ factor: 1, enRango: false });
  });
});

describe('calcularDuracion — regla fija', () => {
  it('devuelve el tiempo estándar tal cual', () => {
    const r = calcularDuracion({
      tipoDuracion: 'fija',
      tiempoEstandar: 4,
      cantidad: 1200,
      factoresCantidad: FACTORES,
    });
    expect(r.dias).toBe(4);
    expect(r.advertencias).toEqual([]);
  });
});

describe('calcularDuracion — regla porCantidad', () => {
  it('1200 pzas (factor 1.00), colchón 2, tiempo 5 → round(5×1+2)=7', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porCantidad',
      tiempoEstandar: 5,
      cantidad: 1200,
      colchonCostura: 2,
      factoresCantidad: FACTORES,
    });
    expect(r.dias).toBe(7);
    expect(r.advertencias).toEqual([]);
  });

  it('4500 pzas (factor 2.00), colchón 2, tiempo 5 → round(5×2+2)=12', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porCantidad',
      tiempoEstandar: 5,
      cantidad: 4500,
      colchonCostura: 2,
      factoresCantidad: FACTORES,
    });
    expect(r.dias).toBe(12);
  });

  it('colchón null se trata como 0 → round(5×1.00)=5', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porCantidad',
      tiempoEstandar: 5,
      cantidad: 1200,
      colchonCostura: null,
      factoresCantidad: FACTORES,
    });
    expect(r.dias).toBe(5);
  });

  it('mínimo 1 día aunque el cálculo dé 0 (factor 0.6, tiempo 0, colchón 0)', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porCantidad',
      tiempoEstandar: 0,
      cantidad: 100,
      colchonCostura: 0,
      factoresCantidad: FACTORES,
    });
    expect(r.dias).toBe(1);
  });

  it('cantidad sin rango → factor 1 + advertencia: round(5×1+2)=7', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porCantidad',
      tiempoEstandar: 5,
      cantidad: 99999,
      colchonCostura: 2,
      factoresCantidad: FACTORES,
    });
    expect(r.dias).toBe(7);
    expect(r.advertencias).toHaveLength(1);
    expect(r.advertencias[0]).toMatch(/no cae en ningún rango/);
  });
});

describe('calcularDuracion — regla porTipoTela', () => {
  it('usa los días del catálogo DIRECTOS (no multiplica por factorTela)', () => {
    // "Importación Tela Oriente": dias 40, factorTela 2.30 (que NO se aplica).
    const r = calcularDuracion({
      tipoDuracion: 'porTipoTela',
      tiempoEstandar: 5,
      cantidad: 4500,
      factoresCantidad: FACTORES,
      tela: { dias: 40 },
    });
    expect(r.dias).toBe(40);
    expect(r.advertencias).toEqual([]);
  });

  it('"Existencia" → 2 días directos', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porTipoTela',
      tiempoEstandar: 5,
      cantidad: 1200,
      factoresCantidad: FACTORES,
      tela: { dias: 2 },
    });
    expect(r.dias).toBe(2);
  });

  it('sin tipo de tela → tiempo estándar + advertencia', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porTipoTela',
      tiempoEstandar: 5,
      cantidad: 1200,
      factoresCantidad: FACTORES,
      tela: null,
    });
    expect(r.dias).toBe(5);
    expect(r.advertencias).toHaveLength(1);
  });
});

describe('calcularDuracion — regla porAplicacion (PRENDE el factor de cantidad)', () => {
  it('"2 Bordados" (6 días) × factor 1.00 (1200 pzas) → 6', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porAplicacion',
      tiempoEstandar: 5,
      cantidad: 1200,
      factoresCantidad: FACTORES,
      aplicacion: { dias: 6 },
    });
    expect(r.dias).toBe(6);
    expect(r.advertencias).toEqual([]);
  });

  it('"2 Bordados" (6 días) × factor 2.00 (4500 pzas) → round(6×2)=12', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porAplicacion',
      tiempoEstandar: 5,
      cantidad: 4500,
      factoresCantidad: FACTORES,
      aplicacion: { dias: 6 },
    });
    expect(r.dias).toBe(12);
  });

  it('"Sin Aplicación" (0 días) → 0 (el proceso se auto-completará)', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porAplicacion',
      tiempoEstandar: 5,
      cantidad: 4500,
      factoresCantidad: FACTORES,
      aplicacion: { dias: 0 },
    });
    expect(r.dias).toBe(0);
  });

  it('"Estampado Sencillo" (3 días) × factor 0.6 (100 pzas) → round(3×0.6)=round(1.8)=2', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porAplicacion',
      tiempoEstandar: 5,
      cantidad: 100,
      factoresCantidad: FACTORES,
      aplicacion: { dias: 3 },
    });
    expect(r.dias).toBe(2);
  });

  it('cantidad sin rango sobre aplicación → factor 1 + advertencia', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porAplicacion',
      tiempoEstandar: 5,
      cantidad: 0,
      factoresCantidad: FACTORES,
      aplicacion: { dias: 6 },
    });
    expect(r.dias).toBe(6);
    expect(r.advertencias).toHaveLength(1);
  });

  it('sin aplicación elegida → tiempo estándar + advertencia', () => {
    const r = calcularDuracion({
      tipoDuracion: 'porAplicacion',
      tiempoEstandar: 5,
      cantidad: 1200,
      factoresCantidad: FACTORES,
      aplicacion: null,
    });
    expect(r.dias).toBe(5);
    expect(r.advertencias).toHaveLength(1);
  });
});
