import { describe, expect, it } from 'vitest';

import {
  normalizarParaDedup,
  parsearBandera,
  parsearDinero,
  parsearEntero,
  parsearFecha,
  parsearFechaSoloDia,
  parsearTexto,
} from './valores.js';

describe('migración · valores (conversores puros)', () => {
  describe('parsearDinero', () => {
    it('quita el símbolo de moneda, comas y espacios', () => {
      expect(parsearDinero('$2.50')).toBe(2.5);
      expect(parsearDinero('57.00')).toBe(57);
      expect(parsearDinero('$1,234.50')).toBe(1234.5);
      expect(parsearDinero(' $ 0.14 ')).toBe(0.14);
    });
    it('vacío / no parseable / null → null', () => {
      expect(parsearDinero('')).toBeNull();
      expect(parsearDinero('   ')).toBeNull();
      expect(parsearDinero('N/A')).toBeNull();
      expect(parsearDinero(null)).toBeNull();
      expect(parsearDinero(undefined)).toBeNull();
    });
    it('conserva el cero como 0 (no null)', () => {
      expect(parsearDinero('$0.00')).toBe(0);
      expect(parsearDinero('0')).toBe(0);
    });
  });

  describe('parsearBandera', () => {
    it('1 / -1 / otros números ≠ 0 → true; 0 / vacío → false', () => {
      expect(parsearBandera('1')).toBe(true);
      expect(parsearBandera('-1')).toBe(true);
      expect(parsearBandera('0')).toBe(false);
      expect(parsearBandera('')).toBe(false);
      expect(parsearBandera(null)).toBe(false);
      expect(parsearBandera(undefined)).toBe(false);
    });
  });

  describe('parsearTexto', () => {
    it('recorta y devuelve null para vacío (nunca "")', () => {
      expect(parsearTexto('  hola ')).toBe('hola');
      expect(parsearTexto('')).toBeNull();
      expect(parsearTexto('   ')).toBeNull();
      expect(parsearTexto(null)).toBeNull();
    });
    it('normaliza los \\r\\n internos de campos multilínea a \\n', () => {
      expect(parsearTexto('linea1\r\nlinea2')).toBe('linea1\nlinea2');
    });
  });

  describe('parsearEntero', () => {
    it('parsea enteros y trunca decimales; vacío → null', () => {
      expect(parsearEntero('12000')).toBe(12000);
      expect(parsearEntero('12.9')).toBe(12);
      expect(parsearEntero('')).toBeNull();
      expect(parsearEntero('abc')).toBeNull();
    });
  });

  describe('parsearFecha (F2 — formato Access DD/MM/YYYY HH:MM:SS)', () => {
    it('parsea fecha con y sin hora (UTC), día/mes en ese orden', () => {
      expect(parsearFecha('04/01/2005 00:00:00')?.toISOString()).toBe('2005-01-04T00:00:00.000Z');
      // 25 > 12 ⇒ confirma que el primer campo es DÍA, no mes.
      expect(parsearFecha('25/12/2010 13:30:00')?.toISOString()).toBe('2010-12-25T13:30:00.000Z');
      expect(parsearFecha('15/06/2008')?.toISOString()).toBe('2008-06-15T00:00:00.000Z');
    });
    it('vacío / no parseable / fecha desbordada → null', () => {
      expect(parsearFecha('')).toBeNull();
      expect(parsearFecha(null)).toBeNull();
      expect(parsearFecha('no es fecha')).toBeNull();
      expect(parsearFecha('31/02/2005')).toBeNull(); // 31 de feb no existe → no se inventa
      expect(parsearFecha('00/01/2005')).toBeNull();
    });
  });

  describe('parsearFechaSoloDia (columnas @db.Date)', () => {
    it('descarta la hora y deja medianoche UTC', () => {
      expect(parsearFechaSoloDia('25/12/2010 13:30:00')?.toISOString()).toBe(
        '2010-12-25T00:00:00.000Z',
      );
      expect(parsearFechaSoloDia('')).toBeNull();
    });
  });

  describe('normalizarParaDedup', () => {
    it('minúsculas, sin acentos, colapsa espacios, recorta', () => {
      expect(normalizarParaDedup('  José  Pérez ')).toBe('jose perez');
      expect(normalizarParaDedup('INTERSEW')).toBe('intersew');
      expect(normalizarParaDedup('Com. D’Omar')).toBe('com. d’omar');
      expect(normalizarParaDedup(null)).toBe('');
    });
    it('iguala variantes de mayúsculas/acentos del mismo nombre (dedup)', () => {
      expect(normalizarParaDedup('Maquilas SA')).toBe(normalizarParaDedup('maquilas sa'));
      expect(normalizarParaDedup('Múñoz')).toBe(normalizarParaDedup('munoz'));
    });
    it('iguala las formas Unicode NFC y NFD del MISMO texto (fix géneros: el ñ del seed vs CSV)', () => {
      // "Niño Infantil" precompuesto (ñ = U+00F1, como el CSV latin-1) vs descompuesto
      // (n + U+0303 combining tilde, como pudo guardarlo el editor del seed). Distintos a
      // nivel de bytes, pero el MISMO género → no debe duplicarse.
      const nfc = 'Niño Infantil'; // ñ precompuesto
      const nfd = 'Niño Infantil'; // n + tilde combinante (̃)
      expect(nfc).not.toBe(nfd); // de verdad difieren en code points
      expect(normalizarParaDedup(nfc)).toBe(normalizarParaDedup(nfd));
      expect(normalizarParaDedup(nfc)).toBe('nino infantil');
    });
  });
});
