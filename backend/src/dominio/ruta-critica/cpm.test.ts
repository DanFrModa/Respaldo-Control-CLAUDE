/**
 * Tests UNITARIOS del CPM PURO (F5-E4 — backward pass en días hábiles). Sin BD. Casos calculados a
 * MANO: cadena de 3 procesos (2+3+1) con festivos, convergencia de N antecesores (MAX en forward =
 * inicio más temprano), fan-out (un proceso con 2 sucesores → MIN), duración 0, idempotencia y la
 * tabla de fechas esperadas de la plantilla chica que usa el script `demo:rc`.
 */
import { describe, expect, it } from 'vitest';

import type { CalendarioLaboral } from '../../comun/diasHabiles.js';
import { calcularCpm, type ProcesoCpm } from './cpm.js';

/** Calendario L–V hábil, sin festivos (salvo el set que se pase). */
function calLV(festivos: string[] = []): CalendarioLaboral {
  return {
    diasSemana: {
      domingo: false,
      lunes: true,
      martes: true,
      miercoles: true,
      jueves: true,
      viernes: true,
      sabado: false,
    },
    festivos: new Set(festivos),
  };
}

/** Helper: fecha UTC desde 'YYYY-MM-DD'. */
function f(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Clave 'YYYY-MM-DD' de un Date para comparar sin ruido de hora/zona. */
function clave(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe('calcularCpm — cadena lineal de 3 procesos (2+3+1 días), L–V', () => {
  // A(2) → B(3) → C(1, terminal). Entrega = lunes 2026-06-29.
  const procesos: ProcesoCpm[] = [
    { id: 1, duracionDias: 2, idsAntecesores: [] }, // A
    { id: 2, duracionDias: 3, idsAntecesores: [1] }, // B
    { id: 3, duracionDias: 1, idsAntecesores: [2] }, // C terminal
  ];
  const r = calcularCpm(procesos, f('2026-06-29'), calLV());

  it('fecha el terminal en la fecha de entrega de la RC', () => {
    expect(clave(r.fechasPorProceso.get(3)!.fin)).toBe('2026-06-29'); // lunes
    expect(clave(r.fechasPorProceso.get(3)!.inicio)).toBe('2026-06-26'); // viernes
  });

  it('retrocede B 3 días hábiles desde el inicio de C', () => {
    expect(clave(r.fechasPorProceso.get(2)!.fin)).toBe('2026-06-26'); // viernes
    expect(clave(r.fechasPorProceso.get(2)!.inicio)).toBe('2026-06-23'); // martes
  });

  it('retrocede A 2 días hábiles desde el inicio de B y ancla el inicio de la ruta', () => {
    expect(clave(r.fechasPorProceso.get(1)!.fin)).toBe('2026-06-23'); // martes
    expect(clave(r.fechasPorProceso.get(1)!.inicio)).toBe('2026-06-19'); // viernes
    expect(clave(r.inicioRuta)).toBe('2026-06-19');
  });

  it('calcula el acumulado de días hábiles por proceso y el total', () => {
    expect(r.fechasPorProceso.get(1)!.acumuladoDias).toBe(3); // Vie19,Lun22,Mar23
    expect(r.fechasPorProceso.get(2)!.acumuladoDias).toBe(6); // …hasta Vie26
    expect(r.fechasPorProceso.get(3)!.acumuladoDias).toBe(7); // …hasta Lun29
    expect(r.acumuladoTotal).toBe(7);
  });

  it('es IDEMPOTENTE: recalcular da las mismas fechas', () => {
    const r2 = calcularCpm(procesos, f('2026-06-29'), calLV());
    for (const id of [1, 2, 3]) {
      expect(clave(r2.fechasPorProceso.get(id)!.inicio)).toBe(
        clave(r.fechasPorProceso.get(id)!.inicio),
      );
      expect(clave(r2.fechasPorProceso.get(id)!.fin)).toBe(clave(r.fechasPorProceso.get(id)!.fin));
    }
  });
});

describe('calcularCpm — con un FESTIVO en medio', () => {
  // Mismo encadenamiento, pero el jueves 2026-06-25 es festivo: el retroceso de B lo salta.
  const procesos: ProcesoCpm[] = [
    { id: 1, duracionDias: 2, idsAntecesores: [] },
    { id: 2, duracionDias: 3, idsAntecesores: [1] },
    { id: 3, duracionDias: 1, idsAntecesores: [2] },
  ];
  const r = calcularCpm(procesos, f('2026-06-29'), calLV(['2026-06-25']));

  it('salta el festivo al retroceder B (3 hábiles desde Vie26: Mié24, Mar23, Lun22)', () => {
    // Vie26 → -1 Mié24 (salta Jue25 festivo) → -2 Mar23 → -3 Lun22.
    expect(clave(r.fechasPorProceso.get(2)!.inicio)).toBe('2026-06-22');
  });

  it('encadena A desde el nuevo inicio de B', () => {
    // A: fin = inicio(B) = Lun22; -2 hábiles = Vie19, Jue18.
    expect(clave(r.fechasPorProceso.get(1)!.fin)).toBe('2026-06-22');
    expect(clave(r.fechasPorProceso.get(1)!.inicio)).toBe('2026-06-18');
  });
});

describe('calcularCpm — N antecesores convergen en el terminal (MAX en forward)', () => {
  // A(2) y B(4) → C(1, terminal). El inicio de la ruta lo marca el antecesor MÁS LARGO (B).
  const procesos: ProcesoCpm[] = [
    { id: 1, duracionDias: 2, idsAntecesores: [] }, // A
    { id: 2, duracionDias: 4, idsAntecesores: [] }, // B
    { id: 3, duracionDias: 1, idsAntecesores: [1, 2] }, // C
  ];
  const r = calcularCpm(procesos, f('2026-06-29'), calLV()); // lunes

  it('ambos antecesores terminan cuando inicia C', () => {
    const inicioC = clave(r.fechasPorProceso.get(3)!.inicio); // Vie26
    expect(inicioC).toBe('2026-06-26');
    expect(clave(r.fechasPorProceso.get(1)!.fin)).toBe(inicioC);
    expect(clave(r.fechasPorProceso.get(2)!.fin)).toBe(inicioC);
  });

  it('el inicio de la ruta lo marca el antecesor MÁS LARGO (B, 4 días)', () => {
    // B: Vie26 -4 = Lun22 (Jue25,Mié24,Mar23,Lun22). A: Vie26 -2 = Mié24.
    expect(clave(r.fechasPorProceso.get(2)!.inicio)).toBe('2026-06-22');
    expect(clave(r.fechasPorProceso.get(1)!.inicio)).toBe('2026-06-24');
    expect(clave(r.inicioRuta)).toBe('2026-06-22');
  });
});

describe('calcularCpm — fan-out (un proceso con 2 sucesores → MIN de sus inicios)', () => {
  // A(1) → B(2) y A → C(5). Ambos B y C terminales (anclan en entrega). A debe terminar cuando
  // inicia el MÁS TEMPRANO de B/C (el de C, que arranca antes por durar más).
  const procesos: ProcesoCpm[] = [
    { id: 1, duracionDias: 1, idsAntecesores: [] }, // A
    { id: 2, duracionDias: 2, idsAntecesores: [1] }, // B terminal
    { id: 3, duracionDias: 5, idsAntecesores: [1] }, // C terminal
  ];
  const r = calcularCpm(procesos, f('2026-06-29'), calLV()); // lunes

  it('A termina cuando inicia el sucesor más temprano (C)', () => {
    const inicioB = r.fechasPorProceso.get(2)!.inicio;
    const inicioC = r.fechasPorProceso.get(3)!.inicio;
    const minInicio = inicioB.getTime() < inicioC.getTime() ? inicioB : inicioC;
    expect(clave(r.fechasPorProceso.get(1)!.fin)).toBe(clave(minInicio));
    // C dura 5 → arranca antes que B (2): el fin de A se alinea con el inicio de C.
    expect(clave(r.fechasPorProceso.get(1)!.fin)).toBe(clave(inicioC));
  });
});

describe('calcularCpm — duración 0', () => {
  it('un proceso de duración 0 tiene inicio = fin y avisa', () => {
    const procesos: ProcesoCpm[] = [
      { id: 1, duracionDias: 0, idsAntecesores: [] }, // resurtido / sin aplicación
      { id: 2, duracionDias: 2, idsAntecesores: [1] },
    ];
    const r = calcularCpm(procesos, f('2026-06-29'), calLV());
    expect(clave(r.fechasPorProceso.get(1)!.inicio)).toBe(clave(r.fechasPorProceso.get(1)!.fin));
    expect(r.advertencias.some((a) => a.includes('duración 0'))).toBe(true);
  });
});

describe('calcularCpm — casos límite', () => {
  it('ruta vacía no rompe', () => {
    const r = calcularCpm([], f('2026-06-29'), calLV());
    expect(r.fechasPorProceso.size).toBe(0);
    expect(r.acumuladoTotal).toBe(0);
  });

  it('lanza si el grafo tiene un ciclo', () => {
    const procesos: ProcesoCpm[] = [
      { id: 1, duracionDias: 1, idsAntecesores: [2] },
      { id: 2, duracionDias: 1, idsAntecesores: [1] },
    ];
    expect(() => calcularCpm(procesos, f('2026-06-29'), calLV())).toThrow(/ciclo/);
  });
});
