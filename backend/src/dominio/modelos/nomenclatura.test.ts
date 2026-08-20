/**
 * Reglas PURAS de la nomenclatura de modelos (§Post-F9.34 + §Post-F9.46, V1-E3n). Sin base de
 * datos: aquí se fija que los códigos se ARMEN y se LEAN bien, y que el aviso de congruencia
 * hable del par correcto. La parte que necesita la ocupación real del catálogo (propuesta del
 * hueco libre, promoción, minteo) vive en `nomenclatura.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  armarCodigoDesarrollo,
  avisosDeCongruencia,
  codigoDeNumeroProduccion,
  digitosDeCodigoDesarrollo,
  numeroProduccionDeCodigo,
  parDe,
  parTexto,
  type DigitosModelo,
} from './nomenclatura.js';

describe('numeroProduccionDeCodigo', () => {
  it('convierte un código de 5 dígitos en su número', () => {
    expect(numeroProduccionDeCodigo('71001')).toBe(71_001);
    // Concepto 2 + género 0 (Bebo): el par puede empezar bajo, nunca en 0.
    expect(numeroProduccionDeCodigo('20134')).toBe(20_134);
  });

  it('devuelve null para los códigos históricos que NO son 5 dígitos', () => {
    // Los 285 modelos del Access con variante o clave a mano: no ocupan consecutivo.
    for (const codigo of ['51783a', '71240-1', 'M-18', '501', '235713', '']) {
      expect(numeroProduccionDeCodigo(codigo)).toBeNull();
    }
  });

  it('respeta los ceros a la izquierda al ida y vuelta', () => {
    expect(numeroProduccionDeCodigo('00123')).toBe(123);
    expect(codigoDeNumeroProduccion(123)).toBe('00123');
    expect(codigoDeNumeroProduccion(71_001)).toBe('71001');
  });
});

describe('parDe / parTexto', () => {
  it('junta concepto y género en los dos dígitos del código', () => {
    expect(parDe(7, 1)).toBe(71);
    expect(parTexto(7, 1)).toBe('71');
    // Género 0 (Bebo): el par conserva el cero, no se colapsa a "2".
    expect(parTexto(2, 0)).toBe('20');
    expect(parDe(2, 0)).toBe(20);
  });
});

describe('armarCodigoDesarrollo', () => {
  it('arma el CYA-26-71-001 del ejemplo de Daniel', () => {
    expect(armarCodigoDesarrollo('CYA', 2026, 7, 1, 1)).toBe('CYA-26-71-001');
  });

  it('usa los DOS últimos dígitos del año de entrega y rellena el consecutivo a tres', () => {
    expect(armarCodigoDesarrollo('LIV', 2030, 5, 2, 47)).toBe('LIV-30-52-047');
    expect(armarCodigoDesarrollo('LIV', 2007, 5, 2, 47)).toBe('LIV-07-52-047');
  });

  it('no trunca un consecutivo de más de tres dígitos', () => {
    expect(armarCodigoDesarrollo('CYA', 2026, 7, 1, 1000)).toBe('CYA-26-71-1000');
  });
});

describe('digitosDeCodigoDesarrollo', () => {
  it('lee el concepto y el género de un código de desarrollo', () => {
    expect(digitosDeCodigoDesarrollo('CYA-26-71-001')).toEqual({ concepto: 7, genero: 1 });
    // El género 0 (Bebo) se lee como 0, no como "sin género".
    expect(digitosDeCodigoDesarrollo('LIV-27-20-013')).toEqual({ concepto: 2, genero: 0 });
  });

  it('devuelve null para lo que no tiene la forma de un código de desarrollo', () => {
    for (const codigo of ['71001', 'CYA-2026-71-001', 'CYA-26-7-001', 'M-18', 'CYA-26-71-01']) {
      expect(digitosDeCodigoDesarrollo(codigo)).toBeNull();
    }
  });
});

describe('avisosDeCongruencia', () => {
  const caballero: DigitosModelo = {
    concepto: 7,
    genero: 1,
    generoAlterno: 5,
    fuente: 'catalogo',
  };
  const dama: DigitosModelo = { concepto: 7, genero: 2, generoAlterno: null, fuente: 'catalogo' };

  it('no avisa nada cuando los dos primeros dígitos cuadran', () => {
    expect(avisosDeCongruencia(71_001, caballero)).toEqual([]);
  });

  it('no avisa cuando el número cae en la serie de CONTINUACIÓN del género (Caballero 1→5)', () => {
    expect(avisosDeCongruencia(75_004, caballero)).toEqual([]);
  });

  it('avisa —nombrando el par capturado y el esperado— cuando NO cuadran, pero no bloquea', () => {
    const avisos = avisosDeCongruencia(51_004, caballero);
    expect(avisos).toHaveLength(1);
    // El aviso tiene que decir QUÉ par se capturó (51) y CUÁL se esperaba (71); si sólo dijera
    // "no corresponde" no serviría para corregirlo.
    expect(avisos[0]).toContain('(51)');
    expect(avisos[0]).toContain('(71)');
    expect(avisos[0]).toContain('la excepción es tuya');
  });

  it('sin serie de continuación, el par alterno del OTRO género también avisa', () => {
    // 75xxx sería la continuación de Caballero; para DAMA (par 72) es un par ajeno y debe avisar.
    const avisos = avisosDeCongruencia(75_004, dama);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('(75)');
    expect(avisos[0]).toContain('(72)');
  });
});
