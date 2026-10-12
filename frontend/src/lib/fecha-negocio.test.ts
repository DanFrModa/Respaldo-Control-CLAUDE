import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  aDiaLocal,
  anioDelNegocio,
  diaDeLaSemana,
  finDelDiaDelNegocio,
  hoy,
  hoyLegible,
  inicioDelDiaDelNegocio,
  lunesDeLaSemana,
  mesDelNegocio,
  sumarDias,
} from './fecha-negocio';

/**
 * ⭐ FILA 0.230 — EL «HOY» DE LA PANTALLA ES EL DÍA DE MÉXICO, NO EL DÍA UTC.
 *
 * Las horas se anclan a propósito en las dos franjas que distinguen las dos cuentas: a las 23:30 de
 * México el día UTC YA es mañana (ahí `toISOString()` proponía MAÑANA), y a las 00:30 los dos dicen
 * lo mismo (ahí se ve que el arreglo no se pasó de largo restando un día a ciegas). Una prueba sin
 * anclar sólo lo vería según la hora a la que corriera el CI.
 *
 * Los esperados van ESCRITOS como literales: si se calcularan con la misma aritmética del helper,
 * la prueba diría «es igual a sí mismo».
 */

/** 23:30 del lunes 12-oct-2026 en México (−06:00): en UTC ya es el martes 13. */
const NOCHE_EN_MEXICO = '2026-10-13T05:30:00.000Z';
/** 00:30 del martes 13-oct-2026 en México: en UTC también es el 13. */
const MADRUGADA_EN_MEXICO = '2026-10-13T06:30:00.000Z';
/** 23:30 del 31-dic-2026 en México: en UTC ya es 2027 (el año y el mes también se corrían). */
const NOCHEVIEJA_EN_MEXICO = '2027-01-01T05:30:00.000Z';
/** 23:30 del DOMINGO 11-oct-2026 en México: en UTC ya es lunes (la semana se corría entera). */
const DOMINGO_NOCHE_EN_MEXICO = '2026-10-12T05:30:00.000Z';

function relojEn(instante: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instante));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('hoy() es el día del negocio, no el día UTC (fila 0.230)', () => {
  it('⭐ a las 23:30 de México propone HOY (el 12), no el día UTC (el 13)', () => {
    relojEn(NOCHE_EN_MEXICO);
    expect(hoy()).toBe('2026-10-12');
  });

  it('⭐ a las 00:30 de México ya es el día nuevo (no se resta un día a ciegas)', () => {
    relojEn(MADRUGADA_EN_MEXICO);
    expect(hoy()).toBe('2026-10-13');
  });

  it('acepta el instante inyectado, igual que el backend', () => {
    expect(hoy(new Date(NOCHE_EN_MEXICO))).toBe('2026-10-12');
  });

  it('⭐ en Nochevieja a las 23:30 el año y el mes siguen siendo los de diciembre', () => {
    relojEn(NOCHEVIEJA_EN_MEXICO);
    expect(anioDelNegocio()).toBe(2026);
    expect(mesDelNegocio()).toBe(12);
  });

  it('a las 00:30 del 1 de enero ya es el año nuevo', () => {
    relojEn('2027-01-01T06:30:00.000Z');
    expect(anioDelNegocio()).toBe(2027);
    expect(mesDelNegocio()).toBe(1);
  });

  it('⭐ el domingo a las 23:30 la semana sigue siendo la que arrancó el lunes 5', () => {
    relojEn(DOMINGO_NOCHE_EN_MEXICO);
    expect(lunesDeLaSemana(hoy())).toBe('2026-10-05');
  });

  it('el rótulo legible también dice el día de México', () => {
    relojEn(NOCHE_EN_MEXICO);
    expect(hoyLegible({ day: 'numeric', month: 'numeric', year: 'numeric' })).toBe('12/10/2026');
  });
});

describe('aritmética de calendario sobre YYYY-MM-DD (no depende de ningún huso)', () => {
  it('sumarDias cruza meses y años, hacia adelante y hacia atrás', () => {
    expect(sumarDias('2026-10-12', 1)).toBe('2026-10-13');
    expect(sumarDias('2026-10-01', -1)).toBe('2026-09-30');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2028-03-01', -1)).toBe('2028-02-29');
    expect(sumarDias('2026-10-12', -7)).toBe('2026-10-05');
  });

  it('diaDeLaSemana: 0 = domingo … 6 = sábado', () => {
    expect(diaDeLaSemana('2026-10-11')).toBe(0);
    expect(diaDeLaSemana('2026-10-12')).toBe(1);
    expect(diaDeLaSemana('2026-10-17')).toBe(6);
  });

  it('lunesDeLaSemana: el lunes es su propio lunes y el domingo cae en la semana anterior', () => {
    expect(lunesDeLaSemana('2026-10-12')).toBe('2026-10-12');
    expect(lunesDeLaSemana('2026-10-14')).toBe('2026-10-12');
    expect(lunesDeLaSemana('2026-10-18')).toBe('2026-10-12');
    expect(lunesDeLaSemana('2026-10-11')).toBe('2026-10-05');
  });

  it('aDiaLocal arma el día a medianoche del navegador (el mismo día, sin corrimiento)', () => {
    const d = aDiaLocal('2026-10-12');
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([
      2026, 10, 12, 0,
    ]);
  });
});

describe('fronteras de un día del negocio como instantes (filtro de la bitácora)', () => {
  it('⭐ el día empieza a las 00:00 de México, que son las 06:00 UTC', () => {
    expect(inicioDelDiaDelNegocio('2026-06-01')).toBe('2026-06-01T06:00:00.000Z');
  });

  it('⭐ y termina en su último milisegundo de México (05:59:59.999 UTC del día siguiente)', () => {
    expect(finDelDiaDelNegocio('2026-06-30')).toBe('2026-07-01T05:59:59.999Z');
  });

  it('el fin de mes y de año cruzan bien', () => {
    expect(finDelDiaDelNegocio('2026-12-31')).toBe('2027-01-01T05:59:59.999Z');
  });

  /**
   * ⭐ Los DÍAS DE CAMBIO DE HORARIO (México los tuvo hasta 2022). La medianoche de esos días tiene un
   * desfase distinto del resto del día, y preguntarlo una sola vez a mediodía erraba la frontera una
   * hora. El histórico migrado de Access trae fechas de esos años.
   */
  it.each([
    ['2021-04-04', '2021-04-04T06:00:00.000Z', '2021-04-05T04:59:59.999Z'], // entra el verano a las 02:00
    ['2021-10-31', '2021-10-31T05:00:00.000Z', '2021-11-01T05:59:59.999Z'], // sale el verano a las 02:00
    ['2022-04-03', '2022-04-03T06:00:00.000Z', '2022-04-04T04:59:59.999Z'],
    ['2022-10-30', '2022-10-30T05:00:00.000Z', '2022-10-31T05:59:59.999Z'],
  ])('⭐ cambio de horario %s: empieza en %s y termina en %s', (dia, inicio, fin) => {
    expect(inicioDelDiaDelNegocio(dia)).toBe(inicio);
    expect(finDelDiaDelNegocio(dia)).toBe(fin);
  });
});
