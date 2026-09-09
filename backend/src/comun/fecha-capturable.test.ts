import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sesionDePrueba } from '../pruebas/sesiones.js';

import { ErrorPermiso } from './errores.js';
import {
  DIAS_VENTANA_CAPTURA,
  hoyDelNegocioUtc,
  verificarFechaCapturable,
} from './fecha-capturable.js';

/**
 * ⭐ LA VENTANA DE CAPTURA SE MIDE CONTRA EL DÍA DEL NEGOCIO, NO CONTRA EL DÍA UTC (fila 0.174 (a)).
 *
 * El servidor corre en UTC y la gente captura en México (`-06:00`, sin horario de verano desde
 * 2022). Mientras el ancla de la ventana fue `hoyUtc()`, **entre las 18:00 y las 23:59 de México el
 * día UTC ya había avanzado**, y en esa franja la pieza rompía sus DOS promesas a la vez:
 *
 *  • *«nunca una fecha futura»* — el día SIGUIENTE del calendario mexicano entraba como si fuera
 *    hoy. A las 19:00 del 9 de septiembre se podía fechar un movimiento el 10.
 *  • *«los últimos N días»* — eran **N − 1 días de negocio completos**, porque el ancla iba un día
 *    por delante y el día más viejo de la ventana caía fuera.
 *
 * Seis horas de cada día —el turno de la tarde entero— con una regla distinta de la que anuncia el
 * contrato. Por eso estas pruebas corren **dos veces, con el reloj anclado**: a mediodía de México
 * (donde el día UTC y el del negocio coinciden y no hay nada que delatar) y a las 19:00 (donde el
 * día UTC ya es el siguiente). Las dos corridas tienen que dar EXACTAMENTE lo mismo: si la ventana
 * dependiera de la hora a la que se captura, sólo la segunda se pondría roja — y eso es justo lo
 * que estaba pasando.
 *
 * ⚠️ El reloj va anclado a propósito: una prueba de husos que tome la hora real pasaría por la
 * mañana y fallaría por la tarde, que es peor que no tenerla. Se falsea sólo `Date`
 * (`toFake: ['Date']`) para no congelar los temporizadores del código asíncrono.
 */

/** El día que vive el negocio en los DOS anclajes de abajo. */
const HOY_EN_MEXICO = '2026-09-09';

/**
 * Los dos anclajes. El segundo es la franja del defecto: 19:00 en México del día 9, que en UTC ya
 * es el día 10. Escritos como instantes UTC para que no dependan de la zona del runner.
 */
const ANCLAJES: readonly { nombre: string; instante: string }[] = [
  {
    nombre: 'a mediodía de México (el día UTC y el del negocio coinciden)',
    instante: `${HOY_EN_MEXICO}T18:00:00.000Z`,
  },
  {
    nombre: 'a las 19:00 de México (en UTC ya es el día siguiente)',
    instante: '2026-09-10T01:00:00.000Z',
  },
];

/** `YYYY-MM-DD` a `dias` días de {@link HOY_EN_MEXICO} hacia atrás (negativo = futuro). */
function diaDelNegocio(dias: number): string {
  return new Date(Date.parse(`${HOY_EN_MEXICO}T00:00:00.000Z`) - dias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Como se guardan las columnas `@db.Date`: medianoche UTC del día. */
const aFecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Sesión SIN la llave (la que se topa con la ventana). Se usa la de PT; la regla es la misma. */
const sinLlave = () => sesionDePrueba({ permisos: [] });

const verificar = (iso: string) =>
  verificarFechaCapturable(sinLlave(), aFecha(iso), { permiso: 'ipt.fecha-libre' });

describe.each(ANCLAJES)('la ventana de captura $nombre', ({ instante }) => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instante));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('⭐ el ancla es el día del NEGOCIO, no el día UTC', () => {
    expect(hoyDelNegocioUtc().toISOString().slice(0, 10)).toBe(HOY_EN_MEXICO);
  });

  it('⭐ MAÑANA en México NO se puede fechar (la promesa de «nunca el futuro»)', () => {
    // Éste es el agujero de la franja de la tarde: con el ancla en UTC, aquí pasaba.
    expect(() => {
      verificar(diaDelNegocio(-1));
    }).toThrow(ErrorPermiso);
  });

  it('HOY en México sí se puede fechar (la captura del día no se bloquea)', () => {
    expect(() => {
      verificar(diaDelNegocio(0));
    }).not.toThrow();
  });

  it('⭐ la ventana son N días de negocio COMPLETOS: el día N todavía entra', () => {
    // El otro medio agujero: con el ancla en UTC, en la franja de la tarde el día más viejo caía
    // fuera y la ventana valía N − 1.
    expect(() => {
      verificar(diaDelNegocio(DIAS_VENTANA_CAPTURA));
    }).not.toThrow();
  });

  it('⭐ y el día N + 1 ya no (la ventana no se estira de más)', () => {
    expect(() => {
      verificar(diaDelNegocio(DIAS_VENTANA_CAPTURA + 1));
    }).toThrow(ErrorPermiso);
  });

  it('CON la llave, la hora del día da igual: cualquier fecha pasa', () => {
    const conLlave = sesionDePrueba({ permisos: ['ipt.fecha-libre'] });
    for (const dias of [-365, -1, 0, DIAS_VENTANA_CAPTURA + 1, 3650]) {
      expect(() => {
        verificarFechaCapturable(conLlave, aFecha(diaDelNegocio(dias)), {
          permiso: 'ipt.fecha-libre',
        });
      }).not.toThrow();
    }
  });
});
