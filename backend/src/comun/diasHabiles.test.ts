/**
 * Tests UNITARIOS (sin BD) de la lógica pura de DÍAS HÁBILES (F5-E2). Es la pieza crítica del CPM
 * de E4: aquí se cubren TODOS los bordes citados — fin de semana, festivo, cruce de año, n
 * negativo (hacia atrás), festivo que cae en fin de semana, y n = 0.
 */
import { describe, expect, it } from 'vitest';

import {
  claveDiaUtc,
  contarDiasHabiles,
  esDiaHabil,
  sumarDiasHabiles,
  type CalendarioLaboral,
} from './diasHabiles.js';

/** Calendario L–V hábiles, sáb/dom no, con los festivos dados (claves YYYY-MM-DD UTC). */
function calendario(festivos: string[] = []): CalendarioLaboral {
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

/** Fecha UTC a medianoche desde YYYY-MM-DD. */
function fecha(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe('díasHábiles (lógica pura)', () => {
  describe('claveDiaUtc', () => {
    it('formatea YYYY-MM-DD en UTC con padding', () => {
      expect(claveDiaUtc(fecha('2026-01-05'))).toBe('2026-01-05');
      expect(claveDiaUtc(new Date('2026-03-09T23:30:00.000Z'))).toBe('2026-03-09');
    });
  });

  describe('esDiaHabil', () => {
    it('un miércoles normal es hábil', () => {
      // 2026-01-07 es miércoles.
      expect(esDiaHabil(fecha('2026-01-07'), calendario())).toBe(true);
    });

    it('sábado y domingo NO son hábiles (calendario L–V)', () => {
      // 2026-01-10 sábado, 2026-01-11 domingo.
      expect(esDiaHabil(fecha('2026-01-10'), calendario())).toBe(false);
      expect(esDiaHabil(fecha('2026-01-11'), calendario())).toBe(false);
    });

    it('un festivo entre semana NO es hábil', () => {
      // 2026-01-01 (jueves) es festivo.
      expect(esDiaHabil(fecha('2026-01-01'), calendario(['2026-01-01']))).toBe(false);
    });

    it('ignora la hora del día (solo cuenta el día calendario)', () => {
      expect(esDiaHabil(new Date('2026-01-07T18:45:00.000Z'), calendario())).toBe(true);
    });

    it('respeta un calendario que SÍ trabaja sábado', () => {
      const cal = calendario();
      const conSabado: CalendarioLaboral = {
        diasSemana: { ...cal.diasSemana, sabado: true },
        festivos: cal.festivos,
      };
      expect(esDiaHabil(fecha('2026-01-10'), conSabado)).toBe(true);
    });
  });

  describe('sumarDiasHabiles', () => {
    it('avanza saltando el fin de semana', () => {
      // Viernes 2026-01-09 + 1 hábil = lunes 2026-01-12 (salta sáb 10 y dom 11).
      expect(sumarDiasHabiles(fecha('2026-01-09'), 1, calendario())).toEqual(fecha('2026-01-12'));
    });

    it('avanza saltando un festivo', () => {
      // Miércoles 2026-12-23 + 2 hábiles con festivo el jue 24 y vie 25:
      // jue 24 (festivo, salta) → vie 25 (festivo, salta) → sáb/dom (salta) →
      // lun 28 (1º) → mar 29 (2º).
      const cal = calendario(['2026-12-24', '2026-12-25']);
      expect(sumarDiasHabiles(fecha('2026-12-23'), 2, cal)).toEqual(fecha('2026-12-29'));
    });

    it('CRUCE DE AÑO: avanza del 31-dic al siguiente hábil del año nuevo', () => {
      // Jueves 2026-12-31 + 1 hábil, con vie 2027-01-01 festivo:
      // vie 1 (festivo) → sáb 2/dom 3 → lun 2027-01-04 (1º).
      const cal = calendario(['2027-01-01']);
      expect(sumarDiasHabiles(fecha('2026-12-31'), 1, cal)).toEqual(fecha('2027-01-04'));
    });

    it('n NEGATIVO retrocede saltando fin de semana (CPM backward)', () => {
      // Lunes 2026-01-12 - 1 hábil = viernes 2026-01-09 (retrocede saltando dom 11 y sáb 10).
      expect(sumarDiasHabiles(fecha('2026-01-12'), -1, calendario())).toEqual(fecha('2026-01-09'));
    });

    it('n NEGATIVO retrocede saltando un festivo', () => {
      // Lunes 2026-01-05 - 1 hábil con vie 2026-01-02 festivo:
      // dom 4/sáb 3 (saltan) → vie 2 (festivo, salta) → jue 2026-01-01 ... pero jue 1 también
      // festivo → mié 2025-12-31 (1º hábil).
      const cal = calendario(['2026-01-02', '2026-01-01']);
      expect(sumarDiasHabiles(fecha('2026-01-05'), -1, cal)).toEqual(fecha('2025-12-31'));
    });

    it('n = 0 devuelve el mismo día (truncado a medianoche) aunque sea inhábil', () => {
      // Sábado inhábil: con 0 pasos NO se ajusta.
      const r = sumarDiasHabiles(new Date('2026-01-10T15:00:00.000Z'), 0, calendario());
      expect(r).toEqual(fecha('2026-01-10'));
    });

    it('avanza varios días hábiles a lo largo de dos semanas', () => {
      // Lunes 2026-01-05 + 6 hábiles: mar6,mié7,jue8,vie9 (4) → lun12,mar13 (6º) = 2026-01-13.
      expect(sumarDiasHabiles(fecha('2026-01-05'), 6, calendario())).toEqual(fecha('2026-01-13'));
    });
  });

  describe('contarDiasHabiles', () => {
    it('cuenta los hábiles del intervalo (ambos extremos incluidos)', () => {
      // lun 5 a vie 9 de ene 2026: 5 hábiles.
      expect(contarDiasHabiles(fecha('2026-01-05'), fecha('2026-01-09'), calendario())).toBe(5);
    });

    it('excluye fin de semana y festivos del intervalo', () => {
      // lun 5 a dom 11: hábiles lun-vie (5), salta sáb 10/dom 11; con jue 8 festivo = 4.
      const cal = calendario(['2026-01-08']);
      expect(contarDiasHabiles(fecha('2026-01-05'), fecha('2026-01-11'), cal)).toBe(4);
    });

    it('FESTIVO QUE CAE EN FIN DE SEMANA no resta de más (ya era inhábil)', () => {
      // sáb 2026-01-10 marcado festivo: el intervalo lun5–dom11 sigue con 5 hábiles (lun-vie),
      // el festivo en sábado no cambia nada porque el sábado ya no era hábil.
      const cal = calendario(['2026-01-10']);
      expect(contarDiasHabiles(fecha('2026-01-05'), fecha('2026-01-11'), cal)).toBe(5);
    });

    it('intervalo invertido (hasta < desde) devuelve 0', () => {
      expect(contarDiasHabiles(fecha('2026-01-09'), fecha('2026-01-05'), calendario())).toBe(0);
    });

    it('mismo día hábil cuenta 1; mismo día inhábil cuenta 0', () => {
      expect(contarDiasHabiles(fecha('2026-01-07'), fecha('2026-01-07'), calendario())).toBe(1);
      expect(contarDiasHabiles(fecha('2026-01-10'), fecha('2026-01-10'), calendario())).toBe(0);
    });

    it('CRUCE DE AÑO cuenta correctamente saltando el 1-ene festivo', () => {
      // mié 2026-12-30 a lun 2027-01-04, con vie 2027-01-01 festivo:
      // mié30, jue31 (2), vie1 festivo, sáb2/dom3, lun4 (3).
      const cal = calendario(['2027-01-01']);
      expect(contarDiasHabiles(fecha('2026-12-30'), fecha('2027-01-04'), cal)).toBe(3);
    });
  });
});
