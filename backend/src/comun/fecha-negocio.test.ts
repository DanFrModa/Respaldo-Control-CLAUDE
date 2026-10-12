import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  diaDelNegocio,
  diaDelNegocioUtc,
  fechaDelActo,
  hoyDelNegocio,
  hoyDelNegocioUtc,
  inicioDelDiaDelNegocio,
  inicioDelDiaSiguienteDelNegocio,
} from './fecha-negocio.js';

/**
 * ⭐ FILA 0.230 — EL «HOY» DEL SERVIDOR ES EL DÍA DE MÉXICO, NO EL DÍA UTC.
 *
 * El servidor corre en UTC. De 18:00 a 23:59 de México el día UTC ya es mañana, y todo lo que se
 * fechaba «hoy» con `new Date()` (la cancelación del kardex y de CxC/CxP, la lista de precios, la
 * cotización, el conteo cíclico, el semáforo de la RC…) salía con la fecha de MAÑANA.
 *
 * El reloj se ancla en las dos franjas que separan las cuentas: 23:30 (UTC ya es el día siguiente)
 * y 00:30 (los dos coinciden: ahí se ve que no se resta un día a ciegas). Se falsea sólo `Date`.
 * Los esperados van escritos como literales, no recalculados con el helper.
 */

/** 23:30 del lunes 12-oct-2026 en México (−06:00): en UTC ya es el martes 13. */
const NOCHE_EN_MEXICO = '2026-10-13T05:30:00.000Z';
/** 00:30 del martes 13-oct-2026 en México: en UTC también es el 13. */
const MADRUGADA_EN_MEXICO = '2026-10-13T06:30:00.000Z';

function relojEn(instante: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instante));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('hoyDelNegocio / hoyDelNegocioUtc (fila 0.230)', () => {
  it('⭐ a las 23:30 de México, HOY es el 12 (el día UTC ya dice 13)', () => {
    relojEn(NOCHE_EN_MEXICO);
    expect(hoyDelNegocio()).toBe('2026-10-12');
    expect(hoyDelNegocioUtc().toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  it('⭐ a las 00:30 de México ya es el 13', () => {
    relojEn(MADRUGADA_EN_MEXICO);
    expect(hoyDelNegocio()).toBe('2026-10-13');
    expect(hoyDelNegocioUtc().toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });

  it('⭐ convierte un INSTANTE inyectado al día del negocio (lo usan la RC y el Resumen)', () => {
    expect(hoyDelNegocioUtc(new Date(NOCHE_EN_MEXICO)).toISOString()).toBe(
      '2026-10-12T00:00:00.000Z',
    );
    expect(hoyDelNegocioUtc(new Date(MADRUGADA_EN_MEXICO)).toISOString()).toBe(
      '2026-10-13T00:00:00.000Z',
    );
  });

  it('el día del acto que se lee en pantalla es el mismo que el de hoy', () => {
    expect(fechaDelActo(new Date(NOCHE_EN_MEXICO))).toBe('12/10/2026');
  });
});

describe('el día de un INSTANTE y las fronteras de un día del negocio (fila 0.230)', () => {
  it('⭐ un sello de las 23:30 de México es del día 12, aunque en UTC ya sea el 13', () => {
    expect(diaDelNegocio(new Date(NOCHE_EN_MEXICO))).toBe('2026-10-12');
    expect(diaDelNegocioUtc(new Date(NOCHE_EN_MEXICO)).toISOString()).toBe(
      '2026-10-12T00:00:00.000Z',
    );
  });

  it('el día empieza a las 06:00 UTC y el siguiente también (horario fijo desde 2022)', () => {
    expect(inicioDelDiaDelNegocio('2026-10-12').toISOString()).toBe('2026-10-12T06:00:00.000Z');
    expect(inicioDelDiaSiguienteDelNegocio('2026-10-12').toISOString()).toBe(
      '2026-10-13T06:00:00.000Z',
    );
    expect(inicioDelDiaSiguienteDelNegocio('2026-12-31').toISOString()).toBe(
      '2027-01-01T06:00:00.000Z',
    );
  });

  /**
   * ⭐ Los DÍAS DE CAMBIO DE HORARIO (México los tuvo hasta 2022): la medianoche tiene otro desfase que
   * el resto del día, y preguntarlo una sola vez a mediodía erraba la frontera una hora.
   */
  it.each([
    ['2021-04-04', '2021-04-04T06:00:00.000Z', '2021-04-05T05:00:00.000Z'],
    ['2021-10-31', '2021-10-31T05:00:00.000Z', '2021-11-01T06:00:00.000Z'],
    ['2022-04-03', '2022-04-03T06:00:00.000Z', '2022-04-04T05:00:00.000Z'],
    ['2022-10-30', '2022-10-30T05:00:00.000Z', '2022-10-31T06:00:00.000Z'],
  ])(
    '⭐ cambio de horario %s: empieza en %s; el día siguiente, en %s',
    (dia, inicio, siguiente) => {
      expect(inicioDelDiaDelNegocio(dia).toISOString()).toBe(inicio);
      expect(inicioDelDiaSiguienteDelNegocio(dia).toISOString()).toBe(siguiente);
    },
  );
});
