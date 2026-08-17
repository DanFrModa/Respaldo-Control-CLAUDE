/**
 * Pruebas de la RETENCIÓN del respaldo (V1-E6a). Es la ÚNICA operación destructiva de la etapa, así
 * que se prueba a fondo y en aislamiento: aquí se decide qué respaldo muere.
 *
 * Lo que se cubre, en orden de gravedad si fallara:
 *  • que NO borre el respaldo recién subido,
 *  • que NO borre el más nuevo, pase lo que pase,
 *  • que una tanda de corridas manuales no se lleve por delante el año de historia,
 *  • que SÍ borre los que sobran del tope,
 *  • que no toque objetos que no son respaldos ni objetos sin fecha.
 */
import { describe, expect, it } from 'vitest';

import { PREFIJO_DEFECTO } from './config.js';
import {
  claveRespaldo,
  DIAS_INTOCABLES,
  esKeyDeRespaldo,
  seleccionarObsoletos,
} from './retencion.js';

const AHORA = new Date('2026-08-17T08:00:00.000Z');
const DIA_MS = 24 * 60 * 60 * 1000;

/** Un objeto de respaldo de hace `dias` días. */
function haceDias(dias: number): { key: string; ultimaModificacion: Date } {
  const fecha = new Date(AHORA.getTime() - dias * DIA_MS);
  return { key: claveRespaldo(PREFIJO_DEFECTO, fecha), ultimaModificacion: fecha };
}

/** Doce respaldos mensuales (uno cada 30 días), del más nuevo al más viejo. */
function unAnoDeMensuales(): { key: string; ultimaModificacion: Date }[] {
  return Array.from({ length: 12 }, (_, indice) => haceDias(indice * 30 + 1));
}

describe('claveRespaldo', () => {
  it('arma una key ordenable por fecha, partida por año', () => {
    expect(claveRespaldo('respaldos/bd', new Date('2026-08-17T08:00:00.000Z'))).toBe(
      'respaldos/bd/2026/control-2026-08-17T080000Z.dump.enc',
    );
  });

  it('el orden alfabético de las keys coincide con el cronológico', () => {
    const keys = [
      claveRespaldo('respaldos/bd', new Date('2026-12-31T23:59:00.000Z')),
      claveRespaldo('respaldos/bd', new Date('2026-01-01T00:00:00.000Z')),
      claveRespaldo('respaldos/bd', new Date('2026-08-17T08:00:00.000Z')),
    ];
    expect([...keys].sort()).toEqual([keys[1], keys[2], keys[0]]);
  });
});

describe('esKeyDeRespaldo', () => {
  it('reconoce solo lo que está bajo el prefijo y tiene la extensión del formato', () => {
    expect(
      esKeyDeRespaldo('respaldos/bd/2026/control-2026-08-17T080000Z.dump.enc', 'respaldos/bd'),
    ).toBe(true);
    expect(esKeyDeRespaldo('modelos/fotos/algo.jpg', 'respaldos/bd')).toBe(false);
    expect(esKeyDeRespaldo('respaldos/bd/2026/notas.txt', 'respaldos/bd')).toBe(false);
    // Un prefijo que solo COMPARTE el principio no cuenta (respaldos/bdviejo ≠ respaldos/bd).
    expect(esKeyDeRespaldo('respaldos/bdviejo/x.dump.enc', 'respaldos/bd')).toBe(false);
  });
});

