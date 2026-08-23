/**
 * Tests UNITARIOS de la lógica PURA de la bandeja "mis tareas" de la RC (F5-E5; R4). Sin BD. Cubre:
 *  • `diasAtrasoProceso` — días naturales vencidos (≥0; 0 si no vence o sin planeada).
 *  • `ordenarTareasPorUrgencia` — atrasado > enRiesgo > aTiempo; luego mayor atraso; luego planeada
 *    ascendente (null al final); empate por idRutaOrden.
 *  • `urgenciaProceso` (R4) — vencida / hoy / semana (próximos 4 días) / despues / sinFecha.
 */
import { describe, expect, it } from 'vitest';

import type { BandejaTareaSalida } from '../../contrato/esquemas/ruta-critica-bandeja.js';

import { diasAtrasoProceso, ordenarTareasPorUrgencia, urgenciaProceso } from './bandeja.js';

function f(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const hoy = f('2026-06-22');

describe('diasAtrasoProceso', () => {
  it('planeada vencida → días naturales > 0', () => {
    expect(diasAtrasoProceso(f('2026-06-19'), hoy)).toBe(3);
    expect(diasAtrasoProceso(f('2026-06-21'), hoy)).toBe(1);
  });

  it('planeada hoy o futura → 0 (no hay atraso)', () => {
    expect(diasAtrasoProceso(f('2026-06-22'), hoy)).toBe(0);
    expect(diasAtrasoProceso(f('2026-06-30'), hoy)).toBe(0);
  });

  it('sin planeada → 0', () => {
    expect(diasAtrasoProceso(null, hoy)).toBe(0);
  });

  it('ignora la hora (compara por día calendario UTC)', () => {
    expect(
      diasAtrasoProceso(new Date('2026-06-20T23:00:00Z'), new Date('2026-06-22T01:00:00Z')),
    ).toBe(2);
  });
});

describe('urgenciaProceso (R4)', () => {
  it('planeada anterior a hoy → vencida', () => {
    expect(urgenciaProceso(f('2026-06-21'), hoy)).toBe('vencida');
    expect(urgenciaProceso(f('2026-06-01'), hoy)).toBe('vencida');
  });

  it('planeada hoy → hoy', () => {
    expect(urgenciaProceso(f('2026-06-22'), hoy)).toBe('hoy');
  });

  it('planeada dentro de los próximos 4 días → semana (bordes inclusive)', () => {
    expect(urgenciaProceso(f('2026-06-23'), hoy)).toBe('semana');
    expect(urgenciaProceso(f('2026-06-26'), hoy)).toBe('semana'); // hoy + 4
  });

  it('planeada a 5+ días → despues', () => {
    expect(urgenciaProceso(f('2026-06-27'), hoy)).toBe('despues');
    expect(urgenciaProceso(f('2026-08-01'), hoy)).toBe('despues');
  });

  it('sin planeada → sinFecha', () => {
    expect(urgenciaProceso(null, hoy)).toBe('sinFecha');
  });

  it('ignora la hora (día calendario UTC)', () => {
    expect(
      urgenciaProceso(new Date('2026-06-22T23:59:00Z'), new Date('2026-06-22T01:00:00Z')),
    ).toBe('hoy');
  });
});

describe('ordenarTareasPorUrgencia', () => {
  /** Tarea mínima para el ordenamiento (solo los campos que mira el sort). */
  function tarea(
    idRutaOrden: number,
    semaforo: BandejaTareaSalida['semaforo'],
    diasAtraso: number,
    fechaPlaneadaVigente: string | null,
  ): BandejaTareaSalida {
    return {
      idRutaOrden,
      idOrden: 1,
      folioOrden: 1,
      cliente: 'C',
      idModelo: 1,
      codigoModelo: 'M',
      descripcionModelo: null,
      idProcesoDef: 1,
      codigoProceso: 'p',
      nombreProceso: 'P',
      critico: false,
      tipoEvento: 'manual',
      fechaEntrega: null,
      fechaPlaneadaVigente,
      urgencia: 'sinFecha',
      diasRestantes: null,
      diasAtraso,
      semaforo,
      parcialEnCurso: false,
      checklist: [],
    };
  }

  it('ordena atrasado > enRiesgo > aTiempo', () => {
    const r = ordenarTareasPorUrgencia([
      tarea(1, 'aTiempo', 0, '2026-07-01'),
      tarea(2, 'atrasado', 5, '2026-06-17'),
      tarea(3, 'enRiesgo', 0, '2026-06-24'),
    ]);
    expect(r.map((t) => t.idRutaOrden)).toEqual([2, 3, 1]);
  });

  it('dentro del mismo estado, mayor diasAtraso primero', () => {
    const r = ordenarTareasPorUrgencia([
      tarea(1, 'atrasado', 2, '2026-06-20'),
      tarea(2, 'atrasado', 9, '2026-06-13'),
      tarea(3, 'atrasado', 5, '2026-06-17'),
    ]);
    expect(r.map((t) => t.idRutaOrden)).toEqual([2, 3, 1]);
  });

  it('a igual estado y atraso, planeada ascendente (la más próxima primero); null al final', () => {
    const r = ordenarTareasPorUrgencia([
      tarea(1, 'aTiempo', 0, null),
      tarea(2, 'aTiempo', 0, '2026-07-05'),
      tarea(3, 'aTiempo', 0, '2026-06-30'),
    ]);
    expect(r.map((t) => t.idRutaOrden)).toEqual([3, 2, 1]);
  });

  it('empate total estable por idRutaOrden', () => {
    const r = ordenarTareasPorUrgencia([
      tarea(9, 'enRiesgo', 0, '2026-06-24'),
      tarea(4, 'enRiesgo', 0, '2026-06-24'),
    ]);
    expect(r.map((t) => t.idRutaOrden)).toEqual([4, 9]);
  });

  it('no muta el arreglo de entrada', () => {
    const entrada = [tarea(1, 'aTiempo', 0, '2026-07-01'), tarea(2, 'atrasado', 5, '2026-06-17')];
    const copia = [...entrada];
    ordenarTareasPorUrgencia(entrada);
    expect(entrada).toEqual(copia);
  });
});
