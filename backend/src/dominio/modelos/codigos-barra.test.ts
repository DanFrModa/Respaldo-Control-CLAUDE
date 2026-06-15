import { describe, expect, it } from 'vitest';

import {
  calcularCodigosBarra,
  ErrorCodigoBarra,
  INDICADOR_DUN14,
  LARGO_BASE_EAN13,
} from './codigos-barra.js';

/**
 * Unit del cálculo PURO de códigos de barra (F1-E5) — SIN base de datos. Es la pieza más
 * crítica de la etapa: el EAN-13 generado debe coincidir DÍGITO A DÍGITO con la etiqueta
 * física real del negocio. Por eso se prueba contra:
 *  • el prefijo UPC REAL de FR Moda (`7500092`, de `Empresas.csv`),
 *  • el algoritmo módulo 10 estándar GS1 (verificador EAN-13) calculado de forma
 *    independiente aquí mismo (no se confía en el código bajo prueba para verificarlo),
 *  • el algoritmo ITF-14 estándar para el DUN-14 (con dígito indicador "1"),
 *  • y la lógica EXACTA del form viejo `Codigo` (DUN = (Total + 3) mod 10).
 */

// ── Implementaciones de referencia INDEPENDIENTES (estándar GS1) ────────────────

/** Verificador EAN-13 estándar: 12 dígitos, peso 1/3 desde la izquierda (impar/par). */
function verificadorEan13Referencia(base12: string): number {
  let suma = 0;
  for (let i = 0; i < base12.length; i += 1) {
    const n = base12.charCodeAt(i) - 48;
    suma += i % 2 === 0 ? n : n * 3;
  }
  return (10 - (suma % 10)) % 10;
}

/** Verificador ITF-14 estándar: 13 dígitos, peso 3/1 DESDE LA DERECHA. */
function verificadorItf14Referencia(base13: string): number {
  let suma = 0;
  for (let i = 0; i < base13.length; i += 1) {
    const n = base13.charCodeAt(base13.length - 1 - i) - 48;
    suma += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (suma % 10)) % 10;
}

const UPC_FR_MODA = '7500092'; // prefijo real de FR Moda (Empresas.csv, empresa activa)

describe('calcularCodigosBarra — casos reales contra el prefijo UPC de FR Moda', () => {
  // Casos calculados a mano/Python y verificados contra el estándar GS1 y el form viejo.
  const casos: { codigo: string; ean13: string; dun14: string }[] = [
    { codigo: '00501', ean13: '7500092005011', dun14: '17500092005018' },
    { codigo: '12345', ean13: '7500092123456', dun14: '17500092123453' },
    { codigo: '00001', ean13: '7500092000016', dun14: '17500092000013' },
  ];

  for (const caso of casos) {
    it(`modelo ${caso.codigo} → EAN-13 ${caso.ean13} / DUN-14 ${caso.dun14}`, () => {
      const r = calcularCodigosBarra(UPC_FR_MODA, caso.codigo);
      expect(r.base12).toBe(UPC_FR_MODA + caso.codigo);
      expect(r.base12).toHaveLength(LARGO_BASE_EAN13);
      expect(r.ean13).toBe(caso.ean13);
      expect(r.ean13).toHaveLength(13);
      expect(r.dun14).toBe(caso.dun14);
      expect(r.dun14).toHaveLength(14);
      expect(r.prefijo).toBe(UPC_FR_MODA);
      expect(r.codigoModelo).toBe(caso.codigo);
    });
  }
});

