/**
 * Tests UNITARIOS del SEMÁFORO de cumplimiento de la RC (F5-E4). Sin BD. Casos: a tiempo / en riesgo
 * / atrasado por proceso, peor-de-procesos por orden, y la regla "en riesgo antes de programar".
 */
import { describe, expect, it } from 'vitest';

import {
  UMBRAL_RIESGO_DIAS,
  esRiesgoso,
  estadoSemaforoOrden,
  estadoSemaforoProceso,
  evaluarRiesgoOrdenSinRuta,
} from './semaforoYRiesgo.js';

function f(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const hoy = f('2026-06-22');

describe('estadoSemaforoProceso', () => {
  it('cumplido (con fechaReal) = aTiempo', () => {
    expect(
      estadoSemaforoProceso(
        { fechaReal: f('2026-06-20'), fechaPlaneadaVigente: f('2026-06-18') },
        hoy,
      ),
    ).toBe('aTiempo');
  });

  it('sin fecha planeada (aún no fechado por el CPM) = aTiempo', () => {
    expect(estadoSemaforoProceso({ fechaReal: null, fechaPlaneadaVigente: null }, hoy)).toBe(
      'aTiempo',
    );
  });

  it('planeada YA vencida = atrasado', () => {
    expect(
      estadoSemaforoProceso({ fechaReal: null, fechaPlaneadaVigente: f('2026-06-21') }, hoy),
    ).toBe('atrasado');
  });

  it('planeada dentro del umbral = enRiesgo', () => {
    expect(
      estadoSemaforoProceso({ fechaReal: null, fechaPlaneadaVigente: f('2026-06-24') }, hoy),
    ).toBe('enRiesgo'); // 2 días < 3.
    expect(
      estadoSemaforoProceso(
        { fechaReal: null, fechaPlaneadaVigente: f('2026-06-22') }, // hoy mismo (0 días)
        hoy,
      ),
    ).toBe('enRiesgo');
  });

  it('planeada lejana (más allá del umbral) = aTiempo', () => {
    expect(
      estadoSemaforoProceso({ fechaReal: null, fechaPlaneadaVigente: f('2026-07-15') }, hoy),
    ).toBe('aTiempo');
  });
});

describe('estadoSemaforoOrden — el PEOR de sus procesos', () => {
  it('un proceso atrasado tiñe la orden de atrasado', () => {
    expect(
      estadoSemaforoOrden(
        [
          { fechaReal: f('2026-06-20'), fechaPlaneadaVigente: f('2026-06-18') },
          { fechaReal: null, fechaPlaneadaVigente: f('2026-06-19') }, // atrasado
        ],
        hoy,
      ),
    ).toBe('atrasado');
  });

  it('sin atrasados pero con uno en riesgo = enRiesgo', () => {
    expect(
      estadoSemaforoOrden(
        [
          { fechaReal: null, fechaPlaneadaVigente: f('2026-07-15') }, // a tiempo
          { fechaReal: null, fechaPlaneadaVigente: f('2026-06-24') }, // en riesgo
        ],
        hoy,
      ),
    ).toBe('enRiesgo');
  });

  it('todo cumplido o lejano = aTiempo', () => {
    expect(
      estadoSemaforoOrden(
        [
          { fechaReal: f('2026-06-19'), fechaPlaneadaVigente: f('2026-06-18') },
          { fechaReal: null, fechaPlaneadaVigente: f('2026-07-30') },
        ],
        hoy,
      ),
    ).toBe('aTiempo');
  });
});

describe('evaluarRiesgoOrdenSinRuta — "en riesgo antes de programar"', () => {
  it('sin fecha de entrega de la RC = aTiempo', () => {
    expect(evaluarRiesgoOrdenSinRuta(null, hoy)).toBe('aTiempo');
  });
  it('entrega ya vencida = atrasado', () => {
    expect(evaluarRiesgoOrdenSinRuta(f('2026-06-20'), hoy)).toBe('atrasado');
  });
  it('entrega que apremia (dentro del umbral) = enRiesgo', () => {
    expect(evaluarRiesgoOrdenSinRuta(f('2026-06-24'), hoy)).toBe('enRiesgo');
  });
  it('entrega lejana = aTiempo', () => {
    expect(evaluarRiesgoOrdenSinRuta(f('2026-08-01'), hoy)).toBe('aTiempo');
  });
});

describe('esRiesgoso', () => {
  it('enRiesgo y atrasado cuentan como riesgosos', () => {
    expect(esRiesgoso('enRiesgo')).toBe(true);
    expect(esRiesgoso('atrasado')).toBe(true);
    expect(esRiesgoso('aTiempo')).toBe(false);
  });
  it('el umbral es 3 días', () => {
    expect(UMBRAL_RIESGO_DIAS).toBe(3);
  });
});
