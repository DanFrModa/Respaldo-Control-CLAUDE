/**
 * Pruebas de la ESCALA CANÓNICA del orden de tallas (V1-E3r, §Post-F9.81).
 *
 * Los casos NO son inventados: son las combinaciones reales del volcado (`Ordenes.csv`, 5,451
 * renglones → 5,383 órdenes de universo en **161 combinaciones**), con sus conteos, para que si
 * alguien retoca la escala vea contra qué la está retocando.
 *
 * ⚠️ **Los conteos de aquí y los del TSDoc de `orden-de-tallas.ts` salen de la MISMA corrida** de
 * `migracion/analisis/medicion-orden-de-tallas.ts`. Si hay que cambiarlos, se re-corre el script y
 * se cambian **los dos a la vez**: en la ronda anterior este archivo decía 252 órdenes para `2-3-3X`
 * y el módulo decía 303 — el mismo dato, dos números, en dos archivos de la misma etapa.
 */
import { describe, expect, it } from 'vitest';

import { BASE_LETRAS, deducirOrdenTalla } from './orden-de-tallas.js';

/** Ordena etiquetas como lo hace la base: por `orden` y, empatadas, por etiqueta. */
function ordenar(etiquetas: string[]): string[] {
  return [...etiquetas].sort(
    (a, b) => (deducirOrdenTalla(a) ?? 0) - (deducirOrdenTalla(b) ?? 0) || a.localeCompare(b, 'es'),
  );
}

describe('deducirOrdenTalla — la escala medida del volcado real (§Post-F9.81)', () => {
  describe('el defecto que dio origen a la etapa', () => {
    it('CH-M-G-XG ya NO sale alfabético (CH, G, M, XG)', () => {
      // 431 órdenes del volcado usan XC-CH-M-G-XG; con `orden = 0` en todo salía CH, G, M, XG.
      expect(ordenar(['XG', 'M', 'CH', 'G'])).toEqual(['CH', 'M', 'G', 'XG']);
    });

    it('la curva más usada del volcado (CH-M-G-EX, 1,928 órdenes) queda en su orden', () => {
      expect(ordenar(['EX', 'G', 'M', 'CH'])).toEqual(['CH', 'M', 'G', 'EX']);
    });
  });

  describe('hallazgo 1 — los NÚMEROS van ANTES que las LETRAS', () => {
    it('todo número queda por debajo de toda letra', () => {
      expect(deducirOrdenTalla('999')).toBeLessThan(BASE_LETRAS);
      expect(deducirOrdenTalla('2C')).toBeGreaterThanOrEqual(BASE_LETRAS);
    });

    it('2-3-3X (252 órdenes) sale 2, 3, 3X', () => {
      expect(ordenar(['3X', '2', '3'])).toEqual(['2', '3', '3X']);
    });

    it('12-14-16-CH-M-G-EX-2X sale con los números primero', () => {
      expect(ordenar(['G', '16', 'CH', '2X', '12', 'EX', 'M', '14'])).toEqual([
        '12',
        '14',
        '16',
        'CH',
        'M',
        'G',
        'EX',
        '2X',
      ]);
    });
  });

  describe('hallazgo 2 — meses y años caen en la MISMA recta numérica', () => {
    it('3M-6M-9M-12-18-2A-3A (57 órdenes) sale bien con la misma regla', () => {
      expect(ordenar(['2A', '18', '3M', '12', '3A', '9M', '6M'])).toEqual([
        '3M',
        '6M',
        '9M',
        '12',
        '18',
        '2A',
        '3A',
      ]);
    });

    it('y la misma regla ordena la curva infantil numérica 4-6-8-10-12-14-16-18', () => {
      expect(ordenar(['18', '4', '16', '6', '14', '8', '12', '10'])).toEqual([
        '4',
        '6',
        '8',
        '10',
        '12',
        '14',
        '16',
        '18',
      ]);
    });

    it('los años se convierten a MESES (2A = 24, no 2)', () => {
      expect(deducirOrdenTalla('2A')).toBe(24);
      expect(deducirOrdenTalla('6M')).toBe(6);
    });
  });

  describe('hallazgo 3 — 3X es una LETRA, y por eso acierta en sus DOS familias', () => {
    it('entre números queda al final (la familia de 2-3-3X, 252 órdenes)', () => {
      expect(ordenar(['1', '2', '3', '3X'])).toEqual(['1', '2', '3', '3X']);
    });

    it('entre letras (CH-M-G-EX-2X-3X, 17 órdenes) queda donde le toca en la escalera', () => {
      expect(ordenar(['3X', 'CH', '2X', 'EX', 'M', 'G'])).toEqual([
        'CH',
        'M',
        'G',
        'EX',
        '2X',
        '3X',
      ]);
    });

    it('leerla como el número 3 la habría mandado al principio (regresión)', () => {
      expect(deducirOrdenTalla('3X')).not.toBe(3);
    });
  });

  describe('las dos nomenclaturas de letra conviven', () => {
    it('la internacional XS-S-M-L-XL-2X-3X', () => {
      expect(ordenar(['XL', 'S', '3X', 'M', 'XS', '2X', 'L'])).toEqual([
        'XS',
        'S',
        'M',
        'L',
        'XL',
        '2X',
        '3X',
      ]);
    });

    it('la española 2C-XC-CH-M-G-EX-2X-3X', () => {
      expect(ordenar(['EX', '3X', 'M', '2C', 'G', 'XC', '2X', 'CH'])).toEqual([
        '2C',
        'XC',
        'CH',
        'M',
        'G',
        'EX',
        '2X',
        '3X',
      ]);
    });

    it('XL-1X-2X-3X: la 1X va DESPUÉS de XL', () => {
      expect(ordenar(['2X', 'XL', '3X', '1X'])).toEqual(['XL', '1X', '2X', '3X']);
    });

    it('0X-1X-2X-3X', () => {
      expect(ordenar(['3X', '0X', '2X', '1X'])).toEqual(['0X', '1X', '2X', '3X']);
    });
  });

  describe('normalización y bordes', () => {
    it('no distingue mayúsculas ni espacios (el catálogo tampoco)', () => {
      expect(deducirOrdenTalla('  ch ')).toBe(deducirOrdenTalla('CH'));
      expect(deducirOrdenTalla('6x')).toBe(deducirOrdenTalla('6X'));
    });

    it('los ceros a la izquierda son el mismo número (01 ≡ 1)', () => {
      expect(deducirOrdenTalla('01')).toBe(1);
    });

    it('devuelve null —NO 0— para lo que no reconoce, y no lo inventa', () => {
      // Etiquetas reales del volcado, casi todas data sucia del viejo.
      for (const rara of ['UT', 'MC', 'DG', 'M.', "G'", 'VA', 'NI', '-', '']) {
        expect(deducirOrdenTalla(rara)).toBeNull();
      }
    });

    it('nunca devuelve 0: el 0 es el sentinela, no un resultado', () => {
      for (const etiqueta of ['0', '00', 'CH', '12', '3M']) {
        expect(deducirOrdenTalla(etiqueta)).not.toBe(0);
      }
    });

    it('un número fuera del rango numérico no se cuela en la zona de las letras', () => {
      expect(deducirOrdenTalla('1000')).toBeNull();
      expect(deducirOrdenTalla('0')).toBeNull();
    });
  });
});
