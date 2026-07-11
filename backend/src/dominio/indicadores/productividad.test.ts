/**
 * Unit de las DOS fórmulas de índice de productividad (F7-E4) y de la regla de agregación del
 * tablero semanal/mensual. Valores calculados A MANO, transcritos del viejo (`Ind_IP_Productividad`
 * / `Ind_Alm_Productividad`). No tocan BD (fórmulas puras).
 */
import { describe, expect, it } from 'vitest';

import { ErrorValidacion } from '../../comun/errores.js';

import { indiceProductividadAlmacen, indiceProductividadIp } from './productividad.js';

/**
 * Regla de agregación del tablero semanal/mensual (F7-E4), como FIXTURE de spec: el tablero la
 * implementa en SQL (`SUM` + `SUM/COUNT`); esta versión pura la documenta y la deja unit-testeable
 * sin BD. `indiceTotal` = Σ (aditivo en IP); `indicePromedio` = media (razón de eficiencia del almacén).
 */
function agregarIndicesDiarios(indices: readonly number[]): {
  indiceTotal: number;
  indicePromedio: number;
} {
  const indiceTotal = indices.reduce((suma, i) => suma + i, 0);
  return {
    indiceTotal,
    indicePromedio: indices.length > 0 ? indiceTotal / indices.length : 0,
  };
}

describe('indiceProductividadIp — RealDiario = (horasBase/horasTrabajadas)·porcentajeD·cantidad', () => {
  it('rinde el estándar cuando trabaja su jornada base', () => {
    // (8/8)·1·10 = 10
    expect(
      indiceProductividadIp({ horasBase: 8, horasTrabajadas: 8, porcentajeD: 1, cantidad: 10 }),
    ).toBe(10);
  });

  it('premia trabajar menos horas que la base y pondera por el peso de la actividad', () => {
    // (9/6)·0.5·20 = 1.5·0.5·20 = 15
    expect(
      indiceProductividadIp({ horasBase: 9, horasTrabajadas: 6, porcentajeD: 0.5, cantidad: 20 }),
    ).toBe(15);
  });

  it('rechaza horas trabajadas 0 (división por cero)', () => {
    expect(() =>
      indiceProductividadIp({ horasBase: 8, horasTrabajadas: 0, porcentajeD: 1, cantidad: 10 }),
    ).toThrow(ErrorValidacion);
  });
});

describe('indiceProductividadAlmacen — ((((J/pzPersDia)/J)·piezas)/personas)·(J/horasTrabajadas)', () => {
  it('vale 1.0 cuando se cumple el estándar exacto (1 persona, jornada completa)', () => {
    // ((((9/100)/9)·100)/1)·(9/9) = (0.01·100)·1 = 1
    expect(
      indiceProductividadAlmacen({
        jornadaBase: 9,
        pzPersDia: 100,
        piezas: 100,
        personas: 1,
        horasTrabajadas: 9,
      }),
    ).toBeCloseTo(1, 10);
  });

  it('reparte entre la cuadrilla (2 personas al doble de estándar cumplen 1.0)', () => {
    // ((((9/50)/9)·100)/2)·(9/9) = ((0.02·100)/2)·1 = (2/2) = 1
    expect(
      indiceProductividadAlmacen({
        jornadaBase: 9,
        pzPersDia: 50,
        piezas: 100,
        personas: 2,
        horasTrabajadas: 9,
      }),
    ).toBeCloseTo(1, 10);
  });

  it('duplica el índice al duplicar las piezas', () => {
    // (0.01·200)·1 = 2
    expect(
      indiceProductividadAlmacen({
        jornadaBase: 9,
        pzPersDia: 100,
        piezas: 200,
        personas: 1,
        horasTrabajadas: 9,
      }),
    ).toBeCloseTo(2, 10);
  });

  it('premia lograr el estándar en menos horas (media jornada = índice doble)', () => {
    // (0.01·100)·(9/4.5) = 1·2 = 2
    expect(
      indiceProductividadAlmacen({
        jornadaBase: 9,
        pzPersDia: 100,
        piezas: 100,
        personas: 1,
        horasTrabajadas: 4.5,
      }),
    ).toBeCloseTo(2, 10);
  });

  it('respeta una jornada base distinta de 9 (configurable por empresa)', () => {
    // J=8: ((((8/80)/8)·80)/1)·(8/8) = (0.0125·80)·1 = 1
    expect(
      indiceProductividadAlmacen({
        jornadaBase: 8,
        pzPersDia: 80,
        piezas: 80,
        personas: 1,
        horasTrabajadas: 8,
      }),
    ).toBeCloseTo(1, 10);
  });

  it('rechaza pzPersDia 0, personas 0 y horas 0 (divisiones por cero)', () => {
    expect(() =>
      indiceProductividadAlmacen({
        jornadaBase: 9,
        pzPersDia: 0,
        piezas: 100,
        personas: 1,
        horasTrabajadas: 9,
      }),
    ).toThrow(ErrorValidacion);
    expect(() =>
      indiceProductividadAlmacen({
        jornadaBase: 9,
        pzPersDia: 100,
        piezas: 100,
        personas: 0,
        horasTrabajadas: 9,
      }),
    ).toThrow(ErrorValidacion);
    expect(() =>
      indiceProductividadAlmacen({
        jornadaBase: 9,
        pzPersDia: 100,
        piezas: 100,
        personas: 1,
        horasTrabajadas: 0,
      }),
    ).toThrow(ErrorValidacion);
  });
});

describe('agregarIndicesDiarios — regla del tablero semanal/mensual (Σ + promedio)', () => {
  it('suma los índices diarios y calcula su promedio', () => {
    expect(agregarIndicesDiarios([10, 15, 5])).toEqual({ indiceTotal: 30, indicePromedio: 10 });
  });

  it('devuelve 0/0 sin registros (evita división por cero)', () => {
    expect(agregarIndicesDiarios([])).toEqual({ indiceTotal: 0, indicePromedio: 0 });
  });
});