describe('seleccionarObsoletos', () => {
  it('con 12 respaldos y tope 12, no borra nada (justo cabe el año)', () => {
    expect(
      seleccionarObsoletos(unAnoDeMensuales(), PREFIJO_DEFECTO, {
        retencion: 12,
        ahora: AHORA,
      }),
    ).toEqual([]);
  });

  it('⭐ al llegar el respaldo 13, borra el más viejo y conserva los 12 nuevos', () => {
    const doce = unAnoDeMensuales();
    const decimotercero = haceDias(12 * 30 + 1);
    const recien = { key: claveRespaldo(PREFIJO_DEFECTO, AHORA), ultimaModificacion: AHORA };

    const aBorrar = seleccionarObsoletos([...doce, decimotercero, recien], PREFIJO_DEFECTO, {
      retencion: 12,
      ahora: AHORA,
      keyProtegida: recien.key,
    });

    // Sobran dos del tope (el 13º de siempre y el más viejo de los doce); ambos superan el piso.
    expect(aBorrar).toEqual([decimotercero.key, doce[11]?.key]);
    expect(aBorrar).not.toContain(recien.key);
    expect(aBorrar).not.toContain(doce[0]?.key);
  });

  it('borra del más VIEJO al más nuevo (si se interrumpe, queda lo mejor)', () => {
    const muchos = Array.from({ length: 20 }, (_, indice) => haceDias((indice + 1) * 30));
    const aBorrar = seleccionarObsoletos(muchos, PREFIJO_DEFECTO, {
      retencion: 3,
      ahora: AHORA,
    });
    const fechas = aBorrar.map((key) => key);
    expect(fechas).toEqual([...fechas].sort()); // la key ordena como la fecha
    expect(aBorrar).toHaveLength(17);
  });

  it('NUNCA borra el respaldo recién subido, aunque el tope sea 1', () => {
    const recien = { key: claveRespaldo(PREFIJO_DEFECTO, AHORA), ultimaModificacion: AHORA };
    const viejo = haceDias(400);
    const aBorrar = seleccionarObsoletos([recien, viejo], PREFIJO_DEFECTO, {
      retencion: 1,
      ahora: AHORA,
      keyProtegida: recien.key,
    });
    expect(aBorrar).toEqual([viejo.key]);
    expect(aBorrar).not.toContain(recien.key);
  });

  it('protege la key recién subida incluso si el reloj la hiciera parecer antiquísima', () => {
    // Escenario paranoico: el reloj del servidor va adelantado un año respecto del `LastModified`
    // que puso R2. Sin la regla 1, el respaldo de HOY se borraría a sí mismo.
    const recien = haceDias(400);
    const aBorrar = seleccionarObsoletos([recien, haceDias(500), haceDias(600)], PREFIJO_DEFECTO, {
      retencion: 1,
      ahora: AHORA,
      keyProtegida: recien.key,
    });
    expect(aBorrar).not.toContain(recien.key);
  });

  it('conserva el MÁS NUEVO aunque el tope fuera 0-ish (mejor viejo que ninguno)', () => {
    const objetos = [haceDias(60), haceDias(90), haceDias(120)];
    const aBorrar = seleccionarObsoletos(objetos, PREFIJO_DEFECTO, {
      retencion: 1,
      ahora: AHORA,
    });
    expect(aBorrar).toEqual([objetos[2]?.key, objetos[1]?.key]);
    expect(aBorrar).not.toContain(objetos[0]?.key);
  });

  it('con un solo respaldo, aunque sea antiquísimo, no borra nada', () => {
    expect(
      seleccionarObsoletos([haceDias(3650)], PREFIJO_DEFECTO, { retencion: 1, ahora: AHORA }),
    ).toEqual([]);
  });

  it('⭐ una tanda de corridas MANUALES no se lleva por delante el año de historia', () => {
    // El día que Gabriel configure R2 va a correr el respaldo varias veces seguidas para probarlo.
    // Contando a secas, 13 corridas en una tarde empujarían los 12 meses fuera del tope. El piso de
    // días intocables lo impide.
    const historia = unAnoDeMensuales();
    const pruebasDeHoy = Array.from({ length: 13 }, (_, indice) => ({
      key: `${PREFIJO_DEFECTO}/2026/control-2026-08-17T0${String(indice)}0000Z.dump.enc`,
      ultimaModificacion: new Date(AHORA.getTime() - indice * 60_000),
    }));

    const aBorrar = seleccionarObsoletos([...historia, ...pruebasDeHoy], PREFIJO_DEFECTO, {
      retencion: 12,
      ahora: AHORA,
    });

    // Solo mueren los que YA pasaron el piso de días; ni uno de los recientes.
    for (const prueba of pruebasDeHoy) {
      expect(aBorrar).not.toContain(prueba.key);
    }
    // Y el más nuevo de la historia mensual (de hace 1 día) tampoco: está dentro del piso.
    expect(aBorrar).not.toContain(historia[0]?.key);
    expect(aBorrar.length).toBeGreaterThan(0); // sí borra los realmente viejos
  });

  it('el piso de días intocables protege exactamente lo de los últimos 35 días', () => {
    const dentro = haceDias(DIAS_INTOCABLES - 1);
    const fuera = haceDias(DIAS_INTOCABLES + 1);
    const nuevo = haceDias(0);
    const aBorrar = seleccionarObsoletos([nuevo, dentro, fuera], PREFIJO_DEFECTO, {
      retencion: 1,
      ahora: AHORA,
    });
    expect(aBorrar).toEqual([fuera.key]);
    expect(aBorrar).not.toContain(dentro.key);
  });

  it('no toca objetos que no son respaldos, ni siquiera bajo el mismo prefijo', () => {
    const ajeno = {
      key: `${PREFIJO_DEFECTO}/2020/notas-del-contador.pdf`,
      ultimaModificacion: new Date('2020-01-01T00:00:00.000Z'),
    };
    const objetos = [haceDias(1), haceDias(400), ajeno];
    const aBorrar = seleccionarObsoletos(objetos, PREFIJO_DEFECTO, {
      retencion: 1,
      ahora: AHORA,
    });
    expect(aBorrar).toEqual([objetos[1]?.key]);
    expect(aBorrar).not.toContain(ajeno.key);
  });

  it('no borra objetos sin fecha (sin dato no se juzga: se conserva)', () => {
    const sinFecha = { key: `${PREFIJO_DEFECTO}/2020/control-viejo.dump.enc` };
    const aBorrar = seleccionarObsoletos([haceDias(1), sinFecha, haceDias(400)], PREFIJO_DEFECTO, {
      retencion: 1,
      ahora: AHORA,
    });
    expect(aBorrar).not.toContain(sinFecha.key);
  });

  it('con el bucket vacío no borra nada (y no truena)', () => {
    expect(seleccionarObsoletos([], PREFIJO_DEFECTO, { retencion: 12, ahora: AHORA })).toEqual([]);
  });
});