describe('calcularCodigosBarra — el verificador coincide con el estándar GS1', () => {
  // Barrido de muchos códigos: el verificador del EAN-13 y del DUN-14 SIEMPRE deben coincidir
  // con las implementaciones de referencia independientes (módulo 10 / ITF-14).
  it('EAN-13: dígito 13 = verificador módulo 10 estándar (barrido)', () => {
    for (let n = 0; n < 100000; n += 4321) {
      const codigo = String(n).padStart(5, '0');
      const base12 = UPC_FR_MODA + codigo;
      const esperado = verificadorEan13Referencia(base12);
      const r = calcularCodigosBarra(UPC_FR_MODA, codigo);
      expect(r.ean13).toBe(`${base12}${esperado}`);
    }
  });

  it('DUN-14: indicador "1" + base + verificador ITF-14 estándar (barrido)', () => {
    for (let n = 0; n < 100000; n += 4321) {
      const codigo = String(n).padStart(5, '0');
      const base13 = INDICADOR_DUN14 + UPC_FR_MODA + codigo;
      const esperado = verificadorItf14Referencia(base13);
      const r = calcularCodigosBarra(UPC_FR_MODA, codigo);
      expect(r.dun14).toBe(`${base13}${esperado}`);
    }
  });

  it('replica el form viejo: DUN = (suma EAN + 3) mod 10', () => {
    // El viejo: RestoDun = (Total + 3) Mod 10; ResultadoDun = 10 - RestoDun (0 si Resto=0).
    for (const codigo of ['00501', '99999', '00000', '54321']) {
      const base12 = UPC_FR_MODA + codigo;
      let total = 0;
      for (let i = 0; i < base12.length; i += 1) {
        const d = base12.charCodeAt(i) - 48;
        total += i % 2 === 0 ? d : d * 3;
      }
      const restoDun = (total + 3) % 10;
      const verificadorViejo = restoDun === 0 ? 0 : 10 - restoDun;
      const r = calcularCodigosBarra(UPC_FR_MODA, codigo);
      expect(r.dun14).toBe(`1${base12}${verificadorViejo}`);
    }
  });
});

describe('calcularCodigosBarra — soporta prefijos UPC de otra longitud (no hardcodea 7 dígitos)', () => {
  it('prefijo de 6 + código de 6 = 12 dígitos válidos', () => {
    const r = calcularCodigosBarra('750009', '200501');
    expect(r.base12).toBe('750009200501');
    // El EAN-13 no depende de cómo se parta el prefijo/código, solo de los 12 dígitos.
    expect(r.ean13).toBe(calcularCodigosBarra('7500092', '00501').ean13);
  });

  it('recorta espacios alrededor del prefijo y el código', () => {
    const r = calcularCodigosBarra('  7500092  ', '  00501 ');
    expect(r.ean13).toBe('7500092005011');
  });
});

describe('calcularCodigosBarra — errores de dominio (mensajes legibles, no 12 dígitos)', () => {
  it('empresa SIN UPC (prefijo vacío) → ErrorCodigoBarra que menciona el prefijo UPC', () => {
    expect(() => calcularCodigosBarra('', '00501')).toThrow(ErrorCodigoBarra);
    expect(() => calcularCodigosBarra('   ', '00501')).toThrow(/prefijo UPC/i);
  });

  it('prefijo con caracteres no numéricos → ErrorCodigoBarra', () => {
    expect(() => calcularCodigosBarra('75A0092', '00501')).toThrow(/solo dígitos/i);
  });

  it('código del modelo no numérico → ErrorCodigoBarra', () => {
    expect(() => calcularCodigosBarra(UPC_FR_MODA, '5O1AB')).toThrow(/dígitos/i);
  });

  it('faltan dígitos para llegar a 12 → ErrorCodigoBarra que dice cuántos faltan', () => {
    // 7500092 (7) + 501 (3) = 10 dígitos → faltan 2.
    expect(() => calcularCodigosBarra(UPC_FR_MODA, '501')).toThrow(/faltan 2/i);
  });

  it('sobran dígitos (más de 12) → ErrorCodigoBarra que dice cuántos sobran', () => {
    // 7500092 (7) + 005010 (6) = 13 dígitos → sobra 1.
    expect(() => calcularCodigosBarra(UPC_FR_MODA, '005010')).toThrow(/sobran 1/i);
  });

  it('código del modelo vacío → ErrorCodigoBarra', () => {
    expect(() => calcularCodigosBarra(UPC_FR_MODA, '')).toThrow(ErrorCodigoBarra);
  });
});
